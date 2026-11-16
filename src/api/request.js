/**
 * axios 统一封装（公共代码，只在 main 上改）
 *
 * 职责（对应《团队开发约定》与 PRD §5.2/§5.3/§6.6）：
 *   1. 统一注入 Authorization: Bearer <token>
 *   2. 统一解包后端响应体 {code, message, data}，业务层直接拿 data
 *   3. code 非 0 视为失败，统一抛错 + 统一提示（页面不再判断 code）
 *   4. 401 统一处理：清 token 并跳登录
 *   5. 请求/响应可加 loading 回调
 *
 * 用法：
 *   import request from '@/api/request'
 *   const data = await request.get('/api/v1/courses', { params })
 */
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { mockAdapter } from './mock'

// ★ token 存两处，按「记住我」区分（2026-11-16 起）：
//    勾选 → localStorage：关浏览器仍在，配合后端 7 天令牌（token.rememberExpireTime）
//    不勾 → sessionStorage：刷新页面保留、关浏览器即失效，按标签页隔离，
//            配合后端 2 小时令牌（token.expireTime）
//    读取时两处都查，写入前先清另一处，避免同一浏览器留下两份互相打架的令牌。
const TOKEN_KEY = 'itap_token'

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token, remember) {
  clearToken()
  if (!token) return
  if (remember) localStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

/**
 * 接口 Mock（详见 ./mock.js）——★ 2026-10-19 改为**仅显式开启**：
 * 原逻辑在 DEV 下默认开启 mock（除非 .env.development 写 VITE_USE_MOCK=0），
 * 而 .env.development 是 gitignore 的本地文件——其他人 clone 后一跑 dev，
 * 所有真实接口都会被 mock 拦截成假数据。现改为只有 VITE_USE_MOCK=1 才启用，
 * 联调 / 生产 / 演示一律默认走真后端。
 */
const USE_MOCK = import.meta.env.VITE_USE_MOCK === '1'
if (USE_MOCK) service.defaults.adapter = mockAdapter

/** 这些接口的 401/500 是「凭据错误」，不该触发跳登录（避免在登录页反复重定向） */
const AUTH_ENDPOINTS = [
  '/auth/login', '/auth/register', '/auth/captcha', '/auth/password',
  // 若依统一鉴权入口（去掉 /auth 前缀后就是这三条）
  '/login', '/register', '/captchaImage'
]
function isAuthEndpoint(url) {
  const u = url || ''
  return AUTH_ENDPOINTS.some((x) => u.includes(x))
}

/** 请求拦截：注入 token */
service.interceptors.request.use(
  (config) => {
    const token = getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

/**
 * token 失效提示：页面通常并发若干请求，若依会逐个回 code=401，
 * 原逻辑每个都 ElMessage.error 一次（实测刷新一次能弹两三条），
 * 真原因被刷屏淹没，用户看到的是"接口连不上"。此处只提示一次。
 */
let authExpiredNotified = false
function notifyAuthExpired() {
  if (authExpiredNotified) return
  authExpiredNotified = true
  ElMessage.error('登录已过期，请重新登录')
  setTimeout(() => {
    authExpiredNotified = false
  }, 3000)
}

/** 401 后跳登录（避免重复跳转） */
let redirecting = false
function toLogin() {
  if (redirecting) return
  redirecting = true
  clearToken()
  const back = encodeURIComponent(window.location.hash.replace(/^#/, '') || '/')
  window.location.hash = `#/login?redirect=${back}`
  setTimeout(() => {
    redirecting = false
  }, 800)
}

/** 响应拦截：解包 + 统一错误 */
service.interceptors.response.use(
  (response) => {
    const body = response.data
    // 文件流等非标准响应直接返回
    if (!body || typeof body !== 'object' || !('code' in body)) return body

    // 兼容两套成功码：自研骨架用 0，若依 AjaxResult 用 200（HttpStatus.SUCCESS）
    if (body.code === 0 || body.code === 200) {
      if (body.data !== undefined) return body.data
      // 若依的 AjaxResult 有时把数据直接放在顶层（典型：POST /login 的 token），
      // 此时没有 data 字段 —— 返回去掉 code/msg 之后的剩余字段
      const rest = { ...body }
      delete rest.code
      delete rest.msg
      return rest
    }

    // 业务失败：统一提示（兼容自研骨架的 message 与若依的 msg）
    const msg = body.msg || body.message || body.details || `请求失败（code=${body.code}）`

    // 401（token 过期/被踢）：只提示一次就跳登录，不把若依的原始文案甩给用户
    if (body.code === 401 && !isAuthEndpoint(response.config?.url)) {
      notifyAuthExpired()
      toLogin()
      return Promise.reject(Object.assign(new Error(msg), { code: body.code, details: body.details }))
    }

    ElMessage.error(msg)
    return Promise.reject(Object.assign(new Error(msg), { code: body.code, details: body.details }))
  },
  (error) => {
    const status = error.response?.status
    const body = error.response?.data
    let msg = body?.msg || body?.message || body?.details

    if (!msg) {
      if (status === 401) msg = '登录已过期，请重新登录'
      else if (status === 403) msg = '无权限访问该数据'
      else if (status === 404) msg = '请求的资源不存在'
      else if (status === 422) msg = '提交的数据未通过校验'
      else if (status === 429) msg = '操作过于频繁或已超出配额，请稍后再试'
      else if (status === 503) msg = '依赖服务暂不可用，请稍后再试'
      else if (status >= 500) msg = '服务器内部错误'
      else msg = '网络异常，请检查网络或后端服务'
    }
    if (status === 401 && !isAuthEndpoint(error.config?.url)) {
      notifyAuthExpired()
      toLogin()
      return Promise.reject(Object.assign(error, { code: body?.code ?? status, details: body?.details }))
    }

    ElMessage.error(msg)
    return Promise.reject(Object.assign(error, { code: body?.code ?? status, details: body?.details }))
  }
)

export default service
