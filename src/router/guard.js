/**
 * 路由守卫：登录校验 + 标题
 * 公共代码，只在 main 上改
 */
import { useUserStore } from '@/store/user'

const APP_TITLE = import.meta.env.VITE_APP_TITLE || '智能教学辅助平台'

export function setupGuard(router) {
  router.beforeEach((to) => {
    const userStore = useUserStore()
    const isPublic = to.meta?.public === true

    if (!isPublic && !userStore.isLogin) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
    if (isPublic && userStore.isLogin) {
      return { path: `/${userStore.role}/courses` }
    }
    return true
  })

  router.afterEach((to) => {
    document.title = to.meta?.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
  })
}
