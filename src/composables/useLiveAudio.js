/**
 * 课堂音频接收（LiveKit SFU · 纯音频）★ 2026-11-09
 *
 * 背景：实时课堂不再做视频直播（教师不推摄像头、不共享屏幕），
 * 只保留**教师麦克风**一条音轨；画面由课件舞台 + 白板承担。
 *
 * 与旧 `useLiveKitCast` 的差异：
 *   1. 只认 `Track.Kind.Audio`，收到 video 轨一律忽略（避免误订阅屏幕共享）；
 *   2. 不再导出 `remoteStream` 给 `<video>`，改为 `<audio>`；
 *   3. 增加 `audioBlocked` —— 浏览器自动播放策略会拦下无手势的 play()，
 *      页面必须给「点击开启声音」按钮，否则学生会误判成"老师没开麦"；
 *   4. 增加 `teacherMuted` —— 教师端静音时给出可见提示。
 *
 * ★ 时序：`TrackSubscribed` 必须在 `room.connect()` **之前** 注册。
 */
import { ref, watch, onUnmounted } from 'vue'
import { Room, RoomEvent, Track } from 'livekit-client'
import { castToken } from '@/api/student/live'

/**
 * @param {import('vue').Ref<number>} sessionId 课堂 ID（0 表示未就绪）
 * @param {Object} [options]
 * @param {(type: string, payload?: Object) => void} [options.onEvent] connected / audio / stop / error
 */
export function useLiveAudio(sessionId, { onEvent, enabled = true } = {}) {
  /** 待绑到 <audio>.srcObject 的音频流 */
  const remoteStream = ref(null)
  /** idle | connecting | live（live = 已收到音轨） */
  const audioState = ref('idle')
  /** 是否已连上 LiveKit 房间（不代表有声音） */
  const connected = ref(false)
  /** 教师未开麦 / 已静音 */
  const teacherMuted = ref(false)
  /** 浏览器拦截自动播放，需要用户点击后才能出声 */
  const audioBlocked = ref(false)
  const errorText = ref('')

  let room = null
  let closedByUser = false
  let connecting = false

  const emit = (type, payload) => {
    try {
      onEvent?.(type, payload)
    } catch {
      /* 回调异常不影响连接 */
    }
  }

  /** 尝试真正开始播放；被浏览器拦截时置 audioBlocked，等页面调 resumeAudio() */
  async function tryStartAudio() {
    if (!room) return false
    try {
      const ok = await room.startAudio()
      audioBlocked.value = !ok
      return ok
    } catch {
      audioBlocked.value = true
      return false
    }
  }

  /** 供「点击开启声音」按钮调用 */
  async function resumeAudio() {
    const ok = await tryStartAudio()
    if (ok) audioBlocked.value = false
    return ok
  }

  async function disconnect() {
    closedByUser = true
    connecting = false
    if (room) {
      try {
        await room.disconnect()
      } catch {
        /* 忽略 */
      }
      room = null
    }
    connected.value = false
    remoteStream.value = null
    audioState.value = 'idle'
    teacherMuted.value = false
    audioBlocked.value = false
  }

  async function connect() {
    // enabled=false 用于本地渲染演示：不向后端换 token，避免课堂不存在时的 403/409 弹窗
    if (!enabled) return
    const sid = Number(sessionId.value) || 0
    if (!sid || connecting || connected.value) return

    connecting = true
    audioState.value = 'connecting'
    errorText.value = ''

    try {
      const d = await castToken(sid)
      if (!d?.token || !d?.url) throw new Error('音频服务未就绪（token 签发失败）')

      room = new Room({ adaptiveStream: true, dynacast: true })

      // ★ 必须在 connect 之前注册
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return
        remoteStream.value = new MediaStream([track.mediaStreamTrack])
        audioState.value = 'live'
        teacherMuted.value = false
        tryStartAudio()
        emit('audio', { kind: 'subscribed' })
      })

      room.on(RoomEvent.TrackMuted, (pub, p) => {
        if (pub?.kind === Track.Kind.Audio) {
          teacherMuted.value = true
          emit('audio', { kind: 'muted', identity: p?.identity })
        }
      })

      room.on(RoomEvent.TrackUnmuted, (pub) => {
        if (pub?.kind === Track.Kind.Audio) {
          teacherMuted.value = false
          tryStartAudio()
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return
        remoteStream.value = null
        audioState.value = 'idle'
        teacherMuted.value = true
        emit('audio', { kind: 'unsubscribed' })
      })

      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!room) return
        if (room.remoteParticipants.size === 0) {
          remoteStream.value = null
          audioState.value = 'idle'
          teacherMuted.value = true
        }
      })

      room.on(RoomEvent.Disconnected, () => {
        connected.value = false
        remoteStream.value = null
        audioState.value = 'idle'
        if (!closedByUser) emit('stop')
      })

      await room.connect(d.url, d.token)
      connected.value = true
      emit('connected', { room: d.room })

      // 房间里可能已经有教师在推流，主动检查一次
      room.remoteParticipants.forEach((p) => {
        p.audioTrackPublications?.forEach((pub) => {
          if (pub.track && pub.track.kind === Track.Kind.Audio && !pub.isMuted) {
            remoteStream.value = new MediaStream([pub.track.mediaStreamTrack])
            audioState.value = 'live'
            tryStartAudio()
          }
        })
      })
    } catch (e) {
      const msg = e?.message || String(e)
      // 403（未选课）/409（课堂结束）由请求拦截器提示，这里只收敛状态
      errorText.value = /403|409/.test(msg) ? '' : `音频连接失败：${msg}`
      connected.value = false
      audioState.value = 'idle'
      if (room) {
        try {
          await room.disconnect()
        } catch {
          /* 忽略 */
        }
        room = null
      }
    } finally {
      connecting = false
    }
  }

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
    audioState,
    connected,
    teacherMuted,
    audioBlocked,
    errorText,
    resumeAudio,
    connect,
    disconnect
  }
}
