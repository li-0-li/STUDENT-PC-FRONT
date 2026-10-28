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
