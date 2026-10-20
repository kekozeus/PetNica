import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/client/',
  build: {
    outDir: '../backend-serverless/public/client',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
    },
  },
})
