/**
 * 课堂投屏信令（契约表 6-2：WS /ws/cast/{sessionId}）+ WebRTC 媒体协商
 *
 * 职责边界：
 *   · 信令（SDP / ICE）走 **表 6-2 服务端转发**（WsSessionRegistry 之外的独立端点 CastWsHandler）
 *   · 音视频**不经服务端**，由 WebRTC 在浏览器之间 P2P 直连
 *
 * 两种角色（★ 2026-10-28 修正：学生 PC 端**只能是接收端**）：
 *   · 共享端（教师）  → startShare() 抓屏 → offer → 等待 answer
 *   · 接收端（学生）  → 收到 offer → answer → ontrack 拿到远端流，交给 <video> 播放
 *
 * ★ 角色由 `options.role` 决定，默认 'viewer'：
 *     role='viewer' 时 startShare() 直接拒绝（返回 false 并提示），
 *     从底层杜绝学生端反向发起共享——投屏方向必须是「教师 → 学生」。
 *     只有 role='sharer'（教师端）才允许抓屏。
 *
 * 用法：
 *   const { remoteStream, castState, wsConnected } = useCastSignaling(sessionId, {
 *     role: 'viewer',
 *     onEvent(type, payload) { ... }   // start / stop / stream 等状态事件
 *   })
 */
import { ref, onMounted, onUnmounted, watch, unref } from 'vue'
import { getToken } from '@/api/request'

