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
 * ★ 2026-10-28 多人同时观看（上课场景：一个班 N 个学生同时看教师屏幕）：
 *     共享端为每个接收端**各维护一路独立的 PeerConnection**（peers: userId -> pc），
 *     每路的 offer / candidate 都通过信令的 `to` 字段定向投递，互不串台；
 *     接收端只维护一路，并校验 offer 的 `to` 是否等于自己的 userId（由服务端下行 self 告知）。
 *     房间成员通过服务端下行的 room-members（快照）与 peer-join / peer-leave（增量）维护。
 *
 * 用法：
 *   // 学生端（接收）
 *   const { remoteStream, castState, wsConnected } = useCastSignaling(sessionId)
 *   // 教师端（共享，多人）
 *   const { viewers, connectedCount, startShare, stopShare } =
 *     useCastSignaling(sessionId, { role: 'sharer' })
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

/**
 * ICE 服务器配置（★ 2026-10-28：支持 TURN，跨网段/跨 NAT 时必须）
 *
 * 同网段（同一个 WiFi/局域网）时，WebRTC 用 host candidate 直接 P2P，不需要任何服务器；
 * 一旦两端不在同一网段且 NAT 打洞失败（校园网常见），就必须靠 TURN 中继，否则永远连不上。
 *
 * TURN 地址通过环境变量注入，运维部署好 coturn 后**只改 .env 重启前端即可生效，无需改代码**：
 *   VITE_TURN_URLS=turn:1.2.3.4:3478         多个用逗号分隔（可同时配 turn: 与 turns:）
 *   VITE_TURN_USERNAME=zhike
 *   VITE_TURN_CREDENTIAL=xxxxxx
 * 不配置时退化为仅 STUN（同网段可用，跨网段无保障）。
 */
function buildIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }]
  const urls = (import.meta.env.VITE_TURN_URLS || '').trim()
  if (urls) {
    const username = import.meta.env.VITE_TURN_USERNAME || ''
    const credential = import.meta.env.VITE_TURN_CREDENTIAL || ''
    urls.split(',').map((u) => u.trim()).filter(Boolean).forEach((u) => {
      const item = { urls: u }
      if (username) item.username = username
      if (credential) item.credential = credential
      servers.push(item)
    })
  }
  return servers
}

/** 兼容旧服务端时的广播路 key（服务端不支持定向投递时的兜底，只允许一路） */
const BROADCAST_KEY = '__broadcast__'

