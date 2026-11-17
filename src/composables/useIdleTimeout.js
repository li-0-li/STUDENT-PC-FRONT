/**
 * 会话闲置超时自动跳转登录
 *
 * 对应《三级功能清单》· 用户端 · 登录与注册 → 登录安全控制 → **会话闲置超时自动跳转登录**。
 * 此前完全没有实现：只要不主动退出，标签页可以一直挂着。
 *
 * 设计要点（2026-11-17 修订）：
 *  - **阈值与后端令牌同源**：后端 token.expireTime=120 分钟且是滑动续期，
 *    所以这里也必须是 120 分钟——此前写死 30 分钟，比后端早 90 分钟把人踢掉，
 *    看起来就像「明明还在用却掉线」。
 *  - **勾了「记住我」不参与本地闲置判定**：那时令牌在 localStorage、后端给 7 天，
 *    前端再按 2 小时清掉就是自相矛盾，交给后端的 401 处理即可。
 *  - **课堂页（/student/live）豁免**：学生看投屏时可以长时间不碰键鼠，
 *    这不是「闲置」，踢人会造成课堂中断（真实事故级体验问题）。
 *  - 只在已登录时计时；未登录（登录页）不触发。
 *  - 令牌存储与跳转逻辑复用 api/request 的口径，不另起一套。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import { getToken, clearToken } from '@/api/request'

/** 闲置多久自动退出（毫秒）：与后端 token.expireTime（120 分钟）保持一致 */
const IDLE_MS = 120 * 60 * 1000
/** 提前多久提醒（毫秒） */
const WARN_MS = 60 * 1000

/** 这些页面不做闲置判定（长连接/长时间观看场景） */
const EXEMPT_PREFIXES = ['/student/live']

/** 令牌键名（与 api/request.js 一致）：localStorage 有值 = 登录时勾了「记住我」 */
const TOKEN_KEY = 'itap_token'

/** 勾了「记住我」→ 后端签发 7 天令牌，本地闲置不踢人，等后端 401 再说 */
function isRemembered() {
  try {
    return !!localStorage.getItem(TOKEN_KEY)
  } catch (e) {
    return false
  }
}

/** 触发「活跃」的事件，passive 避免拖慢滚动 */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useIdleTimeout() {
  const route = useRoute()

  let idleTimer = null
  let warnTimer = null

  const isExempt = () => EXEMPT_PREFIXES.some((p) => (route.path || '').startsWith(p))

  function clearTimers() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (warnTimer) {
      clearTimeout(warnTimer)
      warnTimer = null
    }
  }

  function doLogout() {
    if (!getToken()) return
    clearToken()
    ElMessage.info('登录状态已超时，请重新登录')
    const back = encodeURIComponent(window.location.hash.replace(/^#/, '') || '/')
    window.location.hash = `#/login?redirect=${back}`
  }

  /** 重新开始计时（任何交互 / 进入新页面都会调用） */
  function restart() {
    clearTimers()
    if (!getToken() || isExempt() || isRemembered()) return

    warnTimer = setTimeout(() => {
      if (!getToken() || isExempt()) return
      ElMessage.warning('长时间未操作，1 分钟后将自动退出登录')
    }, IDLE_MS - WARN_MS)

    idleTimer = setTimeout(doLogout, IDLE_MS)
  }

  const onActivity = () => restart()

  onMounted(() => {
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    restart()
  })

  onUnmounted(() => {
    ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
    clearTimers()
  })

  // 路由切换：从课堂页切回普通页（或反之）时，重新判定豁免状态
  watch(() => route.path, () => restart())
}
