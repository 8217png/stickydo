import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromText } from '../features/notes/doc'
import type { Note } from '../sync/model'
import type { NotesRepo, Persisted } from './notesRepo'
import { createSaveQueue } from './saveQueue'

const note = (id: string, text = id): Note => ({
  id, content: docFromText(text), color: 'lemon', x: 0, y: 0, w: 220, h: 200, z: 1,
  version: 0, updatedAt: 1, dirty: true,
})
const data = (...notes: Note[]): Persisted => ({ notes, tombstones: [], cursor: 0 })

/** 记录每次写入的假存储；failNext 次数内的写入抛错 */
function fakeRepo() {
  const calls: { owner: string; prev: Persisted | null; next: Persisted }[] = []
  let failNext = 0
  const repo: NotesRepo = {
    kind: 'indexeddb',
    load: async () => null,
    save: async (owner, prev, next) => {
      if (failNext > 0) {
        failNext--
        throw new Error('QuotaExceededError')
      }
      calls.push({ owner, prev, next })
    },
  }
  return { repo, calls, failTimes: (n: number) => void (failNext = n) }
}

describe('createSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('写入失败后，下一次保存仍与存储里真实的内容比较，失败的行一起写入', async () => {
    const { repo, calls, failTimes } = fakeRepo()
    const q = createSaveQueue({ getRepo: async () => repo, onError: () => {} })
    const a = note('a')
    const v1 = data(a)
    q.markStored('u', v1)

    // 改了 b：写入失败
    failTimes(1)
    const v2 = data(a, note('b'))
    q.persist('u', v2)
    await q.flush()
    expect(calls).toHaveLength(0)
    expect(q.isStored('u', v2)).toBe(false)

    // 又改了 c：比较基准仍是 v1，b 和 c 都会写入
    const v3 = data(a, v2.notes[1], note('c'))
    q.persist('u', v3)
    await q.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].prev).toBe(v1)
    expect(calls[0].next).toBe(v3)
    expect(q.isStored('u', v3)).toBe(true)
  })

  it('失败后不再编辑，也会自动重试并提示恢复', async () => {
    const { repo, calls, failTimes } = fakeRepo()
    const onError = vi.fn()
    const onRecovered = vi.fn()
    const q = createSaveQueue({ getRepo: async () => repo, onError, onRecovered, retryMs: 1000 })
    q.markStored('u', data())

    failTimes(2)
    const v = data(note('a'))
    q.persist('u', v)
    await q.flush()
    expect(onError).toHaveBeenCalledTimes(1)

    // 第一次重试仍然失败
    await vi.advanceTimersByTimeAsync(1000)
    await q.flush()
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onRecovered).not.toHaveBeenCalled()

    // 第二次重试成功
    await vi.advanceTimersByTimeAsync(1000)
    await q.flush()
    expect(calls.map((c) => c.next)).toEqual([v])
    expect(q.isStored('u', v)).toBe(true)
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('重试写入的是最新排队的内容', async () => {
    const { repo, calls, failTimes } = fakeRepo()
    const q = createSaveQueue({ getRepo: async () => repo, onError: () => {}, retryMs: 1000 })
    q.markStored('u', data())

    failTimes(2)
    q.persist('u', data(note('a')))
    const latest = data(note('a'), note('b'))
    q.persist('u', latest)
    await q.flush()
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)
    await q.flush()
    expect(calls.map((c) => c.next)).toEqual([latest])
  })

  it('相同的内容只写一次', async () => {
    const { repo, calls } = fakeRepo()
    const q = createSaveQueue({ getRepo: async () => repo })
    q.markStored('u', data())
    const v = data(note('a'))
    q.persist('u', v)
    q.persist('u', v)
    await q.flush()
    q.persist('u', v)
    await q.flush()
    expect(calls).toHaveLength(1)
  })

  it('第一次写入时 onSaved 的 prev 为 null', async () => {
    const { repo } = fakeRepo()
    const onSaved = vi.fn()
    const q = createSaveQueue({ getRepo: async () => repo, onSaved })
    q.markStored('local', null)
    const v1 = data(note('a'))
    q.persist('local', v1)
    q.persist('local', data(note('a'), note('b')))
    await q.flush()
    expect(onSaved.mock.calls).toEqual([
      ['local', null],
      ['local', v1],
    ])
  })
})
