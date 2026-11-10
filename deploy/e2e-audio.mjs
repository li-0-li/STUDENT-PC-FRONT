/**
 * 本地实时音频联调脚本（教师发布 + 学生真实页面订阅）
 *
 * 设计：
 *   · 教师侧：接口拿 audio-token，在浏览器里用 livekit-client 发布 440Hz 正弦波
 *     （优先真实/假麦克风，失败退化为振荡器），不依赖教师端深层 UI。
 *   · 学生侧：打开真实 Live.vue，注入 sessionStorage.itap_token，自动订阅并播放。
 *   · 指标：page.evaluateOnNewDocument 包装 RTCPeerConnection，每 2s 采集
 *     inbound-rtp / outbound-rtp / candidate-pair / codec。
 *   · 判定：读 deploy/local-audio/audio-thresholds.json，输出 PASS/WARN/FAIL + JSON 报告。
 *
 * 用法：
 *   cd STUDENT-PC-FRONT
 *   $env:SESSION_ID='9043'; $env:HEADFUL='1'; npm run e2e:audio
 *
 * 环境变量：
 *   API_BASE / STUDENT_ORIGIN / SESSION_ID / DURATION / HEADFUL / BROWSER_BIN
 *   TEACHER_USER / STUDENT_USER / PASSWORD / THRESHOLDS_FILE / REPORT_DIR
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_BASE = (process.env.API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
const STUDENT_ORIGIN = (process.env.STUDENT_ORIGIN || 'http://localhost:8081').replace(/\/+$/, '')
const SESSION_ID = Number(process.env.SESSION_ID || 9043)
const DURATION = Math.max(10, Number(process.env.DURATION || 45))
const HEADLESS = process.env.HEADFUL !== '1'
const TEACHER_USER = process.env.TEACHER_USER || 'zhanglaoshi'
const STUDENT_USER = process.env.STUDENT_USER || 'lihaoyi'
const PASSWORD = process.env.PASSWORD || 'admin123'
const UMD = path.resolve(__dirname, '../node_modules/livekit-client/dist/livekit-client.umd.js')
const THRESHOLDS_FILE = process.env.THRESHOLDS_FILE ||
  path.resolve(__dirname, '../../RuoYi-Vue-zhike/deploy/local-audio/audio-thresholds.json')
const REPORT_DIR = process.env.REPORT_DIR ||
  path.resolve(__dirname, '../../RuoYi-Vue-zhike/deploy/local-audio/reports')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(section, msg) {
  const t = new Date().toISOString().slice(11, 19)
  console.log(`[${t}] ${section ? section + ' | ' : ''}${msg}`)
}

function loadThresholds() {
  const raw = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf8'))
  if (!raw.thresholds) throw new Error('audio-thresholds.json 缺少 thresholds')
  return raw
}

function percentile(values, p) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!list.length) return 0
  const idx = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1))
  return list[idx]
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p))
}

async function loadPuppeteer() {
  let firstError = null
  try {
    const mod = await import('puppeteer')
    return { puppeteer: mod.default, executablePath: findBrowser() }
  } catch (e) {
    firstError = e
  }
  try {
    const mod = await import('puppeteer-core')
    return { puppeteer: mod.default, executablePath: findBrowser() }
  } catch (e) {
    throw new Error(`未找到可用的 puppeteer：puppeteer=${firstError?.message || '-'}；puppeteer-core=${e.message}`)
  }
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let json = null
  try { json = await res.json() } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json }
}

async function login(username) {
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { username, password: PASSWORD }
  })
  if (!r.json || r.json.code !== 0 || !r.json.data?.accessToken) {
    throw new Error(`${username} 登录失败：HTTP ${r.status} code=${r.json?.code} ${r.json?.message || ''}`)
  }
  return r.json.data.accessToken
}

async function audioToken(role, token) {
  const prefix = role === 'teacher' ? '/api/v1/teacher/live' : '/api/v1/stu/live'
  const r = await api(`${prefix}/sessions/${SESSION_ID}/audio-token`, { method: 'POST', token })
  if (!r.json || r.json.code !== 0) {
    throw new Error(`${role} audio-token 失败：HTTP ${r.status} code=${r.json?.code} ${r.json?.message || ''}`)
  }
  const d = r.json.data || {}
  for (const k of ['url', 'token', 'room', 'identity', 'canPublish']) {
    if (d[k] === undefined || d[k] === null || d[k] === '') throw new Error(`${role} audio-token 缺字段 ${k}`)
  }
  return d
}

/** 包装 RTCPeerConnection，保留静态属性，把所有实例挂到 window.__audioPcs */
function installStatsHook() {
  const Orig = window.RTCPeerConnection
  if (!Orig) return
  window.__audioPcs = []
  window.RTCPeerConnection = new Proxy(Orig, {
    construct(target, args) {
      const pc = new target(...args)
      window.__audioPcs.push(pc)
      return pc
    }
  })
  window.__gum = []
  const md = navigator.mediaDevices
  if (md && typeof md.getUserMedia === 'function') {
    const orig = md.getUserMedia.bind(md)
    md.getUserMedia = async (constraints) => {
      const stream = await orig(constraints)
      const track = stream.getAudioTracks()[0]
      window.__gum.push({
        audio: constraints && constraints.audio ? JSON.parse(JSON.stringify(constraints.audio)) : null,
        settings: track ? track.getSettings() : null,
        label: track ? track.label : ''
      })
      return stream
    }
  }
}

