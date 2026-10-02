import { type FormEvent, type ReactNode, type Ref, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '../api/client'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { useSession } from '../features/auth/session'
import { isExtension } from '../extension/surface'
import { normalizeServer, requestServerPermission, serverOrigin, setServerOrigin } from '../api/server'

// ---------- 布局 ----------

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="board-surface h-full overflow-y-auto">
      <div className={`mx-auto flex min-h-full w-full flex-col justify-center px-4 py-12 ${wide ? 'max-w-[520px]' : 'max-w-[400px]'}`}>
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 self-start rounded-lg px-1 text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 3L5 8l5 5" />
          </svg>
          返回白板
        </Link>

        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 10, rotate: -0.6 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          {/* 卡片两角露出的两张便利贴 */}
          <div aria-hidden className="absolute -top-5 -left-6 h-20 w-24 -rotate-6 rounded-note max-sm:hidden" style={{ background: 'var(--note-lemon)', boxShadow: 'var(--shadow-note)' }} />
          <div aria-hidden className="absolute -right-5 -bottom-6 h-16 w-28 rotate-[5deg] rounded-note max-sm:hidden" style={{ background: 'var(--note-sky)', boxShadow: 'var(--shadow-note)' }} />

          <div className="relative rounded-[14px] border border-chrome-border bg-surface p-7 shadow-[var(--shadow-note)] max-sm:p-5">
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-1 mb-6 text-[13.5px] text-ink-muted">{subtitle}</p>
            {children}
          </div>
        </motion.div>

        {footer && <div className="mt-8 text-center text-[13px] text-ink-muted">{footer}</div>}
      </div>
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="mb-4 rounded-ui bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
      {message}
    </div>
  )
}

// ---------- 表单状态 ----------

export type Fields = Record<string, string>

