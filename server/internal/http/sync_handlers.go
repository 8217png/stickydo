package httpserver

import (
	"context"

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
	return api.SyncPull200JSONResponse{Notes: notes, ServerVersion: res.ServerVersion, HasMore: res.HasMore}, nil
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
			}
		}
	}
	results, version, err := h.sync.Push(ctx, p, changes)
	if err != nil {
		return nil, err
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
	return api.SyncPush200JSONResponse{Results: out, ServerVersion: version}, nil
}

func noteOut(n *repo.Note) api.Note {
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
		},
	}
}