async function waitFor(fn, timeoutMs, label, intervalMs = 500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true
    await sleep(intervalMs)
  }
  throw new Error(`等待超时：${label}（${timeoutMs}ms）`)
}

async function studentText(page) {
  return page.evaluate(() => document.body.innerText || '')
}

async function clickButtonByText(page, re) {
  return page.evaluate((source) => {
    const rx = new RegExp(source)
    const btn = Array.from(document.querySelectorAll('button')).find((b) => rx.test(b.textContent || ''))
    if (!btn) return false
    btn.click()
    return true
  }, re.source)
}

async function collectStats(page) {
  return page.evaluate(async () => {
    const pcs = window.__audioPcs || []
    const out = { inbound: null, outbound: null, pair: null, codecs: [], gum: window.__gum || [] }
    for (const pc of pcs) {
      let report
      try { report = await pc.getStats() } catch { continue }
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          out.inbound = {
            packetsReceived: Number(s.packetsReceived) || 0,
            packetsLost: Math.max(0, Number(s.packetsLost) || 0),
            bytesReceived: Number(s.bytesReceived) || 0,
            jitterSec: Number(s.jitter) || 0,
            jitterBufferDelay: Number(s.jitterBufferDelay) || 0,
            jitterBufferEmittedCount: Number(s.jitterBufferEmittedCount) || 0,
            codecId: s.codecId || ''
          }
        }
        if (s.type === 'outbound-rtp' && s.kind === 'audio') {
          out.outbound = {
            packetsSent: Number(s.packetsSent) || 0,
            bytesSent: Number(s.bytesSent) || 0
          }
        }
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) {
          out.pair = { rttMs: Number(s.currentRoundTripTime) * 1000 }
        }
        if (s.type === 'codec' && /audio/i.test(s.mimeType || '')) {
          out.codecs.push({ mimeType: s.mimeType, clockRate: s.clockRate, channels: s.channels })
        }
      })
    }
    return out
  })
}

function jitterBufferMs(inbound) {
  if (!inbound || !inbound.jitterBufferEmittedCount) return 0
  return (inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount) * 1000
}

function lossRate(inbound) {
  if (!inbound) return 0
  const total = inbound.packetsLost + inbound.packetsReceived
  return total > 0 ? inbound.packetsLost / total : 0
}