/** 提交表单：把服务端返回的字段错误标到对应输入框，其余错误显示在表单顶部 */
export function useAuthSubmit(fieldNames: string[]) {
  const [fieldErrors, setFieldErrors] = useState<Fields>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = async (check: () => Fields, action: () => Promise<void>) => {
    const local = check()
    setFormError(null)
    if (Object.keys(local).length > 0) {
      setFieldErrors(local)
      return
    }
    setFieldErrors({})
    setPending(true)
    try {
      await action()
    } catch (err) {
      const e = err instanceof ApiError ? err : ApiError.network()
      const known = Object.fromEntries(Object.entries(e.fields).filter(([k]) => fieldNames.includes(k)))
      setFieldErrors(known)
      if (Object.keys(known).length === 0 || e.code !== 'validation_failed') setFormError(e.message)
    } finally {
      setPending(false)
    }
  }

  const clearField = (name: string) => setFieldErrors((f) => (f[name] ? { ...f, [name]: '' } : f))
  return { fieldErrors, formError, pending, run, clearField }
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

// ---------- 插件：服务器地址（E2） ----------

/** 插件要先填连哪台服务器（自己部署的 Sticky-Do）；网页版与服务端同源，不显示 */
function ServerField({ inputRef, error, onInput }: { inputRef: Ref<HTMLInputElement>; error?: string; onInput: () => void }) {
  if (!isExtension) return null
  return (
    <TextField
      ref={inputRef}
      id="auth-server"
      name="server"
      label="服务器"
      inputMode="url"
      autoComplete="url"
      defaultValue={serverOrigin() ?? ''}
      placeholder="notes.example.com"
      hint="你部署的 Sticky-Do 地址"
      error={error}
      onInput={onInput}
    />
  )
}

function checkServer(raw: string | undefined, f: Fields): string | null {
  if (!isExtension) return null
  const origin = normalizeServer(raw ?? '')
  if (!origin) f.server = '请输入服务器地址，例如 notes.example.com'
  return origin
}

/**
 * 插件：申请访问这台服务器的权限，然后记下地址。必须在点击（提交）的同一轮里直接调用，
 * 中间不能先 await 别的，否则浏览器不弹授权框。
 */
async function applyServer(origin: string | null) {
  if (!isExtension || !origin) return
  if (!(await requestServerPermission(origin))) {
    throw new ApiError({ status: 0, code: 'network', title: '需要允许访问这台服务器才能登录', fields: { server: '没有获得访问权限' } })
  }
  setServerOrigin(origin)
}

// ---------- 登录 ----------

export function LoginPage() {
  const user = useSession((s) => s.user)
  const login = useSession((s) => s.login)
  const navigate = useNavigate()
  const location = useLocation()
  const { fieldErrors, formError, pending, run, clearField } = useAuthSubmit(['server', 'email', 'password'])
  const serverRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (user && !pending) return <Navigate to="/" replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const email = emailRef.current?.value ?? ''
    const password = passwordRef.current?.value ?? ''
    let origin: string | null = null
    void run(
      () => {
        const f: Fields = {}
        origin = checkServer(serverRef.current?.value, f)
        if (!email.trim()) f.email = '请输入邮箱'
        else if (!looksLikeEmail(email)) f.email = '请输入有效的邮箱地址'
        if (!password) f.password = '请输入密码'
        return f
      },
      async () => {
        await applyServer(origin)
        const u = await login(email, password)
        toast(`欢迎回来，${u.name}`)
        const from = (location.state as { from?: string } | null)?.from
        navigate(from && from.startsWith('/') ? from : '/', { replace: true })
      },
    )
  }

  return (
    <AuthLayout
      title="欢迎回来"
      subtitle="登录你的 Sticky-Do 账号"
      footer={
        <>
          还没有账号？{' '}
          <Link to="/register" className="font-medium text-ink underline decoration-field-border underline-offset-4 hover:decoration-ink">
            注册
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError message={formError} />
        <ServerField inputRef={serverRef} error={fieldErrors.server || undefined} onInput={() => clearField('server')} />
        <TextField
          ref={emailRef}
          id="login-email"
          name="email"
          label="邮箱"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder="you@example.com"
          error={fieldErrors.email || undefined}
          onInput={() => clearField('email')}
        />
        <TextField
          ref={passwordRef}
          id="login-password"
          name="password"
          label="密码"
          type="password"
          autoComplete="current-password"
          error={fieldErrors.password || undefined}
          onInput={() => clearField('password')}
        />
        <Button type="submit" size="lg" block loading={pending} className="mt-2">
          登录
        </Button>
      </form>
    </AuthLayout>
  )
}

// ---------- 注册 ----------

export function RegisterPage() {
  const user = useSession((s) => s.user)
  const register = useSession((s) => s.register)
  const navigate = useNavigate()
  const { fieldErrors, formError, pending, run, clearField } = useAuthSubmit(['server', 'name', 'email', 'password'])
  const serverRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (user && !pending) return <Navigate to="/" replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const name = nameRef.current?.value.trim() ?? ''
    const email = emailRef.current?.value ?? ''
    const password = passwordRef.current?.value ?? ''
    let origin: string | null = null
    void run(
      () => {
        const f: Fields = {}
        origin = checkServer(serverRef.current?.value, f)
        if (name.length > 50) f.name = '名字最多 50 个字'
        if (!email.trim()) f.email = '请输入邮箱'
        else if (!looksLikeEmail(email)) f.email = '请输入有效的邮箱地址'
        if (Array.from(password).length < 8) f.password = '密码至少 8 位'
        return f
      },
      async () => {
        await applyServer(origin)
        const u = await register(email, password, name)
        toast(`注册成功，欢迎你，${u.name}`)
        navigate('/', { replace: true })
      },
    )
  }

  return (
    <AuthLayout
      title="创建账号"
      subtitle="不注册也能用，注册后可以在多台设备上登录同一个账号"
      footer={
        <>
          已经有账号了？{' '}
          <Link to="/login" className="font-medium text-ink underline decoration-field-border underline-offset-4 hover:decoration-ink">
            登录
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormError message={formError} />
        <ServerField inputRef={serverRef} error={fieldErrors.server || undefined} onInput={() => clearField('server')} />
        <TextField
          ref={nameRef}
          id="register-name"
          name="name"
          label="名字"
          labelAside={<span className="text-[12px] text-ink-faint">可选</span>}
          autoComplete="nickname"
          autoFocus={!isExtension}
          maxLength={50}
          placeholder="怎么称呼你"
          error={fieldErrors.name || undefined}
          onInput={() => clearField('name')}
        />
        <TextField
          ref={emailRef}
          id="register-email"
          name="email"
          label="邮箱"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          error={fieldErrors.email || undefined}
          onInput={() => clearField('email')}
        />
        <TextField
          ref={passwordRef}
          id="register-password"
          name="password"
          label="密码"
          type="password"
          autoComplete="new-password"
          hint="至少 8 位"
          error={fieldErrors.password || undefined}
          onInput={() => clearField('password')}
        />
        <Button type="submit" size="lg" block loading={pending} className="mt-2">
          注册并登录
        </Button>
      </form>
    </AuthLayout>
  )
}
