/**
 * 学
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request, { getToken } from '../request'

/** 表 2-10 会话列表查询 */
export function conversationList(convType, page, pageSize, params) {
  return request.get('/api/v1/conversations', { params })
}

/** 表 2-11 发送消息 */
export function sendMessage(conversationId, data) {
  return request.post(`/api/v1/conversations/${conversationId}/messages`, data)
}

/** 表 2-12 消息记录查询 */
export function messageHistory(conversationId, page, pageSize, params) {
  return request.get(`/api/v1/conversations/${conversationId}/messages`, { params })
}

/** 表 2-13 站内通知查询 */
export function notificationList(bizType, page, pageSize, includeDeleted, params) {
  return request.get('/api/v1/notifications', { params })
}

/** 表 2-17 消息已读标记 */
export function markNoticesRead(data) {
  return request.post('/api/v1/notifications/read', data)
}

/**
 * ★ 2026-10-16 删除通知 / 退出会话（表 2-11 同域写接口）
 * POST /api/v1/messages/delete {targetType: 'notice'|'conversation', targetIds: [id, ...]}
 *   会话为「本人退出」语义（对其他成员保留，成员状态置 quit）；越权 403。
 *   ★ 2026-10-27 修：字段是 targetIds（数组），不是 targetId —— 传错会被后端 400。
 */
export function deleteTarget(data) {
  return request.post('/api/v1/messages/delete', data)
}

/**
 * ★ 2026-10-20 发起一对一会话（表 2-10 写入口，后端幂等）
 * POST /api/v1/conversations {targetUserId, convType:'direct'}
 *   → {conversationId, convType, title, created}；已存在则复用 created=false
 */
export function createConversation(data) {
  return request.post('/api/v1/conversations', data)
}

/**
 * ★ 2026-10-20 撤回消息（后端仅发送人本人、24 小时内，演示放宽）
 * POST /api/v1/messages/{messageId}/recall → {messageId, recalled}
 */
export function recallMessage(messageId) {
  // ★ 2026-10-21 改指 stu-pc 模块（原 /api/v1/messages/... 在 student-mp，已迁出）
  return request.post(`/api/v1/stu/messages/${messageId}/recall`)
}

/**
 * ★ 2026-10-21 会话偏好：置顶 / 免打扰（写 conversation_member.is_pinned / is_muted）
 * PUT /api/v1/conversations/{id}/settings { pinned?, muted? }
 */
export function updateConvSettings(conversationId, data) {
  // ★ 2026-10-21 改指 stu-pc 模块
  return request.put(`/api/v1/stu/conversations/${conversationId}/settings`, data)
}

/**
 * ★ 2026-10-21 我的会话偏好（stu-pc 只读补充：会话列表接口不返回置顶/免打扰）
 * GET /api/v1/stu/conversation-prefs → [{conversationId, pinned, muted}]
 */
export function conversationPrefs() {
  return request.get('/api/v1/stu/conversation-prefs')
}

/**
 * ★ 2026-10-28 群成员列表（后端接口早已存在，前端此前从未调用）
 * GET /api/v1/stu/conversations/{conversationId}/members
 * → [{ userId, role: owner|admin|member, name, joinedAt }]
 * 非本会话成员返回 403。
 */
export function conversationMembers(conversationId) {
  return request.get(`/api/v1/stu/conversations/${conversationId}/members`)
}

/**
 * ★ 2026-10-21 转发消息到另一会话
 * POST /api/v1/messages/{messageId}/forward { targetConversationId }
 */
export function forwardMessage(messageId, targetConversationId) {
  // ★ 2026-10-21 改指 stu-pc 模块
  return request.post(`/api/v1/stu/messages/${messageId}/forward`, { targetConversationId })
}

/**
 * ★ 2026-10-21 一对一私聊的对方昵称（stu-pc 只读补充：会话列表不带对方身份）
 * GET /api/v1/stu/conversation-peers → [{conversationId, peerId, peerName}]
 */
export function conversationPeers() {
  return request.get('/api/v1/stu/conversation-peers')
}

/**
 * ★ 2026-10-21 会话未读数（stu-pc 自算：last_read_time 之后他人发送的消息数）
 * GET /api/v1/stu/conversation-unread → [{conversationId, unreadCount}]
 */
export function conversationUnread() {
  return request.get('/api/v1/stu/conversation-unread')
}

/** ★ 2026-10-21 标记会话已读 POST /api/v1/stu/conversation-read {conversationId} */
export function markConversationRead(conversationId) {
  return request.post('/api/v1/stu/conversation-read', { conversationId })
}

/**
 * ★ 2026-10-26 创建群聊（stu-pc）：{ title, courseId?, memberIds[] }
 * POST /api/v1/stu/conversations/group → { conversationId, title, memberCount }
 */
export function createGroupConversation(data) {
  return request.post('/api/v1/stu/conversations/group', data)
}

/**
 * ★ 2026-11-10 「我的对话」附件读取（图片预览 / 文件打开与下载）。
 *
 * 历史消息的 fileUrl 都是 `/files/RESOURCE/...` 相对路径，直接 `<img src>` 会撞上
 * permitAll 的静态映射：文件不存在时返回的是 JSON（HTTP 200），页面只显示碎图。
 * 统一改走后端 GET /api/v1/files/attachment（本地 uploads 优先、MinIO 兜底、404 明确），
 * 用 fetch 带上 token 取 blob：
 *   · 图片 → URL.createObjectURL 预览
 *   · 文件 → 新标签页打开 或 <a download> 下载
 * 失败由调用方给出「附件不存在或已被清理」提示，不再静默碎图。
 *
 * @param {string} path      fileUrl（可为 /files/... 或完整 URL）
 * @param {object} opts      { name?, download? }
 * @returns {Promise<{blob: Blob, url: string, type: string, name: string}>}
 */
export async function fetchAttachment(path, { name = '', download = 0 } = {}) {
  const base = import.meta.env.VITE_API_BASE_URL || ''
  const qs = new URLSearchParams({ path: String(path || ''), download: String(download) })
  if (name) qs.set('name', name)
  const res = await fetch(`${base}/api/v1/files/attachment?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  })
  // 后端统一信封 + Spring Security 兜底都可能「HTTP 200 但内容是 JSON 错误」，
  // 不能只看 res.ok，否则会把错误 JSON 当成附件 blob 显示成碎图。
  const ct = res.headers.get('Content-Type') || ''
  if (!res.ok || ct.includes('application/json')) {
    let message = `附件读取失败（${res.status}）`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
      else if (body?.msg) message = body.msg
    } catch {
      /* 非 JSON 错误体，保留状态码提示 */
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  return {
    blob,
    url: URL.createObjectURL(blob),
    type: blob.type || res.headers.get('Content-Type') || 'application/octet-stream',
    name: name || String(path || '').split('/').pop() || '附件'
  }
}