async function main() {
  const th = loadThresholds()
  const warnings = []
  const failures = []
  const pageErrors = []
  const audioConsole = []
  const samples = []
  let connectMs = 0
  let browser
  let studentPage
  let teacherPage
  let teacherToken = ''
  let teacherAudio = null
  let studentAudio = null
  let permissionsTested = false
  let micTested = false

  log('boot', `session=${SESSION_ID} api=${API_BASE} student=${STUDENT_ORIGIN} duration=${DURATION}s`)

  try {
    teacherToken = await login(TEACHER_USER)
    const studentToken = await login(STUDENT_USER)
    log('auth', 'teacher/student login ok')

    teacherAudio = await audioToken('teacher', teacherToken)
    studentAudio = await audioToken('student', studentToken)
    log('token', `teacher canPublish=${teacherAudio.canPublish} student canPublish=${studentAudio.canPublish}`)
    if (teacherAudio.room !== `session-${SESSION_ID}` || studentAudio.room !== teacherAudio.room) {
      throw new Error(`房间不一致：teacher=${teacherAudio.room} student=${studentAudio.room}`)
    }

    const loaded = await loadPuppeteer()
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-certificate-errors'
    ]
    browser = await loaded.puppeteer.launch({
      executablePath: loaded.executablePath,
      headless: HEADLESS,
      args: launchArgs
    })
    log('browser', `headless=${HEADLESS} bin=${loaded.executablePath || 'bundled'}`)

    // ---------- 学生真实页面 ----------
    studentPage = await browser.newPage()
    await studentPage.evaluateOnNewDocument(installStatsHook)
    studentPage.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
    studentPage.on('console', (m) => {
      const text = m.text()
      if (/audio|microphone|mic|livekit|TrackSubscription|MediaDevices|重连|连接失败/i.test(text)) {
        audioConsole.push(text.slice(0, 300))
      }
    })

    await studentPage.goto(`${STUDENT_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await studentPage.evaluate((t) => sessionStorage.setItem('itap_token', t), studentToken)
    await studentPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await studentPage.evaluate((sid) => {
      window.location.hash = `#/student/live?sessionId=${sid}`
    }, SESSION_ID)
    const connectStart = Date.now()
    // 等待窗口比判定阈值宽，便于拿到真实连接耗时；判定仍用 connectTimeoutMs
    await waitFor(async () => /课堂音频已连接|麦克风已开启|正在发言|有人正在讲话/.test(await studentText(studentPage)),
      Math.max(15000, th.connectTimeoutMs * 2), 'student audio connected')
    connectMs = Date.now() - connectStart
    log('student', `audio connected in ${connectMs}ms`)
    if (/浏览器已拦截自动播放/.test(await studentText(studentPage))) {
      warnings.push('autoplayBlocked')
      await clickButtonByText(studentPage, /点击开启声音/)
      log('student', 'autoplay blocked, clicked resume')
    }

    // ---------- 教师发布页 ----------
    teacherPage = await browser.newPage()
    await teacherPage.evaluateOnNewDocument(installStatsHook)
    teacherPage.on('pageerror', (e) => pageErrors.push('teacher:' + String(e).slice(0, 300)))
    await teacherPage.goto(`${STUDENT_ORIGIN}/#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await teacherPage.addScriptTag({ path: UMD })
    const published = await teacherPage.evaluate(async ({ url, token }) => {
      try {
        const lib = window.LivekitClient || window.LiveKitClient
        if (!lib || !lib.Room) return { ok: false, err: 'LivekitClient UMD 未加载' }
        const { Room, Track } = lib
        const room = new Room({ adaptiveStream: false, dynacast: false })
        await Promise.race([
          room.connect(url, token),
          new Promise((_, reject) => setTimeout(() => reject(new Error('LiveKit 连接超时（15s）')), 15000))
        ])
        let track
        let source = 'getUserMedia'
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1
            }
          })
          track = stream.getAudioTracks()[0]
        } catch (e) {
          const ctx = new AudioContext()
          try { await ctx.resume() } catch { /* 自动播放策略可能仍限制 */ }
          const osc = ctx.createOscillator()
          osc.frequency.value = 440
          const dest = ctx.createMediaStreamDestination()
          osc.connect(dest)
          osc.start()
          track = dest.stream.getAudioTracks()[0]
          source = 'oscillator'
        }
        await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone })
        window.__teacherRoom = room
        return { ok: true, source, room: room.name, identity: room.localParticipant.identity }
      } catch (e) {
        return { ok: false, err: String(e && e.message ? e.message : e) }
      }
    }, { url: teacherAudio.url, token: teacherAudio.token })
    if (!published.ok) throw new Error(`教师发布失败：${published.err}`)
    log('teacher', `published source=${published.source} room=${published.room} identity=${published.identity}`)

    // ---------- 采样 ----------
    const sampleStart = Date.now()
    while (Date.now() - sampleStart < DURATION * 1000) {
      const student = await collectStats(studentPage)
      const teacher = await collectStats(teacherPage)
      samples.push({
        t: Date.now() - sampleStart,
        student,
        teacher
      })
      await sleep(th.sampleIntervalMs)
    }

    const audioEls = await studentPage.evaluate(() => Array.from(document.querySelectorAll('audio')).map((el) => ({
      hasStream: !!el.srcObject,
      paused: !!el.paused,
      volume: Number(el.volume),
      currentTime: Number(el.currentTime) || 0
    })))

    const inbounds = samples.map((s) => s.student.inbound).filter(Boolean)
    const first = inbounds[0]
    const last = inbounds[inbounds.length - 1]
    const packetsGrowth = first && last ? last.packetsReceived - first.packetsReceived : 0
    const bytesGrowth = first && last ? last.bytesReceived - first.bytesReceived : 0
    const jitterP95 = percentile(inbounds.map((i) => i.jitterSec * 1000), 95)
    const jitterBufferP95 = percentile(inbounds.map(jitterBufferMs), 95)
    const rttP95 = percentile(samples.map((s) => s.student.pair?.rttMs || 0), 95)
    const lossP95 = percentile(inbounds.map(lossRate), 95)
    const e2eProxyMs = rttP95 + jitterBufferP95
    const codecs = [...new Set(samples.flatMap((s) => (s.student.codecs || []).map((c) => c.mimeType)))]
    const opus = codecs.some((m) => /audio\/opus/i.test(m))

    // ---------- 权限回收（可选） ----------
    if (studentAudio.canPublish) {
      try {
        const opened = await clickButtonByText(studentPage, /^开麦$/)
        if (opened) {
          await waitFor(async () => /麦克风已开启|闭麦/.test(await studentText(studentPage)), 6000, 'student mic on')
          micTested = true
          const participants = await api(`/api/v1/teacher/live/sessions/${SESSION_ID}/audio/participants`, { token: teacherToken })
          const list = participants.json?.data?.list || []
          const hit = list.find((p) => String(p.identity) === String(studentAudio.identity))
          if (hit) {
            await api(`/api/v1/teacher/live/sessions/${SESSION_ID}/audio/mic`, {
              method: 'POST',
              token: teacherToken,
              body: { studentId: Number(studentAudio.identity), enabled: false }
            })
            await waitFor(async () => !/麦克风已开启/.test(await studentText(studentPage)), 6000, 'student mic revoked')
            permissionsTested = true
            log('permission', 'teacher revoked student mic, student UI followed')
            // 恢复，避免影响后续手工联调
            await api(`/api/v1/teacher/live/sessions/${SESSION_ID}/audio/mic`, {
              method: 'POST',
              token: teacherToken,
              body: { studentId: Number(studentAudio.identity), enabled: true }
            })
          } else {
            warnings.push('micPermissionSkipped')
          }
        } else {
          warnings.push('micPermissionSkipped')
        }
      } catch (e) {
        warnings.push('micPermissionSkipped')
        log('permission', `skipped: ${e.message}`)
      }
    } else {
      warnings.push('micPermissionSkipped')
    }

    // ---------- 判定 ----------
    const good = th.thresholds
    if (!inbounds.length) failures.push('noRemoteAudio')
    if (packetsGrowth < th.minPacketsReceived) failures.push('noPackets')
    if (bytesGrowth < th.minBytesReceived) failures.push('noPackets')
    if (!opus) failures.push('codecMismatch')
    if (connectMs > th.connectTimeoutMs) failures.push('connectTimeout')
    if (audioEls.length === 0 || !audioEls.some((a) => a.hasStream)) failures.push('noRemoteAudio')
    if (audioEls.some((a) => a.paused)) warnings.push('autoplayBlocked')
    if (pageErrors.some((e) => /audio|microphone|livekit|track/i.test(e))) failures.push('audioDeviceError')

    if (rttP95 > good.rttMs.good) {
      if (rttP95 <= good.rttMs.warn) warnings.push('rttWarn')
      else warnings.push('rttWarn')
    }
    if (jitterP95 > good.jitterMs.good) warnings.push('jitterWarn')
    if (jitterBufferP95 > good.jitterBufferMs.good) warnings.push('jitterBufferWarn')
    if (lossP95 > good.lossRate.good) warnings.push('lossWarn')
    if (audioConsole.some((t) => /TrackSubscriptionFailed|订阅.*失败/i.test(t))) warnings.push('subscriptionRetry')
    if (permissionsTested === false && studentAudio.canPublish) warnings.push('micPermissionSkipped')

    const status = failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS'
    const report = {
      timestamp: new Date().toISOString(),
      sessionId: SESSION_ID,
      config: {
        apiBase: API_BASE,
        studentOrigin: STUDENT_ORIGIN,
        durationSec: DURATION,
        sampleIntervalMs: th.sampleIntervalMs,
        thresholdsVersion: th.version
      },
      result: { status, failures, warnings },
      metrics: {
        connectMs,
        packetsGrowth,
        bytesGrowth,
        jitterP95Ms: Math.round(jitterP95),
        jitterBufferP95Ms: Math.round(jitterBufferP95),
        rttP95Ms: Math.round(rttP95),
        lossP95: Number(lossP95.toFixed(4)),
        e2eProxyMs: Math.round(e2eProxyMs),
        codecs
      },
      playback: audioEls,
      micTested,
      permissionsTested,
      pageErrors,
      audioConsole,
      samples
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true })
    const reportFile = path.join(REPORT_DIR, `audio-${SESSION_ID}-${Date.now()}.json`)
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8')

    console.log('')
    console.log('=== audio e2e result ===')
    console.log(`status        : ${status}`)
    console.log(`connect       : ${connectMs} ms`)
    console.log(`packetsGrowth : ${packetsGrowth}  bytesGrowth=${bytesGrowth}`)
    console.log(`rttP95        : ${Math.round(rttP95)} ms`)
    console.log(`jitterP95     : ${Math.round(jitterP95)} ms`)
    console.log(`jitterBuffer  : ${Math.round(jitterBufferP95)} ms`)
    console.log(`lossP95       : ${(lossP95 * 100).toFixed(2)} %`)
    console.log(`e2eProxy      : ${Math.round(e2eProxyMs)} ms (rtt + jitterBuffer)`)
    console.log(`codecs        : ${codecs.join(', ') || '-'}`)
    console.log(`playback      : ${audioEls.map((a) => `${a.hasStream ? 'stream' : 'no-stream'}/${a.paused ? 'paused' : 'playing'}`).join(', ') || '-'}`)
    console.log(`micTested     : ${micTested}  permissionsTested=${permissionsTested}`)
    if (failures.length) console.log(`failures      : ${failures.join(', ')}`)
    if (warnings.length) console.log(`warnings      : ${[...new Set(warnings)].join(', ')}`)
    console.log(`report        : ${reportFile}`)
    console.log('')

    if (status === 'FAIL') process.exitCode = 1
  } catch (e) {
    console.error('')
    console.error(`[FAIL] ${e.message}`)
    if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'))
    try {
      fs.mkdirSync(REPORT_DIR, { recursive: true })
      const reportFile = path.join(REPORT_DIR, `audio-${SESSION_ID}-${Date.now()}-failed.json`)
      fs.writeFileSync(reportFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
        result: { status: 'FAIL', failures: [e.message], warnings },
        pageErrors,
        audioConsole
      }, null, 2), 'utf8')
      console.error(`report        : ${reportFile}`)
    } catch { /* 报告失败不覆盖原始错误 */ }
    process.exitCode = 1
  } finally {
    try {
      if (teacherPage) {
        await teacherPage.evaluate(() => window.__teacherRoom && window.__teacherRoom.disconnect())
      }
    } catch { /* 清理失败不影响结果 */ }
    try { if (studentPage) await studentPage.close() } catch { /* ignore */ }
    try { if (teacherPage) await teacherPage.close() } catch { /* ignore */ }
    try { if (browser) await browser.close() } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