const RTC_CONFIG = {
  iceServers: buildIceServers()
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

  /** 房间内除自己以外的成员 userId 列表（★ 多人投屏：共享端据此知道要给谁发 offer） */
  const viewers = ref([])
  /** 已成功连通的接收端路数（★ 多人投屏：教师端可显示"N 人正在观看"） */
  const connectedCount = ref(0)
  /** 自己的 userId，由服务端下行 room-members.self 告知（客户端无法从 JWT 解出） */
  const selfId = ref(null)
  /** 投递模式：direct=按 userId 定向（新版服务端，支持多人）/ broadcast=广播一路（旧版服务端兜底） */
  const castMode = ref('direct')

  /** 本端角色：viewer=接收端（学生，默认） / sharer=共享端（教师） */
  const role = options.role === 'sharer' ? 'sharer' : 'viewer'
  const onEvent = options.onEvent || (() => {})

  let ws = null
  let pc = null                 // viewer 角色：唯一的接收用 PeerConnection
  /** sharer 角色：每个接收端一路，userId -> RTCPeerConnection（非响应式，内部索引用） */
  const peers = new Map()
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
      // ★ 多人：共享端重连后旧的多路 pc 已失效，重建所有路（断线期间学生不黑屏）
      if (role === 'sharer' && sharing.value) {
        peers.forEach((p) => {
          try {
            p.close()
          } catch {
            /* ignore */
          }
        })
        peers.clear()
        connectedCount.value = 0
        inviteAll()
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

  // ==================== 多人投屏：共享端的多路 PeerConnection ====================

  /** 关闭并移除某一路连接 */
  function closePeer(uid) {
    const p = peers.get(uid)
    if (p) {
      try {
        p.close()
      } catch {
        /* ignore */
      }
      peers.delete(uid)
    }
    // 重新统计连通数（用微任务让状态变更先落地）
    Promise.resolve().then(countConnected)
  }

  /** 统计已连通的路数（教师端显示"N 人正在观看"） */
  function countConnected() {
    let n = 0
    peers.forEach((p) => {
      if (p.connectionState === 'connected' || p.connectionState === 'completed') n += 1
    })
    connectedCount.value = n
  }

  /**
   * 共享端：为某一个接收端单独建一路并定向发出 offer
   *
   * 每个接收端一条独立 PeerConnection，offer / candidate 均带 `to` 定向，
   * 服务端只把信令投递给该 userId 的连接，因此多路之间不会串台。
   *
   * @param uid 目标接收端 userId（字符串）
   */
  async function inviteViewer(uid, direct = true) {
    if (!uid || !localStream.value) return
    if (direct && String(uid) === String(selfId.value)) return  // 不给自己发
    const key = direct ? String(uid) : BROADCAST_KEY
    if (peers.has(key)) return                            // 该路已在协商/已连通

    const p = new RTCPeerConnection(RTC_CONFIG)
    peers.set(key, p)

    p.onicecandidate = (e) => {
      if (e.candidate) {
        send('candidate', {
          candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex
        }, key)
      }
    }
    p.onconnectionstatechange = () => {
      const s = p.connectionState
      if (s === 'connected') {
        countConnected()
        onEvent('viewer_connected', { userId: key })
      } else if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        // 单路失败只影响这一个学生，不影响其他路；清理后允许后续重邀
        countConnected()
        if (s === 'failed' || s === 'closed') {
          peers.delete(key)
          onEvent('viewer_lost', { userId: key })
        }
      }
    }

    localStream.value.getTracks().forEach((t) => p.addTrack(t, localStream.value))
    try {
      const offer = await p.createOffer()
      await p.setLocalDescription(offer)
      // direct=false 时不带 to → 服务端原样广播（兼容旧版本投屏服务端）
      send('offer', { sdp: offer.sdp, type: offer.type, shareType: 'screen' }, direct ? key : null)
    } catch (e) {
      errorText.value = `向 ${key} 发起共享失败：${e?.message || e}`
      peers.delete(key)
    }
  }

  /**
   * 共享端：给当前所有已知接收端各建一路
   *
   * ★ 兼容回退：若 viewers 为空（说明服务端不支持 room-members / peer-join，
   *   例如尚未部署最新版后端），则退化为「广播一路 offer」——
   *   旧版投屏服务端会把 offer 原样广播给房间所有人，1 个接收端可以正常出画面。
   *   （多人同时观看仍需新版服务端的定向投递。）
   */
  async function inviteAll() {
    const list = viewers.value.slice()
    for (const uid of list) {
      await inviteViewer(uid)
    }
    if (!list.length) {
      castMode.value = 'broadcast'
      await inviteViewer(BROADCAST_KEY, false)
    }
  }

  /**
   * 共享端：抓屏并发出 offer（★ 学生端 role='viewer' 时禁止调用）
   *
   * @param shareType     'screen' | 'window' | 'tab'，仅提示用
   * @param customStream  可选。传入已有 MediaStream 代替 getDisplayMedia。
   *                      联调自测用：canvas.captureStream() 在 http 下也可用，
   *                      不受 getDisplayMedia 的「必须 HTTPS/localhost」安全上下文限制。
   */
  async function startShare(shareType = 'screen', customStream = null) {
    if (role !== 'sharer') {
      errorText.value = '学生端为投屏接收方，不能发起屏幕共享'
      return false
    }
    errorText.value = ''
    if (customStream) {
      localStream.value = customStream
    } else {
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
    }

    sharing.value = true
    setState('negotiating')

    // 用户点「停止共享」时同步收尾
    localStream.value.getVideoTracks().forEach((t) => {
      t.onended = () => stopShare()
    })

    // ★ 多人：广播一条 start（让接收端弹提示），再给每个接收端各定向发一路 offer。
    //   只广播 offer 会让所有学生抢同一路协商，故 offer 必须带 to 定向。
    const ok = send('start', { shareType })
    if (!ok) errorText.value = '信令未连接，稍后自动重试'
    await inviteAll()
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
    // ★ 多人：关闭所有接收端的路
    peers.forEach((p) => {
      try {
        p.close()
      } catch {
        /* ignore */
      }
    })
    peers.clear()
    connectedCount.value = 0
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

    // ---------- 房间成员维护（两种角色都要，服务端下行） ----------
    if (type === 'room-members') {
      if (payload.self != null) selfId.value = String(payload.self)
      const list = Array.isArray(payload.members) ? payload.members.map(String) : []
      const before = viewers.value.slice()
      viewers.value = list
      // 共享中来了新成员（或快照里出现尚未建路的成员）→ 补发 offer
      if (role === 'sharer' && sharing.value) {
        for (const uid of list) {
          if (!before.includes(uid)) inviteViewer(uid)
        }
      }
      onEvent('room-members', payload)
      return
    }
    if (type === 'peer-join') {
      const uid = payload.userId != null ? String(payload.userId) : null
      if (uid && !viewers.value.includes(uid)) viewers.value = [...viewers.value, uid]
      // 共享中有人进来 → 立刻给他单独建一路（这是"后进入教室的学生也能看到画面"的关键）
      if (role === 'sharer' && sharing.value && uid) inviteViewer(uid)
      onEvent('peer-join', payload)
      return
    }
    if (type === 'peer-leave') {
      const uid = payload.userId != null ? String(payload.userId) : null
      if (uid) {
        viewers.value = viewers.value.filter((x) => x !== uid)
        if (role === 'sharer') closePeer(uid)
      }
      onEvent('peer-leave', payload)
      return
    }

    switch (type) {
      case 'start':
        peerId.value = from
        setState('negotiating')
        onEvent('start', payload)
        break

      case 'offer': {
        // 接收端：应答
        // ★ 防御 1：服务端会把信令回环给发送方自己，本端若正在共享必须忽略。
        if (sharing.value) return
        // ★ 防御 2（多人）：offer 带 to 时，只处理发给自己的那一路。
        //   服务端已按 to 定向投递，这里是双保险——防止定向失效时收到别人的 offer 而串台。
        if (payload.to != null && selfId.value && String(payload.to) !== String(selfId.value)) {
          return
        }
        // ★ 防御 3：重复 offer（同一教师重发）时不要重复应答
        if (peerId.value && peerId.value === from && castState.value === 'live') return
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
        // 共享端：按 from 找到对应那一路再落应答（★ 多人：不能落到同一路）
        if (role === 'sharer') {
          // 按 from 找对应那一路；找不到时回落到广播路（旧服务端不带 from 的场景）
          const p = (from ? peers.get(String(from)) : null) || peers.get(BROADCAST_KEY) || null
          if (p && p.signalingState !== 'stable') {
            try {
              await p.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
            } catch {
              /* 重复/过期应答忽略 */
            }
          }
        } else if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        }
        onEvent('answer', payload)
        break
      }

      case 'candidate': {
        // ★ 多人：共享端按 from 路由到对应那一路
        const target = role === 'sharer'
          ? ((from ? peers.get(String(from)) : null) || peers.get(BROADCAST_KEY) || null)
          : pc
        if (!target) return
        try {
          const cand = payload.candidate?.candidate ? payload.candidate : payload
          await target.addIceCandidate({
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
    // ★ 多人投屏
    viewers,          // 房间内其他成员 userId 列表
    connectedCount,   // 已连通的接收端路数（教师端"N 人正在观看"）
    selfId,           // 自己的 userId（服务端下发）
    castMode,         // direct=定向多人（新版服务端） / broadcast=广播一路（旧版服务端兜底）
    startShare,
    stopShare,
    connect,
    close
  }
}
