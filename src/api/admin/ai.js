/**
 * 管理端 · AI 治理（M-D 提供）
 * 契约：表 5-17 AI 用量查询、表 5-18 AI 调用日志查询
 *
 * ★ 2026-11-02 路径修正（实测对不上，会 404）：
 *   - `/api/v1/admin/ai-call-logs`、`/api/v1/admin/analytics/school/extra` 在 admin 模块里**没有实现**，
 *     M-D 的 AI 治理接口实际挂在 student-mp 的 `AiAdminController`（类级 `@RequestMapping("/api/v1/stu-admin")`）。
 *     原先沿用契约写法，导致「数据看板」的课程分类/成绩分布永远走进 catch 兜底、显示演示数据。
 *   - `/api/v1/admin/ai-usage` 由 admin 模块 `AdminAiController` 提供（`@PreAuthorize('admin:ai:usage')`），保持不变。
 *   - 两个控制器都有 `requireAdmin()` / 权限点校验，必须用管理员账号登录后再调用。
 *   - 建议统一收口到 `/api/v1/admin/**`（需 M-A 安全层加前缀拦截器），届时只改本文件即可。
 */
import request from '../request'

/** 表 5-17 AI 用量（按 日期 × 用户/课程 × 业务类型 汇总） */
export function aiUsage(days = 7) {
  return request.get('/api/v1/admin/ai-usage', { params: { days } })
}

/** 表 5-18 AI 调用日志（逐次审计，分页） */
export function aiCallLogs(page = 1, pageSize = 20) {
  return request.get('/api/v1/stu-admin/ai-call-logs', { params: { page, pageSize } })
}

/** 全校学情扩展统计（课程分类 + 成绩分布），M-D 新增只读聚合 */
export function schoolStatsExtra() {
  return request.get('/api/v1/stu-admin/analytics/school/extra')
}
