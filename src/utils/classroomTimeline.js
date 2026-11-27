/**
 * 学生端「统一课堂时间轴」对齐引擎（框架无关）。
 *
 * 权威状态仍由 /ws/session 舞台帧即时应用（保证 seq/rev/digest 与迟到补齐一致）；
 * 本引擎负责：
 *   1. 用舞台帧 ts/timelineMs 与 REST 快照估计客户端↔服务端时钟偏移（NTP 近似 + EWMA）；
 *   2. 用 jitterBuffer / AudioContext.outputLatency / RTT 估计音频输出延迟；
 *   3. 把 audio-marker 排入有界队列，在 fireAt 触发同步呈现（舞台强调 + 视频锚定）；
 *   4. play/pause/seek/rate 与音轨切换时冻结/重锚，异常时降级为「仅舞台同步」。
 *
 * 阈值唯一来源：RuoYi-Vue-zhike/deploy/local-audio/audio-thresholds.json 的 sync 段。
 */
import thresholds from '../../../RuoYi-Vue-zhike/deploy/local-audio/audio-thresholds.json'

const SYNC = thresholds.sync || {}
const CFG = SYNC.autoCalibration || {}
const QUEUE_CFG = SYNC.queue || {}
const OFFSET_KEY = 'stu-pc:classroom-timeline:manualOffsetMs'

const listeners = new Set()
const pulseListeners = new Set()
let queue = []
const seenMarkerIds = new Set()
let timer = null
let notifyTimer = null
let timerDueAt = 0
/** 播放器暂停 / 音频链路中断 两把独立的“冻结闸”，避免互相覆盖 */
let pausedByPlayback = false
let audioFrozen = false
let frozen = false
let lastCalibratedAt = 0
let lastDriftMs = 0
let applied = 0
let dropped = 0

const clock = { samples: [], offset: 0, skewMs: null, count: 0, calibrated: false }
const audio = {
  state: 'idle', blocked: false, reason: '',
  network: { jitterMs: 0, rttMs: 0, lossRate: 0, level: 'good' },
  outputLatencyMs: 0
}
let manualOffsetMs = readOffset()
let anchorTimeSec = 0

function readOffset() {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY))
    return Number.isFinite(v)
      ? Math.max(SYNC.manualOffsetMs.min, Math.min(SYNC.manualOffsetMs.max, v))
      : 0
  } catch { return 0 }
}

function writeOffset(v) {
  try { localStorage.setItem(OFFSET_KEY, String(v)) } catch { /* 无痕模式忽略 */ }
}

/* ---------------- 时钟 ---------------- */

/**
 * @param {{serverTimeMs?:number, clientTimeMs?:number, recvMs?:number}} sample
 * 有 clientTimeMs 时用 NTP 近似 offset = server - client - rtt/2；
 * 只有服务端 ts 时用音频链路 RTT 做单程补偿。
 */
export function addClockSample(sample = {}) {
  const serverTimeMs = Number(sample.serverTimeMs ?? sample.timelineMs)
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return
  const recvMs = Number(sample.recvMs) || Date.now()
  const clientTimeMs = Number(sample.clientTimeMs)
  const rtt = Number.isFinite(clientTimeMs) && clientTimeMs > 0
    ? Math.max(0, recvMs - clientTimeMs)
    : Math.max(0, Number(audio.network.rttMs) || 0)
  if (rtt > (CFG.maxRttForSampleMs || 300) * 4) return
  const offset = Number.isFinite(clientTimeMs) && clientTimeMs > 0
    ? serverTimeMs - clientTimeMs - rtt / 2
    : serverTimeMs - recvMs + rtt / 2

  clock.samples.push({ offset, rtt })
  const max = CFG.maxSamples || 12
  while (clock.samples.length > max) clock.samples.shift()
  const best = clock.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a), clock.samples[0])
  const alpha = CFG.ewmaAlpha || 0.25
  clock.offset = clock.calibrated ? clock.offset * (1 - alpha) + best.offset * alpha : best.offset
  clock.skewMs = Math.abs(best.rtt / 2)
  clock.count = clock.samples.length
  clock.calibrated = clock.count >= (CFG.minSamples || 3)
  lastCalibratedAt = Date.now()
  notify()
}

