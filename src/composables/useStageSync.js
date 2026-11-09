/**
 * 课堂演示同步通道（学生端接收）★ 2026-11-09
 *
 * 对齐教师端 `src/utils/slideSync.js`（教师端作者已实现，学生端此前一直没接）。
 *
 * 端点：`ws(s)://<host>/ws/cast/{sessionId}?token=<JWT>`
 *   —— 与学生端原有的投屏信令通道同一个端点，后端已放开四类演示信令。
 *
 * 下行协议（教师端发、学生端收）：
 *   {type:'slide',    payload:{index, stepNo, name}}                  切换当前演示的课件
 *   {type:'stroke',   payload:{id, color, width, points:[[x,y],...]}} 一笔的增量点
 *   {type:'clear',    payload:{}}                                     清空板书
 *   {type:'snapshot', payload:{index, stepNo, name, strokes:[]}}      进入课堂/重连时的整体状态
 *
 * ★ 坐标：x / y 都是 **0~1 归一化**，原点在演示区左上角；
 *   教师端演示区是 7:5（`PptStage` 的 `aspect-ratio: 7/5`），学生端舞台必须同比例，
 *   否则同一组坐标在两端落点不同 —— 这是笔迹对位的物理前提。
 *
 * ★ 线宽：教师端发的是**像素**（默认 3），按其 700px 宽的演示区换算成比例；
 *   本组件统一转成「相对舞台宽度的比例」，与 BoardLayer 的约定一致。
 *
 * ★ 断线：指数退避重连（1s → 15s）。重连后服务端会补一份 snapshot，
 *   前端不需要自己记「断线期间漏了什么」。
 */
import { ref, watch, onUnmounted } from 'vue'
import { getToken } from '@/api/request'

/** 教师端演示区的设计宽度：用于把像素线宽换算成比例 */
const TEACHER_STAGE_WIDTH = 700

/** 默认线宽（比例）：3px / 700 ≈ 0.0043 */
const DEFAULT_WIDTH = 0.0043

const MAX_BACKOFF = 15000

/**
 * @param {import('vue').Ref<number>|number} sessionId 课堂 ID
 * @param {object} [opts]
 * @param {import('vue').Ref<boolean>|boolean} [opts.enabled] 是否启用（mock 模式关掉）
 * @param {(slide:object)=>void} [opts.onSlide] 课件变更回调（切换/清空都会触发）
 * @returns {{ status: import('vue').Ref<string>, slide: import('vue').Ref<object|null>,
 *            strokes: import('vue').Ref<Array>, rev: import('vue').Ref<number>, close: Function }}
 */
