import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromText } from '../features/notes/doc'
import type { Note } from '@stickydo/core/sync'
import type { Persisted } from '@stickydo/core/storage'
import { IdbNotesRepo, migrateFromLocalStorage } from './notesRepo'

const note = (id: string, text: string, over: Partial<Note> = {}): Note => ({
  id, content: docFromText(text), color: 'lemon', x: 0, y: 0, w: 220, h: 200, z: 1,
  version: 0, updatedAt: 1, dirty: true, ...over,
})

// Node 里没有 localStorage：用一个最小实现
function installLocalStorage() {
  const m = new Map<string, string>()
  const ls = {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
  vi.stubGlobal('localStorage', ls)
  return ls
}

let dbSeq = 0
const openRepo = () => IdbNotesRepo.open(`test-${++dbSeq}`)

describe('IdbNotesRepo', () => {
  it('从未保存过的归属返回 null；保存空数据后返回空数据', async () => {
    const repo = await openRepo()
    expect(await repo.load('local')).toBeNull()
    await repo.save('local', null, { notes: [], tombstones: [], cursor: 0 })
    expect(await repo.load('local')).toEqual({ notes: [], tombstones: [], cursor: 0 })
  })

  it('保存与读取往返一致，归属之间互不影响', async () => {
    const repo = await openRepo()
    const a: Persisted = { notes: [note('a', 'A')], tombstones: [{ id: 't', version: 2, deletedAt: 5 }], cursor: 7 }
    await repo.save('user-1', null, a)
    await repo.save('user-2', null, { notes: [note('b', 'B')], tombstones: [], cursor: 0 })
    expect(await repo.load('user-1')).toEqual(a)
    expect((await repo.load('user-2'))?.notes.map((n) => n.id)).toEqual(['b'])
  })

  it('只写入变化的行：修改、删除、墓碑与游标', async () => {
    const repo = await openRepo()
    const a = note('a', 'A')
    const b = note('b', 'B')
    const v1: Persisted = { notes: [a, b], tombstones: [], cursor: 0 }
    await repo.save('u', null, v1)

    const a2 = { ...a, x: 99 }
    const v2: Persisted = { notes: [a2], tombstones: [{ id: 'b', version: 0, deletedAt: 9 }], cursor: 3 }
    await repo.save('u', v1, v2)
    const loaded = await repo.load('u')
    expect(loaded?.notes).toEqual([a2])
    expect(loaded?.tombstones).toEqual([{ id: 'b', version: 0, deletedAt: 9 }])
    expect(loaded?.cursor).toBe(3)
  })

  it('同一归属在两个“标签页”里改不同的便利贴，互不覆盖（按行写入）', async () => {
    const repo = await openRepo()
    const a = note('a', 'A')
    const b = note('b', 'B')
    const base: Persisted = { notes: [a, b], tombstones: [], cursor: 0 }
    await repo.save('u', null, base)
    // 标签页 1 改 a，标签页 2 改 b，都以 base 为“上次保存”
    await repo.save('u', base, { ...base, notes: [{ ...a, x: 1 }, b] })
    await repo.save('u', base, { ...base, notes: [a, { ...b, x: 2 }] })
    const loaded = await repo.load('u')
    expect(loaded?.notes.find((n) => n.id === 'a')?.x).toBe(1)
    expect(loaded?.notes.find((n) => n.id === 'b')?.x).toBe(2)
  })
})

describe('migrateFromLocalStorage', () => {
  let ls: ReturnType<typeof installLocalStorage>
  beforeEach(() => {
    ls = installLocalStorage()
  })

  it('把各归属的 localStorage 数据搬进 IndexedDB，并删除旧数据', async () => {
    const repo = await openRepo()
    ls.setItem('stickydo.notes.v2:local', JSON.stringify({ notes: [note('a', 'A')], tombstones: [], cursor: 0 }))
    ls.setItem('stickydo.notes.v2:user-1', JSON.stringify({ notes: [note('b', 'B', { version: 4, dirty: false })], tombstones: [], cursor: 4 }))
    ls.setItem('stickydo.theme', '"dark"')
    await migrateFromLocalStorage(repo, (n) => n as Note)
    expect((await repo.load('local'))?.notes.map((n) => n.id)).toEqual(['a'])
    expect(await repo.load('user-1')).toMatchObject({ cursor: 4, notes: [{ id: 'b', version: 4 }] })
    expect(ls.getItem('stickydo.notes.v2:local')).toBeNull()
    expect(ls.getItem('stickydo.notes.v2:user-1')).toBeNull()
    // 其他设置不受影响
    expect(ls.getItem('stickydo.theme')).toBe('"dark"')
  })

  it('IndexedDB 里已有该归属的数据时不覆盖', async () => {
    const repo = await openRepo()
    await repo.save('local', null, { notes: [note('new', '新的')], tombstones: [], cursor: 0 })
    ls.setItem('stickydo.notes.v2:local', JSON.stringify({ notes: [note('old', '旧的')], tombstones: [], cursor: 0 }))
    await migrateFromLocalStorage(repo, (n) => n as Note)
    expect((await repo.load('local'))?.notes.map((n) => n.id)).toEqual(['new'])
  })
})
