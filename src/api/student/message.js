/**
 * 学
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

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
 * POST /api/v1/messages/delete {targetType: 'notice'|'conversation', targetId}
 *   会话为「本人退出」语义（对其他成员保留）；越权 403。
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
  return request.post(`/api/v1/messages/${messageId}/recall`)
}

/**
 * ★ 2026-10-21 会话偏好：置顶 / 免打扰（写 conversation_member.is_pinned / is_muted）
 * PUT /api/v1/conversations/{id}/settings { pinned?, muted? }
 */
export function updateConvSettings(conversationId, data) {
  return request.put(`/api/v1/conversations/${conversationId}/settings`, data)
}

/**
 * ★ 2026-10-21 我的会话偏好（stu-pc 只读补充：会话列表接口不返回置顶/免打扰）
 * GET /api/v1/stu/conversation-prefs → [{conversationId, pinned, muted}]
 */
export function conversationPrefs() {
  return request.get('/api/v1/stu/conversation-prefs')
}

/**
 * ★ 2026-10-21 转发消息到另一会话
 * POST /api/v1/messages/{messageId}/forward { targetConversationId }
 */
export function forwardMessage(messageId, targetConversationId) {
  return request.post(`/api/v1/messages/${messageId}/forward`, { targetConversationId })
}
