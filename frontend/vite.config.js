import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Under `wails dev`, Wails sends every request to Vite first and only falls
// back to the Go handler when Vite answers 404/405. So /api must get a 404
// from Vite (not its index.html SPA fallback, not a proxy error).
// For plain browser development against `go run ./cmd/devserver`, start Vite
// with CPRO_API=http://127.0.0.1:8787 npm run dev to proxy /api instead.
const api = process.env.CPRO_API

const apiNotFound = {
  name: 'cpro-api-404',
  configureServer(server) {
    server.middlewares.use('/api/', (_req, res) => {
      res.statusCode = 404
      res.end()
    })
  },
}

export default defineConfig({
  plugins: [tailwindcss(), react(), ...(api ? [] : [apiNotFound])],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: api ? { proxy: { '/api': api } } : {},
  build: {
    // Two pages: the staff app and the guest e-menu (served on the tunnel).
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), menu: path.resolve(__dirname, 'menu.html') } },
  },
})
