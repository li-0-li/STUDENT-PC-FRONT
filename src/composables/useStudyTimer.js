/**
 * 学习时长采集（★ 2026-11-20）
 *
 * 背景：`learning_time_daily` 只有读接口，全仓没有任何上报调用，
 * 导致「学情看板 / 学习周报 / 我的学习时长」长期显示 0（库里只有 seed 数据）。
 *
 * 口径：
 *  · 只在已登录 + 页面可见时计时，30 秒一个心跳，心跳即上报（丢一个包最多丢 30 秒）；
 *  · 场景由当前路由推断，非学习页（首页、课表、消息、个人中心…）完全不计时；
 *  · 路由切换、页面隐藏、组件卸载前各补一次 flush，把不足一个心跳的零头也带上；
 *  · 上报失败一律静默——采集是旁路能力，不能影响页面。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/store/user'
import { reportStudyTime } from '@/api/student/learning'

/** 心跳间隔：同时也是单次上报的秒数 */
const TICK_SEC = 30
/** 零头下限：少于 5 秒的路由停留不值得记 */
const MIN_FLUSH_SEC = 5

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 路由 → 学习场景；返回 null 表示这一页不计时 */
function sceneOf(route) {
  const path = String(route?.path || '')
  const query = route?.query || {}
  const params = route?.params || {}
  if (path.startsWith('/student/course-detail')) {
    return { source: 'resource', courseId: num(params.courseId) }
  }
  if (path.startsWith('/student/resource-preview')) {
    return { source: query.type === 'video' ? 'video' : 'resource', courseId: num(query.courseId) }
  }
  if (path.startsWith('/student/homework') || path.startsWith('/student/submission')) {
    return { source: 'homework', courseId: num(query.courseId) }
  }
  if (path.startsWith('/student/live')) {
    return { source: 'class', courseId: num(query.courseId) }
  }
  if (path.startsWith('/student/wrong-book') || path.startsWith('/student/ai')) {
    return { source: 'practice', courseId: 0 }
  }
  return null
}

export function useStudyTimer() {
  const route = useRoute()
  const userStore = useUserStore()

  let scene = null
  let pending = 0
  let timer = null

  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
  const counting = () => visible() && !!userStore.isLogin

  function flush() {
    const sec = pending
    pending = 0
    if (!scene || sec < MIN_FLUSH_SEC) return
    reportStudyTime({ courseId: scene.courseId, source: scene.source, seconds: sec }).catch(() => {})
  }

  function tick() {
    if (!counting()) return
    pending += TICK_SEC
    flush()
  }

  function onVisibility() {
    if (visible()) return
    flush()
  }

  function onBeforeUnload() {
    // 关页/刷新：keepalive 让请求有机会发出去
    if (!scene || pending < MIN_FLUSH_SEC) return
    try {
      const token = localStorage.getItem('itap_token')
      if (!token) return
      fetch('/api/v1/stu/study-time', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ courseId: scene.courseId, source: scene.source, seconds: pending })
      }).catch(() => {})
      pending = 0
    } catch (e) {
      /* 静默 */
    }
  }

  onMounted(() => {
    scene = sceneOf(route)
    timer = setInterval(tick, TICK_SEC * 1000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
  })

  watch(
    () => route.fullPath,
    () => {
      // 离开旧场景前把零头记到旧场景上，再切到新场景
      flush()
      scene = sceneOf(route)
    }
  )

  onUnmounted(() => {
    flush()
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('beforeunload', onBeforeUnload)
  })
}
