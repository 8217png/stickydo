import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { hydrateNotes } from './features/notes/store'
import { startSyncEngine } from './sync/engine'
import './index.css'

// 读取本地数据（IndexedDB，异步）；完成前白板不显示便利贴
void hydrateNotes()
startSyncEngine()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
