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

/**
 * 表 3-13 进入课堂
 *
 * ★ 2026-11-04 标注：**当前无页面调用**。课堂页进入房间走 `POST /api/v1/stu/live/cast-token`
 *   与 WebSocket（表 6-1/6-2），该 REST 契约在本端尚未落地；保留仅为契约对照，
 *   若确认不用请连同表号一起删（不要误当成「已实现」）。
 */
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

/**
 * 表 3-16 课堂聊天消息
 *
 * ★ 2026-11-04 标注：**当前无页面调用**。实时课堂的聊天走 WebSocket 通道（表 6-1）
 *   与 `GET /api/v1/stu/sessions/{id}/...` 只读接口，本 REST 写接口尚未接页面。
 */
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

/**
 * ★ 2026-10-28 当前课堂：按此刻课表判定该进哪节课
 * GET /api/v1/stu/live/current?beforeMinutes=30
 *   → { now, status: live|opening|waiting|no_class,
 *       schedule:{scheduleId,courseId,courseName,teacherName,classroomName,classTime,endTime,periodNo,startsInSec} | null,
 *       session:{sessionId,status,currentStepIndex} | null,
 *       next:{courseName,classTime,periodNo,classroomName} | null }
 *
 * ★ 2026-11-12 默认不再由前端指定窗口。
 * 旧实现是 `currentLive(beforeMinutes = 15)`，Live.vue 还显式写死 `currentLive(15)`，
 * 把后端 `defaultValue = "30"` 覆盖成了 15 —— 于是「教师端课前 30 分钟能开课，
 * 学生端要等到课前 15 分钟才算当前课」，同一节课两端口径不一致。
 * 现改为默认不传，窗口由后端 {@code SessionWindow.BEFORE_ENTRY_MINUTES} 唯一决定；
 * 参数仅保留给排障/灰度场景手动指定，正常调用一律不传。
 *
 * @param {number} [beforeMinutes] 课前多少分钟视为「当前课」，省略则用后端统一口径（30）
 */
export function currentLive(beforeMinutes) {
  const params = beforeMinutes == null ? {} : { beforeMinutes }
  return request.get('/api/v1/stu/live/current', { params })
}

/**
 * ★ 2026-11-10 课程卡「进入课堂」：按课程定位该课对应的课堂
 * GET /api/v1/stu/live/by-course?courseId=13
 *   → { courseId, status: live|opening|ended|no_session,
 *       session:{sessionId,status,currentStepIndex,startedAt}|null,
 *       course:{courseId,courseName,teacherName,classroomName,classTime}|null }
 *
 * 与 currentLive 并存：后者回答「此刻该上哪节课」，本接口回答「这门课最近的一节课堂」。
 * 后端用 course_enrollment 做越权校验，只返回本人已选课程的课堂。
 */
export function liveByCourse(courseId) {
  return request.get('/api/v1/stu/live/by-course', { params: { courseId } })
}

/* ==========================================================================
 * 课堂演示（★ 2026-11-09 实时课堂改造：白板 + 课件/PPT 同步，不含音视频）
 *
 * 分工：
 *   · **实时增量**：教师端 `/ws/teacher/live` 发布 slide / stroke / clear / snapshot，
 *     经 SessionBroadcastBridge 转到 `/ws/session/{sessionId}`（学生端只收，
 *     见 `composables/useStageSync.js`）。
 *   · **迟到补齐**：学生连接 `/ws/cast/{sessionId}` 时，服务端补发当前舞台 snapshot，
 *     因此**不需要**再提供 stage / board 的查询接口。
 *   · **课件地址**：老师只广播文件名，学生端按权限从本接口换预签名地址（避免把
 *     带签名的长期 URL 广播给整个课堂）。
 * ========================================================================== */

