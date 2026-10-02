import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { api, ApiError, type Schemas, toApiError } from '../api/client'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { TextField } from '../components/ui/TextField'
import { useSession } from '../features/auth/session'
import { AuthLayout, type Fields, FormError, useAuthSubmit } from './AuthPages'

type Device = Schemas['Device']

const PLATFORM: Record<Device['platform'], string> = {
  web: '网页',
  extension: 'Chrome 插件',
  android: 'Android',
  ios: 'iOS',
  other: '其他',
}

/** 账号页：修改密码、已登录的设备（M1 的接口，M4 补上页面） */
export function AccountPage() {
  const user = useSession((s) => s.user)
  if (!user) return <Navigate to="/login" replace state={{ from: '/account' }} />
  return (
    <AuthLayout wide title="账号与设备" subtitle={`${user.name} · ${user.email}`}>
      <section aria-labelledby="password-title">
        <h2 id="password-title" className="mb-3 text-[15px] font-semibold text-ink">
          修改密码
        </h2>
        <PasswordForm />
      </section>
      <div className="my-7 h-px bg-chrome-border" />
      <section aria-labelledby="devices-title">
        <h2 id="devices-title" className="mb-1 text-[15px] font-semibold text-ink">
          已登录的设备
        </h2>
        <p className="mb-3 text-[13px] text-ink-muted">不认识的设备可以让它退出，它上面的数据不会再同步。</p>
        <DeviceList />
      </section>
    </AuthLayout>
  )
}

function PasswordForm() {
  const { fieldErrors, formError, pending, run, clearField } = useAuthSubmit(['current_password', 'new_password'])
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const current = currentRef.current?.value ?? ''
    const next = nextRef.current?.value ?? ''
    void run(
      () => {
        const f: Fields = {}
        if (!current) f.current_password = '请输入当前密码'
        if (Array.from(next).length < 8) f.new_password = '新密码至少 8 位'
        else if (next === current) f.new_password = '新密码和当前密码一样'
        return f
      },
      async () => {
        const res = await api.POST('/me/password', { body: { current_password: current, new_password: next } })
        if (res.error) throw toApiError(res.error, res.response)
        formRef.current?.reset()
        toast('密码已修改，其他设备已退出登录')
      },
    )
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError message={formError} />
      <TextField
        ref={currentRef}
        id="current-password"
        name="current_password"
        label="当前密码"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.current_password || undefined}
        onInput={() => clearField('current_password')}
      />
      <TextField
        ref={nextRef}
        id="new-password"
        name="new_password"
        label="新密码"
        type="password"
        autoComplete="new-password"
        hint="至少 8 位。修改后，其他设备需要重新登录"
        error={fieldErrors.new_password || undefined}
        onInput={() => clearField('new_password')}
      />
      <Button type="submit" loading={pending} className="self-start">
        修改密码
      </Button>
    </form>
  )
}

function DeviceList() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = async () => {
    const res = await api.GET('/me/devices')
    if (res.data) {
      setDevices(res.data)
      setError(null)
    } else setError(toApiError(res.error, res.response).message)
  }
  useEffect(() => {
    void load()
  }, [])

  const revoke = async (d: Device) => {
    setRevoking(d.id)
    try {
      const res = await api.DELETE('/me/devices/{deviceId}', { params: { path: { deviceId: d.id } } })
      if (res.error) throw toApiError(res.error, res.response)
      toast(`「${d.name}」已退出登录`)
      setDevices((list) => list?.filter((x) => x.id !== d.id) ?? null)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败，请稍后再试')
    } finally {
      setRevoking(null)
    }
  }

  if (error) return <FormError message={error} />
  if (!devices)
    return (
      <div className="flex h-16 items-center justify-center text-ink-muted">
        <Spinner />
      </div>
    )
  // 这台设备排第一，其余按最近使用
  const sorted = [...devices].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
  return (
    <ul className="divide-y divide-chrome-border rounded-ui border border-chrome-border" data-testid="devices">
      {sorted.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[14px] text-ink">
              <span className="truncate">{d.name}</span>
              {d.current && <span className="flex-none rounded-full bg-chrome-hover px-1.5 py-px text-[11px] text-ink-muted">这台设备</span>}
            </div>
            <div className="mt-0.5 text-[12.5px] text-ink-faint">
              {PLATFORM[d.platform]} · 最近使用 {formatTime(d.last_seen_at)}
            </div>
          </div>
          {!d.current && (
            <Button variant="secondary" size="sm" loading={revoking === d.id} onClick={() => void revoke(d)}>
              退出
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `昨天 ${time}`
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
