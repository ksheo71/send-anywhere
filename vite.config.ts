import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'web/src') },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:4500',
      '/files': 'http://localhost:4500',
    },
  },
})
