import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const desktopAudioEngine = fileURLToPath(
  new URL('./src/audio/DesktopAudioEngineStub.ts', import.meta.url),
)

function desktopNativeOnlyBundle(): Plugin {
  return {
    name: 'calcotone-desktop-native-only-audio-engine',
    enforce: 'pre',
    resolveId(source) {
      if (/(?:^|\/)audio\/AudioEngine(?:\.ts)?$/.test(source)) {
        return desktopAudioEngine
      }
      return null
    },
    transformIndexHtml(html) {
      // public/ contains the retired browser AudioWorklets plus the browser
      // favicon. Desktop disables publicDir entirely, so remove the favicon
      // request instead of leaving a harmless-but-noisy 404 in WebView2.
      return html.replace(/\s*<link rel="icon"[^>]*>\s*/i, '\n')
    },
  }
}

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop'
  const plugins: Plugin[] = [react()]
  if (desktop) plugins.unshift(desktopNativeOnlyBundle())

  return {
    plugins,
    // The public directory is the legacy WebAudio worklet payload. It remains
    // available to the browser/dev build, but must never be copied into the
    // standalone Windows package.
    publicDir: desktop ? false : 'public',
  }
})
