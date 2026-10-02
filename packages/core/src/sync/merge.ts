import type { LocalChange, Note, NotesData, PushOutcome, RemoteNote, Tombstone } from './model'

/**
 * 同步的合并规则（纯函数，docs/architecture.md §5.2）：
 * 一边改过就以那边为准；两边都改过，比较最后编辑时间，晚的胜出。
 */

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))

const fromRemote = (r: RemoteNote): Note => ({ ...r.note, id: r.id, version: r.version, updatedAt: r.updatedAt, dirty: false })

/**
 * 本地编辑：比较编辑前后的便利贴数组（按对象引用），把新建、修改、恢复的标记为 dirty 并记下编辑时间，
 * 删除的留下墓碑。撤销 / 重做也走这里，算作一次新的编辑。
 */
export function commitLocal(prev: NotesData, next: Note[], now: number): NotesData {
  const before = byId(prev.notes)
  const tombs = byId(prev.tombstones)
  const nextIds = new Set<string>()
  const notes = next.map((n) => {
    nextIds.add(n.id)
    const old = before.get(n.id)
    if (old === n) return n
    // 版本号取本地已知的最新值：撤销时快照里的版本可能已经过时
    const version = old?.version ?? tombs.get(n.id)?.version ?? n.version
    return { ...n, version, updatedAt: now, dirty: true, sample: undefined }
  })
  const tombstones: Tombstone[] = prev.tombstones.filter((t) => !nextIds.has(t.id))
  for (const old of prev.notes) {
    if (!nextIds.has(old.id)) tombstones.push({ id: old.id, version: old.version, deletedAt: now })
  }
  return { notes, tombstones }
}

/** 拉取到的服务端记录逐条合并进本地 */
export function mergePulled(local: NotesData, remote: RemoteNote[]): NotesData {
  const notes = byId(local.notes)
  const tombs = byId(local.tombstones)
  for (const r of remote) {
    const mine = notes.get(r.id)
    const tomb = tombs.get(r.id)
    if (mine) {
      if (!mine.dirty || r.updatedAt > mine.updatedAt) {
        // 本地没改，或服务端更新：采用服务端
        if (r.deleted) notes.delete(r.id)
        else notes.set(r.id, fromRemote(r))
      } else {
        // 本地更新：保留本地改动，基准版本跟上服务端，推送时直接写入
        notes.set(r.id, { ...mine, version: r.version })
      }
    } else if (tomb) {
      if (r.updatedAt > tomb.deletedAt) {
        // 服务端的编辑晚于本地删除：便利贴“复活”
        tombs.delete(r.id)
        if (!r.deleted) notes.set(r.id, fromRemote(r))
      } else if (r.deleted) {
        tombs.delete(r.id)
      } else {
        tombs.set(r.id, { ...tomb, version: r.version })
      }
    } else if (!r.deleted) {
      notes.set(r.id, fromRemote(r))
    }
  }
  // 保持原有顺序，新来的追加在后面
  const order = [...local.notes.map((n) => n.id), ...remote.map((r) => r.id)]
  const seen = new Set<string>()
  const merged: Note[] = []
  for (const id of order) {
    const n = notes.get(id)
    if (n && !seen.has(id)) {
      seen.add(id)
      merged.push(n)
    }
  }
  return { notes: merged, tombstones: [...tombs.values()] }
}

/** 需要推送的本地改动；正在编辑的便利贴等编辑结束再推 */
export function collectChanges(data: NotesData, skipId?: string | null): LocalChange[] {
  const out: LocalChange[] = []
  for (const n of data.notes) {
    if (n.dirty && n.id !== skipId) out.push({ id: n.id, baseVersion: n.version, updatedAt: n.updatedAt, deleted: false, note: n })
  }
  for (const t of data.tombstones) {
    out.push({ id: t.id, baseVersion: t.version, updatedAt: t.deletedAt, deleted: true })
  }
  return out
}

/**
 * 处理推送结果。推送期间本地可能又改了：这时保留本地改动（仍是 dirty），
 * 只把基准版本更新为服务端最新版本。
 */
export function applyPushResults(local: NotesData, sent: LocalChange[], outcomes: PushOutcome[]): NotesData {
  const sentById = byId(sent)
  const notes = byId(local.notes)
  const tombs = byId(local.tombstones)
  for (const o of outcomes) {
    const s = sentById.get(o.id)
    if (!s) continue
    const mine = notes.get(o.id)
    const tomb = tombs.get(o.id)
    // 推送之后本地没有再改动
    const unchanged = mine ? !s.deleted && mine.updatedAt === s.updatedAt : !!tomb && s.deleted && tomb.deletedAt === s.updatedAt

    if (o.status === 'invalid') {
      // 服务端不接受：不再重试，保留本地副本
      if (unchanged && mine) notes.set(o.id, { ...mine, dirty: false })
      if (unchanged && tomb) tombs.delete(o.id)
      continue
    }

    const r = o.remote
    if (o.status === 'applied') {
      if (unchanged) {
        if (mine) notes.set(o.id, r && !r.deleted ? fromRemote(r) : { ...mine, dirty: false })
        if (tomb) tombs.delete(o.id)
      } else if (r) {
        if (mine) notes.set(o.id, { ...mine, version: r.version })
        if (tomb) tombs.set(o.id, { ...tomb, version: r.version })
      }
      continue
    }

    // stale：服务端更新
    if (!r) continue
    const localLater = !unchanged && (mine ? mine.updatedAt : (tomb?.deletedAt ?? 0)) > r.updatedAt
    if (localLater) {
      // 推送后本地又改了，而且比服务端还晚：保留本地，下次推送会写入
      if (mine) notes.set(o.id, { ...mine, version: r.version })
      if (tomb) tombs.set(o.id, { ...tomb, version: r.version })
      continue
    }
    tombs.delete(o.id)
    if (r.deleted) notes.delete(o.id)
    else notes.set(o.id, fromRemote(r))
  }
  const order = [...local.notes.map((n) => n.id), ...outcomes.map((o) => o.id)]
  const seen = new Set<string>()
  const merged: Note[] = []
  for (const id of order) {
    const n = notes.get(id)
    if (n && !seen.has(id)) {
      seen.add(id)
      merged.push(n)
    }
  }
  return { notes: merged, tombstones: [...tombs.values()] }
}

/**
 * 把服务端带来的变化也应用到撤销栈的快照上：
 * 这样撤销只撤回自己的操作，不会把其他设备更新的内容“撤”回旧版本再推上去。
 */
export function patchSnapshot(snapshot: Note[], remote: RemoteNote[]): Note[] {
  const changes = byId(remote)
  const out: Note[] = []
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

/**
 * 登录到一个已经有便利贴的账号时，丢掉本机没动过的示例便利贴（还没上传过的），
 * 避免每台新设备都往账号里加一份示例。账号是空的（例如刚注册）时保留。
 */
export function dropUntouchedSamples(data: NotesData): NotesData {
  const accountHasNotes = data.notes.some((n) => n.version > 0 && !n.sample)
  if (!accountHasNotes) return data
  const notes = data.notes.filter((n) => !(n.sample && n.version === 0))
  return notes.length === data.notes.length ? data : { ...data, notes }
}
