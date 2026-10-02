import Dexie, { type Table } from 'dexie'
import type { Note, NotesData, Tombstone } from '../sync/model'

/**
 * 便利贴的本地存储（docs/architecture.md §5.5）。
 * 默认 IndexedDB（Dexie），每张便利贴一行，只写变化的行；
 * 浏览器不允许使用 IndexedDB 时（例如部分隐私模式）退回 localStorage。
 */

export interface Persisted extends NotesData {
  /** 同步游标：上次拉取到的服务端版本 */
  cursor: number
}

export interface NotesRepo {
  readonly kind: 'indexeddb' | 'localstorage'
  /** 读取某个归属（本机或某个账号）的全部数据；从未保存过返回 null */
  load(owner: string): Promise<Persisted | null>
  /** 保存：与 prev（上次保存的内容）比较，只写入变化的部分 */
  save(owner: string, prev: Persisted | null, next: Persisted): Promise<void>
}

export const emptyPersisted = (): Persisted => ({ notes: [], tombstones: [], cursor: 0 })

// ---------- IndexedDB ----------

type NoteRow = Note & { owner: string }
type TombRow = Tombstone & { owner: string }
interface MetaRow {
  owner: string
  cursor: number
}

class StickyDoDB extends Dexie {
  notes!: Table<NoteRow, [string, string]>
  tombstones!: Table<TombRow, [string, string]>
  meta!: Table<MetaRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      // 主键 [owner+id]；owner 上有索引，按归属读取
      notes: '[owner+id], owner',
      tombstones: '[owner+id], owner',
      // meta 行的存在表示“这个归属保存过数据”（即使一张便利贴都没有）
      meta: 'owner',
    })
  }
}

const strip = <T extends { owner: string }>({ owner: _owner, ...rest }: T) => rest

/** 按对象引用找出变化：新增或修改的要写入，消失的要删除 */
function diff<T extends { id: string }>(prev: T[], next: T[]) {
  const before = new Map(prev.map((x) => [x.id, x]))
  const put = next.filter((x) => before.get(x.id) !== x)
  const nextIds = new Set(next.map((x) => x.id))
  const del = prev.filter((x) => !nextIds.has(x.id)).map((x) => x.id)
  return { put, del }
}

export class IdbNotesRepo implements NotesRepo {
  readonly kind = 'indexeddb' as const
  constructor(private db: StickyDoDB) {}

  static async open(name = 'stickydo'): Promise<IdbNotesRepo> {
    const db = new StickyDoDB(name)
    await db.open()
    return new IdbNotesRepo(db)
  }

  async load(owner: string): Promise<Persisted | null> {
    return this.db.transaction('r', this.db.notes, this.db.tombstones, this.db.meta, async () => {
      const meta = await this.db.meta.get(owner)
      if (!meta) return null
      const [notes, tombstones] = await Promise.all([
        this.db.notes.where('owner').equals(owner).toArray(),
        this.db.tombstones.where('owner').equals(owner).toArray(),
      ])
      return { notes: notes.map(strip), tombstones: tombstones.map(strip), cursor: meta.cursor }
    })
  }

  async save(owner: string, prev: Persisted | null, next: Persisted): Promise<void> {
    const p = prev ?? emptyPersisted()
    const notes = diff(p.notes, next.notes)
    const tombs = diff(p.tombstones, next.tombstones)
    await this.db.transaction('rw', this.db.notes, this.db.tombstones, this.db.meta, async () => {
      if (notes.put.length) await this.db.notes.bulkPut(notes.put.map((n) => ({ ...n, owner })))
      if (notes.del.length) await this.db.notes.bulkDelete(notes.del.map((id) => [owner, id] as [string, string]))
      if (tombs.put.length) await this.db.tombstones.bulkPut(tombs.put.map((t) => ({ ...t, owner })))
      if (tombs.del.length) await this.db.tombstones.bulkDelete(tombs.del.map((id) => [owner, id] as [string, string]))
      if (!prev || prev.cursor !== next.cursor) await this.db.meta.put({ owner, cursor: next.cursor })
    })
  }
}

// ---------- localStorage（退路） ----------

export const lsKey = (owner: string) => `stickydo.notes.v2:${owner}`

export class LocalStorageNotesRepo implements NotesRepo {
  readonly kind = 'localstorage' as const

  async load(owner: string): Promise<Persisted | null> {
    try {
      const raw = localStorage.getItem(lsKey(owner))
      if (!raw) return null
      const p = JSON.parse(raw) as Partial<Persisted>
      return { notes: p.notes ?? [], tombstones: p.tombstones ?? [], cursor: p.cursor ?? 0 }
    } catch {
      return null
    }
  }

  async save(owner: string, _prev: Persisted | null, next: Persisted): Promise<void> {
    localStorage.setItem(lsKey(owner), JSON.stringify(next))
  }
}

// ---------- 从 localStorage 迁移到 IndexedDB ----------

/**
 * M2 及之前的数据在 localStorage：stickydo.notes.v2:<owner>（各归属）与 stickydo.m0.notes（更早的本机数据）。
 * 搬进 IndexedDB 后删除；IndexedDB 里已有同一归属的数据时不覆盖。
 * 返回旧版（M0/M1）本机数据，交给调用方转换格式。
 */
export async function migrateFromLocalStorage(repo: NotesRepo, normalize: (raw: unknown) => Note | null): Promise<void> {
  if (repo.kind !== 'indexeddb' || typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('stickydo.notes.v2:')) keys.push(k)
  }
  for (const key of keys) {
    const owner = key.slice('stickydo.notes.v2:'.length)
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Persisted> | null
      if (raw && !(await repo.load(owner))) {
        await repo.save(owner, null, {
          notes: (raw.notes ?? []).map(normalize).filter((n): n is Note => !!n),
          tombstones: raw.tombstones ?? [],
          cursor: raw.cursor ?? 0,
        })
      }
      localStorage.removeItem(key)
    } catch (err) {
      // 迁移失败就保留旧数据，下次再试
      console.warn('[storage] 迁移失败，保留 localStorage 中的数据', key, err)
    }
  }
}

/** 打开存储：优先 IndexedDB，不可用时退回 localStorage */
export async function openNotesRepo(): Promise<NotesRepo> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB')
    const repo = await IdbNotesRepo.open()
    // 尽量申请持久化存储，避免浏览器在空间紧张时清掉数据
    void navigator.storage?.persist?.().catch(() => false)
    return repo
  } catch (err) {
    console.warn('[storage] IndexedDB 不可用，改用 localStorage', err)
    return new LocalStorageNotesRepo()
  }
}
