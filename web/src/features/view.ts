import { create } from 'zustand'
import { load, save } from '../lib/storage'

/**
 * 当前看的是什么（docs/frontend-design.md §4）：某块白板（收件箱或某个看板），
 * 或者从所有便利贴里汇总出的待办列表。每个页面各自记住，不跨标签页同步。
 */
export type View =
  | { kind: 'board'; boardId: string | null }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'done' }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }

export type TodoViewKind = 'today' | 'upcoming' | 'done' | 'tag'

const VIEW_KEY = 'stickydo.view'
const SIDEBAR_KEY = 'stickydo.sidebar'

export const INBOX: View = { kind: 'board', boardId: null }

function initialView(): View {
  const v = load<View>(VIEW_KEY)
  if (!v || typeof v !== 'object') return INBOX
  switch (v.kind) {
    case 'board':
      return { kind: 'board', boardId: typeof v.boardId === 'string' ? v.boardId : null }
    case 'today':
    case 'upcoming':
    case 'done':
    case 'trash':
      return { kind: v.kind }
    case 'tag':
      return typeof v.tag === 'string' && v.tag ? { kind: 'tag', tag: v.tag } : INBOX
    default:
      return INBOX
  }
}

interface ViewState {
  view: View
  /** 宽屏：侧边栏展开（专注模式时收起）；窄屏：抽屉是否打开 */
  sidebarOpen: boolean
}

const wide = () => typeof window === 'undefined' || window.innerWidth >= 900

export const useView = create<ViewState>(() => ({
  view: initialView(),
  sidebarOpen: wide() && load<boolean>(SIDEBAR_KEY) !== false,
}))

export function setView(view: View) {
  save(VIEW_KEY, view)
  // 窄屏上选完就收起抽屉
  useView.setState(wide() ? { view } : { view, sidebarOpen: false })
}

export function toggleSidebar(open = !useView.getState().sidebarOpen) {
  if (wide()) save(SIDEBAR_KEY, open)
  useView.setState({ sidebarOpen: open })
}

/** 当前白板对应的看板；不在白板视图时为 null（收件箱） */
export const activeBoardId = (): string | null => {
  const v = useView.getState().view
  return v.kind === 'board' ? v.boardId : null
}

export const sameView = (a: View, b: View) =>
  a.kind === b.kind &&
  (a.kind !== 'board' || a.boardId === (b as typeof a).boardId) &&
  (a.kind !== 'tag' || a.tag === (b as typeof a).tag)

// 窗口在宽窄之间切换：变窄时收起（抽屉默认关闭），变宽时恢复宽屏下记住的状态
if (typeof window !== 'undefined' && typeof matchMedia !== 'undefined') {
  matchMedia('(min-width: 900px)').addEventListener('change', (e) => {
    useView.setState({ sidebarOpen: e.matches && load<boolean>(SIDEBAR_KEY) !== false })
  })
}

// ---------- 白板 / 列表 ----------

export type BoardLayout = 'board' | 'list'
const LAYOUT_KEY = 'stickydo.layout'

/** 看板的显示方式：白板（自由摆放）或列表（按阅读顺序一列排开）。所有看板共用，记在本机 */
export const useBoardLayout = create<{ layout: BoardLayout }>(() => ({
  layout: load<BoardLayout>(LAYOUT_KEY) === 'list' ? 'list' : 'board',
}))

/**
 * 便利贴不多于这个数时才做共享元素过渡（layoutId）和列表里的让位动画：
 * 带着 layoutId 的元素每次渲染都要测量位置，便利贴一多就卡（实测 120 张时每次换选中约 60ms，60 张以内没有长任务）。
 */
export const MORPH_LIMIT = 60

export function setBoardLayout(layout: BoardLayout) {
  save(LAYOUT_KEY, layout)
  useBoardLayout.setState({ layout })
}

export const toggleBoardLayout = () => setBoardLayout(useBoardLayout.getState().layout === 'board' ? 'list' : 'board')
