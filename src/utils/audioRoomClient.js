/**
 * LiveKit 课堂音频客户端（框架无关）
 *
 * 设计目标：
 *   · 只处理「音频」：麦克风采集、远端音频挂载、说话人、网络质量与重连；
 *   · 不依赖 Vue：Vue 3 用 composable 包一层，Vue 2 可在 mounted / beforeDestroy 直接使用；
 *   · 不做自定义 jitter buffer：WebRTC 自带自适应缓冲，应用层再加缓冲只会增加延迟；
 *   · 加入/离开时做一次轻量音量归一化，避免多人同时说话时总音量忽大忽小。
 *
 * LiveKit 侧参数：
 *   · 采集：AEC / 降噪 / AGC 全开，48kHz 单声道；
 *   · 发布：speech 预设 + RED 冗余；教师端关闭 DTX 避免吃字，学生端开启省带宽；
 *   · 订阅：自动订阅所有远端音频，按 trackSid 幂等挂载。
 */
import { Room, RoomEvent, Track, AudioPresets } from 'livekit-client'

/** 输出音量归一化下限：人数再多也不把每个人压到听不清 */
const MIN_GAIN = 0.7

/** 网络看门狗间隔 */
const STATS_INTERVAL_MS = 10000

/** 低延迟目标：jitter buffer 超过该值提示网络抖动 */
const JITTER_WARN_MS = 150

/** 丢包提示阈值（10s 窗口） */
const LOSS_WARN_RATE = 0.1

export class AudioRoomClient {
  /**
   * @param {object} options
   * @param {'teacher'|'student'} [options.role]
   * @param {(type: string, payload?: any) => void} [options.onEvent]
   */
  constructor(options = {}) {
    this.role = options.role || 'student'
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {}
    this.room = null
    /** trackSid -> { track, element, participant } */
    this.audioTracks = new Map()
    this.speakingIds = []
    this.statsTimer = null
    this.closed = false
    this.lastLoss = new Map()
    /** 用户音量滑杆（0~1），与人数归一化系数相乘 */
    this.masterVolume = 1
  }

  /* ---------------- 连接 / 断开 ---------------- */

  async connect({ url, token }) {
    if (!url || !token) {
      throw new Error('音频凭证缺少 url 或 token')
    }
    if (this.room) {
      await this.disconnect()
    }
    this.closed = false
    const room = this.buildRoom()
    this.room = room
    this.bindEvents(room)
    this.emit('state', 'connecting')
    try {
      await room.connect(url, token, { autoSubscribe: true })
      if (!room.canPlaybackAudio) {
        this.emit('blocked', true)
      }
      this.emit('state', 'connected')
      this.emitParticipants()
      this.startStatsWatchdog()
    } catch (e) {
      this.emit('state', 'error')
      this.emit('error', e?.message || '音频连接失败')
      throw e
    }
  }

