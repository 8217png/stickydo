package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/8217png/stickydo/server/internal/auth"
	"github.com/8217png/stickydo/server/internal/repo"
)

// Sync 实现“本地优先、按记录比新旧”的同步（docs/architecture.md §5）：便利贴和看板。
type Sync struct {
	pool *pgxpool.Pool
	q    *repo.Queries
	// Now 可在测试中替换
	Now func() time.Time
}

func NewSync(pool *pgxpool.Pool) *Sync {
	return &Sync{pool: pool, q: repo.New(pool), Now: time.Now}
}

// 单条便利贴正文的上限
const maxContentBytes = 256 << 10

type NoteData struct {
	Content  json.RawMessage
	Color    string
	PosX     float64
	PosY     float64
	Width    float64
	Height   float64
	ZIndex   int32
	Pinned   bool
	Archived bool
	// 所在看板；nil 表示收件箱
	BoardID *uuid.UUID
}

type BoardData struct {
	Name      string
	Color     string
	SortOrder string
}

type BoardChange struct {
	ID          uuid.UUID
	BaseVersion int64
	UpdatedAt   time.Time
	Deleted     bool
	Data        *BoardData
}

type BoardPushResult struct {
	ID     uuid.UUID
	Status PushStatus
	Board  *repo.Board
	Reason string
}

type NoteChange struct {
	ID          uuid.UUID
	BaseVersion int64
	UpdatedAt   time.Time
	Deleted     bool
	Data        *NoteData
}

type PushStatus string

const (
	PushApplied PushStatus = "applied"
	PushStale   PushStatus = "stale"
	PushInvalid PushStatus = "invalid"
)

type PushResult struct {
	ID     uuid.UUID
	Status PushStatus
	// 写入后（applied）或服务端当前（stale）的记录；删除一条服务端没有的便利贴时为 nil
	Note   *repo.Note
	Reason string
}

type PullResult struct {
	Notes         []repo.Note
	Boards        []repo.Board
	ServerVersion int64
	HasMore       bool
}

// Version 用户当前的服务端版本（实时连接建立时告诉客户端）。
func (s *Sync) Version(ctx context.Context, user uuid.UUID) (int64, error) {
	return s.q.GetSyncSeq(ctx, user)
}

// Pull 返回 version > since 的便利贴和看板（含已删除的），按 version 递增。
// 便利贴按 limit 分页；看板很少，每页带上同一版本区间内的全部看板。
func (s *Sync) Pull(ctx context.Context, p auth.Principal, since int64, limit int) (PullResult, error) {
	upto, err := s.q.GetSyncSeq(ctx, p.UserID)
	if err != nil {
		return PullResult{}, err
	}
	if since >= upto {
		return PullResult{Notes: []repo.Note{}, Boards: []repo.Board{}, ServerVersion: upto}, nil
	}
	notes, err := s.q.PullNotes(ctx, repo.PullNotesParams{UserID: p.UserID, Since: since, Upto: upto, MaxRows: int32(limit)})
	if err != nil {
		return PullResult{}, err
	}
	res := PullResult{Notes: notes, ServerVersion: upto}
	if len(notes) == limit && notes[len(notes)-1].Version < upto {
		res.ServerVersion = notes[len(notes)-1].Version
		res.HasMore = true
	}
	res.Boards, err = s.q.PullBoards(ctx, repo.PullBoardsParams{UserID: p.UserID, Since: since, Upto: res.ServerVersion})
	if err != nil {
		return PullResult{}, err
	}
	return res, nil
}