/**
 * 课堂音频凭证（LiveKit 纯音频）
 * POST /api/v1/stu/live/sessions/{sessionId}/audio-token
 * → { url, token, room, identity, canPublish, expiresIn }
 *
 * <p>音频服务未配置时后端返回 code=503，前端降级为「仅课件同步」；
 * 不在选课名单返回 403；课堂已结束返回 409。
 */
export function audioToken(sessionId) {
  return request.post(`/api/v1/stu/live/sessions/${sessionId}/audio-token`)
}

/**
 * 当前课堂演示状态（迟到 / 刷新 / 断线重连补齐）
 * GET /api/v1/stu/live/sessions/{sessionId}/stage
 * → { page, totalPages, stepIndex, stepNo, name, resourceId, strokes:[...] }，未展示时 data=null
 *
 * <p>与 `/ws/cast` 的连接快照二选一即可：REST 不依赖投屏通道，
 * 只要教师端推过信令，服务端内存缓存就有值。
 */
export function stageSnapshot(sessionId) {
  return request.get(`/api/v1/stu/live/sessions/${sessionId}/stage`)
}

/** P1 状态修复：seq 缺口 / 摘要不一致 / 重连时拉权威全量快照 */
export function stageResync(sessionId, payload) {
  return request.post(`/api/v1/stu/live/sessions/${sessionId}/stage/resync`, payload || {})
}

/** P1 上报本地摘要比对结果，用于服务端同步率统计 */
export function stageDigestReport(sessionId, payload) {
  return request.post(`/api/v1/stu/live/sessions/${sessionId}/stage/digest-report`, payload || {})
}

/** P1 同步指标（联调/看板） */
export function stageMetrics(sessionId) {
  return request.get(`/api/v1/stu/live/sessions/${sessionId}/stage/metrics`)
}

/**
 * 本节课的课件列表（按 schedule_id 精确取，不含整周混入）
 * GET /api/v1/stu/live/sessions/{sessionId}/slides
 * → { total, list: [{ resourceId, fileName, fileType, previewUrl, pageCount, durationSec, ... }] }
 */
export function slidesList(sessionId) {
  return request.get(`/api/v1/stu/live/sessions/${sessionId}/slides`)
}

/**
 * 课堂流程（上课模板步骤 + 当前执行到第几步）
 * GET /api/v1/stu/live/sessions/{sessionId}/steps
 * → { sessionId, status, currentStepIndex, total, source,
 *     steps:[{ stepIndex, type, name, durationMin, durationMax, desc,
 *              state:'pending'|'current'|'done', startedAt, endedAt, durationSec, overTime }] }
 *
 * ★ 数据源与教师端同一条链路：lesson_template.steps（模板定义）+ session_step_log（执行态）。
 *   老师推进步骤时 WS 会推 `step_advance{stepIndex, stepName, stepType}`，收到后重拉一次即可。
 */
export function stepsList(sessionId) {
  return request.get(`/api/v1/stu/live/sessions/${sessionId}/steps`)
}

/**
 * 课堂消息历史（进课堂补历史）
 * GET /api/v1/stu/live/sessions/{sessionId}/chat?afterMessageId=&limit=
 * → { sessionId, total, list:[{ messageId, senderId, senderName, content, msgType, sendTime, mine }] }
 *
 * ★ 发消息不走这里，走 `WS /ws/session/{id}` 上行 `chat`（入库 + 广播一次完成）。
 *   本接口只负责「进课堂/刷新后把之前说过的话补回来」——此前学生端没有历史接口，
 *   刷新一次聊天区就全空，而教师端是 REST 增量轮询、历史一直在，两端口径不一致。
 * ★ `mine` 由服务端按 senderId 判定。前端不要再拿 senderName 去比 username：
 *   senderName 是真实姓名（刘浩艺），username 是登录名（lihaoyi），永远不相等。
 */
export function chatHistory(sessionId, afterMessageId = 0, limit = 50) {
  return request.get(`/api/v1/stu/live/sessions/${sessionId}/chat`, {
    params: { afterMessageId, limit }
  })
}
