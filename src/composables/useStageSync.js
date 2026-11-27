/**
 * 课堂演示同步通道（学生端接收）★ 2026-11-09
 *
 * 对齐教师端 `src/utils/slideSync.js`（教师端作者已实现，学生端此前一直没接）。
 *
 * 端点：`ws(s)://<host>/ws/cast/{sessionId}?token=<JWT>`
 *   —— 与学生端原有的投屏信令通道同一个端点，后端已放开四类演示信令。
 *
 * 下行协议（教师端发、学生端收）：
 *   {type:'slide',    payload:{page, totalPages, stepIndex, stepNo, name}}  切换课件并翻页
 *   {type:'stroke',   payload:{id, color, width, points:[[x,y],...]}}      一笔的增量点
 *   {type:'clear',    payload:{}}                                          清空板书
 *   {type:'snapshot', payload:{page, totalPages, stepIndex, stepNo, name, strokes:[]}} 进入课堂/重连时的整体状态
 *
 * ★ 2026-11-09 兼容：教师端已从 `/ws/cast` 迁到 `/ws/teacher/live`，帧经
 *   SessionBroadcastBridge 下发到 `/ws/session/{id}`；本组件除自身监听 `/ws/cast`
 *   外，还导出 `ingest(type,payload)` 供 Live.vue 从 `/ws/session` 转发同一套事件。
 *   字段同时保留新（page/totalPages/stepIndex）与旧（index）两套，避免旧教师端失配。
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
import { wsUrl, WS_PATHS } from '@/utils/wsUrl'
import { stageSnapshot, stageResync, stageDigestReport } from '@/api/student/live'
import timeline from '@/utils/classroomTimeline'

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
  /** P1 服务端状态版本（权威），只接受 rev > localRev 的舞台帧 */
  const localRev = ref(0)
  /** P1 已处理的最大下行 seq，用于去重与缺口检测 */
  const lastSeq = ref(0)
  /** P1 视频/音频播放状态：{ mediaId, state, timeSec, rate, durationSec, serverTimeMs } */
  const playback = ref(null)
  /** P2 最近的语音对齐标记（有界，供舞台强调与诊断） */
  const audioMarkers = ref([])
  /** P2 统一课堂时间轴（服务端 epoch ms，来自下行信封/权威快照） */
  const timelineMs = ref(0)
  /** 本地一致性摘要（与服务端 FNV-1a 规则一致） */
  const digest = ref('')

  const onSlide = typeof opts.onSlide === 'function' ? opts.onSlide : () => {}
  const onPlayback = typeof opts.onPlayback === 'function' ? opts.onPlayback : () => {}

  /** id -> stroke，避免每来一个分片都线性查找 */
  let index = new Map()
  let ws = null
  let closed = false
  let connecting = false
  let backoff = 1000
  let reconnectTimer = null
  let currentId = 0
  /** 上一次演示定位的 key：用于区分「换课件/翻页」与「仅补 totalPages」 */
  let lastSlideKey = ''
  /**
   * 按页缓存的笔迹快照：slideKey -> [{ id, color, width, points }]
   *
   * ★ 2026-11-20：教师端 PptStage 有 strokesByPage，翻回已画过的页仍显示板书；
   * 学生端原先翻页即清空且无任何回填，表现为「老师切回上一页，学生画板空了」。
   * 服务端 StuPcCastStageState 同样只镜像当前页（翻页即 clear），所以恢复只能靠本地缓存。
   * 上限 MAX_CACHED_PAGES 页，超出按插入顺序淘汰最旧的（Map 保序）。
   */
  const strokesByPage = new Map()
  const MAX_CACHED_PAGES = 30

  /** P1：REST 补偿节流，避免 seq 缺口/摘要不一致时打爆 /stage/resync */
  let lastResyncAt = 0
  let resyncInFlight = null

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
    // ★ 2026-11-10：与 /ws/session 共用一套地址构造（协议/主机/token 只维护一处）
    return wsUrl(WS_PATHS.cast, id)
  }

  /* ---------------- 收到信令 ---------------- */

  function normalizeWidth(w) {
    const n = Number(w)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_WIDTH
    // 教师端发的是像素（3）；兼容「已经归一化」的发送端（<=1）
    return n > 1 ? n / TEACHER_STAGE_WIDTH : n
  }

  /** 判断两个归一化坐标是否同一点（用于丢弃重连/重复帧带来的重复前缀） */
  function samePoint(a, b) {
    return Array.isArray(a) && Array.isArray(b)
      && Math.abs(Number(a[0]) - Number(b[0])) < 1e-6
      && Math.abs(Number(a[1]) - Number(b[1])) < 1e-6
  }

  /** 统一取定位字段：新帧用 page/totalPages/stepIndex，旧帧只有 index */
  function toSlide(p) {
    if (!p || (p.name == null && p.stepNo == null && p.page == null && p.index == null && p.resourceId == null)) {
      return null
    }
    return {
      index: p.index,
      page: p.page,
      totalPages: p.totalPages,
      stepIndex: p.stepIndex,
      stepNo: p.stepNo,
      // resourceId 是最可靠的课件定位字段；教师端 11-09 起随 slide/snapshot 下发
      resourceId: p.resourceId,
      name: p.name
    }
  }

  /** 演示定位 key：资源 + 步骤 + 页码。仅变化时才清空笔迹，避免补 totalPages 的帧把板书冲掉 */
  function slideKey(s) {
    if (!s) return ''
    return [
      s.resourceId == null ? '' : s.resourceId,
      s.name || '',
      s.stepIndex == null ? '' : s.stepIndex,
      s.stepNo == null ? '' : s.stepNo,
      s.page == null ? '' : s.page
    ].join('|')
  }

  /* ---------------- P1 一致性摘要（与后端 StuPcCastStageState.digestOf 同规则） ---------------- */

  function text(v) { return v == null ? '' : String(v) }

  function decimalText(v) {
    const n = Number(v) || 0
    return String(Math.round(n * 10000) / 10000)
  }

  /** FNV-1a 32 位，UTF-8 字节流；非加密用途，只做两端状态一致性比对 */
  function fnv1a32(str) {
    const bytes = new TextEncoder().encode(str)
    let h = 0x811c9dc5
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  function localDigest() {
    const s = slide.value
    const pb = playback.value || {}
    const parts = ['v1']
    if (s) {
      parts.push(text(s.resourceId), text(s.name), text(s.stepIndex), text(s.stepNo), text(s.page))
    } else {
      parts.push('', '', '', '', '')
    }
    parts.push(text(s && s.page), text(s && s.totalPages))
    parts.push(text(pb.state))
    parts.push(String(Math.round((Number(pb.timeSec) || 0) * 1000 / 500) * 500))
    parts.push(String(Math.round((Number(pb.rate) || 1) * 100)))
    const list = strokes.value
    parts.push(String(list.length))
    if (!list.length) {
      parts.push('', '0', '0')
    } else {
      const last = list[list.length - 1]
      parts.push(text(last.id))
      const pts = last.points || []
      const p = pts.length ? pts[pts.length - 1] : [0, 0]
      parts.push(decimalText(p[0]), decimalText(p[1]))
    }
    return fnv1a32(parts.join('|'))
  }

  function applyPlayback(payload) {
    if (!payload) return
    if (payload.state === 'idle') {
      playback.value = null
      onPlayback(null)
      return
    }
    const now = Date.now()
    const serverTimeMs = Number(payload.serverTimeMs) || now
    playback.value = Object.assign({}, payload, { clockOffset: serverTimeMs - now })
    // P2：播放控制同步到统一时间轴（暂停冻结、拖动重锚、播放恢复）
    timeline.applyStageFrame('playback', payload, { timelineMs: Number(payload.timelineMs) || serverTimeMs })
    onPlayback(playback.value)
  }

  /** P2 音频标记：交给时间轴排队，在 fireAt 触发视觉同步呈现 */
  function applyAudioMarker(payload) {
    if (!payload || !payload.markerId) return
    const row = Object.assign({}, payload)
    audioMarkers.value = audioMarkers.value.concat([row]).slice(-64)
    timeline.applyStageFrame('audio-marker', row, {
      timelineMs: Number(row.timelineMs || row.serverTimeMs) || 0
    })
  }

  /** 摘要比对：上报同步率；不一致立即拉权威全量快照修复 */
  async function applyStateDigest(payload) {
    const remote = text(payload && payload.digest)
    const mine = localDigest()
    digest.value = mine
    const match = !!remote && remote === mine
    const id = resolveId()
    if (!id || !isEnabled()) return
    try {
      await stageDigestReport(id, { match, rev: payload && payload.rev, digest: mine })
    } catch { /* 观测失败不影响画面 */ }
    if (!match) await requestResync('mismatch')
  }

  /**
   * state-req / state-res 的 REST 实现：gap / mismatch / reconnect 时全量对齐。
   * 2s 内只允许一次、同一时刻只允许一个请求，防止缺口帧造成补偿风暴。
   */
  async function requestResync(reason) {
    const id = resolveId()
    if (!id || !isEnabled()) return
    // 后端重启/长时间断线后 stageSeq 会从头开始，重连时必须重置本地序号
    if (reason === 'reconnect') lastSeq.value = 0
    if (resyncInFlight) return resyncInFlight
    const now = Date.now()
    if (now - lastResyncAt < 2000) return
    lastResyncAt = now
    resyncInFlight = (async () => {
      try {
        const snapshot = await stageResync(id, {
          lastSeq: lastSeq.value, lastRev: localRev.value, reason
        })
        if (snapshot) applySnapshot(snapshot)
      } catch { /* WS 通道仍可能已补齐 */ }
    })()
    try {
      await resyncInFlight
    } finally {
      resyncInFlight = null
    }
  }

  /** 笔迹深拷贝：缓存与渲染各一份，避免后续追加点污染快照 */
  function cloneStrokes(list) {
    return list.map((s) => ({ id: s.id, color: s.color, width: s.width, points: s.points.slice() }))
  }

  /** 写入某页缓存，超出上限淘汰最旧的一页 */
  function cacheStrokes(key, list) {
    if (!key) return
    // 先删旧值：该页被清空后缓存也必须消失，否则翻回来会冒出已清掉的笔画
    strokesByPage.delete(key)
    if (!list.length) return
    strokesByPage.set(key, cloneStrokes(list))
    while (strokesByPage.size > MAX_CACHED_PAGES) {
      const oldest = strokesByPage.keys().next().value
      strokesByPage.delete(oldest)
    }
  }

  function applySnapshot(payload) {
    const p = payload || {}
    slide.value = toSlide(p)
    lastSlideKey = slideKey(slide.value)
    const list = Array.isArray(p.strokes) ? p.strokes : []
    strokes.value = list.map((s) => ({
      id: String(s.id),
      color: s.color || '#ff4d4f',
      width: normalizeWidth(s.width),
      points: Array.isArray(s.points) ? s.points.slice() : []
    }))
    index = new Map(strokes.value.map((s) => [s.id, s]))
    // 服务端快照是当前页的权威值：覆盖该页缓存，其它页的本地快照保留
    cacheStrokes(lastSlideKey, strokes.value)
    if (p.playback && typeof p.playback === 'object') {
      const now = Date.now()
      const st = Number(p.playback.serverTimeMs) || now
      playback.value = Object.assign({}, p.playback, { clockOffset: st - now })
    } else {
      playback.value = null
    }
    // P2：权威快照让迟到/重连学生重新锚定时间轴，丢弃过期标记
    timelineMs.value = Number(p.timelineMs) || timelineMs.value
    audioMarkers.value = Array.isArray(p.audioMarkers) ? p.audioMarkers.slice(-64) : []
    timeline.reanchor(p)
    if (p.rev != null) localRev.value = Number(p.rev) || 0
    digest.value = localDigest()
    rev.value++
    onSlide(slide.value)
    onPlayback(playback.value)
  }

  function applySlide(payload) {
    const p = payload || {}
    const next = toSlide(p)
    const nextKey = slideKey(next)
    const changed = nextKey !== lastSlideKey
    slide.value = next
    // 只有换课件 / 翻页才清空板书；同一页补 totalPages 或重复帧不清，避免板书被冲掉
    if (changed) {
      // 翻走前先留存当前页，切回来才能像教师端一样看到已有板书
      cacheStrokes(lastSlideKey, strokes.value)
      const cached = strokesByPage.get(nextKey)
      strokes.value = cached ? cloneStrokes(cached) : []
      index = new Map(strokes.value.map((s) => [s.id, s]))
      playback.value = null
      onPlayback(null)
      rev.value++
    }
    lastSlideKey = nextKey
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
    // 同一笔的后续分片追加点；数组引用不变，靠 rev 触发重绘。
    // 重连重放或重复帧可能带来与已有点相同的前缀，跳过它，避免笔迹越画越粗/错位
    const existing = stroke.points
    const incoming = p.points
    let start = 0
    if (existing.length) {
      const last = existing[existing.length - 1]
      while (start < incoming.length && samePoint(last, incoming[start])) start++
    }
    if (start < incoming.length) {
      stroke.points.push(...incoming.slice(start))
      rev.value++
    }
  }

  function applyClear() {
    strokes.value = []
    index = new Map()
    // 教师清空的是当前页：缓存同步作废，否则翻回来会冒出已清掉的笔画
    if (lastSlideKey) strokesByPage.delete(lastSlideKey)
    rev.value++
  }

  /**
   * 应用一条舞台事件（供 /ws/cast 与 /ws/session 两条通道共用）。
   *
   * @param {string} type 帧类型
   * @param {object} payload 帧载荷
   * @param {object} [envelope] 统一下行信封，含 seq/rev/ts；旧通道没有时跳过版本校验
   * @returns {boolean} 是否为本组件认识的类型
   */
  function applyEvent(type, payload, envelope) {
    // P2：下行信封的 ts/timelineMs 是服务端权威时钟，喂给统一时间轴做偏移估计
    if (envelope) {
      const serverTs = Number(envelope.timelineMs || envelope.ts)
      if (Number.isFinite(serverTs) && serverTs > 0) {
        timeline.addClockSample({ serverTimeMs: serverTs, recvMs: Date.now() })
        timelineMs.value = serverTs
      }
    }
    // P1：先做 seq/rev 去重与缺口检测，再应用状态，避免乱序旧帧覆盖新状态
    if (envelope) {
      const seq = Number(envelope.seq)
      const r = Number(envelope.rev)
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= lastSeq.value) return false
        if (lastSeq.value > 0 && seq > lastSeq.value + 1) requestResync('gap')
        lastSeq.value = seq
      }
      if (Number.isFinite(r) && r > 0) {
        if (r < localRev.value) return false
        localRev.value = r
      }
    }
    switch (type) {
      case 'snapshot':
      case 'state-reset':
        applySnapshot(payload)
        return true
      case 'slide':
        applySlide(payload)
        return true
      case 'stroke':
        applyStroke(payload)
        return true
      case 'clear':
        applyClear()
        return true
      case 'playback':
        applyPlayback(payload)
        return true
      case 'audio-marker':
        applyAudioMarker(payload)
        return true
      case 'state-digest':
        applyStateDigest(payload)
        return true
      default:
        return false
    }
  }

  /** 供 Live.vue 直接转发 /ws/session 的完整下行帧（含 seq/rev/ts） */
  function ingestFrame(frame) {
    if (!frame || !frame.type) return false
    return applyEvent(frame.type, frame.payload || {}, frame)
  }

  function handleMessage(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'error') {
      // 后端拒绝（如学生端误发）只在控制台留痕，不打扰学生
      console.warn('[stage-sync]', msg.payload && msg.payload.message)
      return
    }
    // 未知类型（room-members / peer-join / offer / answer …）直接忽略
    applyEvent(msg.type, msg.payload, msg)
  }

  /* ---------------- 连接 ---------------- */

  /**
   * 主动拉一次服务端舞台状态。
   *
   * <p>用于三种场景：学生中途加入、`/ws/session` 重连、`/ws/cast` 不可用。
   * 服务端缓存由教师端信令镜像而来，不依赖投屏通道。
   */
  async function refresh() {
    const id = resolveId()
    if (!id || !isEnabled()) return
    try {
      const snapshot = await stageSnapshot(id)
      if (snapshot) applySnapshot(snapshot)
    } catch {
      // 403 / 网络异常不打扰学生；WS 通道仍可能已经补齐
    }
  }

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
      // 连接快照之外再主动拉一次，防止服务端未推 snapshot 或推送丢失
      refresh()
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
      strokesByPage.clear()
      slide.value = null
      lastSlideKey = ''
      lastSeq.value = 0
      localRev.value = 0
      playback.value = null
      audioMarkers.value = []
      timelineMs.value = 0
      timeline.reanchor({ timelineMs: Date.now() })
      digest.value = ''
      lastResyncAt = 0
      resyncInFlight = null
      onSlide(null)
      onPlayback(null)
      if (id) connect()
    }
  )

  onUnmounted(close)

  // 进课堂即建立通道；课堂 ID 还没确定时由上面的 watch 在确定后补连
  connect()

  // ingest：兼容旧调用（只有 type/payload）；ingestFrame：P1 传完整信封做 seq/rev 去重
  return {
    status, slide, strokes, rev, playback, audioMarkers, timelineMs,
    localRev, lastSeq, digest,
    connect, close, refresh, requestResync,
    ingest: (type, payload) => applyEvent(type, payload, null),
    ingestFrame
  }
}
