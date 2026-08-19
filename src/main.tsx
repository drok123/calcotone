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
import './loopBridge'
import './loop505Controls'
import './randomVisualGovernor'
import './randomTransferBridge'
import './chordChainPatch'
import './nativeFinishPass'
import './nativeFinishPass.css'
import { installDisplayProfile } from './ui/displayProfile'
import App from './App.tsx'
import './approvedFaceplate.css'
import './components/effects/ModulePowerState.css'
import './loopRefinement.css'
import './loopSurfaceV3'

installDisplayProfile()

const query = new URLSearchParams(window.location.search)
const nativeShell = query.has('native-shell')
// Browser execution is now an explicit diagnostic surface only. Normal production
// launch is the local WebView2 desktop shell, where the UI carries control/telemetry
// and the C++ engine owns every audio sample.
const browserDiagnostic = query.has('browser-diagnostic') || query.has('diagnostic-audio')
const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {nativeShell || browserDiagnostic ? (
      <App />
    ) : (
      <div className="native-shell-required" role="status">
        <div>
          <h1>CALCOTONE DESKTOP REQUIRED</h1>
          <p>
            Audio no longer starts from a normal browser page. Launch the standalone CALCOTONE Windows app.
            Browser execution is reserved for explicit diagnostics.
          </p>
        </div>
      </div>
    )}
  </StrictMode>,
)
