import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/effects/ModuleViewport.css'
import './components/layout/SignalRailBackplane.css'
import App from './App.tsx'
import './components/layout/FaceplateResizeFix.css'
import './components/layout/PanelContrastRefresh.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
