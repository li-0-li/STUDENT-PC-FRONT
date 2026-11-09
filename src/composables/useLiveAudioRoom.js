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
      default:
        break
    }
  }

  async function connect() {
    const id = resolveId()
    if (!isEnabled() || !id || connecting) return
    connecting = true
    state.value = 'connecting'
    error.value = ''
    try {
      const data = await audioToken(id)
      if (!client) {
        client = new AudioRoomClient({ role: 'student', onEvent: handleEvent })
      }
      canPublish.value = !!data?.canPublish
      await client.connect({ url: data.url, token: data.token })
      currentId = id
    } catch (e) {
      if (e?.code === 503) {
        state.value = 'disabled'
        error.value = '课堂音频服务未配置，当前仅同步课件与板书'
      } else if (e?.code === 403) {
        state.value = 'disabled'
        error.value = '你不在本课堂选课名单内，无法接入课堂音频'
      } else {
        state.value = 'error'
        error.value = e?.message || '课堂音频连接失败'
      }
    } finally {
      connecting = false
    }
  }

  async function disconnect() {
    const instance = client
    client = null
    currentId = 0
    micEnabled.value = false
    speakingIds.value = []
    participants.value = []
    blocked.value = false
    state.value = 'idle'
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
    } catch {
      blocked.value = true
    }
  }

  function setVolume(v) {
    const n = Number(v)
    volume.value = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 80
    client?.setMasterVolume?.(volume.value / 100)
  }

  function retry() {
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
