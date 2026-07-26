import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { serialRoutingTransform } from './build/serialRoutingTransform'
import { signalLabUiTransform } from './build/signalLabUiTransform'

// https://vite.dev/config/
export default defineConfig({
  plugins: [serialRoutingTransform(), signalLabUiTransform(), react()],
})
