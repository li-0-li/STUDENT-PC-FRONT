/**
 * 课堂实时通道（契约表 6-1：WS /ws/session/{sessionId}）
 *
 * 严格按《接口设计文档》第 6 章「WebSocket 消息协议」实现：
 *   · 通用格式   { type, seq, ts, clientMsgId, payload }
 *   · 上行 ACK   服务端收到后回 ack；客户端 5 秒未收到 ACK 自动重发（最多 3 次）
 *   · 幂等      每条上行消息带唯一 clientMsgId，服务端据此去重，客户端也按 clientMsgId 丢弃自己的回声
 *   · 下行有序   服务端 seq 连续递增；客户端记录 lastSeq 并丢弃重复/过期消息
 *   · 心跳       客户端 25 秒发 ping，服务端回 pong；40 秒无 pong 判定断线
 *   · 断线重连   指数退避 1s → 2s → 4s …（上限 30s），重连成功后发 reconnect{lastSeq} 请求补推
 *
 * 用法：
 *   const { connected, onlineCount, statusText, send, close, reconnectNow } = useClassroomSocket(sessionId, {
 *     onEvent(type, payload, frame) { ... }  // frame 含 seq/rev/ts，舞台帧据此去重
 *   })
 *   send('chat', { content: '你好' })   // 自动带 clientMsgId、ACK 重发、去重
 *                                      // ★ 注意上行 payload 字段名按契约表 6-1 用 content（不是 text）
 *
 * ★ 2026-11-10 重连/心跳加固：
 *   1) 重连计数改为「连接稳定 5 秒（或收到首帧业务消息）后才清零」，避免「连上就掉」把重试次数刷成 0；
 *   2) 重连有上限（8 次 且 总时长 5 分钟），超限不再死循环，暴露 reconnectNow() 给用户手动重试；
 *   3) 关闭码分流：1008/4001/4401 或 reason 提到 token/登录 → 判定登录过期，停止重连并提示重新登录；
 *   4) 心跳三态 unknown/on/off：只有服务端**明确回「不支持的上行 type：ping」**才降级为业务探活，
 *      探活连续两次失败主动断开触发重连（此前是「40 秒收不到 pong 就永久关心跳」，半开连接永远发现不了）；
 *   5) 补 visibilitychange / online / offline：切回前台、网络恢复时立即补连。
 */
import { ref, onMounted, onUnmounted, watch, unref } from 'vue'
import { getToken } from '@/api/request'
import { wsUrl, WS_PATHS } from '@/utils/wsUrl'

/**
 * sessionId 允许三种形态：数字 / Ref / getter。
 * ★ 2026-10-28：课堂页改为「先查当前课表拿到 sessionId 再连接」，
 *   调用时 sessionId 还不存在，故必须支持响应式来源。
 */
function resolveId(src) {
  if (typeof src === 'function') return src()
  return unref(src)
}

const HEARTBEAT_MS = 25000      // 契约：客户端心跳间隔 25 秒
const PONG_TIMEOUT_MS = 40000   // 契约：客户端判死 40 秒无 pong
const ACK_TIMEOUT_MS = 5000     // 契约：上行 ACK 超时重发
const MAX_ACK_RETRY = 3
const RECONNECT_BASE_MS = 1000  // 契约：指数退避 1s→2s→4s…
const RECONNECT_MAX_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 8      // ★ 重连上限：次数
const RECONNECT_TOTAL_MS = 5 * 60000  // ★ 重连上限：总时长 5 分钟
const STABLE_RESET_MS = 5000          // ★ 连接稳定多久后清零重连计数
const PROBE_MS = 25000                // ★ 心跳降级后的业务探活间隔
const PROBE_ACK_MS = 5000             // ★ 探活等待下行的超时

/** 控制帧：收到这些不算「业务首帧」，不用于判定连接已稳定 */
const CONTROL_TYPES = new Set(['pong', 'ack', 'presence', 'member_change', 'reconnect_ack', 'error'])

/** 鉴权类关闭码（本项目约定 + WebSocket 标准 1008 Policy Violation） */
const AUTH_CLOSE_CODES = new Set([1008, 4001, 4003, 4401])

/**
 * 舞台帧使用独立的 stageSeq 序列（后端 StageSyncCoordinator.nextStageSeq），
 * 不能拿普通课堂事件的 lastSeq 去比较，否则舞台 seq 从 1 开始会被直接丢弃。
 * 舞台帧的 seq/rev 去重统一交给 useStageSync。
 */
const STAGE_TYPES = new Set([
  'slide', 'stroke', 'clear', 'snapshot', 'playback', 'state-digest', 'state-reset'
])

