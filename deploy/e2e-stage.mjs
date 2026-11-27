/**
 * 学生 PC 课件演示同步 e2e（翻页 / 批注 / 播放 / 迟到 / 刷新重连）
 *
 * 前提：后端 8080、学生端 8083 已启动，9046 为进行中课堂；
 *       教师端 8082 不要同时占用写者租约（脚本需要以教师身份发帧）。
 *
 * 用法：
 *   cd STUDENT-PC-FRONT
 *   $env:SESSION_ID='9046'; $env:HEADFUL='1'; npm run e2e:stage
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const API = (process.env.API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
const ORIGIN = (process.env.STUDENT_ORIGIN || 'http://localhost:8083').replace(/\/+$/, '')
const SID = Number(process.env.SESSION_ID || 9046)
const HEADLESS = process.env.HEADFUL !== '1'
const EDGE = process.env.BROWSER_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const REPORT_DIR = process.env.REPORT_DIR || path.resolve(process.cwd(), '../RuoYi-Vue-zhike/deploy/local-audio/reports')
const TARGET_PAGE = Number(process.env.TARGET_PAGE || 5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(section, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${section} | ${msg}`)
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function login(username) {
  const r = await api('/api/v1/auth/login', { method: 'POST', body: { username, password: 'admin123' } })
  if (!r.json || r.json.code !== 0) throw new Error(`${username} 登录失败`)
  return r.json.data.accessToken
}

function connectTeacher(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:8080/ws/teacher/live/${SID}?token=${encodeURIComponent(token)}`)
    const timer = setTimeout(() => reject(new Error('教师 WS 连接超时')), 8000)
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'connected') {
        clearTimeout(timer)
        resolve({ ws, writer: !!(m.payload && m.payload.writer) })
      }
      if (m.type === 'error' && m.payload && m.payload.code === 'WRITER_CONFLICT') {
        clearTimeout(timer)
        reject(new Error('WRITER_CONFLICT：已有其它教师窗口在演示，请关闭 8082 课堂页后重跑'))
      }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('教师 WS 连接失败')) }
  })
}

/** 旁路 /ws/session 收集舞台 seq，验证独立序列连续（不影响页面） */
function openSeqCollector(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:8080/ws/session/${SID}?token=${encodeURIComponent(token)}`)
    const frames = []
    const timer = setTimeout(() => reject(new Error('seq collector 连接超时')), 8000)
    ws.onopen = () => { clearTimeout(timer); resolve({ ws, frames }) }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data)
        if (['slide', 'stroke', 'clear', 'snapshot', 'playback', 'state-digest', 'state-reset'].includes(m.type)) {
          frames.push({ type: m.type, seq: m.seq, rev: m.rev })
        }
      } catch { /* ignore */ }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('seq collector 连接失败')) }
  })
}

let msgSeq = 0
function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, payload, clientMsgId: `e2e-stage-${Date.now()}-${++msgSeq}` }))
}

async function openStudent(browser, token, label) {
  const page = await browser.newPage()
  const errors = []
  const httpErrors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url().slice(0, 160)}`) })
  // 记录舞台帧 seq，用于验证“普通事件不制造缺口”
  await page.evaluateOnNewDocument(() => {
    window.__stageSeqs = []
    const Orig = window.WebSocket
    window.WebSocket = new Proxy(Orig, {
      construct(target, args) {
        const ws = new target(...args)
        if (String(args[0] || '').includes('/ws/session')) {
          ws.addEventListener('message', (e) => {
            try {
              const m = JSON.parse(e.data)
              if (['slide', 'stroke', 'clear', 'snapshot', 'playback', 'state-digest', 'state-reset'].includes(m.type)) {
                window.__stageSeqs.push({ type: m.type, seq: m.seq, rev: m.rev })
              }
            } catch { /* ignore */ }
          })
        }
        return ws
      }
    })
  })

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate((t) => sessionStorage.setItem('itap_token', t), token)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(5000)
  const clicked = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find((el) => (el.textContent || '').trim() === '课堂')
    if (!a) return false
    a.click()
    return true
  })
  if (!clicked) throw new Error(`${label}: 未找到「课堂」菜单`)
  try {
    await waitFor(async () => {
      const text = await page.evaluate(() => document.body.innerText || '')
      return text.includes('实时课堂') && !text.includes('我学的课')
    }, 12000, `${label}: 进入实时课堂`)
  } catch (e) {
    const info = await page.evaluate(() => ({
      url: location.href,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600)
    }))
    throw new Error(`${e.message}; url=${info.url}; text=${info.text}; console=${errors.slice(-3).join(' | ')}`)
  }
  return { page, errors, httpErrors }
}

async function pageText(page) {
  return page.evaluate(() => document.body.innerText || '')
}

async function waitFor(fn, timeoutMs, label, intervalMs = 300) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return Date.now() - start
    await sleep(intervalMs)
  }
  throw new Error(`等待超时：${label}（${timeoutMs}ms）`)
}

async function waitText(page, needle, timeoutMs, label) {
  return waitFor(async () => (await pageText(page)).includes(needle), timeoutMs, label, 100)
}

/** BoardLayer 是舞台内最后一个 canvas；统计非透明像素判断笔迹是否出现 */
async function boardInk(page) {
  return page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    const c = canvases[canvases.length - 1]
    if (!c || !c.width || !c.height) return { count: 0, width: c ? c.width : 0, height: c ? c.height : 0 }
    const ctx = c.getContext('2d')
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4 * 23) {
      if (data[i] > 0) count++
    }
    return { count, width: c.width, height: c.height }
  })
}

