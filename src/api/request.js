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

// ★ token 存 sessionStorage（按标签页隔离）：刷新页面保留登录态，
//    但**复制链接到新窗口/新标签页必须重新登录**（权限认证要求）
const TOKEN_KEY = 'itap_token'

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

/**
 * 开发期接口 Mock（详见 ./mock.js）
 * 后端骨架就绪前，让前端能独立跑通并自测；后端可用后设 VITE_USE_MOCK=0 关掉。
 */
const USE_MOCK =
  import.meta.env.VITE_USE_MOCK === '1' ||
  (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== '0')
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
    ElMessage.error(msg)

    if (body.code === 401 && !isAuthEndpoint(response.config?.url)) toLogin()
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
    ElMessage.error(msg)

    if (status === 401 && !isAuthEndpoint(error.config?.url)) toLogin()
    return Promise.reject(Object.assign(error, { code: body?.code ?? status, details: body?.details }))
  }
)

export default service
