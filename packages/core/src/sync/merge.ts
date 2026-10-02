import type {
  Board,
  BoardsData,
  LocalChange,
  Note,
  NotesData,
  PushOutcome,
  Remote,
  RemoteChanges,
  Snapshot,
  Syncable,
  SyncData,
  Tombstone,
} from './model'

/**
 * 同步的合并规则（纯函数，docs/architecture.md §5.2）：
 * 一边改过就以那边为准；两边都改过，比较最后编辑时间，晚的胜出。
 * 便利贴和看板用同一套规则，各自独立合并。
 */

/** 一类记录：现有的和删除后留下的墓碑 */
interface Coll<E> {
  items: E[]
  tombstones: Tombstone[]
}

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))

const fromRemote = <E extends Syncable>(r: Remote<E>): E =>
  ({ ...r.data, id: r.id, version: r.version, updatedAt: r.updatedAt, dirty: false }) as unknown as E

/** 保持原有顺序，新来的追加在后面 */
function ordered<E extends { id: string }>(prev: E[], extra: { id: string }[], map: Map<string, E>): E[] {
  const seen = new Set<string>()
  const out: E[] = []
  for (const { id } of [...prev, ...extra]) {
    const x = map.get(id)
    if (x && !seen.has(id)) {
      seen.add(id)
      out.push(x)
    }
  }
  return out
}

function commitItems<E extends Syncable>(prev: Coll<E>, next: E[], now: number): Coll<E> {
  const before = byId(prev.items)
  const tombs = byId(prev.tombstones)
  const nextIds = new Set<string>()
  const items = next.map((n) => {
    nextIds.add(n.id)
    const old = before.get(n.id)
    if (old === n) return n
    // 版本号取本地已知的最新值：撤销时快照里的版本可能已经过时
    const version = old?.version ?? tombs.get(n.id)?.version ?? n.version
    return { ...n, version, updatedAt: now, dirty: true, sample: undefined }
  })
  const tombstones: Tombstone[] = prev.tombstones.filter((t) => !nextIds.has(t.id))
  for (const old of prev.items) {
    if (!nextIds.has(old.id)) tombstones.push({ id: old.id, version: old.version, deletedAt: now })
  }
  return { items, tombstones }
}

function mergeItems<E extends Syncable>(local: Coll<E>, remote: Remote<E>[]): Coll<E> {
  const items = byId(local.items)
  const tombs = byId(local.tombstones)
  for (const r of remote) {
    const mine = items.get(r.id)
    const tomb = tombs.get(r.id)
    if (mine) {
      if (!mine.dirty || r.updatedAt > mine.updatedAt) {
        // 本地没改，或服务端更新：采用服务端
        if (r.deleted) items.delete(r.id)
        else items.set(r.id, fromRemote(r))
      } else {
        // 本地更新：保留本地改动，基准版本跟上服务端，推送时直接写入
        items.set(r.id, { ...mine, version: r.version })
      }
    } else if (tomb) {
      if (r.updatedAt > tomb.deletedAt) {
        // 服务端的编辑晚于本地删除：记录“复活”
        tombs.delete(r.id)
        if (!r.deleted) items.set(r.id, fromRemote(r))
      } else if (r.deleted) {
        tombs.delete(r.id)
      } else {
        tombs.set(r.id, { ...tomb, version: r.version })
      }
    } else if (!r.deleted) {
      items.set(r.id, fromRemote(r))
    }
  }
  return { items: ordered(local.items, remote, items), tombstones: [...tombs.values()] }
}

function changesOf<E extends Syncable>(c: Coll<E>, skipId?: string | null): LocalChange<E>[] {
  const out: LocalChange<E>[] = []
  for (const n of c.items) {
    if (n.dirty && n.id !== skipId) out.push({ id: n.id, baseVersion: n.version, updatedAt: n.updatedAt, deleted: false, data: n })
  }
  for (const t of c.tombstones) {
    out.push({ id: t.id, baseVersion: t.version, updatedAt: t.deletedAt, deleted: true })
  }
  return out
}

function pushResults<E extends Syncable>(local: Coll<E>, sent: LocalChange<E>[], outcomes: PushOutcome<E>[]): Coll<E> {
  const sentById = byId(sent)
  const items = byId(local.items)
  const tombs = byId(local.tombstones)
  for (const o of outcomes) {
    const s = sentById.get(o.id)
    if (!s) continue
    const mine = items.get(o.id)
    const tomb = tombs.get(o.id)
    // 推送之后本地没有再改动
    const unchanged = mine ? !s.deleted && mine.updatedAt === s.updatedAt : !!tomb && s.deleted && tomb.deletedAt === s.updatedAt

    if (o.status === 'invalid') {
      // 服务端不接受：不再重试，保留本地副本
      if (unchanged && mine) items.set(o.id, { ...mine, dirty: false })
      if (unchanged && tomb) tombs.delete(o.id)
      continue
    }

    const r = o.remote
    if (o.status === 'applied') {
      if (unchanged) {
        if (mine) items.set(o.id, r && !r.deleted ? fromRemote(r) : { ...mine, dirty: false })
        if (tomb) tombs.delete(o.id)
      } else if (r) {
        if (mine) items.set(o.id, { ...mine, version: r.version })
        if (tomb) tombs.set(o.id, { ...tomb, version: r.version })
      }
      continue
    }

    // stale：服务端更新
    if (!r) continue
    const localLater = !unchanged && (mine ? mine.updatedAt : (tomb?.deletedAt ?? 0)) > r.updatedAt
    if (localLater) {
      // 推送后本地又改了，而且比服务端还晚：保留本地，下次推送会写入
      if (mine) items.set(o.id, { ...mine, version: r.version })
      if (tomb) tombs.set(o.id, { ...tomb, version: r.version })
      continue
    }
    tombs.delete(o.id)
    if (r.deleted) items.delete(o.id)
    else items.set(o.id, fromRemote(r))
  }
  return { items: ordered(local.items, outcomes, items), tombstones: [...tombs.values()] }
}

