import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // `npm run dev` against a running app with LAN access enabled
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
