import Dexie, { type Table } from 'dexie'
import type { Board, Note, Tombstone } from '@stickydo/core/sync'
import { emptyPersisted, type NotesRepo, type Persisted, type TrashItem } from '@stickydo/core/storage'

/**
 * 便利贴的本地存储（docs/architecture.md §5.5），实现 @stickydo/core/storage 的 NotesRepo。
 * 默认 IndexedDB（Dexie），每张便利贴一行，只写变化的行；
 * 浏览器不允许使用 IndexedDB 时（例如部分隐私模式）退回 localStorage。
 */

// ---------- IndexedDB ----------

type NoteRow = Note & { owner: string }
type TombRow = Tombstone & { owner: string }
type BoardRow = Board & { owner: string }
type TrashRow = TrashItem & { owner: string }
interface MetaRow {
  owner: string
  cursor: number
}

class StickyDoDB extends Dexie {
  notes!: Table<NoteRow, [string, string]>
  tombstones!: Table<TombRow, [string, string]>
  meta!: Table<MetaRow, string>
  boards!: Table<BoardRow, [string, string]>
  boardTombstones!: Table<TombRow, [string, string]>
  trash!: Table<TrashRow, [string, string]>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      // 主键 [owner+id]；owner 上有索引，按归属读取
      notes: '[owner+id], owner',
      tombstones: '[owner+id], owner',
      // meta 行的存在表示“这个归属保存过数据”（即使一张便利贴都没有）
      meta: 'owner',
    })
    // M4：看板
    this.version(2).stores({
      boards: '[owner+id], owner',
      boardTombstones: '[owner+id], owner',
    })
    // M5：回收站
    this.version(3).stores({ trash: '[owner+id], owner' })
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
    const { notes, tombstones, boards, boardTombstones, trash, meta: metaTable } = this.db
    return this.db.transaction('r', [notes, tombstones, boards, boardTombstones, trash, metaTable], async () => {
      const meta = await metaTable.get(owner)
      if (!meta) return null
      const rows = await Promise.all([
        notes.where('owner').equals(owner).toArray(),
        tombstones.where('owner').equals(owner).toArray(),
        boards.where('owner').equals(owner).toArray(),
        boardTombstones.where('owner').equals(owner).toArray(),
        trash.where('owner').equals(owner).toArray(),
      ])
      return {
        notes: rows[0].map(strip),
        tombstones: rows[1].map(strip),
        boards: rows[2].map(strip),
        boardTombstones: rows[3].map(strip),
        trash: rows[4].map(strip),
        cursor: meta.cursor,
      }
    })
  }

  async save(owner: string, prev: Persisted | null, next: Persisted): Promise<void> {
    const p = prev ?? emptyPersisted()
    const { notes, tombstones, boards, boardTombstones, trash, meta } = this.db
    const write = async <T extends { id: string }>(table: Table<T & { owner: string }, [string, string]>, before: T[], after: T[]) => {
      const d = diff(before, after)
      if (d.put.length) await table.bulkPut(d.put.map((x) => ({ ...x, owner })))
      if (d.del.length) await table.bulkDelete(d.del.map((id) => [owner, id] as [string, string]))
    }
    await this.db.transaction('rw', [notes, tombstones, boards, boardTombstones, trash, meta], async () => {
      await write(notes, p.notes, next.notes)
      await write(tombstones, p.tombstones, next.tombstones)
      await write(boards, p.boards, next.boards)
      await write(boardTombstones, p.boardTombstones, next.boardTombstones)
      await write(trash, p.trash, next.trash)
      if (!prev || prev.cursor !== next.cursor) await meta.put({ owner, cursor: next.cursor })
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
      return { ...emptyPersisted(), ...p }
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
          ...emptyPersisted(),
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
