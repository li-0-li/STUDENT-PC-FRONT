/**
 * 学生端 · 实时课堂（表 3-13、3-14、3-15、3-16）
 * 另有 2 个 WebSocket 通道：表 6-1 `/ws/session/{sessionId}`、表 6-2 `/ws/cast/{sessionId}`
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 3-13 进入课堂 */
export function enterLesson(sessionId, data) {
  return request.post(`/api/v1/sessions/${sessionId}/enter`, data)
}

/** 表 3-14 课堂签到 */
export function signAttendance(sessionId, data) {
  return request.post(`/api/v1/sessions/${sessionId}/attendance/sign`, data)
}

/**
 * 课堂签到详情（当前签到任务 + 我的签到状态 + 已签/应到人数）
 * 实测 `GET /api/v1/sessions/{id}/signin` 返回：
 *   { sessionId, courseName, teacherName, classroomName,
 *     signinTask:{ taskId, signTypes:'["qr","location","photo"]', expireAt, allowMakeup, status },
 *     myAttendance:{ attend_status, sign_type, sign_time, ... },
 *     signed, attendStatus, signedCount, shouldCount }
 * 契约「表 3-14」只登记了 POST，GET 为该实现附带，已记入差异清单。
 */
export function signinDetail(sessionId) {
  return request.get(`/api/v1/sessions/${sessionId}/signin`)
}

/** 表 3-15 课堂互动参与（投票 / 抢答 / 课堂测试作答） */
export function answerInteraction(sessionId, data) {
  return request.post(`/api/v1/sessions/${sessionId}/interactions`, data)
}

/** 表 3-16 课堂聊天消息 */
export function sendLessonMessage(sessionId, data) {
  return request.post(`/api/v1/sessions/${sessionId}/messages`, data)
}

/**
 * ★ 2026-10-27 当前互动详情（stu-pc 只读）
 * GET /api/v1/stu/sessions/{sessionId}/interactions/{interactionId}
 *   → { interactionId, sessionId, interType, title, durationSec, startedAt,
 *       questions:[{questionId,qType,content,options}], answered }
 *   仅返回本人已选课程 / 本课堂的互动；quiz 不含标准答案。
 */
export function interactionDetail(sessionId, interactionId) {
  return request.get(`/api/v1/stu/sessions/${sessionId}/interactions/${interactionId}`)
}

/**
 * ★ 2026-10-27 本堂课最近一次互动（刷新页面后恢复用）
 * GET /api/v1/stu/sessions/{sessionId}/interactions/current?minutes=120
 *   → 同 detail 结构；没有进行中的互动时 data = null
 */
export function currentInteraction(sessionId, minutes = 120) {
  return request.get(`/api/v1/stu/sessions/${sessionId}/interactions/current`, { params: { minutes } })
}
