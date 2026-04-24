import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import path from 'path'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'iOS >= 11', 'Android >= 6'],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pos:  resolve(__dirname, 'pos.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
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
    watch: {
      usePolling: true,
      interval: 800,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8001',  // DEV backend; prod займає 8000
        changeOrigin: true,
      },
    },
  },
})
