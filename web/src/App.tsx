import { lazy, Suspense, useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { useSettings } from './features/settings'
import { surface } from './extension/surface'
import { BoardPage } from './routes/BoardPage'
import { LoadBoundary } from './components/LoadBoundary'

// 登录、注册、账号页不在首屏，按需加载
const LoginPage = lazy(() => import('./routes/AuthPages').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('./routes/AuthPages').then((m) => ({ default: m.RegisterPage })))
const AccountPage = lazy(() => import('./routes/AccountPage').then((m) => ({ default: m.AccountPage })))

// 嵌入时宿主页面在根元素上设置的主题（我们自己的显式选择不算）
const initialTheme =
  useSettings.getState().theme === 'system' ? document.documentElement.dataset.theme : undefined

function useResolvedTheme() {
  const pref = useSettings((s) => s.theme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const systemTheme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : systemDark ? 'dark' : 'light'
  const theme = pref === 'system' ? systemTheme : pref
  useEffect(() => {
    // 跟随系统时不写死属性，交给 CSS 的 prefers-color-scheme
    const root = document.documentElement
    if (pref !== 'system') root.dataset.theme = pref
    else if (initialTheme === 'light' || initialTheme === 'dark') root.dataset.theme = initialTheme
    else delete root.dataset.theme
  }, [pref])
  return theme
}

export default function App() {
  const theme = useResolvedTheme()
  return (
    // 遵循系统的“减少动态效果”设置
    <MotionConfig reducedMotion="user">
      {surface === 'web' ? (
        <BrowserRouter>
          <LoadBoundary>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/account" element={<AccountPage />} />
                {/* 其余路径都显示白板（例如部署在子路径下时） */}
                <Route path="*" element={<BoardPage />} />
              </Routes>
            </Suspense>
          </LoadBoundary>
        </BrowserRouter>
      ) : (
        // Chrome 插件：单机使用，没有账号入口
        <BoardPage />
      )}
      <Toaster
        theme={theme}
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--chrome-bg)',
            color: 'var(--ink)',
            border: '1px solid var(--chrome-border)',
            backdropFilter: 'blur(12px)',
            fontFamily: 'var(--font-ui)',
          },
        }}
      />
    </MotionConfig>
  )
}
