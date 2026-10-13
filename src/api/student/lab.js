/**
 * 学生端 · 实验报告（表 3-17、3-18、3-22）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/**
 * 实验任务列表（学生视角）
 * 实测 `GET /api/v1/experiments` 会按 JWT 返回**本人所选课程**的实验任务与提交情况
 * （含 course_name / title / deadline / guide / sub_id / sub_status / sub_score / duplicate_rate），
 * 故学生端采用该接口。契约里该 URL 未单独登记学生侧表号，已记入差异清单。
 */
export function experimentList() {
  return request.get('/api/v1/experiments')
}

/** 表 3-17 提交实验报告 */
export function submitLabReport(taskId, data) {
  return request.post(`/api/v1/experiments/${taskId}/submissions`, data)
}

/** 表 3-18 实验报告详情 */
export function labReportDetail(submissionId) {
  return request.get(`/api/v1/experiment-submissions/${submissionId}`)
}

/** 表 3-22 实验报告下载 */
export function downloadLabReport(submissionId) {
  return request.get(`/api/v1/experiment-submissions/${submissionId}/report`)
}
