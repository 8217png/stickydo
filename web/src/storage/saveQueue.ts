import type { NotesRepo, Persisted } from './notesRepo'

/**
 * 按顺序把便利贴写入本地存储，只写变化的行。
 *
 * 与之比较的“上次保存的内容”只在写入成功后才更新：写入失败时，下一次保存仍与
 * 存储里真实的内容比较，失败的那些行会重新写入，不会被当成已经保存过。
 * 失败后隔一段时间自动重试最新的内容。
 */

export interface SaveQueueOptions {
  getRepo: () => Promise<NotesRepo>
  /** 写入成功之后；prev 为 null 表示这个归属第一次写入 */
  onSaved?: (owner: string, prev: Persisted | null) => void
  /** 写入失败（每次失败都会调用） */
  onError?: (err: unknown) => void
  /** 失败之后又写入成功 */
  onRecovered?: () => void
  retryMs?: number
}

export const samePersisted = (a: Persisted | null | undefined, b: Persisted) =>
  !!a && a.notes === b.notes && a.tombstones === b.tombstones && a.cursor === b.cursor

export function createSaveQueue({ getRepo, onSaved, onError, onRecovered, retryMs = 3000 }: SaveQueueOptions) {
  /** 每个归属确实写入了存储的内容 */
  const stored = new Map<string, Persisted | null>()
  /** 每个归属最近一次排队的内容，用于去掉重复的保存 */
  const queued = new Map<string, Persisted>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let chain: Promise<void> = Promise.resolve()
  let failing = false

  function scheduleRetry(owner: string) {
    if (retryTimers.has(owner)) return
    retryTimers.set(
      owner,
      setTimeout(() => {
        retryTimers.delete(owner)
        const latest = queued.get(owner)
        queued.delete(owner)
        if (latest) persist(owner, latest)
      }, retryMs),
    )
  }

  /** 排队保存 */
  function persist(owner: string, next: Persisted) {
    const last = queued.has(owner) ? queued.get(owner) : stored.get(owner)
    if (samePersisted(last, next)) return
    queued.set(owner, next)
    chain = chain.then(async () => {
      // 在真正写入时才取比较基准：前面的写入失败了，这里就会把失败的行一起写上
      const prev = stored.get(owner) ?? null
      if (samePersisted(prev, next)) return
      try {
        await (await getRepo()).save(owner, prev, next)
      } catch (err) {
        failing = true
        onError?.(err)
        scheduleRetry(owner)
        return
      }
      stored.set(owner, next)
      if (failing && retryTimers.size === 0) {
        failing = false
        onRecovered?.()
      }
      onSaved?.(owner, prev)
    })
  }

  return {
    persist,
    /** 记下存储里现有的内容（刚读出来时） */
    markStored(owner: string, p: Persisted | null) {
      stored.set(owner, p)
      queued.delete(owner)
    },
    /** 本页的内容是否都已写入存储 */
    isStored: (owner: string, s: Persisted) => samePersisted(stored.get(owner), s),
    /** 等待所有排队中的保存完成 */
    flush: () => chain,
  }
}
