/**
 * 教师端 · 学情（Day 1 新增的三个接口）
 *
 * ⚠️ 这三个接口**不在冻结的 101 个契约里**，是 M-D 为教师端页面补位的只读聚合接口。
 * 路径口径沿用冻结契约：**不带端前缀**（`/api/v1/analytics/**`）。
 * 后端实现见 server 的 TeacherAnalyticsController / TeacherAnalyticsServiceImpl。
 * 待回填《05-接口设计文档》后固化。
 */
import request from '../request'

/** 班级学情看板（教师端 /teacher/analytics） */
export function classAnalytics(courseId) {
  return request.get('/api/v1/analytics/class', { params: { courseId } })
}

/** 班级成绩明细（教师端 /teacher/class-scores） */
export function classScores(courseId) {
  return request.get('/api/v1/analytics/class/scores', { params: { courseId } })
}

/** 学情热力图（教师端 /teacher/heatmap） */
export function classHeatmap(courseId) {
  return request.get('/api/v1/analytics/heatmap', { params: { courseId } })
}
