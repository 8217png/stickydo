import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

/**
 * 把 @stickydo/core 里的 zustand store 包装成 React hook，
 * 用法与 zustand 的 create() 相同：useX(selector)、useX.getState()、useX.subscribe()。
 */
export function bindStore<T>(store: StoreApi<T>) {
  const hook = <U>(selector: (s: T) => U): U => useStore(store, selector)
  return Object.assign(hook, store)
}
