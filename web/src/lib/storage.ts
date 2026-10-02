/**
 * localStorage 读写；隐私模式等情况下可能抛错，统一吞掉。
 * 只用于很小、且要在首帧前同步读到的数据（登录状态、设置）；便利贴存在 IndexedDB（storage/notesRepo.ts）。
 */
export function load<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