export function recalibrate() {
  clock.samples = []
  clock.count = 0
  clock.calibrated = false
  clock.skewMs = null
  lastCalibratedAt = Date.now()
  notify()
}

export function maybeRecalibrate() {
  const interval = CFG.recalibrateIntervalMs || 30000
  if (lastCalibratedAt && Date.now() - lastCalibratedAt > interval) recalibrate()
}

/* ---------------- 音频延迟 ---------------- */

function applyFreeze() {
  frozen = pausedByPlayback || audioFrozen
}

export function setAudioStatus(patch = {}) {
  if (patch.state != null) audio.state = patch.state
  if (patch.blocked != null) audio.blocked = !!patch.blocked
  if (patch.reason != null) audio.reason = patch.reason || ''
  if (patch.network != null) audio.network = Object.assign({}, audio.network, patch.network)
  if (patch.outputLatencyMs != null) audio.outputLatencyMs = Number(patch.outputLatencyMs) || 0

  // 自动播放被拦截：没有声音就不必再等音频，按降级立即呈现并提示用户解锁
  if (audio.blocked && !audio.reason) {
    audio.reason = '浏览器拦截了自动播放，请点击「开启声音」后重新校准'
  }
  // 降级（无音频）→ 立即生效；重连/缓冲中断 → 冻结队列等待恢复
  audioFrozen = !audio.reason
    && ['connecting', 'reconnecting', 'disconnected', 'error', 'disabled'].includes(audio.state)
  if (audio.reason) {
    queue.forEach(m => { m.fireAt = Date.now() })
  }
  applyFreeze()
  notify()
  wakeTimer()
}

export function estimateAudioLatency() {
  const cfg = SYNC.audioOutputLatencyMs || {}
  const jitter = Number(audio.network.jitterMs) || 0
  const rtt = Number(audio.network.rttMs) || 0
  const output = audio.outputLatencyMs > 0 ? audio.outputLatencyMs : (cfg.default || 120)
  // 拿不到 jitterBuffer 统计时，用 RTT/2 作为网络单程延迟的粗略替代
  const network = jitter > 0 ? jitter : rtt / 2
  const raw = network + output
  return Math.max(cfg.min || 0, Math.min(cfg.max || 500, Math.round(raw)))
}

/* ---------------- 状态 ---------------- */

export function syncState() {
  if (audio.reason || audio.blocked) return 'degraded'
  if (audio.state === 'disabled' || audio.state === 'error' || audio.state === 'disconnected') return 'offline'
  if (audio.state === 'reconnecting' && audioFrozen) return 'buffering'
  if (audio.state === 'connecting' || audio.state === 'reconnecting') return 'calibrating'
  if (!clock.calibrated) return 'calibrating'
  if (Math.abs(lastDriftMs) > (SYNC.markerDriftMs.warn || 150)) return 'drifting'
  return 'synced'
}

export function getState() {
  return {
    syncState: syncState(),
    driftMs: Math.round(lastDriftMs),
    clockSkewMs: clock.skewMs == null ? null : Math.round(clock.skewMs),
    clockOffsetMs: Math.round(clock.offset),
    sampleCount: clock.count,
    audioLatencyMs: estimateAudioLatency(),
    outputLatencyMs: Math.round(audio.outputLatencyMs),
    manualOffsetMs,
    pendingMarkers: queue.length,
    appliedMarkers: applied,
    droppedMarkers: dropped,
    frozen,
    pausedByPlayback,
    audioFrozen,
    anchorTimeSec,
    audioState: audio.state,
    audioBlocked: audio.blocked,
    network: Object.assign({}, audio.network),
    reason: audio.reason,
    thresholds: {
      driftGood: SYNC.markerDriftMs.good,
      driftWarn: SYNC.markerDriftMs.warn,
      driftFail: SYNC.markerDriftMs.fail,
      skewGood: SYNC.clockSkewMs.good
    }
  }
}

