import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Short-link redirects, same rule as nginx.conf
      '^/[A-Za-z0-9_-]{4,32}$': {
        target: 'http://localhost:5000',
      },
    },
  },
})