/** sessionId 允许 数字 / Ref / getter（★ 2026-10-28：课堂页先查当前课表再连接） */
function resolveId(src) {
  if (typeof src === 'function') return src()
  return unref(src)
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

const RTC_CONFIG = {
  iceServers: [
    // 校园网/局域网内 host candidate 即可直连；跨网段时依赖 STUN
    { urls: 'stun:stun.l.google.com:19302' }
  ]
}

export function useCastSignaling(sessionId, options = {}) {
  const remoteStream = ref(null)     // 接收到的屏幕流（绑定 <video>）
  /** 本端抓到的屏幕流（★ 2026-10-28：教师端共享时给自己一个本地预览小窗；viewer 模式恒为 null） */
  const localStream = ref(null)
  const sharing = ref(false)         // 本端是否正在共享（viewer 模式恒为 false）
  const castState = ref('idle')      // idle | connecting | negotiating | live | ended
  const peerId = ref(null)           // 当前对端 userId
  const errorText = ref('')
  /** 信令通道是否已连上（★ 2026-10-28：页面要能显示"投屏通道：已连接/重连中"，便于演示排障） */
  const wsConnected = ref(false)

  /** 本端角色：viewer=接收端（学生，默认） / sharer=共享端（教师） */
  const role = options.role === 'sharer' ? 'sharer' : 'viewer'
  const onEvent = options.onEvent || (() => {})

  let ws = null
  let pc = null
  let retry = 0
  let closedByUser = false
  let reconnectTimer = null

  function setState(s) {
    castState.value = s
  }

  function wsUrl() {
    const token = getToken()
    const base = import.meta.env.VITE_WS_BASE_URL
      || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    return `${base}/ws/cast/${resolveId(sessionId)}?token=${encodeURIComponent(token)}`
  }

  // ==================== 信令连接 ====================

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
    closedByUser = false
    setState('connecting')
    try {
      ws = new WebSocket(wsUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      retry = 0
      wsConnected.value = true
      setState(sharing.value ? 'negotiating' : 'idle')
      // 契约：投屏通道重连后由接收端重新协商
      const wasDown = castState.value === 'live' || peerId.value != null
      if (wasDown) {
        send('reconnect', { sessionId: resolveId(sessionId), lastSeq: 0 })
      }
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const { type, payload = {} } = msg
      if (type === 'error') {
        errorText.value = payload.message || '投屏信令错误'
        return
      }
      if (type === 'reconnect_ack') {
        return
      }
      handleSignal(type, payload)
    }

    ws.onclose = () => {
      wsConnected.value = false
      if (!closedByUser) scheduleReconnect()
    }
    ws.onerror = () => {
      /* onclose 统一处理 */
    }
  }

  function scheduleReconnect() {
    if (closedByUser) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** retry, RECONNECT_MAX_MS)
    retry += 1
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, delay)
  }

  function send(type, payload = {}, to = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    const body = { ...payload }
    if (to != null) body.to = to
    ws.send(JSON.stringify({ type, ts: Date.now(), payload: body }))
    return true
  }

  function close() {
    closedByUser = true
    wsConnected.value = false
    clearTimeout(reconnectTimer)
    stopShare(true)
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    setState('idle')
  }

  // ==================== WebRTC ====================

  function ensurePeer() {
    if (pc) return pc
    pc = new RTCPeerConnection(RTC_CONFIG)

    // 接收：远端轨道到达
    pc.ontrack = (e) => {
      remoteStream.value = e.streams[0] || null
      setState('live')
      onEvent('stream', { stream: remoteStream.value })
    }
    // 本端 ICE 候选 → 通过信令发出去
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send('candidate', {
          candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex
        }, peerId.value)
      }
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') setState('live')
      else if (s === 'failed' || s === 'closed') {
        setState('ended')
        remoteStream.value = null
      }
    }
    return pc
  }

  /**
   * 丢弃旧 PeerConnection 重建一个干净的
   * ★ 2026-10-28：教师「停止共享 → 再次共享」时，旧的 pc 里残留上一轮的 transceiver，
   *   复用它会让第二次协商失败（表现为「老师第二次共享，学生没画面」）。
   *   每次收到新 offer 都重建，保证每轮共享都是全新协商。
   */
  function resetPeer() {
    if (pc) {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      pc = null
    }
    remoteStream.value = null
    return ensurePeer()
  }

  /** 共享端：抓屏并发出 offer（★ 学生端 role='viewer' 时禁止调用） */
  async function startShare(shareType = 'screen') {
    if (role !== 'sharer') {
      errorText.value = '学生端为投屏接收方，不能发起屏幕共享'
      return false
    }
    errorText.value = ''
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('当前浏览器不支持屏幕共享（请使用 Chrome / Edge）')
      }
      localStream.value = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false
      })
    } catch (e) {
      errorText.value = e?.name === 'NotAllowedError' ? '已取消共享' : `无法开始共享：${e.message || e}`
      return false
    }

    sharing.value = true
    setState('negotiating')

    const peer = ensurePeer()
    localStream.value.getTracks().forEach((t) => peer.addTrack(t, localStream.value))
    // 用户点「停止共享」时同步收尾
    localStream.value.getVideoTracks().forEach((t) => {
      t.onended = () => stopShare()
    })

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const ok = send('offer', { sdp: offer.sdp, type: offer.type, shareType })
    if (!ok) errorText.value = '信令未连接，稍后自动重试'
    onEvent('share_start', { shareType })
    return true
  }

  /** 共享端 / 接收端：结束共享并释放资源 */
  function stopShare(silent = false) {
    if (localStream.value) {
      localStream.value.getTracks().forEach((t) => {
        try {
          t.stop()
        } catch {
          /* ignore */
        }
      })
      localStream.value = null
    }
    sharing.value = false
    if (pc) {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      pc = null
    }
    remoteStream.value = null
    setState('ended')
    if (!silent) {
      send('stop', { reason: 'user_stop' })
      onEvent('share_stop', {})
    }
  }

  // ==================== 信令处理 ====================

  async function handleSignal(type, payload) {
    const from = payload.from != null ? String(payload.from) : null
    switch (type) {
      case 'start':
        peerId.value = from
        setState('negotiating')
        onEvent('start', payload)
        break

      case 'offer': {
        // 接收端：应答
        // ★ 防御：服务端现行实现会把信令回环给发送方自己（实测确认），
        //   本端若正在共享必须忽略，否则会对着自己的 offer 做 setRemoteDescription 而崩。
        if (sharing.value) return
        peerId.value = from
        setState('negotiating')
        const peer = resetPeer()
        await peer.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        send('answer', { sdp: answer.sdp, type: answer.type }, from)
        onEvent('offer', payload)
        break
      }

      case 'answer': {
        // 共享端：收到应答
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        }
        onEvent('answer', payload)
        break
      }

      case 'candidate': {
        if (!pc) return
        try {
          const cand = payload.candidate?.candidate ? payload.candidate : payload
          await pc.addIceCandidate({
            candidate: cand.candidate ?? cand,
            sdpMid: cand.sdpMid,
            sdpMLineIndex: cand.sdpMLineIndex
          })
        } catch {
          /* 候选乱序到达时忽略 */
        }
        break
      }

      case 'stop':
        // 对端停止共享
        if (!sharing.value) {
          remoteStream.value = null
          setState('ended')
        }
        onEvent('stop', payload)
        break

      case 'reconnect':
        // 对端重连：本端若在共享，重新发起 offer 由上层决定（这里仅通知）
        onEvent('reconnect', payload)
        break

      default:
        break
    }
  }

  onMounted(() => {
    // 等「当前课堂」接口给出 sessionId 后再连
    if (resolveId(sessionId)) connect()
  })
  watch(
    () => resolveId(sessionId),
    (id, old) => {
      if (!id || id === old) return
      if (ws) close()
      retry = 0
      connect()
    }
  )
  onUnmounted(close)

  return {
    remoteStream,
    localStream,
    sharing,
    castState,
    peerId,
    errorText,
    wsConnected,
    role,
    startShare,
    stopShare,
    connect,
    close
  }
}
