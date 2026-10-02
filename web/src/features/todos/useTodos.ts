import { useEffect, useMemo, useState } from 'react'
import { collectTodos, type TodoRef } from '@stickydo/core/capture'
import { useNotes } from '../notes/store'

/** 所有便利贴里的待办项（随便利贴变化重新汇总） */
export function useTodos(): TodoRef[] {
  const notes = useNotes((s) => s.notes)
  return useMemo(() => collectTodos(notes), [notes])
}

/** 当前时间，每分钟更新一次：过了零点“今天”和逾期会跟着变 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}
