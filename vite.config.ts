import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const desktopAudioEngine = fileURLToPath(
  new URL('./src/audio/DesktopAudioEngineStub.ts', import.meta.url),
)

function desktopNativeOnlyAudioEngine(): Plugin {
  return {
    name: 'calcotone-desktop-native-only-audio-engine',
    enforce: 'pre',
    resolveId(source) {
      if (/(?:^|\/)audio\/AudioEngine(?:\.ts)?$/.test(source)) {
        return desktopAudioEngine
      }
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const plugins: Plugin[] = [react()]
  if (mode === 'desktop') plugins.unshift(desktopNativeOnlyAudioEngine())

  return { plugins }
})
