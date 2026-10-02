package httpserver

import (
	"context"

	"github.com/google/uuid"

	"github.com/8217png/stickydo/server/internal/http/api"
	"github.com/8217png/stickydo/server/internal/repo"
	"github.com/8217png/stickydo/server/internal/service"
)

func (h *handlers) SyncPull(ctx context.Context, req api.SyncPullRequestObject) (api.SyncPullResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	limit := 500
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	res, err := h.sync.Pull(ctx, p, req.Params.Since, limit)
	if err != nil {
		return nil, err
	}
	notes := make([]api.Note, len(res.Notes))
	for i := range res.Notes {
		notes[i] = noteOut(&res.Notes[i])
	}
	boards := make([]api.Board, len(res.Boards))
	for i := range res.Boards {
		boards[i] = boardOut(&res.Boards[i])
	}
	return api.SyncPull200JSONResponse{Notes: notes, Boards: boards, ServerVersion: res.ServerVersion, HasMore: res.HasMore}, nil
}

func (h *handlers) SyncPush(ctx context.Context, req api.SyncPushRequestObject) (api.SyncPushResponseObject, error) {
	p, err := mustPrincipal(ctx)
	if err != nil {
		return nil, err
	}
	changes := make([]service.NoteChange, len(req.Body.Notes))
	for i, c := range req.Body.Notes {
		changes[i] = service.NoteChange{ID: c.Id, BaseVersion: c.BaseVersion, UpdatedAt: c.UpdatedAt, Deleted: c.Deleted}
		if c.Data != nil {
			d := c.Data
			changes[i].Data = &service.NoteData{
				Content: d.Content, Color: string(d.Color), PosX: d.PosX, PosY: d.PosY,
				Width: d.Width, Height: d.Height, ZIndex: d.ZIndex, Pinned: d.Pinned, Archived: d.Archived,
				BoardID: d.BoardId,
			}
		}
	}
	var boardChanges []service.BoardChange
	if req.Body.Boards != nil {
		boardChanges = make([]service.BoardChange, len(*req.Body.Boards))
		for i, c := range *req.Body.Boards {
			boardChanges[i] = service.BoardChange{ID: c.Id, BaseVersion: c.BaseVersion, UpdatedAt: c.UpdatedAt, Deleted: c.Deleted}
			if c.Data != nil {
				boardChanges[i].Data = &service.BoardData{Name: c.Data.Name, Color: string(c.Data.Color), SortOrder: c.Data.SortOrder}
			}
		}
	}
	results, boardResults, version, err := h.sync.Push(ctx, p, changes, boardChanges)
	if err != nil {
		return nil, err
	}
	if h.hub != nil && wroteAny(results, boardResults) {
		// 通知这个用户的其他设备来拉取
		h.hub.Notify(p.UserID, p.DeviceID, version)
	}
	out := make([]api.SyncPushResult, len(results))
	for i, r := range results {
		out[i] = api.SyncPushResult{Id: r.ID, Status: api.SyncPushResultStatus(r.Status)}
		if r.Note != nil {
			n := noteOut(r.Note)
			out[i].Note = &n
		}
		if r.Reason != "" {
			reason := r.Reason
			out[i].Reason = &reason
		}
	}
	boardOutResults := make([]api.BoardPushResult, len(boardResults))
	for i, r := range boardResults {
		boardOutResults[i] = api.BoardPushResult{Id: r.ID, Status: api.BoardPushResultStatus(r.Status)}
		if r.Board != nil {
			b := boardOut(r.Board)
			boardOutResults[i].Board = &b
		}
		if r.Reason != "" {
			reason := r.Reason
			boardOutResults[i].Reason = &reason
		}
	}
	return api.SyncPush200JSONResponse{Results: out, BoardResults: boardOutResults, ServerVersion: version}, nil
}

func wroteAny(notes []service.PushResult, boards []service.BoardPushResult) bool {
	for _, r := range notes {
		if r.Status == service.PushApplied && r.Note != nil {
			return true
		}
	}
	for _, r := range boards {
		if r.Status == service.PushApplied && r.Board != nil {
			return true
		}
	}
	return false
}

func boardOut(b *repo.Board) api.Board {
	return api.Board{
		Id:        b.ID,
		Version:   b.Version,
		UpdatedAt: b.UpdatedAt,
		DeletedAt: b.DeletedAt,
		Data:      api.BoardData{Name: b.Name, Color: api.NoteColor(b.Color), SortOrder: b.SortOrder},
	}
}

func noteOut(n *repo.Note) api.Note {
	var board *uuid.UUID
	if n.BoardID.Valid {
		id := n.BoardID.UUID
		board = &id
	}
	return api.Note{
		Id:        n.ID,
		Version:   n.Version,
		UpdatedAt: n.UpdatedAt,
		DeletedAt: n.DeletedAt,
		Data: api.NoteData{
			Content:  n.Content,
			Color:    api.NoteColor(n.Color),
			PosX:     n.PosX,
			PosY:     n.PosY,
			Width:    n.Width,
			Height:   n.Height,
			ZIndex:   n.ZIndex,
			Pinned:   n.Pinned,
			Archived: n.Archived,
			BoardId:  board,
		},
	}
}
