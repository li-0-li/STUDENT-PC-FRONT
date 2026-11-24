/**
 * 学生端 · 作业（表 3-5、3-6、3-7、3-21）
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/**
 * 表 3-5 作业列表查询（学生视角，GET /api/v1/assignments）
 *
 * ★ 2026-11-24 修复：旧签名 (courseId,status,page,pageSize,params) 从未把参数透传，
 *   导致「历史作业 / 按课程筛选」在前端无法下发。后端 AssignmentListQueryBo 仅支持
 *   courseId / weekNum / status（draft|published|closed|archived），**不支持 keyword 标题搜索**；
 *   标题模糊由作业中心在前端本地过滤。角色分流（学生 vs 教师出参）由后端按登录角色判定，
 *   前端不要传 studentId/view 之类的参数（见 QueryBo 注释）。
 *
 * 兼容旧调用：homeworkList() 无参 = 全部；homeworkList({ courseId, status, weekNum }) = 带条件。
 */
export function homeworkList(params) {
  return request.get('/api/v1/assignments', { params: params || {} })
}

/**
 * 我的作业中心 - 按状态桶拉取（进行中 / 历史归档）
 * AssignmentItemVo.status: draft / published / closed / archived
 */
export function homeworkListByStatus(status, courseId) {
  return homeworkList({ status, courseId: courseId || undefined })
}

/** 表 3-6 提交作业 */
export function submitHomework(assignmentId, data) {
  return request.post(`/api/v1/assignments/${assignmentId}/submissions`, data)
}

/** 表 3-7 作业申诉 */
export function appealSubmission(submissionId, data) {
  return request.post(`/api/v1/submissions/${submissionId}/appeal`, data)
}

/**
 * 表 3-21 作业退回重交
 *
 * ★ 2026-11-04 标注：**当前无页面调用，且不建议接**。
 *   实测后端两条路都能重交，但语义不同：
 *   - `POST /api/v1/assignments/{id}/submissions`（本文件 `submitHomework`）→ 版本 +1 并**重新判分**；
 *   - `POST /api/v1/submissions/{id}/resubmit`（本函数）→ 只改 answers/附件，状态直接置 submitted，
 *     **不触发批改**（`SubmissionActionServiceImpl#resubmit`）。
 *   退回后学生要的是「改完重新判分」，所以作答页仍走 `submitHomework`；
 *   本函数保留仅作契约对照，接入前先确认是否需要「不判分」的语义。
 */
export function resubmitHomework(submissionId, data) {
  return request.post(`/api/v1/submissions/${submissionId}/resubmit`, data)
}

/**
 * ★ 2026-10-19 本人某次作业的最新提交（stu-pc 模块只读接口）
 * GET /api/v1/stu/submission?assignmentId=
 *   返回 { submissionId, status, score, objectiveScore, subjectiveScore, isLate,
 *          submitTime, gradedTime, appealReason, returnReason, attachment, answers(JSON 原文) }
 *   null = 未提交。
 */
export function mySubmission(assignmentId) {
  return request.get('/api/v1/stu/submission', { params: { assignmentId } })
}

/**
 * ★ 2026-10-19 试卷题目（表 3-8 作答视图，不含答案）
 * GET /api/v1/assignments/{assignmentId}/questions
 *   返回 [{ questionId, qType, typeText, content, options:[{key,text}], maxScore }]
 */
export function assignmentQuestions(assignmentId) {
  return request.get(`/api/v1/assignments/${assignmentId}/questions`)
}

/**
 * ★ 2026-11-19 批改后逐题答案与解析（stu-pc 模块只读接口）
 * GET /api/v1/stu/submission/answers?assignmentId=
 *   返回 [{ questionId, qType, typeText, content, options, maxScore,
 *          studentAnswer, standardAnswer, correct, gain, analysis }]
 *   未提交 / 未批改返回空数组（作答阶段不泄题）。
 */
export function myAnswerReview(assignmentId) {
  return request.get('/api/v1/stu/submission/answers', { params: { assignmentId } })
}
