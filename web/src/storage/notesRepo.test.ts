import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromText } from '../features/notes/doc'
import type { Board, Note } from '@stickydo/core/sync'
import { emptyPersisted, type Persisted } from '@stickydo/core/storage'
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
const NB = { boards: [], boardTombstones: [], trash: [] }
const openRepo = () => IdbNotesRepo.open(`test-${++dbSeq}`)

describe('IdbNotesRepo', () => {
  it('从未保存过的归属返回 null；保存空数据后返回空数据', async () => {
    const repo = await openRepo()
    expect(await repo.load('local')).toBeNull()
    await repo.save('local', null, emptyPersisted())
    expect(await repo.load('local')).toEqual(emptyPersisted())
  })

  it('保存与读取往返一致，归属之间互不影响', async () => {
    const repo = await openRepo()
    const a: Persisted = { ...NB, notes: [note('a', 'A')], tombstones: [{ id: 't', version: 2, deletedAt: 5 }], cursor: 7 }
    await repo.save('user-1', null, a)
    await repo.save('user-2', null, { ...NB, notes: [note('b', 'B')], tombstones: [], cursor: 0 })
    expect(await repo.load('user-1')).toEqual(a)
    expect((await repo.load('user-2'))?.notes.map((n) => n.id)).toEqual(['b'])
  })

  it('M3 及之前的数据库（版本 1，没有看板表）升级后照常读取', async () => {
    const name = `test-${++dbSeq}`
    const old = new Dexie(name)
    old.version(1).stores({ notes: '[owner+id], owner', tombstones: '[owner+id], owner', meta: 'owner' })
    await old.open()
    await old.table('notes').put({ ...note('a', 'A'), owner: 'local' })
    await old.table('meta').put({ owner: 'local', cursor: 5 })
    old.close()
    const repo = await IdbNotesRepo.open(name)
    expect(await repo.load('local')).toMatchObject({ notes: [{ id: 'a' }], boards: [], boardTombstones: [], cursor: 5 })
  })

  it('看板与便利贴一起保存，删除的看板留下墓碑', async () => {
    const repo = await openRepo()
    const work: Board = { id: 'w', name: '工作', color: 'sky', sortOrder: 'a0', version: 0, updatedAt: 1, dirty: true }
    const life: Board = { ...work, id: 'l', name: '生活' }
    const v1: Persisted = { ...emptyPersisted(), notes: [note('a', 'A', { boardId: 'w' })], boards: [work, life] }
    await repo.save('u', null, v1)
    const v2: Persisted = { ...v1, boards: [{ ...work, name: '工作 2' }], boardTombstones: [{ id: 'l', version: 0, deletedAt: 3 }] }
    await repo.save('u', v1, v2)
    const loaded = await repo.load('u')
    expect(loaded?.boards).toEqual([{ ...work, name: '工作 2' }])
    expect(loaded?.boardTombstones).toEqual([{ id: 'l', version: 0, deletedAt: 3 }])
    expect(loaded?.notes[0].boardId).toBe('w')
  })

  it('只写入变化的行：修改、删除、墓碑与游标', async () => {
    const repo = await openRepo()
    const a = note('a', 'A')
    const b = note('b', 'B')
    const v1: Persisted = { ...NB, notes: [a, b], tombstones: [], cursor: 0 }
    await repo.save('u', null, v1)

    const a2 = { ...a, x: 99 }
    const v2: Persisted = { ...NB, notes: [a2], tombstones: [{ id: 'b', version: 0, deletedAt: 9 }], cursor: 3 }
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
    const base: Persisted = { ...NB, notes: [a, b], tombstones: [], cursor: 0 }
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
    await repo.save('local', null, { ...NB, notes: [note('new', '新的')], tombstones: [], cursor: 0 })
    ls.setItem('stickydo.notes.v2:local', JSON.stringify({ notes: [note('old', '旧的')], tombstones: [], cursor: 0 }))
    await migrateFromLocalStorage(repo, (n) => n as Note)
    expect((await repo.load('local'))?.notes.map((n) => n.id)).toEqual(['new'])
  })
})
