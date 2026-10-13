/**
 * 学生端 · AI 答疑（表 3-9、3-10）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-9 课程AI答疑 */
export function askQuestion(data) {
  return request.post('/api/v1/qa/ask', data)
}

/** 表 3-10 答疑反馈 */
export function qaFeedback(qaId, data) {
  return request.post(`/api/v1/qa/${qaId}/feedback`, data)
}