function notify() {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    const s = getState()
    listeners.forEach(fn => { try { fn(s) } catch { /* 忽略单个订阅者 */ } })
  }, 250)
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  fn(getState())
  return () => listeners.delete(fn)
}

/** 标记到期时触发：StageCanvas 用它做视觉强调，SlideViewer 用它重新锚定视频 */
export function onPulse(fn) {
  if (typeof fn !== 'function') return () => {}
  pulseListeners.add(fn)
  return () => pulseListeners.delete(fn)
}

/* ---------------- 标记队列 ---------------- */

function fireAtFor(marker) {
  // WS 权威帧带服务端 timelineMs；data channel 旁路没有时用「本地 now + offset」估服务端时间
  const timelineMs = Number(marker.timelineMs || marker.serverTimeMs) || (Date.now() + clock.offset)
  // server epoch → local epoch：local = server - clockOffset
  const local = timelineMs - clock.offset
  if (syncState() === 'degraded') return Date.now()
  return local + estimateAudioLatency() + manualOffsetMs
}

function enqueue(marker) {
  const id = String(marker.markerId || '')
  if (!id) return
  if (seenMarkerIds.has(id)) {
    // 低延迟旁路先到（无服务端时间）时，WS 权威帧后到要覆盖时间锚点，而不是被去重丢掉
    const existing = queue.find(item => String(item.marker.markerId) === id)
    if (existing && !existing.marker.timelineMs && marker.timelineMs) {
      existing.marker = marker
      existing.fireAt = fireAtFor(marker)
      queue.sort((a, b) => a.fireAt - b.fireAt)
      notify()
    }
    return
  }
  seenMarkerIds.add(id)
  if (seenMarkerIds.size > (QUEUE_CFG.maxPending || 64) * 4) {
    seenMarkerIds.clear()
  }
  const fireAt = fireAtFor(marker)
  if (Date.now() - fireAt > (SYNC.maxMarkerAgeMs || 5000)) {
    dropped += 1
    notify()
    return
  }
  queue.push({ marker, fireAt, appliedOffset: manualOffsetMs })
  queue.sort((a, b) => a.fireAt - b.fireAt)
  const max = QUEUE_CFG.maxPending || 64
  while (queue.length > max) { queue.shift(); dropped += 1 }
  wakeTimer()
  notify()
}

function flushDue() {
  const now = Date.now()
  const due = queue.filter(item => item.fireAt <= now)
  if (!due.length) return
  queue = queue.filter(item => item.fireAt > now)
  due.forEach(({ marker, fireAt }) => {
    lastDriftMs = now - fireAt
    applied += 1
    if (marker.timeSec != null) anchorTimeSec = Number(marker.timeSec) || 0
    pulseListeners.forEach(fn => {
      try { fn({ marker, driftMs: lastDriftMs }) } catch { /* 忽略 */ }
    })
  })
  if (Math.abs(lastDriftMs) > (SYNC.markerDriftMs.fail || 250)) recalibrate()
  notify()
}

function ensureTimer() {
  if (timer) return
  schedule()
}

