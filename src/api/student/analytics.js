/**
 * 学生端 · 学情与自适应练习（表 3-11、3-8、3-19、3-26）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/**
 * 把可选入参整理成 query（去掉 undefined/null/空串），避免拼出 `?courseId=undefined`
 */
function q(params) {
  const out = {}
  Object.keys(params || {}).forEach((k) => {
    const v = params[k]
    if (v !== undefined && v !== null && v !== '') out[k] = v
  })
  return out
}

/** 表 3-11 学情画像查询（courseId 可选，按课程筛选） */
export function profileDashboard(courseId) {
  return request.get('/api/v1/profiles/me', { params: q({ courseId }) })
}

/** 表 3-8 错题本查询 */
export function wrongRecords(courseId, page, pageSize, params) {
  return request.get('/api/v1/wrong-records', { params: q({ courseId, page, pageSize, ...params }) })
}

/** 表 3-19 薄弱点练习推荐 */
export function practiceRecommend(courseId, page, pageSize, params) {
  return request.get('/api/v1/practice/recommend', { params: q({ courseId, page, pageSize, ...params }) })
}

/** 表 3-26 提交练习作答 */
export function practiceSubmit(data) {
  return request.post('/api/v1/practice/submit', data)
}

/**
 * ★ 2026-10-22 AI 学情建议（stu-pc 模块）
 * GET /api/v1/stu/study-advice?courseId= →
 *   { source: 'ai'|'rule', summary, strengths[], weaknesses[], actions[], data{}, model?, generatedAt }
 */
export function studyAdvice(courseId) {
  return request.get('/api/v1/stu/study-advice', { params: { courseId } })
}
