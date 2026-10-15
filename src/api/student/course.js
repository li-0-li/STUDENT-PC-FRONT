/**
 * 学生端 · 课程与资源（表 3-1、3-2、3-3、3-4）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-1 课程列表查询 */
export function courseList(keyword, semester, status, page, pageSize, params) {
  return request.get('/api/v1/courses', { params })
}

/**
 * ★ 2026-10-15 新 UI 课程卡片数据源（stu-pc 模块自有接口）
 * GET /api/v1/stu/courses?keyword= —— 本人已选课程（course_enrollment × course）
 * 返回（Result 信封解包后）：
 *   [{ courseId, courseName, courseCode, teacherName, studentCount, enrollTime, status }]
 */
export function myCourses(keyword) {
  return request.get('/api/v1/stu/courses', { params: keyword ? { keyword } : {} })
}

/** 表 3-2 课程详情查询 */
export function courseDetail(courseId) {
  return request.get(`/api/v1/courses/${courseId}`)
}

/** 表 3-3 学生加课 */
export function enrollCourse(courseId, data) {
  return request.post(`/api/v1/courses/${courseId}/enroll`, data)
}

/** 表 3-4 资源列表查询 */
export function resourceList(courseId, weekNum, resourceType, page, pageSize, params) {
  return request.get(`/api/v1/courses/${courseId}/resources`, { params })
}
