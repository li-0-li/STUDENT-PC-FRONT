import { createRouter, createWebHashHistory } from 'vue-router'
import PcShell from '@/layout/PcShell.vue'
import authRoutes from './routes/auth'
import studentRoutes from './routes/student'
import otherRoutes from './routes/others'
import { setupGuard } from './guard'

/**
 * 路由表（公共代码，只在 main 上改）
 * - 认证页不带 Shell（顶层路由）
 * - PC 三端共用一个 PcShell 布局，菜单按角色切换
 * - 小程序端（mp）是独立工程，不在本路由表内，见 src/views/mp/README.md
 */
const routes = [
  { path: '/', redirect: '/login' },
  ...authRoutes,
  {
    path: '/',
    component: PcShell,
    children: [
      // 学生 PC 端（stu-pc 负责人：刘浩艺）
      ...studentRoutes,
      // 教师 PC 端 / 管理端：占位路由，由各自负责人补齐
      ...otherRoutes
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/login' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

setupGuard(router)

export default router
