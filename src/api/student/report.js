/**
 * 学生端 · 内容举报（stu-pc 模块自有接口）
 *
 * POST /api/v1/reports
 *   body: { targetType, targetId?, targetUserId?, reason, evidenceUrl? }
 *   targetType 合法值（后端校验）：chat_message / qa_record / support_message / user
 *   重复举报同一对象（未处理）返回 409；成功后 admin 侧「举报处理」可见。
 *
 * 契约表号：表 2-27 举报提交（学生端）
 */
import request from '../request'

/** 提交举报 */
export function submitReport(data) {
  return request.post('/api/v1/reports', data)
}
