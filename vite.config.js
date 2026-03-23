import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Garder console.log en production (débogage)
  esbuild: {
    pure: [],
  },
  server: {
    // En local : `vercel dev` (port 3000 par défaut) sert /api/* ; Vite proxy pour éviter CORS / 404.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
