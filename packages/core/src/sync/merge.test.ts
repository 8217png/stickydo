import { describe, expect, it } from 'vitest'
import { docFromText } from '../notes/doc'
import { applyPushResults, collectChanges, commitLocal, mergePulled, patchSnapshot } from './merge'
import type { Note, NotesData, RemoteNote } from './model'

const note = (id: string, text: string, over: Partial<Note> = {}): Note => ({
  id, content: docFromText(text), color: 'lemon', x: 0, y: 0, w: 220, h: 200, z: 1,
  version: 1, updatedAt: 1000, dirty: false, ...over,
})

const remote = (id: string, text: string, version: number, updatedAt: number, deleted = false): RemoteNote => ({
  id, version, updatedAt, deleted,
  note: { id, content: docFromText(text), color: 'sky', x: 5, y: 5, w: 220, h: 200, z: 2 },
})

const text = (n?: Note) => n?.content.content?.[0]?.content?.[0]?.text
const data = (notes: Note[], tombstones: NotesData['tombstones'] = []): NotesData => ({ notes, tombstones })

describe('commitLocal', () => {
  it('只把真正改动的便利贴标记为 dirty，并记下编辑时间', () => {
    const a = note('a', 'A')
    const b = note('b', 'B')
    const next = [a, { ...b, color: 'mint' as const }]
    const r = commitLocal(data([a, b]), next, 5000)
    expect(r.notes[0]).toBe(a)
    expect(r.notes[1]).toMatchObject({ dirty: true, updatedAt: 5000, version: 1, color: 'mint' })
  })

  it('删除留下墓碑，恢复时去掉墓碑并沿用已知版本', () => {
    const a = note('a', 'A', { version: 7 })
    const deleted = commitLocal(data([a]), [], 5000)
    expect(deleted.tombstones).toEqual([{ id: 'a', version: 7, deletedAt: 5000 }])
    // 撤销删除：快照里的对象带着旧版本号
    const restored = commitLocal(deleted, [{ ...a, version: 3 }], 6000)
    expect(restored.tombstones).toEqual([])
    expect(restored.notes[0]).toMatchObject({ version: 7, dirty: true, updatedAt: 6000 })
  })
})