async function stageState(token) {
  const r = await api(`/api/v1/stu/live/sessions/${SID}/stage`, { token })
  return r.json && r.json.data
}

async function main() {
  const checks = []
  const add = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    log(ok ? 'PASS' : 'FAIL', `${name}${detail ? ' — ' + detail : ''}`)
  }

  const teacherToken = await login('zhanglaoshi')
  const studentToken = await login('lihaoyi')
  log('auth', '教师/学生登录成功')

  const teacher = await connectTeacher(teacherToken)
  if (!teacher.writer) throw new Error('当前连接不是写者，请先关闭 8082 教师课堂页')
  log('teacher', '已获得写者租约')
  const collector = await openSeqCollector(studentToken)

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: HEADLESS,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  })

  let student
  let late
  try {
    student = await openStudent(browser, studentToken, 'student-A')
    add('学生进入实时课堂', true)

    // 1) 翻页：教师发 page=5，学生标题/页码同步
    const slide = {
      page: TARGET_PAGE, totalPages: 30, stepIndex: 0, stepNo: null,
      resourceId: 73, name: '毕业生职面未来就业攻略小手册（1.0指导版）.pdf'
    }
    const t0 = Date.now()
    send(teacher.ws, 'slide', slide)
    const flipMs = await waitText(student.page, `第 ${TARGET_PAGE} / 30 页`, 5000, '学生页码同步')
    add('翻页同步', true, `${Date.now() - t0}ms（页面可见 ${flipMs}ms）`)

    // 2) 批注：发 3 个点，学生 BoardLayer 出现非透明像素
    send(teacher.ws, 'stroke', {
      id: 'e2e-stage-stroke-1', color: '#dc2626', width: 3,
      points: [[0.10, 0.20], [0.20, 0.30], [0.30, 0.40]]
    })
    let ink = { count: 0 }
    await waitFor(async () => { ink = await boardInk(student.page); return ink.count > 0 }, 4000, '学生笔迹出现')
    add('批注同步', ink.count > 0, `board pixels=${ink.count}`)

    // 3) 播放状态：REST 权威状态带 playback.timeSec=10
    send(teacher.ws, 'playback', {
      mediaId: 73, action: 'pause', state: 'paused', timeSec: 10, rate: 1, durationSec: 30
    })
    await sleep(800)
    const afterPlayback = await stageState(studentToken)
    add('播放状态同步', !!afterPlayback && afterPlayback.playback && afterPlayback.playback.timeSec === 10,
      JSON.stringify(afterPlayback && afterPlayback.playback))

    // 4) 迟到加入：第二个学生页打开即拿到 page=5 + 已有笔迹
    late = await openStudent(browser, studentToken, 'student-B-late')
    await waitText(late.page, `第 ${TARGET_PAGE} / 30 页`, 6000, '迟到学生页码')
    const lateInk = await boardInk(late.page)
    add('迟到学生自动同步', lateInk.count > 0, `page=${TARGET_PAGE}, board pixels=${lateInk.count}`)

    // 5) 刷新重连：学生 A 刷新后恢复 page=5 + 笔迹
    await student.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2500)
    const clicked = await student.page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((el) => (el.textContent || '').trim() === '课堂')
      if (!a) return false
      a.click()
      return true
    })
    if (!clicked) throw new Error('刷新后未找到「课堂」菜单')
    await waitText(student.page, `第 ${TARGET_PAGE} / 30 页`, 8000, '刷新后页码恢复')
    let recoveredInk = { count: 0 }
    await waitFor(async () => { recoveredInk = await boardInk(student.page); return recoveredInk.count > 0 }, 5000, '刷新后笔迹恢复')
    add('刷新/重连恢复', recoveredInk.count > 0, `board pixels=${recoveredInk.count}`)

    // 6) 清空板书：学生画布归零
    send(teacher.ws, 'clear', {})
    await waitFor(async () => {
      const cur = await boardInk(student.page)
      return cur.count === 0
    }, 4000, '学生清空板书')
    add('清空板书同步', true)

    // 7) 舞台帧 seq 连续性：旁路连接收集整场舞台帧，检查无缺口
    const seqs = collector.frames.filter((x) => typeof x.seq === 'number')
    const contiguous = seqs.every((x, i) => i === 0 || x.seq === seqs[i - 1].seq + 1)
    add('舞台 seq 连续', contiguous,
      `frames=${seqs.length}, first=${seqs[0] ? seqs[0].seq : '-'}, last=${seqs.length ? seqs[seqs.length - 1].seq : '-'}`)

    const failedChecks = checks.filter((c) => !c.ok)
    const status = failedChecks.length ? 'FAIL' : 'PASS'
    const report = {
      timestamp: new Date().toISOString(),
      sessionId: SID,
      status,
      checks,
      consoleErrors: student.errors,
      httpErrors: student.httpErrors,
      lateConsoleErrors: late.errors,
      lateHttpErrors: late.httpErrors
    }
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    const file = path.join(REPORT_DIR, `stage-${SID}-${Date.now()}.json`)
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
    console.log('')
    console.log(`RESULT: ${status}`)
    console.log(`report: ${file}`)
    if (status === 'FAIL') process.exitCode = 1
  } finally {
    try { if (late) await late.page.close() } catch { /* ignore */ }
    try { if (student) await student.page.close() } catch { /* ignore */ }
    try { await browser.close() } catch { /* ignore */ }
    try { teacher.ws.close() } catch { /* ignore */ }
    try { collector.ws.close() } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`)
  process.exit(1)
})
