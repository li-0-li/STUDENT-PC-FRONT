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

/**
 * ★ 2026-10-15 课程搜索（stu-pc 模块自有接口，添加课程弹窗用）
 * GET /api/v1/stu/courses/search?keyword= —— 课程码/课程名模糊，最多 10 条，
 * 精确命中课程码排最前；返回项含 enrolled（本人是否已选）。
 */
export function searchCourses(keyword) {
  return request.get('/api/v1/stu/courses/search', { params: { keyword } })
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

/**
 * ★ 2026-10-20 课程联系人（stu-pc 模块只读）：任课教师 + 同班同学
 * GET /api/v1/stu/course-contacts?courseId= → [{userId, nickName, userName, roleName}]
 *   roleName: teacher / student；老师在前、同学按昵称排序
 */
export function courseContacts(courseId) {
  return request.get('/api/v1/stu/course-contacts', { params: { courseId } })
}

/**
 * ★ 2026-10-22 课程课件内容搜索（stu-pc：kb_chunk，按关键词命中次数排序）
 * GET /api/v1/stu/kb-search?courseId=&kw= → [{chunkId, sourceFile, chunkIndex, snippet, resourceId}]
 */
export function kbSearch(courseId, kw) {
  return request.get('/api/v1/stu/kb-search', { params: { courseId, kw } })
}