function patchItems<E extends Syncable>(snapshot: E[], remote: Remote<E>[]): E[] {
  if (!remote.length) return snapshot
  const changes = byId(remote)
  const out: E[] = []
  const seen = new Set<string>()
  for (const n of snapshot) {
    seen.add(n.id)
    const r = changes.get(n.id)
    if (!r) out.push(n)
    else if (!r.deleted) out.push(fromRemote(r))
  }
  for (const r of remote) if (!seen.has(r.id) && !r.deleted) out.push(fromRemote(r))
  return out
}

// ---------- 便利贴 ----------

const notesColl = (d: NotesData): Coll<Note> => ({ items: d.notes, tombstones: d.tombstones })
const toNotes = (c: Coll<Note>): NotesData => ({ notes: c.items, tombstones: c.tombstones })

/**
 * 本地编辑：比较编辑前后的便利贴数组（按对象引用），把新建、修改、恢复的标记为 dirty 并记下编辑时间，
 * 删除的留下墓碑。撤销 / 重做也走这里，算作一次新的编辑。
 */
export const commitLocal = (prev: NotesData, next: Note[], now: number): NotesData =>
  toNotes(commitItems(notesColl(prev), next, now))

/** 拉取到的服务端便利贴逐条合并进本地 */
export const mergePulled = (local: NotesData, remote: Remote<Note>[]): NotesData => toNotes(mergeItems(notesColl(local), remote))

/** 需要推送的本地改动；正在编辑的便利贴等编辑结束再推 */
export const collectChanges = (data: NotesData, skipId?: string | null): LocalChange<Note>[] => changesOf(notesColl(data), skipId)

/**
 * 处理推送结果。推送期间本地可能又改了：这时保留本地改动（仍是 dirty），
 * 只把基准版本更新为服务端最新版本。
 */
export const applyPushResults = (local: NotesData, sent: LocalChange<Note>[], outcomes: PushOutcome<Note>[]): NotesData =>
  toNotes(pushResults(notesColl(local), sent, outcomes))

/**
 * 把服务端带来的变化也应用到撤销栈的快照上：
 * 这样撤销只撤回自己的操作，不会把其他设备更新的内容“撤”回旧版本再推上去。
 */
export const patchSnapshot = (snapshot: Note[], remote: Remote<Note>[]): Note[] => patchItems(snapshot, remote)

// ---------- 看板 ----------

const boardsColl = (d: BoardsData): Coll<Board> => ({ items: d.boards, tombstones: d.boardTombstones })
const toBoards = (c: Coll<Board>): BoardsData => ({ boards: c.items, boardTombstones: c.tombstones })

export const commitBoards = (prev: BoardsData, next: Board[], now: number): BoardsData =>
  toBoards(commitItems(boardsColl(prev), next, now))
export const mergePulledBoards = (local: BoardsData, remote: Remote<Board>[]): BoardsData =>
  toBoards(mergeItems(boardsColl(local), remote))
export const collectBoardChanges = (data: BoardsData): LocalChange<Board>[] => changesOf(boardsColl(data))
export const applyBoardPushResults = (local: BoardsData, sent: LocalChange<Board>[], outcomes: PushOutcome<Board>[]): BoardsData =>
  toBoards(pushResults(boardsColl(local), sent, outcomes))

// ---------- 全部数据 ----------

/** 拉取到的便利贴和看板一起合并 */
export const mergePulledAll = <D extends SyncData>(local: D, remote: RemoteChanges): D => ({
  ...local,
  ...mergePulled(local, remote.notes),
  ...mergePulledBoards(local, remote.boards),
})

/** 撤销栈的一步也跟上服务端 */
export const patchStep = (step: Snapshot, remote: RemoteChanges): Snapshot => ({
  notes: patchItems(step.notes, remote.notes),
  boards: patchItems(step.boards, remote.boards),
})

/** 本地有没有等待推送的改动 */
export const hasPendingChanges = (data: SyncData, skipId?: string | null) =>
  collectChanges(data, skipId).length > 0 || collectBoardChanges(data).length > 0

/**
 * 登录到一个已经有便利贴的账号时，丢掉本机没动过的示例便利贴（还没上传过的），
 * 避免每台新设备都往账号里加一份示例。账号是空的（例如刚注册）时保留。
 */
export function dropUntouchedSamples<D extends NotesData>(data: D): D {
  const accountHasNotes = data.notes.some((n) => n.version > 0 && !n.sample)
  if (!accountHasNotes) return data
  const notes = data.notes.filter((n) => !(n.sample && n.version === 0))
  return notes.length === data.notes.length ? data : { ...data, notes }
}
