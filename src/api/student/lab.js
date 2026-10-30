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
 *
 * ★ 2026-10-30 改为 **学生 PC 端自有接口** `/api/v1/stu/experiments`（student-pc 模块）。
 *   原先调小程序端的 `/api/v1/experiments`，违反「学生 PC 端只调本模块接口」的约定，
 *   且可见范围/归属校验都不由本端控制。新接口只返回本人已选课(enrolled)且已发布的实验。
 */
export function experimentList() {
  return request.get('/api/v1/stu/experiments')
}

/** 表 3-17 提交实验报告（★ 2026-10-30 迁到本模块自有接口，不再走小程序端） */
export function submitLabReport(taskId, data) {
  return request.post(`/api/v1/stu/experiments/${taskId}/submissions`, data)
}

/** 表 3-18 实验报告详情（★ 2026-10-30 迁到本模块自有接口） */
export function labReportDetail(submissionId) {
  return request.get(`/api/v1/stu/experiment-submissions/${submissionId}`)
}

/**
 * 表 3-22 实验报告下载（★ 2026-10-30 迁到本模块自有接口）
 * 注意：返回的是**文件信息 JSON** `{ fileName, url, message }`，不是二进制流，
 * 所以这里不能设 responseType: 'blob'，由调用方拿 url 触发下载。
 */
export function downloadLabReport(submissionId) {
  return request.get(`/api/v1/stu/experiment-submissions/${submissionId}/report`)
}
