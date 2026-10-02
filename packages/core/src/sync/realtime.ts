/**
 * 实时通知的客户端（docs/architecture.md §5.6）：连上 /sync/ws，服务端说“有新版本”时通知同步引擎去拉取。
 * 只传通知不传数据，所以连接断了也不会丢东西：重连后服务端会告诉当前版本，落后就拉取。
 * 不依赖浏览器 API 以外的东西，React Native 也有 WebSocket。
 */

export interface RealtimeOptions {
  /** WebSocket 地址，例如 wss://example.com/api/v1/sync/ws */
  url: () => string
  /** 有效的 Access Token；未登录返回 null */
  getToken: () => Promise<string | null>
  /** 服务端有新版本（连接建立时也会报一次当前版本） */
  onVersion: (serverVersion: number) => void
  /** 连接状态变化：连上（已认证）/ 断开 */
  onStatus?: (connected: boolean) => void
  /** 设备被吊销（4003）：不再重连，等登录状态变化 */
  onRevoked?: () => void
  WebSocketImpl?: typeof WebSocket
  /** 重连等待：从 minDelay 开始翻倍，最多 maxDelay */
  minDelayMs?: number
  maxDelayMs?: number
}

export interface Realtime {
  /** 开始连接（已经在连就不变） */
  start: () => void
  /** 断开且不再重连 */
  stop: () => void
  /** 立即重连（例如网络恢复） */
  reconnectNow: () => void
  isConnected: () => boolean
}

const CLOSE_UNAUTHORIZED = 4001
const CLOSE_REVOKED = 4003

export function createRealtime(o: RealtimeOptions): Realtime {
  const WS = o.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  const minDelay = o.minDelayMs ?? 1000
  const maxDelay = o.maxDelayMs ?? 30_000

  let ws: WebSocket | null = null
  let running = false
  let connected = false
  let delay = minDelay
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 每次连接的编号：旧连接迟到的事件不处理 */
  let generation = 0

  const setConnected = (v: boolean) => {
    if (connected === v) return
    connected = v
    o.onStatus?.(v)
  }

  function schedule(ms = delay) {
    clearTimeout(timer)
    if (!running) return
    // 加一点随机，避免服务端重启后所有客户端同时重连
    timer = setTimeout(connect, ms * (0.8 + Math.random() * 0.4))
    delay = Math.min(maxDelay, delay * 2)
  }

  async function connect() {
    if (!running || !WS) return
    const gen = ++generation
    const token = await o.getToken().catch(() => null)
    if (gen !== generation || !running) return
    if (!token) {
      schedule()
      return
    }
    let sock: WebSocket
    try {
      sock = new WS(o.url())
    } catch {
      schedule()
      return
    }
    ws = sock
    sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token }))
    sock.onmessage = (e) => {
      if (gen !== generation) return
      let m: { type?: string; server_version?: number }
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.type === 'ready') {
        delay = minDelay
        setConnected(true)
      }
      if ((m.type === 'ready' || m.type === 'changed') && typeof m.server_version === 'number') o.onVersion(m.server_version)
    }
    sock.onclose = (e) => {
      if (gen !== generation) return
      ws = null
      setConnected(false)
      if (e.code === CLOSE_REVOKED) {
        running = false
        o.onRevoked?.()
        return
      }
      // 4001：Token 被拒（可能刚过期），下次取 Token 时会刷新；其他情况按退避重连
      schedule(e.code === CLOSE_UNAUTHORIZED ? minDelay : delay)
    }
    sock.onerror = () => {
      /* 随后会触发 onclose */
    }
  }

  return {
    start() {
      if (running) return
      running = true
      delay = minDelay
      void connect()
    },
    stop() {
      running = false
      generation++
      clearTimeout(timer)
      setConnected(false)
      ws?.close(1000)
      ws = null
    },
    reconnectNow() {
      if (!running || connected) return
      delay = minDelay
      clearTimeout(timer)
      generation++
      ws?.close(1000)
      ws = null
      void connect()
    },
    isConnected: () => connected,
  }
}