// Push 逐条比较新旧并写入。整批在一个事务里：先锁住用户的版本序列，
// 同一用户的推送因此串行，版本号按提交顺序递增。看板先处理，便利贴可以引用同一批里新建的看板。
func (s *Sync) Push(ctx context.Context, p auth.Principal, changes []NoteChange, boards []BoardChange) ([]PushResult, []BoardPushResult, int64, error) {
	results := make([]PushResult, 0, len(changes))
	boardResults := make([]BoardPushResult, 0, len(boards))
	var serverVersion int64
	now := s.Now()

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		seq, err := q.LockSyncSeq(ctx, p.UserID)
		if err != nil {
			return err
		}
		next := func() int64 { seq++; return seq }

		seenBoards := make(map[uuid.UUID]bool, len(boards))
		for _, c := range boards {
			if seenBoards[c.ID] {
				boardResults = append(boardResults, BoardPushResult{ID: c.ID, Status: PushInvalid, Reason: "同一批里重复的 id"})
				continue
			}
			seenBoards[c.ID] = true
			r, err := s.pushBoard(ctx, q, p, c, now, next)
			if err != nil {
				return err
			}
			boardResults = append(boardResults, r)
		}

		seen := make(map[uuid.UUID]bool, len(changes))
		for _, c := range changes {
			if seen[c.ID] {
				results = append(results, PushResult{ID: c.ID, Status: PushInvalid, Reason: "同一批里重复的 id"})
				continue
			}
			seen[c.ID] = true
			r, err := s.pushOne(ctx, q, p, c, now, next)
			if err != nil {
				return err
			}
			results = append(results, r)
		}
		serverVersion = seq
		return q.SetSyncSeq(ctx, repo.SetSyncSeqParams{UserID: p.UserID, LastVersion: seq})
	})
	if err != nil {
		return nil, nil, 0, err
	}
	return results, boardResults, serverVersion, nil
}

