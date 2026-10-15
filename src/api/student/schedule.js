/**
 * 学生端 · 课表（表 3-12）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-12 课表查询（★ 经理整合版要求 startDate / endDate 必填，否则 422） */
export function scheduleList(startDate, endDate, params) {
  return request.get('/api/v1/schedules', {
    params: { startDate, endDate, ...(params || {}) }
  })
}

/**
 * ★ 2026-10-15 新 UI 课表数据源（stu-pc 模块自有接口，见 `student-pc` 后端模块）
 * GET /api/v1/stu/schedule?weekRef=N —— 学生视角、按教学周取本人课表
 * 返回（Result 信封解包后）：[{ scheduleId, courseId, courseName, weekday(1-7),
 *   periodNo('1-2'), weekRef, classTime, durationMin, classroomName, teacherName, status }]
 * weekRef 不传则返回全部周次。
 */
export function mySchedule(weekRef) {
  return request.get('/api/v1/stu/schedule', { params: weekRef ? { weekRef } : {} })
}
