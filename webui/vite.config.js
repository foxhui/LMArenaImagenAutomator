import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/admin': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
})
