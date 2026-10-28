import request from '@/api/request'

/** ★ 2026-10-23 学习辅助接口（stu-pc 模块） */

/** 错题本：返回 { list[], total, unmastered }，list 带题干/答案/解析 */
export function wrongBook(params) {
  return request.get('/api/v1/stu/wrong-book', { params })
}

/** 标记错题已掌握 / 取消 */
export function markWrongMastered(errorId, mastered = true) {
  return request.put(`/api/v1/stu/wrong-book/${errorId}/master`, { mastered })
}

/** 学习时长统计：{ totalSec, daily[], byCourse[], bySource[] } */
export function studyTime(days = 7) {
  return request.get('/api/v1/stu/study-time', { params: { days } })
}

/** 我的签到记录 */
export function signinRecords(params) {
  return request.get('/api/v1/stu/signin-records', { params })
}

/** ★ 2026-10-23 练习中心：抽题（不含答案） */
export function practiceQuestions(params) {
  return request.get('/api/v1/stu/practice/questions', { params })
}

/** ★ 交卷判分：{ courseId, durationSec, answers:[{questionId, answer}] } */
export function submitPractice(data) {
  return request.post('/api/v1/stu/practice/submit', data)
}

/** ★ 练习记录（按天聚合） */
export function practiceRecords(days = 10) {
  return request.get('/api/v1/stu/practice/records', { params: { days } })
}

/**
 * ★ 2026-10-28 学习周报 / 月报
 * GET /api/v1/stu/study-report?type=week|month&offset=0
 * 返回 { type, startDate, endDate, summary, prevSummary, daily[], byCourse[], bySource[] }
 */
export function studyReport(params) {
  return request.get('/api/v1/stu/study-report', { params })
}