describe('mergePulled（谁新谁赢）', () => {
  it('本地没改、服务端变了：服务端新，直接采用', () => {
    const r = mergePulled(data([note('a', '旧')]), [remote('a', '新', 2, 2000)])
    expect(text(r.notes[0])).toBe('新')
    expect(r.notes[0]).toMatchObject({ version: 2, dirty: false })
  })

  it('两边都改：本地更晚，保留本地，基准版本跟上服务端', () => {
    const mine = note('a', '本地', { dirty: true, updatedAt: 3000 })
    const r = mergePulled(data([mine]), [remote('a', '服务端', 2, 2000)])
    expect(text(r.notes[0])).toBe('本地')
    expect(r.notes[0]).toMatchObject({ version: 2, dirty: true })
  })

  it('两边都改：服务端更晚，采用服务端', () => {
    const mine = note('a', '本地', { dirty: true, updatedAt: 1500 })
    const r = mergePulled(data([mine]), [remote('a', '服务端', 2, 2000)])
    expect(text(r.notes[0])).toBe('服务端')
    expect(r.notes[0].dirty).toBe(false)
  })

  it('服务端删除：本地没改就删；本地改得更晚就保留（推送后复活）', () => {
    expect(mergePulled(data([note('a', 'x')]), [remote('a', 'x', 2, 2000, true)]).notes).toEqual([])
    const kept = mergePulled(data([note('a', 'x', { dirty: true, updatedAt: 3000 })]), [remote('a', 'x', 2, 2000, true)])
    expect(kept.notes[0]).toMatchObject({ dirty: true, version: 2 })
  })

  it('本地删除 vs 服务端编辑：比较时间', () => {
    const tomb = { id: 'a', version: 1, deletedAt: 2500 }
    const later = mergePulled(data([], [tomb]), [remote('a', '服务端更晚', 2, 3000)])
    expect(later.tombstones).toEqual([])
    expect(text(later.notes[0])).toBe('服务端更晚')
    const earlier = mergePulled(data([], [tomb]), [remote('a', '服务端更早', 2, 2000)])
    expect(earlier.notes).toEqual([])
    expect(earlier.tombstones).toEqual([{ ...tomb, version: 2 }])
  })

  it('新的远端便利贴加入本地；本地没有的已删除记录忽略', () => {
    const r = mergePulled(data([note('a', 'A')]), [remote('b', 'B', 3, 2000), remote('c', 'C', 4, 2000, true)])
    expect(r.notes.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('collectChanges', () => {
  it('收集 dirty 便利贴与墓碑，跳过正在编辑的', () => {
    const d = data([note('a', 'A', { dirty: true, version: 2, updatedAt: 9 }), note('b', 'B'), note('c', 'C', { dirty: true })], [
      { id: 'd', version: 4, deletedAt: 8 },
    ])
    const cs = collectChanges(d, 'c')
    expect(cs.map((c) => [c.id, c.baseVersion, c.updatedAt, c.deleted])).toEqual([
      ['a', 2, 9, false],
      ['d', 4, 8, true],
    ])
  })
})

describe('applyPushResults', () => {
  it('applied：采用服务端写入后的版本并清除 dirty；墓碑清除', () => {
    const d = data([note('a', 'A', { dirty: true, version: 0, updatedAt: 9 })], [{ id: 'd', version: 4, deletedAt: 8 }])
    const sent = collectChanges(d)
    const r = applyPushResults(d, sent, [
      { id: 'a', status: 'applied', remote: remote('a', 'A', 10, 9) },
      { id: 'd', status: 'applied', remote: remote('d', '', 11, 8, true) },
    ])
    expect(r.notes[0]).toMatchObject({ version: 10, dirty: false })
    expect(r.tombstones).toEqual([])
  })

  it('推送期间本地又改了：保留改动，只更新基准版本', () => {
    const before = data([note('a', 'A1', { dirty: true, updatedAt: 9 })])
    const sent = collectChanges(before)
    const now = data([note('a', 'A2', { dirty: true, updatedAt: 12 })])
    const r = applyPushResults(now, sent, [{ id: 'a', status: 'applied', remote: remote('a', 'A1', 10, 9) }])
    expect(text(r.notes[0])).toBe('A2')
    expect(r.notes[0]).toMatchObject({ version: 10, dirty: true })
  })

  it('stale：服务端更新，采用服务端；服务端已删除则删除本地', () => {
    const d = data([note('a', '本地', { dirty: true, updatedAt: 9 }), note('b', '本地', { dirty: true, updatedAt: 9 })])
    const r = applyPushResults(d, collectChanges(d), [
      { id: 'a', status: 'stale', remote: remote('a', '服务端', 20, 15) },
      { id: 'b', status: 'stale', remote: remote('b', '', 21, 15, true) },
    ])
    expect(r.notes.map((n) => [n.id, text(n), n.dirty])).toEqual([['a', '服务端', false]])
  })

  it('invalid：不再重试，本地副本保留', () => {
    const d = data([note('a', 'A', { dirty: true, updatedAt: 9 })])
    const r = applyPushResults(d, collectChanges(d), [{ id: 'a', status: 'invalid' }])
    expect(r.notes[0]).toMatchObject({ dirty: false })
    expect(text(r.notes[0])).toBe('A')
  })
})

describe('patchSnapshot（撤销栈跟上服务端）', () => {
  it('替换、删除、补充远端变化', () => {
    const snap = [note('a', '旧'), note('b', 'B')]
    const out = patchSnapshot(snap, [remote('a', '新', 2, 2000), remote('b', '', 3, 2000, true), remote('c', 'C', 4, 2000)])
    expect(out.map((n) => [n.id, text(n)])).toEqual([
      ['a', '新'],
      ['c', 'C'],
    ])
  })
})

describe('dropUntouchedSamples', () => {
  it('账号已有便利贴时丢掉没动过、没上传的示例', async () => {
    const { dropUntouchedSamples } = await import('./merge')
    const d = data([note('s1', '示例', { sample: true, version: 0 }), note('s2', '动过的示例', { version: 0 }), note('a', '账号里的', { version: 3 })])
    expect(dropUntouchedSamples(d).notes.map((n) => n.id)).toEqual(['s2', 'a'])
  })

  it('账号是空的（刚注册）时保留示例', async () => {
    const { dropUntouchedSamples } = await import('./merge')
    const d = data([note('s1', '示例', { sample: true, version: 0 })])
    expect(dropUntouchedSamples(d).notes).toHaveLength(1)
  })

  it('编辑会清除示例标记', () => {
    const s = note('s1', '示例', { sample: true })
    expect(commitLocal(data([s]), [{ ...s, x: 10 }], 1).notes[0].sample).toBeUndefined()
  })
})
