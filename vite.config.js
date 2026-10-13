import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 智课平台前端构建配置
// 端口：学生 PC 端固定 8081（团队约定：后端 8080 / 学生PC 8081 / 教师PC 8082 / 管理端 8083）
// 代理：/api 与 /ws 转发到后端网关 http://localhost:8080
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 8081,
    open: false,
    proxy: {
      // 接口统一前缀 /api/v1/ 与实时通道 /ws/ 都转发到后端
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
})
