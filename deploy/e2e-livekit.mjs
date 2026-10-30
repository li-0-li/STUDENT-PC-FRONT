/**
 * LiveKit 投屏端到端验证
 *
 * 页面 A（模拟教师）：手签 canPublish=true 的 token → 连 LiveKit → 用 canvas 假流
 *                    以 ScreenShare 源推流（无头环境拿不到真实屏幕，canvas 等价）
 * 页面 B（真实学生端）：打开 Live.vue?sessionId=9011，走 /stu/live/cast-token → 订阅
 *
 * 通过标准：页面 B 的 <video> 有 srcObject 且 videoWidth > 0。
 */
import puppeteer from 'puppeteer-core'
import crypto from 'node:crypto'
import path from 'node:path'

const EDGE = 'C:\\Users\\Administrator\\.cache\\puppeteer\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe'
const ORIGIN = 'http://localhost:8081'
const LK_URL = 'ws://127.0.0.1:7880'
const ROOM = 'session-9011'
const SID = 9011
const UMD = path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js')
const SECRET = 'devsecret_devsecret_devsecret_32'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 手签教师 token（HS256，与后端同一 secret） ----------
function signJwt(payload, secret) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
const now = Math.floor(Date.now() / 1000)
const teacherToken = signJwt(
  {
    iss: 'devkey',
    sub: '1001',
    name: '张老师',
    nbf: now,
    exp: now + 7200,
    video: { roomJoin: true, room: ROOM, canPublish: true, canSubscribe: true, canPublishData: true }
  },
  SECRET
)
console.log('教师 token 已签（canPublish=true）')

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required']
})

// ---------- 页面 A：教师推流 ----------
const pub = await browser.newPage()
pub.on('pageerror', (e) => console.log('[推流页 pageerror]', String(e).slice(0, 200)))
await pub.goto(`${ORIGIN}/student/`, { waitUntil: 'domcontentloaded' })
await pub.addScriptTag({ path: UMD })
console.log('UMD 已注入，全局:', await pub.evaluate(() => typeof window.LivekitClient))

const pubResult = await pub.evaluate(
  async (lkUrl, token, roomName) => {
    try {
      const { Room, Track } = window.LivekitClient
      const room = new Room({ adaptiveStream: true, dynacast: true })
      window.__room = room
      await room.connect(lkUrl, token)

      // canvas 假流（等价于教师抓屏）
      const c = document.createElement('canvas')
      c.width = 960
      c.height = 540
      const ctx = c.getContext('2d')
      let n = 0
      setInterval(() => {
        n++
        ctx.fillStyle = '#0f766e'
        ctx.fillRect(0, 0, 960, 540)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 44px sans-serif'
        ctx.fillText('LiveKit 投屏测试', 60, 120)
        ctx.font = '28px sans-serif'
        ctx.fillText('帧 ' + n, 60, 200)
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.arc(60 + (n * 8) % 840, 400, 20, 0, Math.PI * 2)
        ctx.fill()
      }, 100)
      const stream = c.captureStream(15)
      const track = stream.getVideoTracks()[0]
      await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare })

      return {
        ok: true,
        room: room.name,
        state: room.state,
        published: room.localParticipant.videoTrackPublications.size,
        trackSource: Track.Source.ScreenShare
      }
    } catch (e) {
      return { ok: false, err: String(e && e.message ? e.message : e) }
    }
  },
  LK_URL,
  teacherToken,
  ROOM
)
console.log('推流端:', JSON.stringify(pubResult))

// ---------- 页面 B：学生端真实页面订阅 ----------
const lr = await fetch(`${ORIGIN}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'lihaoyi', password: 'admin123' })
})
const stuToken = (await lr.json())?.data?.accessToken
if (!stuToken) throw new Error('学生登录失败')

const view = await browser.newPage()
view.on('pageerror', (e) => console.log('[学生页 pageerror]', String(e).slice(0, 200)))
view.on('console', (m) => {
  const t = m.text()
  if (/livekit|投屏|订阅|token|error|失败/i.test(t)) console.log(`  [学生页] ${t.slice(0, 160)}`)
})

await view.goto(`${ORIGIN}/student/`, { waitUntil: 'domcontentloaded' })
await view.evaluate((t) => sessionStorage.setItem('itap_token', t), stuToken)
await view.reload({ waitUntil: 'domcontentloaded' })
await sleep(1500)
await view.evaluate((sid) => { window.location.hash = `#/student/live?sessionId=${sid}` }, SID)
await sleep(3000)

// 轮询学生页是否收到画面
let got = false
for (let i = 0; i < 20; i++) {
  await sleep(1500)
  const st = await view.evaluate(() => {
    const vs = Array.from(document.querySelectorAll('video'))
    const withStream = vs.filter((v) => v.srcObject)
    const playing = withStream.filter((v) => v.videoWidth > 0)
    const txt = document.body.innerText || ''
    return {
      videos: vs.length,
      withStream: withStream.length,
      playing: playing.length,
      dims: playing.map((v) => `${v.videoWidth}x${v.videoHeight}`).join(','),
      castText: (txt.match(/正在接收教师屏幕|等待教师共享屏幕|投屏通道连接中|投屏连接失败[^\n]*/g) || []).join(' / ')
    }
  })
  console.log(`  [${(i + 1) * 1.5}s] video=${st.videos} 有流=${st.withStream} 尺寸=${st.dims || '-'} 文案=${st.castText}`)
  if (st.playing > 0) {
    got = true
    break
  }
}

console.log('\n=== 结论 ===')
console.log(got ? '✅ LiveKit 投屏端到端成功：学生端已收到教师画面' : '❌ 学生端未收到画面')

await browser.close()
process.exit(got ? 0 : 1)
