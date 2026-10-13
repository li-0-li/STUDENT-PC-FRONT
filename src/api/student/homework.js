/**
 * 学生端 · 作业（表 3-5、3-6、3-7、3-21）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-5 作业列表查询 */
export function homeworkList(courseId, status, page, pageSize, params) {
  return request.get('/api/v1/assignments', { params })
}

/** 表 3-6 提交作业 */
export function submitHomework(assignmentId, data) {
  return request.post(`/api/v1/assignments/${assignmentId}/submissions`, data)
}

/** 表 3-7 作业申诉 */
export function appealSubmission(submissionId, data) {
  return request.post(`/api/v1/submissions/${submissionId}/appeal`, data)
}

/** 表 3-21 作业退回重交 */
export function resubmitHomework(submissionId, data) {
  return request.post(`/api/v1/submissions/${submissionId}/resubmit`, data)
}
