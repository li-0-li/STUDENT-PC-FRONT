/**
 * 学生端课堂音频（LiveKit）
 *
 * 职责：
 *   · 用 sessionId 换音频 token 并连接 LiveKit；
 *   · 暴露连接状态、麦克风开关、说话人、参与者与网络质量；
 *   · 音频服务未配置 / 未选课时自动降级为「仅课件同步」，不阻断课堂。
 */
import { ref, watch, onUnmounted } from 'vue'
import { audioToken } from '@/api/student/live'
import { AudioRoomClient } from '@/utils/audioRoomClient'
import timeline from '@/utils/classroomTimeline'

/**
 * @param {import('vue').Ref<number>|number} sessionId 课堂 id
 * @param {object} [opts]
 * @param {import('vue').Ref<boolean>|boolean} [opts.enabled] 是否启用（mock / 演示模式关掉）
 */
export function useLiveAudioRoom(sessionId, opts = {}) {
  /** idle | connecting | connected | reconnecting | disabled | error */
  const state = ref('idle')
  const error = ref('')
  const micEnabled = ref(false)
  const blocked = ref(false)
  const canPublish = ref(false)
  const speakingIds = ref([])
  const participants = ref([])
  const network = ref({ level: 'good', jitterMs: 0, lossRate: 0, rttMs: 0 })
  const volume = ref(80)

  let client = null
  let currentId = 0
  let connecting = false
  /** 音频重连次数（★ 2026-11-10）：每次重连都重新取 token，token 有有效期不能复用 */
  let audioRetry = 0
  let audioRetryTimer = null
  /** 重连上限：1/2/4 秒退避，最多 5 次，超限后交给用户点「重试」 */
  const AUDIO_MAX_RETRY = 5

  function isEnabled() {
    const v = opts.enabled
    return v && typeof v === 'object' && 'value' in v ? !!v.value : v !== false
  }

  function resolveId() {
    const v = sessionId
    return Number(v && typeof v === 'object' && 'value' in v ? v.value : v) || 0
  }

  function handleEvent(type, payload) {
    switch (type) {
      case 'state':
        state.value = payload || 'idle'
        break
      case 'blocked':
        blocked.value = !!payload
        break
      case 'speaking':
        speakingIds.value = Array.isArray(payload) ? payload : []
        break
      case 'participants':
        participants.value = Array.isArray(payload) ? payload : []
        break
      case 'permissions':
        canPublish.value = !!payload?.canPublish
        break
      case 'mic':
        micEnabled.value = !!payload
        break
      case 'network':
        network.value = payload || network.value
        break
      case 'error':
        error.value = payload || '课堂音频异常'
        break
      case 'audio-marker':
        // LiveKit data channel 低延迟旁路；与 WS 权威帧按 markerId 去重
        timeline.applyStageFrame('audio-marker', payload || {}, {
          timelineMs: Number(payload?.timelineMs || payload?.serverTimeMs) || 0
        })
        break
      case 'track':
        // 音轨切换：短暂冻结标记队列 + 音量渐变，避免画面/声音跳变
        timeline.markTrackSwitch()
        timeline.setAudioStatus({ outputLatencyMs: client?.measureOutputLatency?.() || 0 })
        break
      case 'disconnected': {
        // ★ 2026-11-10：终态断开分流。
        //   fatal（同名顶号 / 被移出 / 房间已删）→ 不再自动重连，避免两台设备互踢；
        //   其它（服务重启、状态错乱）→ 退避重连，每次重新取 token。
        const fatal = !!payload?.fatal
        const message = payload?.message || '课堂音频已断开'
        if (fatal) {
          clearRetry()
          state.value = 'error'
          error.value = message
          break
        }
        scheduleAudioReconnect(message)
        break
      }
      default:
        break
    }
    // P2：音频链路状态喂给统一时间轴，用于同步状态与降级判定
    let reason = ''
    if (blocked.value) {
      reason = '浏览器拦截了自动播放，请点击「开启声音」后恢复同步'
    } else if (state.value === 'disabled' || state.value === 'error' || state.value === 'disconnected') {
      reason = error.value || '课堂音频不可用，已降级为仅舞台同步'
    }
    // reconnecting 不置降级原因：保留队列并冻结，恢复后继续按原时间轴生效（缓冲中断）
    timeline.setAudioStatus({
      state: state.value,
      blocked: blocked.value,
      network: network.value,
      reason
    })
  }

  function clearRetry() {
    if (audioRetryTimer) {
      clearTimeout(audioRetryTimer)
      audioRetryTimer = null
    }
  }

  /**
   * 音频断线重连（★ 2026-11-10 新增）。
   *
   * @param {string} message 展示给学生的原因
   */
  function scheduleAudioReconnect(message) {
    if (!isEnabled() || !resolveId()) return
    if (audioRetry >= AUDIO_MAX_RETRY) {
      clearRetry()
      state.value = 'error'
      error.value = `${message}（已重试 ${AUDIO_MAX_RETRY} 次，请点击重试）`
      return
    }
    // 1s → 2s → 4s 封顶，避免雪崩式重连
    const delay = Math.min(1000 * 2 ** audioRetry, 4000)
    audioRetry += 1
    state.value = 'reconnecting'
    error.value = message
    clearRetry()
    audioRetryTimer = setTimeout(() => {
      // connect() 内部会重新 POST /audio-token，不复用旧 token
      connect()
    }, delay)
  }

  async function connect() {
    const id = resolveId()
    if (!isEnabled() || !id || connecting) return
    connecting = true
    clearRetry()
    // 首次连接不显示「重连中」，重连场景沿用外部已设置的状态
    if (state.value !== 'reconnecting') state.value = 'connecting'
    error.value = ''
    try {
      // ★ 每次连接都重新取 token：token 带过期时间，重连复用旧 token 必然再失败
      const data = await audioToken(id)
      if (!client) {
        client = new AudioRoomClient({ role: 'student', onEvent: handleEvent })
      }
      canPublish.value = !!data?.canPublish
      await client.connect({ url: data.url, token: data.token })
      currentId = id
      audioRetry = 0
      timeline.setAudioStatus({
        state: 'connected',
        reason: '',
        outputLatencyMs: client?.measureOutputLatency?.() || 0
      })
      timeline.recalibrate()
    } catch (e) {
      if (e?.code === 503) {
        state.value = 'disabled'
        error.value = '课堂音频服务未配置，当前仅同步课件与板书'
      } else if (e?.code === 403) {
        state.value = 'disabled'
        error.value = '你不在本课堂选课名单内，无法接入课堂音频'
      } else if (e?.code === 409) {
        state.value = 'disabled'
        error.value = '课堂已结束，音频已关闭'
      } else if (audioRetry === 0) {
        // ★ 首连失败大多是瞬时问题（设备初始化、网络抖动）：自动重试一次，再失败才报错
        audioRetry = 1
        state.value = 'reconnecting'
        error.value = '课堂音频连接失败，正在重试…'
        clearRetry()
        audioRetryTimer = setTimeout(connect, 1500)
      } else {
        state.value = 'error'
        error.value = e?.message || '课堂音频连接失败'
      }
    } finally {
      connecting = false
    }
  }

  async function disconnect() {
    // 切课/离场：清掉进行中的重连，避免离场后又被定时器连回来
    clearRetry()
    audioRetry = 0
    const instance = client
    client = null
    currentId = 0
    micEnabled.value = false
    speakingIds.value = []
    participants.value = []
    blocked.value = false
    state.value = 'idle'
    timeline.setAudioStatus({ state: 'idle', blocked: false, reason: '' })
    if (instance) {
      await instance.disconnect()
    }
  }

  async function toggleMic() {
    if (!client) return
    try {
      micEnabled.value = await client.setMicEnabled(!micEnabled.value)
      error.value = ''
    } catch (e) {
      micEnabled.value = false
      error.value = e?.message || '麦克风开启失败，请检查浏览器权限'
    }
  }

  async function resumeAudio() {
    try {
      await client?.room?.startAudio?.()
      blocked.value = false
      timeline.setAudioStatus({
        blocked: false,
        reason: '',
        outputLatencyMs: client?.measureOutputLatency?.() || 0
      })
      timeline.recalibrate()
    } catch {
      blocked.value = true
    }
  }

  function setVolume(v) {
    const n = Number(v)
    volume.value = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 80
    client?.setMasterVolume?.(volume.value / 100)
  }

  /** 用户手动重试：清零退避计数与定时器，立即重连（会重新取 token） */
  function retry() {
    audioRetry = 0
    clearRetry()
    connect()
  }

  watch(
    () => resolveId(),
    (id) => {
      if (id && id !== currentId) {
        connect()
      } else if (!id) {
        disconnect()
      }
    }
  )

  onUnmounted(disconnect)

  connect()

  return {
    state,
    error,
    micEnabled,
    blocked,
    canPublish,
    speakingIds,
    participants,
    network,
    volume,
    connect,
    disconnect,
    toggleMic,
    resumeAudio,
    setVolume,
    retry
  }
}
