/**
 * 管理端 · AI 治理（M-D 提供）
 * 契约：表 5-17 AI 用量查询、表 5-18 AI 调用日志查询
 * 路径口径：沿用冻结契约，**不带端前缀**
 */
import request from '../request'

/** 表 5-17 AI 用量（按 日期 × 用户/课程 × 业务类型 汇总） */
export function aiUsage(days = 7) {
  return request.get('/api/v1/admin/ai-usage', { params: { days } })
}

/** 表 5-18 AI 调用日志（逐次审计，分页） */
export function aiCallLogs(page = 1, pageSize = 20) {
  return request.get('/api/v1/admin/ai-call-logs', { params: { page, pageSize } })
}

/** 全校学情扩展统计（课程分类 + 成绩分布），M-D 新增只读聚合 */
export function schoolStatsExtra() {
  return request.get('/api/v1/admin/analytics/school/extra')
}