  buildRoom() {
    return new Room({
      adaptiveStream: false,
      dynacast: false,
      webAudioMix: false,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1
      },
      publishDefaults: {
        audioPreset: AudioPresets.speech,
        // 教师连续讲，关闭 DTX 避免弱网下首个音节被吞；学生按需发言，开启省带宽
        dtx: this.role !== 'teacher',
        red: true,
        stopMicTrackOnMute: true
      },
      reconnectPolicy: {
        nextRetryDelayInMs: (ctx) => Math.min(1000 * 2 ** (ctx?.retryCount || 0), 15000)
      }
    })
  }

  bindEvents(room) {
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return
      this.attachAudio(track, publication, participant)
      this.emitParticipants()
      this.normalizeOutputVolume()
    })

    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      this.detachAudio(publication?.trackSid, track)
      this.normalizeOutputVolume()
      this.emitParticipants()
    })

    room.on(RoomEvent.ParticipantConnected, () => {
      this.emitParticipants()
      this.normalizeOutputVolume()
    })

    room.on(RoomEvent.ParticipantDisconnected, () => {
      this.emitParticipants()
      this.normalizeOutputVolume()
    })

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      this.speakingIds = (speakers || []).map((p) => p.identity)
      this.emit('speaking', this.speakingIds)
      this.emitParticipants()
    })

    room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      this.emit('blocked', !playing)
    })

    room.on(RoomEvent.TrackMuted, () => {
      this.emitParticipants()
      this.emit('mic', this.isMicEnabled())
    })
    room.on(RoomEvent.TrackUnmuted, () => {
      this.emitParticipants()
      this.emit('mic', this.isMicEnabled())
    })
    room.on(RoomEvent.ParticipantPermissionsChanged, () => {
      this.emitParticipants()
      this.emit('permissions', this.localPermissions())
    })

    room.on(RoomEvent.Reconnecting, () => this.emit('state', 'reconnecting'))
    room.on(RoomEvent.Reconnected, () => {
      this.emit('state', 'connected')
      this.resyncSubscriptions()
    })

    room.on(RoomEvent.TrackSubscriptionFailed, (_sid, participant) => {
      this.emit('error', `订阅 ${participant?.identity || '对方'} 音频失败，稍后自动重试`)
      // 延迟重试一次，避免网络瞬断时直接放弃
      setTimeout(() => this.resyncSubscriptions(), 2000)
    })

    room.on(RoomEvent.MediaDevicesError, (e) => {
      this.emit('error', e?.message || '麦克风不可用，请检查系统权限')
    })
  }

  /* ---------------- 远端音频挂载 ---------------- */

  attachAudio(track, publication, participant) {
    const sid = publication?.trackSid
    if (!sid || this.audioTracks.has(sid)) return
    const element = track.attach()
    element.autoplay = true
    element.playsInline = true
    // 不放进布局，但必须进 DOM：Safari / iOS 对游离的 audio 元素可能不播放
    element.style.position = 'absolute'
    element.style.width = '0'
    element.style.height = '0'
    element.style.opacity = '0'
    element.setAttribute('aria-hidden', 'true')
    document.body.appendChild(element)
    this.audioTracks.set(sid, { track, element, participant })
  }

  detachAudio(sid, track) {
    if (!sid) return
    const entry = this.audioTracks.get(sid)
    if (!entry) return
    try {
      if (track && typeof track.detach === 'function') {
        track.detach(entry.element)
      }
    } catch {
      // 轨道可能已被浏览器回收
    }
    entry.element?.remove()
    this.audioTracks.delete(sid)
  }

  /**
   * 总响度归一化：人数增加时按 1/sqrt(N) 轻压，离开时恢复。
   *
   * <p>只调远端音频轨音量，不动采集端 AGC；下限 0.7，避免把人声压没。
   */
  normalizeOutputVolume() {
    const count = Math.max(1, this.audioTracks.size)
    const gain = Math.min(1, Math.max(MIN_GAIN, 1 / Math.sqrt(count))) * this.masterVolume
    this.audioTracks.forEach(({ track }) => {
      try {
        track.setVolume?.(gain)
      } catch {
        // 轨道已结束，忽略
      }
    })
  }

  /**
   * 用户音量滑杆：0~1，作用在归一化系数之上。
   */
  setMasterVolume(volume) {
    const n = Number(volume)
    this.masterVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
    this.normalizeOutputVolume()
  }

  /**
   * 重连后补齐订阅：LiveKit 通常会自动恢复，这里做一次幂等兜底。
   */
  resyncSubscriptions() {
    const room = this.room
    if (!room) return
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio) return
        const sid = publication.trackSid
        if (!sid || this.audioTracks.has(sid)) return
        if (publication.track) {
          this.attachAudio(publication.track, publication, participant)
        } else if (!publication.isSubscribed && typeof publication.setSubscribed === 'function') {
          publication.setSubscribed(true)
        }
      })
    })
    this.normalizeOutputVolume()
    this.emitParticipants()
  }

  /* ---------------- 本地麦克风 ---------------- */

  async setMicEnabled(enabled) {
    if (!this.room) {
      throw new Error('音频尚未连接')
    }
    await this.room.localParticipant.setMicrophoneEnabled(!!enabled)
    this.emit('mic', !!enabled)
    this.emitParticipants()
    return !!enabled
  }

  isMicEnabled() {
    return !!this.room?.localParticipant?.isMicrophoneEnabled
  }

  localPermissions() {
    const permission = this.room?.localParticipant?.permissions
    return {
      canPublish: !!permission?.canPublish,
      canSubscribe: !!permission?.canSubscribe
    }
  }

  /* ---------------- 统计看门狗 ---------------- */

  startStatsWatchdog() {
    this.stopStatsWatchdog()
    this.statsTimer = setInterval(() => this.collectStats(), STATS_INTERVAL_MS)
  }

  stopStatsWatchdog() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  async collectStats() {
    const room = this.room
    if (!room || this.closed) return
    let worstJitter = 0
    let worstLoss = 0
    let rtt = 0
    for (const [sid, entry] of this.audioTracks) {
      try {
        const report = await entry.track.getRTCStatsReport?.()
        if (!report) continue
        let jitterMs = 0
        let lossRate = 0
        report.forEach((stat) => {
          if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
            if (stat.jitterBufferEmittedCount > 0 && stat.jitterBufferDelay != null) {
              jitterMs = (stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000
            }
            const lost = Number(stat.packetsLost) || 0
            const received = Number(stat.packetsReceived) || 0
            const total = lost + received
            if (total > 0) lossRate = lost / total
          }
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime != null) {
            rtt = stat.currentRoundTripTime * 1000
          }
        })
        // 丢包按增量计算，避免历史累计值长期偏高
        const prev = this.lastLoss.get(sid) || 0
        const deltaLoss = Math.max(0, lossRate - prev)
        this.lastLoss.set(sid, lossRate)
        worstJitter = Math.max(worstJitter, jitterMs)
        worstLoss = Math.max(worstLoss, deltaLoss)
      } catch {
        // 统计失败不影响通话
      }
    }
    const level = worstJitter > JITTER_WARN_MS || worstLoss > LOSS_WARN_RATE
      ? 'poor'
      : worstJitter > JITTER_WARN_MS / 2 || worstLoss > LOSS_WARN_RATE / 2
        ? 'fair'
        : 'good'
    this.emit('network', {
      jitterMs: Math.round(worstJitter),
      lossRate: Number(worstLoss.toFixed(4)),
      rttMs: Math.round(rtt),
      level
    })
  }

  /* ---------------- 参与者快照 ---------------- */

  emitParticipants() {
    this.emit('participants', this.snapshotParticipants())
  }

  snapshotParticipants() {
    const room = this.room
    if (!room) return []
    const speaking = new Set(this.speakingIds)
    const rows = []
    const push = (participant, isLocal) => {
      if (!participant) return
      const audioPublications = []
      participant.trackPublications.forEach((publication) => {
        if (publication.kind === Track.Kind.Audio) audioPublications.push(publication)
      })
      const publishingAudio = audioPublications.some((p) => p.track && !p.isMuted)
      rows.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        role: parseRole(participant.metadata),
        isLocal,
        speaking: speaking.has(participant.identity),
        canPublish: !!participant.permissions?.canPublish,
        publishingAudio,
        muted: !publishingAudio
      })
    }
    push(room.localParticipant, true)
    room.remoteParticipants.forEach((participant) => push(participant, false))
    return rows
  }

  /* ---------------- 收尾 ---------------- */

  async disconnect() {
    this.closed = true
    this.stopStatsWatchdog()
    this.audioTracks.forEach(({ element }) => element?.remove())
    this.audioTracks.clear()
    const room = this.room
    this.room = null
    if (room) {
      try {
        await room.disconnect()
      } catch {
        // 断线场景下 disconnect 可能抛错，不影响后续状态
      }
    }
    this.emit('state', 'idle')
  }

  emit(type, payload) {
    this.onEvent(type, payload)
  }
}

function parseRole(metadata) {
  if (!metadata) return ''
  try {
    return JSON.parse(metadata).role || ''
  } catch {
    return ''
  }
}