export function useClassroomSocket(sessionId, options = {}) {
  const connected = ref(false)
  const reconnecting = ref(false)
  const onlineCount = ref(0)
  const lastSeq = ref(0)
  const statusText = ref('未连接')
  /** 重连超限，需要用户手动点「重新连接」 */
  const needManualReconnect = ref(false)
  /** 鉴权失败（登录过期），不应再自动重连 */
  const authFailed = ref(false)

  const onEvent = options.onEvent || (() => {})
  const onStatusChange = options.onStatusChange || (() => {})

  let ws = null
  let hbTimer = null
  let pongTimer = null
  let reconnectTimer = null
  let stableTimer = null
  let probeTimer = null
  let probeTimeout = null
  let retry = 0
  /** 本轮重连序列的起始时间（用于总时长上限），稳定连接后清零 */
  let reconnectStartedAt = 0
  let closedByUser = false
  /**
   * 心跳能力三态：
   *   unknown —— 还没确认（刚连上）；
   *   on      —— 已收到 pong，服务端支持 ping/pong；
   *   off     —— 服务端明确回「不支持的上行 type：ping」，改用业务探活。
   * ★ 之前是「首次 pong 超时即永久关心跳」，半开连接（服务端进程假死）永远发现不了。
   */
  let heartbeatMode = 'unknown'
  /** 业务探活连续失败次数（收到任意下行即清零） */
  let probeFailures = 0
  /**
   * 服务端是否回 ACK。
   * ★ 契约（表 6-1）同样**没有定义 ack**，ACK + clientMsgId 幂等是本实现的增强项。
   *   服务端不回 ACK 时若照样超时重发，同一条消息会被**重复落库**。
   *   故：**收到过服务端 ACK 之后**才启用「超时重发」；没收到过就只发一次。
   */
  let ackSupported = false

  /** clientMsgId → { msg, retries, timer }（等待 ACK） */
  const pending = new Map()
  /** 已处理的 clientMsgId（丢弃自己消息的回声与重复投递） */
  const seen = new Set()

  function setStatus(text) {
    statusText.value = text
    onStatusChange(text)
  }

  function buildUrl() {
    // ★ 2026-11-10：三条通道统一走 utils/wsUrl，协议/主机/token 只在一处维护
    return wsUrl(WS_PATHS.session, resolveId(sessionId))
  }

  /** 本轮重连是否还能继续（次数 + 总时长双上限） */
  function canReconnect() {
    if (retry >= RECONNECT_MAX_ATTEMPTS) return false
    if (reconnectStartedAt && Date.now() - reconnectStartedAt > RECONNECT_TOTAL_MS) return false
    return true
  }

  /** 连接稳定：清零重连计数与手动重试标记 */
  function markStable() {
    retry = 0
    reconnectStartedAt = 0
    needManualReconnect.value = false
    clearTimeout(stableTimer)
    stableTimer = null
  }

  // ==================== 连接 ====================

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    closedByUser = false
    authFailed.value = false
    setStatus(retry > 0 ? `重连中（第 ${retry} 次）` : '连接中…')

    try {
      ws = new WebSocket(buildUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      reconnecting.value = false
      needManualReconnect.value = false
      const wasReconnect = retry > 0 || lastSeq.value > 0
      setStatus('已连接')
      // ★ 不在这里清零 retry：若「连上就被踢」，清零会让重试次数永远回到 0（死循环）。
      //   改为稳定 5 秒后再清零；期间若收到业务首帧，也会提前清零（见 onmessage）。
      clearTimeout(stableTimer)
      stableTimer = setTimeout(markStable, STABLE_RESET_MS)
      startHeartbeat()
      if (wasReconnect) {
        // 契约：重连成功后立即发送 reconnect{lastSeq}，服务端补推离线消息
        send('reconnect', { lastSeq: lastSeq.value }, { noAck: true })
      }
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const { type, seq, clientMsgId, payload } = msg

      // 任何下行都说明连接是活的：业务探活失败计数清零
      probeFailures = 0
      clearTimeout(probeTimeout)
      probeTimeout = null

      // 业务首帧 = 连接确实可用，提前清零重连计数（控制帧不算，服务端连上就推 presence）
      if (!CONTROL_TYPES.has(type)) {
        markStable()
      }

      // pong：刷新判死计时
      if (type === 'pong') {
        heartbeatMode = 'on'
        refreshPongTimer()
        return
      }
      // ack：清掉待确认队列
      if (type === 'ack') {
        ackSupported = true
        clearPending(clientMsgId)
        return
      }
      // 下行有序：普通事件按 seq 去重；舞台帧走独立 stageSeq，由 useStageSync 处理
      if (typeof seq === 'number' && !STAGE_TYPES.has(type)) {
        if (seq <= lastSeq.value) return
        lastSeq.value = seq
      }
      // 自己消息的回声：客户端已乐观渲染，按 clientMsgId 丢弃
      // （chat 的回声里 clientMsgId 在 payload 中，其余在顶层）
      const echoId = clientMsgId || payload?.clientMsgId
      if (echoId && seen.has(echoId)) return

      if (type === 'member_change') {
        onlineCount.value = payload?.onlineCount ?? onlineCount.value
      }
      if (type === 'reconnect_ack') {
        onlineCount.value = payload?.onlineCount ?? onlineCount.value
      }
      // 协议噪声过滤：服务端对「它不认识的上行 type」回的 error（如心跳 ping、reconnect）
      // 属于各端实现差异，不是业务错误 —— 不上报给页面，避免弹无意义的错误提示
      if (type === 'error') {
        const message = String(payload?.message || '')
        // ★ 只有服务端**明确说不支持 ping**，才把心跳降级为业务探活
        if (/不支持的上行/i.test(message) && /ping/i.test(message)) {
          heartbeatMode = 'off'
          stopHeartbeat()
          startProbe()
        }
        if (/不支持的上行|unsupported/i.test(message)) return
      }
      onEvent(type, payload || {}, msg)
    }

    ws.onclose = (ev) => {
      connected.value = false
      stopHeartbeat()
      clearTimeout(stableTimer)
      if (closedByUser) {
        setStatus('已断开')
        return
      }
      // ★ 关闭码分流：鉴权失败重连多少次都没用，只会让用户看到「一直在重连」
      if (isAuthFailure(ev)) {
        authFailed.value = true
        reconnecting.value = false
        needManualReconnect.value = false
        setStatus('登录已过期，请重新登录')
        onEvent('error', { code: 401, message: '登录已过期，请重新登录' })
        return
      }
      scheduleReconnect()
    }

    ws.onerror = () => {
      // 交给 onclose 统一处理重连
    }
  }

  /**
   * 是否为鉴权类关闭（登录过期 / token 无效）。
   *
   * @param {CloseEvent} ev
   * @returns {boolean}
   */
  function isAuthFailure(ev) {
    const code = ev?.code
    const reason = String(ev?.reason || '')
    if (AUTH_CLOSE_CODES.has(code)) return true
    if (/token|登录|过期|unauthorized|forbidden/i.test(reason)) return true
    // 本地已经没有 token 了（被 401 拦截器清掉）：没必要重连
    return !getToken()
  }

  function scheduleReconnect() {
    if (closedByUser || authFailed.value) return
    if (!reconnectStartedAt) reconnectStartedAt = Date.now()
    if (!canReconnect()) {
      // ★ 超限：不再自动重连，暴露手动入口，避免整班学生无限重连打爆后端
      reconnecting.value = false
      needManualReconnect.value = true
      setStatus('实时通道连接失败，请点击重试')
      return
    }
    reconnecting.value = true
    const base = Math.min(RECONNECT_BASE_MS * 2 ** retry, RECONNECT_MAX_MS)
    // 抖动 ±20%：避免整班学生同一时刻齐刷刷重连
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    retry += 1
    setStatus(`${Math.round(delay / 1000)} 秒后重连…（第 ${retry} 次）`)
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, delay)
  }

  /**
   * 用户手动重连（重连超限后的入口）。
   * 重置计数后立即发起一次连接，不等待退避。
   */
  function reconnectNow() {
    clearTimeout(reconnectTimer)
    retry = 0
    reconnectStartedAt = 0
    needManualReconnect.value = false
    authFailed.value = false
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    connect()
  }

  function close() {
    closedByUser = true
    clearTimeout(reconnectTimer)
    clearTimeout(stableTimer)
    stopHeartbeat()
    pending.forEach((e) => clearTimeout(e.timer))
    pending.clear()
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    connected.value = false
    setStatus('已断开')
  }

  // ==================== 上行发送 ====================

  function raw(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  /**
   * 发送上行消息。
   * @param {string} type       chat / interact / ping / reconnect …
   * @param {object} payload    事件负载
   * @param {object} opts       { noAck: 不等待 ACK（ping/reconnect 用）, clientMsgId: 自定义 }
   * @returns {string} clientMsgId
   */
  function send(type, payload = {}, opts = {}) {
    const clientMsgId = opts.clientMsgId
      || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const msg = { type, clientMsgId, ts: Date.now(), payload }
    seen.add(clientMsgId)

    if (type === 'ping' || opts.noAck) {
      raw(msg)
      return clientMsgId
    }

    // 服务端还没表现出 ACK 能力 → 只发一次，不排队、不重发（否则会重复落库）
    if (!ackSupported) {
      raw(msg)
      return clientMsgId
    }

    const entry = { msg, retries: 0, timer: null }
    entry.timer = setTimeout(() => retrySend(clientMsgId), ACK_TIMEOUT_MS)
    pending.set(clientMsgId, entry)
    if (!raw(msg)) {
      // 连接未就绪：交给重发队列（重连后会补发）
      clearPending(clientMsgId)
      return clientMsgId
    }
    return clientMsgId
  }

  function retrySend(clientMsgId) {
    const entry = pending.get(clientMsgId)
    if (!entry) return
    entry.retries += 1
    if (entry.retries > MAX_ACK_RETRY) {
      pending.delete(clientMsgId)
      onEvent('error', { code: 504, message: '消息发送失败（重试超限）' })
      return
    }
    raw(entry.msg)
    entry.timer = setTimeout(() => retrySend(clientMsgId), ACK_TIMEOUT_MS)
  }

  function clearPending(clientMsgId) {
    const entry = pending.get(clientMsgId)
    if (entry) {
      clearTimeout(entry.timer)
      pending.delete(clientMsgId)
    }
  }

  // ==================== 心跳 / 探活 ====================

  function startHeartbeat() {
    stopHeartbeat()
    if (heartbeatMode === 'off') {
      startProbe()
      return
    }
    hbTimer = setInterval(() => send('ping', {}, { noAck: true }), HEARTBEAT_MS)
    refreshPongTimer()
  }

  function refreshPongTimer() {
    clearTimeout(pongTimer)
    pongTimer = setTimeout(onPongTimeout, PONG_TIMEOUT_MS)
  }

  /**
   * pong 超时处理。
   *
   * <p>已确认支持心跳（on）却收不到 pong → 连接已半开，主动关闭触发重连；
   * 仍是 unknown → 不能断定服务端不支持，先降级为业务探活（兼容老后端）。
   */
  function onPongTimeout() {
    if (heartbeatMode === 'on') {
      forceReconnect('心跳超时')
      return
    }
    heartbeatMode = 'off'
    stopHeartbeat()
    startProbe()
  }

  /**
   * 业务探活：心跳降级后用 reconnect 当探针（服务端必回 reconnect_ack）。
   * 连续两次在 {@link PROBE_ACK_MS} 内没有任何下行 → 判定半开，主动断开重连。
   */
  function startProbe() {
    clearInterval(probeTimer)
    probeTimer = setInterval(() => {
      if (!connected.value || !ws || ws.readyState !== WebSocket.OPEN) return
      send('reconnect', { lastSeq: lastSeq.value }, { noAck: true })
      clearTimeout(probeTimeout)
      probeTimeout = setTimeout(() => {
        probeFailures += 1
        if (probeFailures >= 2) {
          forceReconnect('连接探测失败')
        }
      }, PROBE_ACK_MS)
    }, PROBE_MS)
  }

  /** 主动断开以触发 onclose → scheduleReconnect */
  function forceReconnect(reason) {
    setStatus(`连接异常（${reason}），正在重连…`)
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
  }

  function stopHeartbeat() {
    clearInterval(hbTimer)
    clearTimeout(pongTimer)
    clearInterval(probeTimer)
    clearTimeout(probeTimeout)
    hbTimer = null
    pongTimer = null
    probeTimer = null
    probeTimeout = null
  }

  // ==================== 前后台 / 网络切换 ====================

  /** 切回前台：半开连接往往在后台被系统掐断，回来立即补连 */
  function handleVisibility() {
    if (document.visibilityState !== 'visible' || closedByUser || authFailed.value) return
    if (!ws || ws.readyState > WebSocket.OPEN) {
      connect()
      return
    }
    // 连接还在：重置判死计时，避免把「后台被挂起」误判成断线
    if (connected.value) refreshPongTimer()
  }

  /** 网络恢复：立刻重连，不等退避 */
  function handleOnline() {
    if (closedByUser || authFailed.value || connected.value) return
    clearTimeout(reconnectTimer)
    connect()
  }

  /** 网络断开：先把状态说清楚，后续由 online 事件触发重连 */
  function handleOffline() {
    setStatus('网络已断开')
  }

  onMounted(() => {
    // sessionId 可能要等「当前课堂」接口返回才有值，此时先不连，交给下面的 watch
    if (resolveId(sessionId)) connect()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })
  // sessionId 从无到有（或切换到另一节课）时重建连接
  watch(
    () => resolveId(sessionId),
    (id, old) => {
      if (!id || id === old) return
      if (ws) close()
      lastSeq.value = 0
      retry = 0
      reconnectStartedAt = 0
      heartbeatMode = 'unknown'
      probeFailures = 0
      connect()
    }
  )
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    close()
  })

  return {
    connected,
    reconnecting,
    onlineCount,
    lastSeq,
    statusText,
    needManualReconnect,
    authFailed,
    send,
    close,
    connect,
    reconnectNow
  }
}
