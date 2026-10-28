import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 智课平台前端构建配置
// 端口：学生 PC 端固定 8081（团队约定：后端 8080 / 学生PC 8081 / 教师PC 8082 / 管理端 8083）
// 代理：/api、/ws 以及「若依统一鉴权入口（无 /api 前缀）」都转发到后端 http://localhost:8080
/**
 * ★ 2026-10-21 生产部署适配（运维要求）：前端按子路径部署到 /student/。
 *   - build（vite build）时 base = '/student/'：产物资源引用与 index.html 均带前缀；
 *   - dev（npm run dev）时 base = '/'：本地仍用 http://localhost:8081/ 调试，无需加 /student。
 *   本前端为 **hash 路由**（createWebHashHistory），路由无需传 base；
 *   /api、/login、/logout、/getInfo、/captchaImage、/register、/ws 为全站统一反代，**不加子前缀**。
 */
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // ★ 后端地址可切换（2026-10-28）：默认本机 8080。
  //   跨网段联调时，在 .env.local 写 VITE_BACKEND_TARGET=http://47.114.123.118:8080 即可，
  //   ★ 关键：教师端与学生端必须指向【同一个后端进程】，否则投屏房间不在同一 JVM 内。
  const rawTarget = (env.VITE_BACKEND_TARGET || 'http://localhost:8080').replace(/\/+$/, '')
  const wsTarget = rawTarget.replace(/^http/, 'ws')

  return {
  base: command === 'build' ? '/student/' : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 8081,
    open: false,
    // ★ 构建产物目录排除出 dev 监听：否则本地 vite build 的输出会触发 dev server
    //   反复 page reload，把浏览器已加载的模块图弄坏（表现为白屏）
    watch: {
      ignored: ['**/dist-verify/**', '**/dist/**']
    },
    proxy: {
      // 接口统一前缀 /api/v1/ 与实时通道 /ws/ 都转发到后端
      '/api': {
        target: rawTarget,
        changeOrigin: true
      },
      '/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: true
      },
      // ★ 2026-10-20 上传文件静态目录（/files/** 由后端 ResourceWebConfig 映射到 uploads/）：
      //   图片消息、资源下载、头像都走这里，缺这条浏览器里会 404
      '/files': {
        target: rawTarget,
        changeOrigin: true
      },
      // 若依统一鉴权入口（RuoYi SysLoginController 等，不带 /api 前缀）
      '/login': { target: rawTarget, changeOrigin: true },
      '/register': { target: rawTarget, changeOrigin: true },
      '/logout': { target: rawTarget, changeOrigin: true },
      '/getInfo': { target: rawTarget, changeOrigin: true },
      '/captchaImage': { target: rawTarget, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
  }
})
