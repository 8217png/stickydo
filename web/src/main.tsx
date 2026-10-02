import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startSyncEngine } from './sync/engine'
import './index.css'

startSyncEngine()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
