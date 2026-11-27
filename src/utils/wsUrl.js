/**
 * WebSocket 地址统一构造（★ 2026-11-10 新增）。
 *
 * <p><b>为什么需要</b>：学生端同时接三条通道 ——
 * {@code /ws/session/{id}}（课堂主通道）、{@code /ws/cast/{id}}（舞台快照）、
 * 教师端 {@code /ws/teacher/live/{id}}（同一前端工程里也有教师页复用）——
 * 此前各自拼协议、主机与 token，改一次网关或加一次 VITE 变量就要改三处，且容易漏 {@code wss}。
 *
 * <p><b>约定</b>：
 * <ul>
 *   <li>协议跟随页面：https 页面用 wss，http 页面用 ws；</li>
 *   <li>主机默认取 {@code location.host}（走 Vite/网关代理），可用 {@code VITE_WS_BASE_URL} 覆盖；</li>
 *   <li>token 用 query 参数携带（浏览器 WebSocket 不能自定义 Header，握手拦截器按 query 取）。</li>
 * </ul>
 */
import { getToken } from '@/api/request'

/** 实时通道路径（不含 sessionId） */
export const WS_PATHS = {
  /** 课堂主通道：聊天 / 互动 / 步骤 / 签到 / 舞台信令 */
  session: '/ws/session',
  /** 舞台通道：进入课堂与重连时补发 snapshot */
  cast: '/ws/cast',
  /** 教师端课堂通道（教师页面用） */
  teacherLive: '/ws/teacher/live'
}

/**
 * WS 基地址（带协议，不带尾部斜杠）。
 *
 * @returns {string} 例如 wss://zhike.example.com
 */
export function wsBaseUrl() {
  const configured = import.meta.env.VITE_WS_BASE_URL
  if (configured) return String(configured).replace(/\/+$/, '')
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
}

/**
 * 构造完整 WS 地址。
 *
 * @param {string} path 见 {@link WS_PATHS}
 * @param {number|string} [id] 资源 id（课堂 id）；不传则不加路径段
 * @param {object} [options]
 * @param {boolean} [options.token=true] 是否携带 token（少数只读诊断通道可不带）
 * @returns {string} 例如 wss://host/ws/session/1?token=xxx
 */
export function wsUrl(path, id, options = {}) {
  const base = wsBaseUrl()
  const suffix = id === undefined || id === null || id === '' ? '' : `/${id}`
  const token = getToken() || ''
  const query = options.token === false || !token ? '' : `?token=${encodeURIComponent(token)}`
  return `${base}${path}${suffix}${query}`
}