func (s *Sync) pushOne(ctx context.Context, q *repo.Queries, p auth.Principal, c NoteChange, now time.Time, next func() int64) (PushResult, error) {
	if !c.Deleted {
		if reason := validateNote(c.Data); reason != "" {
			return PushResult{ID: c.ID, Status: PushInvalid, Reason: reason}, nil
		}
	}
	// 时钟走快的设备不能永远胜出：编辑时间不晚于服务端当前时间
	edited := c.UpdatedAt
	if edited.After(now) {
		edited = now
	}

	board := uuid.NullUUID{}
	if !c.Deleted && c.Data.BoardID != nil {
		// 看板不存在（或属于别人）时放进收件箱，便利贴照常保存
		ok, err := q.BoardOwnedBy(ctx, repo.BoardOwnedByParams{ID: *c.Data.BoardID, UserID: p.UserID})
		if err != nil {
			return PushResult{}, err
		}
		if ok {
			board = uuid.NullUUID{UUID: *c.Data.BoardID, Valid: true}
		}
	}

	row, err := q.GetNoteForUpdate(ctx, c.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		if c.Deleted {
			// 本地新建后又删掉、从没上传过：服务端无需记录
			return PushResult{ID: c.ID, Status: PushApplied}, nil
		}
		d := c.Data
		ins, err := q.InsertNote(ctx, repo.InsertNoteParams{
			ID: c.ID, UserID: p.UserID, Content: d.Content, Color: d.Color, Pinned: d.Pinned, Archived: d.Archived,
			PosX: d.PosX, PosY: d.PosY, Width: d.Width, Height: d.Height, ZIndex: d.ZIndex,
			UpdatedAt: edited, Version: next(), BoardID: board,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// 并发插入了同一个 id（只可能是别的用户）：不覆盖
			return PushResult{ID: c.ID, Status: PushInvalid, Reason: "id 已被占用"}, nil
		}
		if err != nil {
			return PushResult{}, err
		}
		return PushResult{ID: c.ID, Status: PushApplied, Note: &ins}, nil
	}
	if err != nil {
		return PushResult{}, err
	}
	if row.UserID != p.UserID {
		return PushResult{ID: c.ID, Status: PushInvalid, Reason: "id 已被占用"}, nil
	}

	// 谁新谁赢：服务端自客户端上次同步后没变，或者客户端的编辑更晚
	clientWins := c.BaseVersion == row.Version || edited.After(row.UpdatedAt)
	if !clientWins {
		return PushResult{ID: c.ID, Status: PushStale, Note: &row}, nil
	}

	if c.Deleted {
		del, err := q.MarkNoteDeleted(ctx, repo.MarkNoteDeletedParams{ID: c.ID, UpdatedAt: edited, Version: next()})
		if err != nil {
			return PushResult{}, err
		}
		return PushResult{ID: c.ID, Status: PushApplied, Note: &del}, nil
	}
	d := c.Data
	// 编辑一条已删除的便利贴且更晚：让它“复活”（deleted_at 清空）
	upd, err := q.UpdateNote(ctx, repo.UpdateNoteParams{
		ID: c.ID, Content: d.Content, Color: d.Color, Pinned: d.Pinned, Archived: d.Archived,
		PosX: d.PosX, PosY: d.PosY, Width: d.Width, Height: d.Height, ZIndex: d.ZIndex,
		UpdatedAt: edited, DeletedAt: nil, Version: next(), BoardID: board,
	})
	if err != nil {
		return PushResult{}, err
	}
	return PushResult{ID: c.ID, Status: PushApplied, Note: &upd}, nil
}

func (s *Sync) pushBoard(ctx context.Context, q *repo.Queries, p auth.Principal, c BoardChange, now time.Time, next func() int64) (BoardPushResult, error) {
	if !c.Deleted {
		if reason := validateBoard(c.Data); reason != "" {
			return BoardPushResult{ID: c.ID, Status: PushInvalid, Reason: reason}, nil
		}
	}
	edited := c.UpdatedAt
	if edited.After(now) {
		edited = now
	}

	row, err := q.GetBoardForUpdate(ctx, c.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		if c.Deleted {
			return BoardPushResult{ID: c.ID, Status: PushApplied}, nil
		}
		d := c.Data
		ins, err := q.InsertBoard(ctx, repo.InsertBoardParams{
			ID: c.ID, UserID: p.UserID, Name: d.Name, Color: d.Color, SortOrder: d.SortOrder,
			UpdatedAt: edited, Version: next(),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return BoardPushResult{ID: c.ID, Status: PushInvalid, Reason: "id 已被占用"}, nil
		}
		if err != nil {
			return BoardPushResult{}, err
		}
		return BoardPushResult{ID: c.ID, Status: PushApplied, Board: &ins}, nil
	}
	if err != nil {
		return BoardPushResult{}, err
	}
	if row.UserID != p.UserID {
		return BoardPushResult{ID: c.ID, Status: PushInvalid, Reason: "id 已被占用"}, nil
	}
	if !(c.BaseVersion == row.Version || edited.After(row.UpdatedAt)) {
		return BoardPushResult{ID: c.ID, Status: PushStale, Board: &row}, nil
	}
	if c.Deleted {
		del, err := q.MarkBoardDeleted(ctx, repo.MarkBoardDeletedParams{ID: c.ID, UpdatedAt: edited, Version: next()})
		if err != nil {
			return BoardPushResult{}, err
		}
		return BoardPushResult{ID: c.ID, Status: PushApplied, Board: &del}, nil
	}
	d := c.Data
	upd, err := q.UpdateBoard(ctx, repo.UpdateBoardParams{
		ID: c.ID, Name: d.Name, Color: d.Color, SortOrder: d.SortOrder, UpdatedAt: edited, Version: next(),
	})
	if err != nil {
		return BoardPushResult{}, err
	}
	return BoardPushResult{ID: c.ID, Status: PushApplied, Board: &upd}, nil
}

// validateBoard 补充 OpenAPI 管不到的检查
func validateBoard(d *BoardData) string {
	if d == nil {
		return "缺少 data"
	}
	if strings.TrimSpace(d.Name) == "" {
		return "看板名称不能为空"
	}
	if strings.ContainsRune(d.Name, 0) || strings.ContainsRune(d.SortOrder, 0) {
		return "包含不支持的字符"
	}
	if !noteColors[d.Color] {
		return "不支持的颜色"
	}
	return ""
}

var noteColors = map[string]bool{
	"lemon": true, "peach": true, "blossom": true, "lavender": true,
	"sky": true, "mint": true, "sand": true, "paper": true,
}

// validateNote 补充 OpenAPI 管不到的检查；返回空字符串表示合规。
func validateNote(d *NoteData) string {
	if d == nil {
		return "缺少 data"
	}
	if len(d.Content) > maxContentBytes {
		return "正文太长"
	}
	var doc struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(d.Content, &doc); err != nil || doc.Type != "doc" {
		return "正文不是 Tiptap 文档"
	}
	// PostgreSQL 的 jsonb 不接受 \u0000；在这里拦下，避免整批推送失败
	if bytes.Contains(bytes.ToLower(d.Content), []byte(`\u0000`)) {
		return "正文包含不支持的字符"
	}
	if !noteColors[d.Color] {
		return "不支持的颜色"
	}
	for _, v := range []float64{d.PosX, d.PosY, d.Width, d.Height} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return "位置或大小不正确"
		}
	}
	return ""
}
