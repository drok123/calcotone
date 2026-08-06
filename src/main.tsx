import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './UnifiedTextPalette.css'
import './components/effects/ModuleViewport.css'
import './components/effects/ViewportOptics.css'
import './components/effects/HardwareIdentity.css'
import './components/layout/SignalRailBackplane.css'
import './components/layout/PanelTheme.css'
import './components/layout/UnifiedOutlinePass.css'
import './components/effects/CreamModuleTest.css'
import './components/layout/UnifiedGrayPalette.css'
import './components/layout/HardwarePolishPass.css'
import './components/layout/RailMicroAdjust.css'
import './components/layout/CharcoalHardwarePass.css'
import './components/controls/RandomPerformance.css'
import './readability.css'
import './chordChainPatch.css'
import './highDefinition1440.css'
import './haloStabilityPatch'
import './pressureBridge'
import './randomVisualGovernor'
import './randomTransferBridge'
import './chordChainPatch'
import { installDisplayProfile } from './ui/displayProfile'
import App from './App.tsx'

installDisplayProfile()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
