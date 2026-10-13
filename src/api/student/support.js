/**
 * 学
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-20 客服咨询 */
export function consult(data) {
  return request.post('/api/v1/support/consult', data)
}

/** 表 3-23 客服会话列表 */
export function ticketList(status, page, pageSize, params) {
  return request.get('/api/v1/support/tickets', { params })
}

/** 表 3-24 客服消息查询 */
export function ticketMessages(ticketId, page, pageSize, params) {
  return request.get(`/api/v1/support/tickets/${ticketId}/messages`, { params })
}

/** 表 3-25 发送客服消息 */
export function sendTicketMessage(ticketId, data) {
  return request.post(`/api/v1/support/tickets/${ticketId}/messages`, data)
}
