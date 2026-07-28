import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { serialRoutingTransform } from './build/serialRoutingTransform.js'
import { dreamFieldCompositionTransform } from './build/dreamFieldCompositionTransform.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [serialRoutingTransform(), dreamFieldCompositionTransform(), react()],
})
