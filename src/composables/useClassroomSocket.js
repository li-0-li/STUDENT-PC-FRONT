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
 *   const { connected, onlineCount, statusText, send, close } = useClassroomSocket(sessionId, {
 *     onEvent(type, payload) { ... }   // 收到下行事件（chat / attendance / interact / member_change …）
 *   })
 *   send('chat', { content: '你好' })   // 自动带 clientMsgId、ACK 重发、去重
 *                                      // ★ 注意上行 payload 字段名按契约表 6-1 用 content（不是 text）
 */
import { ref, onMounted, onUnmounted, watch, unref } from 'vue'
import { getToken } from '@/api/request'

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

export function useClassroomSocket(sessionId, options = {}) {
  const connected = ref(false)
  const reconnecting = ref(false)
  const onlineCount = ref(0)
  const lastSeq = ref(0)
  const statusText = ref('未连接')

  const onEvent = options.onEvent || (() => {})
  const onStatusChange = options.onStatusChange || (() => {})

  let ws = null
  let hbTimer = null
  let pongTimer = null
  let reconnectTimer = null
  let retry = 0
  let closedByUser = false
  /**
   * 服务端是否回 pong。
   * ★ 契约（表 6-1）**没有规定心跳**，各端后端实现不一致：
   *   本项目经理整合版的 ChatWebSocketHandler 只认上行 chat / interact，收到 ping 会回
   *   「不支持的上行 type：ping」。若照旧在 PONG_TIMEOUT_MS 后强断重连，就会陷入「连上 → 40s 后强断 → 重连」的死循环。
   *   故改为：首次超时即**停用应用层心跳**，断线检测退回浏览器原生 onclose。
   */
  let heartbeatSupported = true
  /**
   * 服务端是否回 ACK。
   * ★ 契约（表 6-1）同样**没有定义 ack**，ACK + clientMsgId 幂等是本实现的增强项。
   *   经理整合版的 ChatWebSocketHandler 不回 ACK —— 若照样在 ACK_TIMEOUT_MS 后重发，
   *   同一条消息会被服务端**重复落库**（实测 chat_message 连出 message_id 50 / 51 两条一模一样）。
   *   故改为：**收到过服务端 ACK 之后**才启用「超时重发」；没收到过就只发一次。
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

  function wsUrl() {
    const token = getToken()
    const base = import.meta.env.VITE_WS_BASE_URL
      || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    return `${base}/ws/session/${resolveId(sessionId)}?token=${encodeURIComponent(token)}`
  }

  // ==================== 连接 ====================

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    closedByUser = false
    setStatus(retry > 0 ? `重连中（第 ${retry} 次）` : '连接中…')

    try {
      ws = new WebSocket(wsUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      reconnecting.value = false
      const wasReconnect = retry > 0 || lastSeq.value > 0
      retry = 0
      setStatus('已连接')
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

      // pong：刷新判死计时
      if (type === 'pong') {
        heartbeatSupported = true
        refreshPongTimer()
        return
      }
      // ack：清掉待确认队列
      if (type === 'ack') {
        ackSupported = true
        clearPending(clientMsgId)
        return
      }
      // 下行有序：seq 存在的按序去重（重连补推可能带来已收消息）
      if (typeof seq === 'number') {
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
        const msg = String(payload?.message || '')
        if (/不支持的上行|unsupported/i.test(msg)) return
      }
      onEvent(type, payload || {})
    }

    ws.onclose = () => {
      connected.value = false
      stopHeartbeat()
      if (!closedByUser) scheduleReconnect()
      else setStatus('已断开')
    }

    ws.onerror = () => {
      // 交给 onclose 统一处理重连
    }
  }

  function scheduleReconnect() {
    if (closedByUser) return
    reconnecting.value = true
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** retry, RECONNECT_MAX_MS)
    retry += 1
    setStatus(`${Math.round(delay / 1000)} 秒后重连…`)
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, delay)
  }

  function close() {
    closedByUser = true
    clearTimeout(reconnectTimer)
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
   * @param {string} type       chat / answer_submit / attendance_result / quiz_submit …
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

  // ==================== 心跳 ====================

  function startHeartbeat() {
    stopHeartbeat()
    if (!heartbeatSupported) return
    hbTimer = setInterval(() => send('ping', {}, { noAck: true }), HEARTBEAT_MS)
    refreshPongTimer()
  }

  function refreshPongTimer() {
    clearTimeout(pongTimer)
    pongTimer = setTimeout(() => {
      // 契约未规定心跳，服务端可能不支持：
      // 首次超时 → 停用应用层心跳（而不是强断重连，否则会 40s 一次的死循环重连）
      heartbeatSupported = false
      stopHeartbeat()
      setStatus('已连接')
    }, PONG_TIMEOUT_MS)
  }

  function stopHeartbeat() {
    clearInterval(hbTimer)
    clearTimeout(pongTimer)
    hbTimer = null
    pongTimer = null
  }

  onMounted(() => {
    // sessionId 可能要等「当前课堂」接口返回才有值，此时先不连，交给下面的 watch
    if (resolveId(sessionId)) connect()
  })
  // sessionId 从无到有（或切换到另一节课）时重建连接
  watch(
    () => resolveId(sessionId),
    (id, old) => {
      if (!id || id === old) return
      if (ws) close()
      lastSeq.value = 0
      retry = 0
      connect()
    }
  )
  onUnmounted(close)

  return { connected, reconnecting, onlineCount, lastSeq, statusText, send, close, connect }
}