export function useStageSync(sessionId, opts = {}) {
  const status = ref('idle')
  /** 当前演示的课件：{ index, stepNo, name }，null 表示老师尚未展示 */
  const slide = ref(null)
  /** 已收到的笔迹：[{ id, color, width, points }] */
  const strokes = ref([])
  /** 内容版本号：笔迹「追加点」不改变数组长度，靠它通知渲染层重绘 */
  const rev = ref(0)

  const onSlide = typeof opts.onSlide === 'function' ? opts.onSlide : () => {}

  /** id -> stroke，避免每来一个分片都线性查找 */
  let index = new Map()
  let ws = null
  let closed = false
  let connecting = false
  let backoff = 1000
  let reconnectTimer = null
  let currentId = 0

  function isEnabled() {
    const v = opts.enabled
    return v && typeof v === 'object' && 'value' in v ? !!v.value : v !== false
  }

  function resolveId() {
    const v = sessionId
    return Number(v && typeof v === 'object' && 'value' in v ? v.value : v) || 0
  }

  function setStatus(s) {
    if (status.value !== s) status.value = s
  }

  function url(id) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getToken() || ''
    return `${proto}//${window.location.host}/ws/cast/${id}?token=${encodeURIComponent(token)}`
  }

  /* ---------------- 收到信令 ---------------- */

  function normalizeWidth(w) {
    const n = Number(w)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_WIDTH
    // 教师端发的是像素（3）；兼容「已经归一化」的发送端（<=1）
    return n > 1 ? n / TEACHER_STAGE_WIDTH : n
  }

  function applySnapshot(payload) {
    const p = payload || {}
    slide.value = p.name || p.stepNo != null ? { index: p.index, stepNo: p.stepNo, name: p.name } : null
    const list = Array.isArray(p.strokes) ? p.strokes : []
    strokes.value = list.map((s) => ({
      id: String(s.id),
      color: s.color || '#ff4d4f',
      width: normalizeWidth(s.width),
      points: Array.isArray(s.points) ? s.points.slice() : []
    }))
    index = new Map(strokes.value.map((s) => [s.id, s]))
    rev.value++
    onSlide(slide.value)
  }

  function applySlide(payload) {
    const p = payload || {}
    slide.value = p.name || p.stepNo != null ? { index: p.index, stepNo: p.stepNo, name: p.name } : null
    // 切课件 = 换展示面，上一份课件的板书不保留（与教师端切步骤清笔迹一致）
    strokes.value = []
    index = new Map()
    rev.value++
    onSlide(slide.value)
  }

  function applyStroke(payload) {
    const p = payload || {}
    if (p.id == null || !Array.isArray(p.points) || !p.points.length) return
    const id = String(p.id)
    let stroke = index.get(id)
    if (!stroke) {
      stroke = {
        id,
        color: p.color || '#ff4d4f',
        width: normalizeWidth(p.width),
        points: []
      }
      strokes.value.push(stroke)
      index.set(id, stroke)
    }
    // 同一笔的后续分片追加点；数组引用不变，靠 rev 触发重绘
    stroke.points.push(...p.points)
    rev.value++
  }

  function applyClear() {
    strokes.value = []
    index = new Map()
    rev.value++
  }

  function handleMessage(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'snapshot':
        applySnapshot(msg.payload)
        break
      case 'slide':
        applySlide(msg.payload)
        break
      case 'stroke':
        applyStroke(msg.payload)
        break
      case 'clear':
        applyClear()
        break
      case 'error':
        // 后端拒绝（如学生端误发）只在控制台留痕，不打扰学生
        console.warn('[stage-sync]', msg.payload && msg.payload.message)
        break
      default:
        // room-members / peer-join / peer-leave / offer / answer … 投屏遗留事件，本页不消费
        break
    }
  }

  /* ---------------- 连接 ---------------- */

  function connect() {
    const id = resolveId()
    if (!id || closed || connecting) return
    if (!isEnabled()) {
      setStatus('idle')
      return
    }
    currentId = id
    connecting = true
    setStatus('connecting')
    try {
      ws = new WebSocket(url(id))
    } catch {
      connecting = false
      setStatus('offline')
      scheduleReconnect()
      return
    }
    ws.onopen = () => {
      connecting = false
      backoff = 1000
      setStatus('online')
    }
    ws.onmessage = (e) => handleMessage(e.data)
    ws.onerror = () => {
      // onerror 之后浏览器必定再触发 onclose，这里只改状态
      setStatus('offline')
    }
    ws.onclose = () => {
      connecting = false
      ws = null
      setStatus('offline')
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return
    if (!isEnabled() || !resolveId()) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF)
  }

  function close() {
    closed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      try {
        ws.close()
      } catch {
        /* 已断开，忽略 */
      }
      ws = null
    }
    setStatus('idle')
  }

  // 课堂 ID 变化（从 URL 参数切到真实课堂）→ 断开重连
  watch(
    () => resolveId(),
    (id) => {
      if (id === currentId) return
      if (ws) {
        try {
          ws.close()
        } catch {
          /* 忽略 */
        }
        ws = null
      }
      connecting = false
      applyClear()
      slide.value = null
      onSlide(null)
      if (id) connect()
    }
  )

  onUnmounted(close)

  // 进课堂即建立通道；课堂 ID 还没确定时由上面的 watch 在确定后补连
  connect()

  return { status, slide, strokes, rev, connect, close }
}
