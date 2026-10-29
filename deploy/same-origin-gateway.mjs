#!/usr/bin/env node
/**
 * =============================================================================
 * 同域 HTTPS 网关（本机验证用 / 生产可替代 nginx 的备选方案）
 * -----------------------------------------------------------------------------
 * 作用：用【一个 origin】同时提供
 *      https://<host>/student/      前端静态产物（vite build 的 dist）
 *      https://<host>/api/...       反代到后端 8080
 *      https://<host>/ws/...        WebSocket 反代（含 upgrade，长连接不超时）
 *      https://<host>/files/...     上传文件
 *      https://<host>/login 等      若依鉴权入口
 *
 * 为什么需要它：
 *   教师端 getDisplayMedia() 是 secure-context-only API，
 *   必须 https（或 localhost）才能抓屏。本机开发时前端跑在 8081（http），
 *   拿不到安全上下文，所以投屏的"最后一公里"在本机一直验不了。
 *
 * 生产环境推荐用 nginx（见 deploy/nginx-student-pc.conf）；
 * 本脚本是纯 Node 实现，零依赖，用于在部署前把整条链路跑通验证。
 *
 * 用法：
 *   node deploy/same-origin-gateway.mjs \
 *     --dist ./dist --backend 127.0.0.1:8080 \
 *     --cert ../output/cert/srv.crt --key ../output/cert/srv.key --port 8443
 * =============================================================================
 */

import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 参数 ----------
function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const DIST = path.resolve(__dirname, '..', arg('dist', 'dist'))
const BACKEND = arg('backend', '127.0.0.1:8080')
// 证书默认放在脚本同级的 cert/ 目录（私钥不入库，仅本机与内网部署使用）
const CERT = path.resolve(__dirname, arg('cert', 'cert/srv.crt'))
const KEY = path.resolve(__dirname, arg('key', 'cert/srv.key'))
const PORT = Number(arg('port', '8443'))
const BASE = arg('base', '/student/') // 与 vite build 的 base 保持一致

const [BHOST, BPORT] = BACKEND.split(':')

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0])

  // /student/ → /student/index.html
  if (urlPath === BASE.slice(0, -1)) urlPath = BASE + 'index.html'

  let rel = urlPath
  if (BASE !== '/' && urlPath.startsWith(BASE)) rel = urlPath.slice(BASE.length)

  let file = path.join(DIST, rel)
  // 防目录穿越
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden')
    return
  }

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA 兜底：hash 路由下只有 index.html 需要回退
    file = path.join(DIST, 'index.html')
  }

  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // index.html 不缓存，避免发版后浏览器加载旧 chunk 白屏
    'Cache-Control': file.endsWith('index.html')
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=2592000, immutable'
  })
  fs.createReadStream(file).pipe(res)
}

// ---------- API 反代 ----------
function proxyRequest(req, res) {
  const headers = { ...req.headers }
  headers.host = BACKEND
  headers['x-forwarded-proto'] = 'https'
  if (headers['accept-encoding']) delete headers['accept-encoding']

  const up = http.request(
    { host: BHOST, port: Number(BPORT), path: req.url, method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    }
  )
  up.on('error', () => res.writeHead(502).end('backend unreachable'))
  req.pipe(up)
  // 长轮询/AI 接口可能超过默认超时
  up.setTimeout(120000, () => up.destroy())
}

// ---------- WebSocket 反代（隧道式，保留 upgrade 语义） ----------
function proxyUpgrade(req, socket, head) {
  const up = net.connect(Number(BPORT), BHOST, () => {
    const h = { ...req.headers, host: BACKEND }
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [k, v] of Object.entries(h)) {
      if (v === undefined) continue
      lines.push(Array.isArray(v) ? v.map((x) => `${k}: ${x}`).join('\r\n') : `${k}: ${v}`)
    }
    up.write(lines.join('\r\n') + '\r\n\r\n')
    if (head && head.length) up.write(head)

    socket.pipe(up)
    up.pipe(socket)
  })
  // ★ 一节课 90 分钟，不能设短超时
  up.setTimeout(0)
  socket.setTimeout(0)

  const kill = (e) => {
    console.error('[ws] 连接错误:', e?.message || e)
    try { up.destroy() } catch {}
    try { socket.destroy() } catch {}
  }
  up.on('error', kill)
  socket.on('error', kill)
}

// ---------- 启动 ----------
const tlsOpt = { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }
const server = https.createServer(tlsOpt, (req, res) => {
  const p = req.url.split('?')[0]
  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n')
    return
  }
  if (BASE !== '/' && (p.startsWith(BASE) || p === BASE.slice(0, -1))) {
    serveStatic(req, res)
    return
  }
  proxyRequest(req, res)
})

server.on('upgrade', proxyUpgrade)

server.listen(PORT, () => {
  console.log('=================================================')
  console.log(' 同域 HTTPS 网关已启动')
  console.log(` 站点      : https://localhost:${PORT}${BASE}`)
  console.log(` 静态目录  : ${DIST}`)
  console.log(` 后端      : http://${BACKEND}`)
  console.log(` 反代路径  : /api /ws /files /login /logout /getInfo /captchaImage /register`)
  console.log('=================================================')
})
