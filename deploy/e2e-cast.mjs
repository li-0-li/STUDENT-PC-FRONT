// 端到端投屏验证：同域 HTTPS 下，sharer 页面抓流 → 信令 → viewer 页面收到画面
// 用法: node e2e_cast.mjs
// 优先用 puppeteer 自带的现代 Chromium；没装则回退系统 Edge
let puppeteer
let executablePath = process.env.BROWSER_BIN || undefined
try {
  puppeteer = (await import('puppeteer')).default
} catch {
  puppeteer = (await import('puppeteer-core')).default
  executablePath = executablePath ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\92.0.902.67\\msedge.exe'
}
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDGE = process.env.BROWSER_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\92.0.902.67\\msedge.exe'
const ORIGIN = process.env.ORIGIN || 'https://localhost:8443'
const SID = process.env.SID || '9999'
const HEADLESS = process.env.HEADFUL !== '1'

function login(user) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: user, password: 'admin123' })
    const req = https.request(
      { host: 'localhost', port: 8443, path: '/api/v1/auth/login', method: 'POST', rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          const m = d.match(/"accessToken":"([^"]+)"/)
          m ? resolve(m[1]) : reject(new Error('登录失败: ' + d.slice(0, 200)))
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function openPage(browser, hash, token, tag) {
  const page = await browser.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if (/cast|webrtc|offer|answer|ice|signal|投屏|共享|peer/i.test(t)) console.log(`    [${tag}] ${t.slice(0, 160)}`)
  })
  page.on('pageerror', (e) => console.log(`    [${tag}:pageerror] ${String(e).slice(0, 200)}`))

  // 1) 先到站点根（此时未登录，会留在登录页，但 origin 正确，可写 sessionStorage）
  await page.goto(`${ORIGIN}/student/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // 2) 注入 token
  await page.evaluate((t) => sessionStorage.setItem('itap_token', t), token)
  // 3) reload 让 store 重新读取 token（store 在初始化时读一次）
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  await wait(2000)
  // 4) 切 hash 进入目标页（此时已登录，不会再被守卫拦截）
  await page.evaluate((h) => { window.location.hash = h }, hash)
  await wait(3000)
  return page
}

const browser = await puppeteer.launch({
  executablePath,
  headless: HEADLESS,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--ignore-certificate-errors',
    '--autoplay-policy=no-user-gesture-required',
    '--allow-file-access-from-files',
    '--disable-web-security'
  ]
})

try {
  const token = await login('lihaoyi')
  console.log(`sharer token 获取成功 (${token.length} 字符)`)

  // ★ 接收端必须用【另一个用户】：服务端按 userId 排除发送方，
  //   同一账号开两个标签页时，自己发的 offer 会被自己过滤掉（防自收设计）。
  let viewerToken = token
  let viewerUser = 'lihaoyi'
  for (const u of ['stu22001', 'stu22002', 'stu22003']) {
    try {
      viewerToken = await login(u)
      viewerUser = u
      console.log(`viewer 账号: ${u}`)
      break
    } catch {
      console.log(`viewer 账号 ${u} 不可用，试下一个`)
    }
  }
  if (viewerUser === 'lihaoyi') console.log('⚠ 未找到第二个账号，将与 sharer 同号（预期收不到画面）')

  const hashSharer = `#/student/cast-selftest?sessionId=${SID}`
  const hashViewer = `#/student/live?sessionId=${SID}`

  console.log('\n=== 打开 SHARER（cast-selftest） ===')
  const sharer = await openPage(browser, hashSharer, token, 'SHARER')
  console.log('  url  =', sharer.url())
  console.log('  title=', await sharer.title())
  console.log('  token=', await sharer.evaluate(() => sessionStorage.getItem('itap_token') ? 'present' : 'MISSING'))
  console.log('  body =', JSON.stringify((await sharer.evaluate(() => document.body.innerText || '')).slice(0, 400)))
  const secure = await sharer.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    protocol: location.protocol,
    hasMediaDevices: typeof navigator.mediaDevices !== 'undefined',
    hasGetDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    hasRTCPeerConnection: typeof RTCPeerConnection !== 'undefined'
  }))
  console.log('安全上下文检查:', JSON.stringify(secure))

  console.log('\n=== 打开 VIEWER（live） ===')
  const viewer = await openPage(browser, hashViewer, viewerToken, 'VIEWER')
  console.log('  url  =', viewer.url())
  console.log('  body =', JSON.stringify((await viewer.evaluate(() => document.body.innerText || '')).slice(0, 400)))

  await wait(3000)

  console.log('\n=== SHARER 填课堂 ID 并启动共享 ===')
  // 页面需先填课堂 ID（不从 URL 读），再点「开始模拟共享」
  const filled = await sharer.evaluate((sid) => {
    const inp = Array.from(document.querySelectorAll('input')).find(
      (e) => (e.type === 'text' || !e.type) && e.offsetParent !== null
    )
    if (!inp) return false
    inp.focus()
    inp.value = sid
    // Vue v-model 依赖 input 事件
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, String(SID))
  console.log('填写课堂 ID:', filled ? `成功（${SID}）` : '未找到输入框')
  await wait(2500) // 等 sessionId 变化触发 WS 建连

  const clicked = await sharer.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find((x) => /开始模拟共享|开始共享/.test(x.textContent || ''))
    if (b) { b.click(); return b.textContent.trim() }
    return null
  })
  console.log('按钮点击:', clicked ? `成功（${clicked}）` : '未找到按钮')
  await wait(3000)
  const readSharer = () => sharer.evaluate(() => {
    const t = document.body.innerText || ''
    const vs = Array.from(document.querySelectorAll('video'))
    return {
      state: (t.match(/通道：[^\n]*|协商：[^\n]*|我是：[^\n]*|房间成员：[^\n]*|已连通：[^\n]*/g) || []).join(' | '),
      localVideo: vs.map((v) => `${v.videoWidth}x${v.videoHeight}`).join(','),
      localHasStream: vs.filter((v) => v.srcObject).length
    }
  })
  console.log('SHARER 状态:', JSON.stringify(await readSharer()))

  // 轮询 viewer 是否收到远端视频
  let ok = false
  for (let i = 0; i < 40; i++) {
    await wait(1500)
    const st = await viewer.evaluate(() => {
      const vs = Array.from(document.querySelectorAll('video'))
      const withStream = vs.filter((v) => v.srcObject)
      return {
        videos: vs.length,
        withStream: withStream.length,
        dims: withStream.map((v) => `${v.videoWidth}x${v.videoHeight}`),
        playing: withStream.filter((v) => v.videoWidth > 0).length,
        text: (document.body.innerText || '').match(/正在接收教师屏幕|等待教师共享|协商|连接中/g) || []
      }
    })
    process.stdout.write(`  [${(i + 1) * 1.5}s] video=${st.videos} 有流=${st.withStream} 尺寸=${st.dims.join(',') || '-'} 文本=${st.text.slice(0, 3).join('/')}\n`)
    if (st.playing > 0) { ok = true; console.log('\n★ VIEWER 收到远端画面:', st.dims.join(', ')); break }
    if (i % 4 === 3) console.log('  SHARER:', JSON.stringify(await readSharer()))
  }

  console.log('\n=== 结论 ===')
  console.log(ok ? '✅ 端到端投屏成功（同域 HTTPS 下出画面）' : '❌ 未收到画面')

  await new Promise((r) => setTimeout(r, 1000))
} catch (e) {
  console.error('执行失败:', e)
  process.exitCode = 1
} finally {
  await browser.close()
}
