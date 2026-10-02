import { Component, type ReactNode } from 'react'
import { toast } from 'sonner'

/**
 * 按需加载的部分（快速记录、命令面板、登录页等）加载失败时不要拖垮整个页面：
 * 常见原因是部署了新版本、旧的分块文件已经不在，提示刷新即可。
 */
export class LoadBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error('[load] 加载失败', err)
    toast.error('有一部分内容没能加载，刷新页面试试', {
      id: 'chunk-load-failed',
      action: { label: '刷新', onClick: () => location.reload() },
    })
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}
