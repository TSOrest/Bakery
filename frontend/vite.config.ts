import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vite has issues resolving packages through UNC paths (//localhost/...) on Windows.
// Explicitly resolving node_modules via __dirname (which uses the Z: drive path) fixes it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    // usePolling потрібен для мережевих дисків (Z:) — без нього Vite падає
    watch: {
      usePolling: true,
      interval: 800,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
