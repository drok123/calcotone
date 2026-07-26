import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { serialRoutingTransform } from './build/serialRoutingTransform'

// https://vite.dev/config/
export default defineConfig({
  plugins: [serialRoutingTransform(), react()],
})