/** 把定时器收紧到下一个到期点；已在更早时刻唤醒时保持不变 */
function wakeTimer() {
  ensureTimer()
  const tick = QUEUE_CFG.tickMs || 100
  if (timer && !frozen && queue.length && timerDueAt - Date.now() > tick) {
    schedule()
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  const active = queue.length > 0 && !frozen
  const tick = QUEUE_CFG.tickMs || 100
  // 队列非空时最多等 tickMs，临近 fireAt 时按剩余时间精确唤醒，降低标记生效偏差
  const next = active ? Math.min(tick, Math.max(16, queue[0].fireAt - Date.now())) : 0
  const delay = active ? next : (QUEUE_CFG.idleTickMs || 500)
  timerDueAt = Date.now() + delay
  timer = setTimeout(() => {
    timer = null
    timerDueAt = 0
    if (!frozen) flushDue()
    maybeRecalibrate()
    if (queue.length || listeners.size) schedule()
  }, delay)
}

/** 重连 / 迟到 / 摘要不一致后：丢弃过期标记，按权威快照重新锚定 */
export function reanchor(snapshot = {}) {
  queue = []
  audioFrozen = false
  if (snapshot.timelineMs) addClockSample({ serverTimeMs: snapshot.timelineMs, recvMs: Date.now() })
  const pb = snapshot.playback || {}
  anchorTimeSec = Number(pb.timeSec) || 0
  pausedByPlayback = pb.state === 'paused'
  applyFreeze()
  const markers = Array.isArray(snapshot.audioMarkers) ? snapshot.audioMarkers : []
  markers.forEach(m => {
    if (m && m.markerId) enqueue(m)
  })
  notify()
  ensureTimer()
}

/** 舞台帧入口：由 useStageSync 在应用帧时调用 */
export function applyStageFrame(type, payload = {}, envelope = {}) {
  const serverTimeMs = Number(envelope.timelineMs || envelope.ts || payload.timelineMs || payload.serverTimeMs)
  if (Number.isFinite(serverTimeMs) && serverTimeMs > 0) {
    addClockSample({ serverTimeMs, recvMs: Date.now() })
  }
  if (type === 'playback') {
    if (payload.action === 'seek') {
      queue = []
      anchorTimeSec = Number(payload.timeSec) || 0
    } else if (payload.action === 'sync' || payload.action === 'rate') {
      const cutoff = Date.now() - (SYNC.maxMarkerAgeMs || 5000)
      queue = queue.filter(item => item.fireAt >= cutoff)
    }
    pausedByPlayback = payload.state === 'paused'
    if (payload.timeSec != null) anchorTimeSec = Number(payload.timeSec) || 0
    applyFreeze()
    notify()
  } else if (type === 'audio-marker') {
    if (payload.action === 'pause') {
      pausedByPlayback = true
      applyFreeze()
      notify()
      return
    }
    if (payload.action === 'seek' || payload.action === 'sync' || payload.action === 'slide') {
      // 重锚/换页只清过期队列，不改变“播放器是否暂停”的独立状态
      queue = []
    }
    if (payload.action === 'play') pausedByPlayback = false
    applyFreeze()
    enqueue(payload)
  }
  ensureTimer()
}

/** 音轨切换：短暂冻结队列，配合 audioRoomClient 的音量渐变避免画面/声音跳变 */
export function markTrackSwitch() {
  audioFrozen = true
  applyFreeze()
  notify()
  setTimeout(() => {
    audioFrozen = false
    applyFreeze()
    flushDue()
    notify()
  }, SYNC.switchGraceMs || 200)
}

export function setManualOffset(ms) {
  const v = Number(ms)
  if (!Number.isFinite(v)) return
  manualOffsetMs = Math.max(SYNC.manualOffsetMs.min, Math.min(SYNC.manualOffsetMs.max, Math.round(v)))
  writeOffset(manualOffsetMs)
  // 已排队的标记按新偏移重算，尚未生效的部分立即响应微调
  queue.forEach(item => {
    const delta = manualOffsetMs - (item.appliedOffset || 0)
    item.fireAt += delta
    item.appliedOffset = manualOffsetMs
  })
  notify()
}

export function resetManualOffset() { setManualOffset(0) }

export function dispose() {
  if (timer) clearTimeout(timer)
  if (notifyTimer) clearTimeout(notifyTimer)
  timer = null
  notifyTimer = null
  queue = []
  listeners.clear()
  pulseListeners.clear()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // 移动端后台 setTimeout 被节流，回到前台立刻补齐到期标记
      flushDue()
      ensureTimer()
    }
  })
}

ensureTimer()

export default {
  addClockSample, recalibrate, maybeRecalibrate, setAudioStatus,
  estimateAudioLatency, syncState, getState, subscribe, onPulse,
  applyStageFrame, reanchor, markTrackSwitch, setManualOffset,
  resetManualOffset, dispose
}
