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
    // ★ 2026-11-20 角色守卫：others.js 里教师端 / 管理端的骨架路由都带 meta.role，
    //   但注册是全量的，学生登录后手输 URL 也能进（顶上还显示自己的名字，正文是演示数据）。
    //   角色不符一律送回自己的首页。
    const needRole = to.meta?.role
    if (needRole && needRole !== userStore.role) {
      return { path: `/${userStore.role}/courses` }
    }
    return true
  })

  router.afterEach((to) => {
    document.title = to.meta?.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
  })
}
