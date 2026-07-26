import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/effects/ModuleViewport.css'
import './components/effects/ViewportOptics.css'
import './components/effects/HardwareIdentity.css'
import './components/layout/SignalRailBackplane.css'
import './components/layout/PanelTheme.css'
import './haloStabilityPatch'
import './artifactStabilityPatch'
import './moduleStabilityPatch'
import './randomTransferBridge'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
