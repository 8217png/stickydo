import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealtime } from './realtime'

/** 假的 WebSocket：记录发出的消息，测试里手动触发服务端事件 */
class FakeWS {
  static all: FakeWS[] = []
  sent: string[] = []
  closed: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWS.all.push(this)
  }
  send(s: string) {
    this.sent.push(s)
  }
  close(code = 1000) {
    this.closed = code
  }
  // 服务端动作
  open() {
    this.onopen?.()
  }
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createRealtime', () => {
  beforeEach(() => {
    FakeWS.all = []
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const versions: number[] = []
    const status: boolean[] = []
    let revoked = 0
    const rt = createRealtime({
      url: () => 'ws://test/sync/ws',
      getToken: async () => 'tok',
      onVersion: (v) => versions.push(v),
      onStatus: (c) => status.push(c),
      onRevoked: () => revoked++,
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      minDelayMs: 1000,
      maxDelayMs: 8000,
    })
    return { rt, versions, status, revoked: () => revoked }
  }

  it('连上后先认证；ready 和 changed 都报告版本', async () => {
    const { rt, versions, status } = setup()
    rt.start()
    await vi.waitFor(() => expect(FakeWS.all).toHaveLength(1))
    const ws = FakeWS.all[0]
    ws.open()
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'auth', token: 'tok' })
    ws.msg({ type: 'ready', server_version: 5 })
    ws.msg({ type: 'changed', server_version: 7 })
    expect(versions).toEqual([5, 7])
    expect(status).toEqual([true])
    expect(rt.isConnected()).toBe(true)
  })

  it('断线后退避重连，连上后退避时间复位', async () => {
    const { rt, status } = setup()
    rt.start()
    await vi.waitFor(() => expect(FakeWS.all).toHaveLength(1))
    FakeWS.all[0].open()
    FakeWS.all[0].msg({ type: 'ready', server_version: 1 })
    FakeWS.all[0].drop()
    expect(status).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(1300)
    await flush()
    expect(FakeWS.all).toHaveLength(2)
    // 第二次也失败：等待翻倍
    FakeWS.all[1].drop()
    await vi.advanceTimersByTimeAsync(1300)
    expect(FakeWS.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1300)
    await flush()
    expect(FakeWS.all).toHaveLength(3)
  })

  it('设备被吊销（4003）不再重连；stop 后也不重连', async () => {
    const { rt, revoked } = setup()
    rt.start()
    await vi.waitFor(() => expect(FakeWS.all).toHaveLength(1))
    FakeWS.all[0].drop(4003)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWS.all).toHaveLength(1)
    expect(revoked()).toBe(1)

    rt.start()
    await vi.waitFor(() => expect(FakeWS.all).toHaveLength(2))
    rt.stop()
    expect(FakeWS.all[1].closed).toBe(1000)
    FakeWS.all[1].drop(1000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWS.all).toHaveLength(2)
  })
})
