/**
 * 课堂投屏接收（LiveKit SFU）★ 2026-10-30
 *
 * 对应《实时课堂投屏改造调整清单》第五章「学生端前端改造」。
 *
 * **为什么换**：原来的 `useCastSignaling` 是自研 P2P Mesh —— 教师对每个学生各建一条
 * RTCPeerConnection，30 人上课时教师要上行 30 路独立编码，教室网络必炸；且无 simulcast、
 * 无断线重连（`stop()` 是终态）。改为 LiveKit SFU 后：教师只上行 1 路，
 * 由服务端按需转发，弱网自动降档，信令/ICE/TURN 全部交给 LiveKit。
 *
 * **本文件只做订阅方（viewer）**：学生 `canPublish=false`，只收不发。
 *
 * ★ 关键时序（官方文档没强调、但错了就永远收不到流）：
 *   `RoomEvent.TrackSubscribed` 必须在 `room.connect()` **之前** 注册 ——
 *   加入房间的过程中服务端就会推送已有轨道，监听器注册晚了会错过事件。
 */
import { ref, watch, onUnmounted } from 'vue'
import { Room, RoomEvent, Track } from 'livekit-client'
import { castToken } from '@/api/student/live'

/**
 * @param {import('vue').Ref<number>} sessionId 课堂 ID（0 表示未就绪）
 * @param {Object} options
 * @param {(type: string, payload?: Object) => void} [options.onEvent] 状态回调：stream / stop / error
 */
export function useLiveKitCast(sessionId, { onEvent } = {}) {
  /** 教师屏幕流（绑到 <video>.srcObject） */
  const remoteStream = ref(null)
  /** idle | connecting | live */
  const castState = ref('idle')
  /** 与 LiveKit 媒体服务器的连接状态（沿用旧字段名，Live.vue 无需改） */
  const wsConnected = ref(false)
  const errorText = ref('')

  let room = null
  let closedByUser = false
  /** 防止重复连接（watch 与手动调用可能同时触发） */
  let connecting = false

  const emit = (type, payload) => {
    try {
      onEvent?.(type, payload)
    } catch {
      // 回调异常不能影响连接流程
    }
  }

  async function disconnect() {
    closedByUser = true
    connecting = false
    if (room) {
      try {
        await room.disconnect()
      } catch {
        // 断开失败不影响后续清理
      }
      room = null
    }
    wsConnected.value = false
    remoteStream.value = null
    if (castState.value !== 'connecting') castState.value = 'idle'
  }

  async function connect() {
    const sid = Number(sessionId.value) || 0
    if (!sid || connecting || wsConnected.value || closedByUser) return

    connecting = true
    castState.value = 'connecting'
    errorText.value = ''

    try {
      // 1) 向自己的后端换 LiveKit token（后端校验选课归属，学生 canPublish 恒 false）
      const d = await castToken(sid)
      if (!d?.token || !d?.url) {
        throw new Error('投屏服务未就绪（token 签发失败）')
      }

      // 2) 建房间对象
      room = new Room({ adaptiveStream: true, dynacast: true })

      // ★ 必须在 connect 之前注册监听
      room.on(RoomEvent.TrackSubscribed, (track) => {
        // 只认屏幕共享轨（教师端 publish 时 source=ScreenShare）
        const isScreen = track.source === Track.Source.ScreenShare
        if (!isScreen && track.kind !== 'video') return
        remoteStream.value = new MediaStream([track.mediaStreamTrack])
        castState.value = 'live'
        emit('stream', { source: track.source })
      })

      room.on(RoomEvent.TrackUnsubscribed, () => {
        remoteStream.value = null
        castState.value = 'idle'
        emit('stop')
      })

      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        // 分享者离开 → 清空画面（避免停在最后一帧）
        if (!p) return
        if (!room || room.remoteParticipants.size === 0) {
          remoteStream.value = null
          castState.value = 'idle'
          emit('stop')
        }
      })

      room.on(RoomEvent.Disconnected, () => {
        wsConnected.value = false
        remoteStream.value = null
        castState.value = 'idle'
        // 非主动断开：交给重连逻辑（页面重新可见/切回课堂时再连）
        if (!closedByUser) emit('stop')
      })

      // 3) 连接
      await room.connect(d.url, d.token)
      wsConnected.value = true
      castState.value = 'idle'
      emit('connected', { room: d.room })
    } catch (e) {
      const msg = e?.message || String(e)
      // 403（未选课）/409（课堂结束）由请求拦截器提示，这里只做状态收敛
      errorText.value = /403|409/.test(msg) ? '' : `投屏连接失败：${msg}`
      wsConnected.value = false
      castState.value = 'idle'
      if (room) {
        try {
          await room.disconnect()
        } catch {
          // 忽略
        }
        room = null
      }
    } finally {
      connecting = false
    }
  }

  /** sessionId 就绪即连；变化时先断后连 */
  watch(
    sessionId,
    async (v) => {
      if (Number(v) > 0) {
        closedByUser = false
        await connect()
      } else {
        await disconnect()
      }
    },
    { immediate: true }
  )

  onUnmounted(disconnect)

  return {
    remoteStream,
    castState,
    wsConnected,
    errorText,
    connect,
    disconnect
  }
}
