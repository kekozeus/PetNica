import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'serve' ? '/' : '/client/',
  build: {
    outDir: '../backend-serverless/public/client',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.host) proxyRequest.setHeader('host', request.headers.host)
          })
        },
      },
      '/images': 'http://localhost:3000',
    },
  },
}))
