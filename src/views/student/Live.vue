<script setup>
/**
 * 实时课堂（★ 2026-11-09 改造：白板 + 课件/PPT 同步 + 纯音频）
 *
 * 关联接口（接口设计文档表号）：表 3-13 进入课堂、表 3-15 课堂互动、表 3-16 随堂测试、
 *                              表 6-1 WebSocket 实时通道
 *
 * 本次改造要点：
 *   · **取消视频直播与投屏**，保留 **LiveKit 纯音频**（老师麦克风 + 学生按需发言）；
 *   · 主画面改为「课件舞台」：老师展示的 PPT/图片/视频同步到这里；
 *   · 舞台上方挂一层**透明 canvas**，渲染老师板书（归一化坐标，只读）；
 *   · 课件与板书同步只走 WebSocket 文本帧：翻页 / 笔迹 / 清屏 / 快照。
 *
 * 下行事件：
 *   · `/ws/session/{sessionId}` —— 聊天 / 签到 / 互动 / 步骤推进，以及教师端舞台信令
 *     （slide / stroke / clear / snapshot，经 SessionBroadcastBridge 转发）
 *   · `/ws/cast/{sessionId}`    —— 旧投屏通道，保留用于取服务端补发的 snapshot
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import StageCanvas from '@/components/live/StageCanvas.vue'
import SlidePeekDialog from '@/components/live/SlidePeekDialog.vue'
import AudioBar from '@/components/live/AudioBar.vue'
import { useClassroomSocket } from '@/composables/useClassroomSocket'
import { useLiveAudioRoom } from '@/composables/useLiveAudioRoom'
import { useStageSync } from '@/composables/useStageSync'
import { useUserStore } from '@/store/user'
import {
  signinDetail,
  interactionDetail,
  currentInteraction,
  answerInteraction,
  currentLive,
  liveByCourse,
  slidesList,
  stepsList,
  chatHistory
} from '@/api/student/live'

const router = useRouter()
const route = useRoute()

/**
 * 课堂 ID 的来源（★ 2026-11-10 新增 ②）：
 *   ① URL 带 `?sessionId=xxx` → 联调时强制指定，优先级最高；
 *   ② URL 带 `?courseId=xxx` → 课程卡「进入课堂」传入，调
 *      `GET /api/v1/stu/live/by-course` 定位这门课最近一节课堂（进行中优先）；
 *   ③ 否则调 `GET /api/v1/stu/live/current`，按此刻课表 + 老师是否已开课堂决定。
 */
const sessionIdFromQuery = computed(() => Number(route.query.sessionId) || 0)
const courseFromQuery = computed(() => Number(route.query.courseId) || 0)
const courseNameFromQuery = computed(() => String(route.query.courseName || ''))

const SESSION_ID = ref(sessionIdFromQuery.value)

/**
 * 本地渲染演示开关：`?mockStage=1`（仅 DEV 生效）。
 * 教师端舞台接口未上线时用它验证 PDF 渲染与笔迹对位，不向后端发请求。
 */
const mockMode = import.meta.env.DEV && !!route.query.mockStage

/** loading | live（老师已开课）| opening（已建课堂待开始）| waiting（有课未开）| ended（该课课堂已结束）| no_class（无课） */
const liveState = ref('loading')
const currentClass = ref(null)
const nextClass = ref(null)
const currentError = ref('')

const info = ref({ course: '—', teacher: '—', room: '—' })
const currentStep = ref('—')

async function loadSessionInfo() {
  if (!SESSION_ID.value) return
  try {
    const d = await signinDetail(SESSION_ID.value)
    info.value = {
      course: d?.courseName || '—',
      teacher: d?.teacherName || '—',
      room: d?.classroomName || '—'
    }
  } catch {
    /* 接口异常时保持 '—' */
  }
}

const pinnedByUrl = computed(() => sessionIdFromQuery.value > 0)

/**
 * 课程卡「进入课堂」入口：按 courseId 查这门课最近一节课堂。
 * 与全局 current 的区别是不会被「此刻另一门课」抢走；老师开新课后轮询会自动进入。
 */
async function initByCourse() {
  try {
    const d = await liveByCourse(courseFromQuery.value)
    const c = d?.course || {}
    currentClass.value = {
      courseName: c.courseName || courseNameFromQuery.value || `课程 #${courseFromQuery.value}`,
      teacherName: c.teacherName || '—',
      classroomName: c.classroomName || '—',
      classTime: c.classTime || ''
    }
    info.value = {
      course: currentClass.value.courseName,
      teacher: currentClass.value.teacherName,
      room: currentClass.value.classroomName
    }
    currentError.value = ''
    const st = d?.status || 'no_session'
    if ((st === 'live' || st === 'opening') && d?.session?.sessionId) {
      SESSION_ID.value = Number(d.session.sessionId)
      liveState.value = st
      await loadSessionInfo()
      if (info.value.course === '—') info.value.course = currentClass.value.courseName
    } else if (st === 'ended') {
      SESSION_ID.value = 0
      liveState.value = 'ended'
    } else {
      SESSION_ID.value = 0
      liveState.value = 'waiting'
    }
  } catch {
    SESSION_ID.value = 0
    liveState.value = 'no_class'
    currentError.value = '按课程查询课堂失败：请确认后端已部署 GET /api/v1/stu/live/by-course'
  }
}

async function initCurrentClass(force = false) {
  if (pinnedByUrl.value) {
    liveState.value = 'live'
    await loadSessionInfo()
    return
  }
  if (courseFromQuery.value) {
    await initByCourse()
    return
  }
  if (force) liveState.value = liveState.value === 'loading' ? 'loading' : liveState.value
  try {
    const d = await currentLive(15)
    currentClass.value = d?.schedule || null
    nextClass.value = d?.next || null
    const st = d?.status || 'no_class'
    if ((st === 'live' || st === 'opening') && d?.session?.sessionId) {
      SESSION_ID.value = Number(d.session.sessionId)
      liveState.value = st
      await loadSessionInfo()
      if ((!info.value.course || info.value.course === '—') && currentClass.value) {
        info.value = {
          course: currentClass.value.courseName || '—',
          teacher: currentClass.value.teacherName || '—',
          room: currentClass.value.classroomName || '—'
        }
      }
    } else {
      liveState.value = st === 'waiting' ? 'waiting' : 'no_class'
    }
  } catch {
    liveState.value = 'no_class'
    currentError.value = '课堂接口不可用：当前后端可能未部署最新版本（/api/v1/stu/live/current 缺失）'
  }
}

/* ---------------- 自动轮询：老师一开课堂，页面自动进入 ---------------- */
let pollTimer = null

function startPoll() {
  if (pinnedByUrl.value || pollTimer) return
  pollTimer = setInterval(() => {
    if (liveState.value === 'live' || liveState.value === 'opening') {
      stopPoll()
      return
    }
    initCurrentClass(true)
  }, 10000)
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 课表时间 "2026-10-28 14:30:00" → 今天 14:30 / 明天 14:30 / 10-30 14:30 */
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function fmtClassTime(t) {
  if (!t) return '—'
  const s = String(t).replace('T', ' ')
  const d = new Date(s.replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s.slice(0, 16)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day1 = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((day1 - day0) / 86400000)
  if (diff === 0) return `今天 ${hm}`
  if (diff === 1) return `明天 ${hm}`
  if (diff === -1) return `昨天 ${hm}`
  return `${WEEKDAY_CN[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

function countdownText(sec) {
  const s = Number(sec)
  if (!Number.isFinite(s)) return ''
  if (s <= 0) return '即将开始'
  if (s < 3600) return `还有 ${Math.max(1, Math.round(s / 60))} 分钟`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `还有 ${h} 小时 ${m} 分` : `还有 ${h} 小时`
}

/* ==================== ① 课堂舞台（课件 + 白板） ==================== */

/**
 * 舞台状态。mode：slide 展示课件 / blank 空白画盘 / none 未展示。
 * 由 `useStageSync` 的 slide / snapshot 事件驱动，不再有独立的「拉取舞台」接口。
 */
const stage = ref({
  mode: 'none',
  resourceId: null,
  fileName: '',
  fileType: '',
  previewUrl: '',
  pageNo: 1,
  pageCount: 0,
  timeSec: 0,
  // P1 播放同步：由 useStageSync 的 playback 帧驱动
  playing: false,
  playbackRate: 1,
  serverTimeMs: 0,
  clockOffset: 0
})

/**
 * 课件 + 板书同步 —— 直接对接教师端 `PptStage` 的通道：
 *   `/ws/cast/{sessionId}`，信令 slide / stroke / clear / snapshot。
 * 教师端是发布端，学生端只收；进入课堂和断线重连时服务端会补一份 snapshot，
 * 所以刷新页面也能拿到之前的板书。
 */
const {
  status: stageSyncStatus,
  strokes: boardOps,
  rev: boardRev,
  playback: stagePlayback,
  refresh: stageRefresh,
  requestResync: stageRequestResync,
  ingestFrame: stageIngestFrame
} = useStageSync(SESSION_ID, {
  enabled: !mockMode,
  onSlide: (s) => applySyncedSlide(s)
})

const stageMode = computed(() => stage.value.mode)

const stageHint = computed(() => {
  if (stage.value.mode === 'blank') return '老师正在白板板书'
  if (stage.value.mode === 'slide') return `正在展示：${stage.value.fileName || '课件'}`
  return '老师暂未展示内容'
})



/* ==================== ①-c 课堂音频（LiveKit 纯音频） ==================== */

/**
 * 音频与课件/板书是两条独立链路：
 *   · 课件/板书走 WebSocket 文本帧；
 *   · 音频走 LiveKit SFU，由 useLiveAudioRoom 负责连接、重连与麦克风。
 *
 * 音频服务未配置（503）或未选课（403）时只降级为「仅课件同步」，不影响课堂其它功能。
 */
const {
  state: audioState,
  error: audioError,
  micEnabled: audioMicEnabled,
  blocked: audioBlocked,
  canPublish: audioCanPublish,
  speakingIds: audioSpeakingIds,
  participants: audioParticipants,
  network: audioNetwork,
  volume: audioVolume,
  toggleMic: toggleAudioMic,
  resumeAudio,
  setVolume: setAudioVolume,
  retry: retryAudio
} = useLiveAudioRoom(SESSION_ID, { enabled: !mockMode })

const audioSpeaking = computed(() => audioSpeakingIds.value.length > 0)

/* ==================== ①-b 本节课件（教师端上传的 courseware） ==================== */

/**
 * 课件列表 —— 对齐教师端 `GET /teacher/live/sessions/{id}/slides`，
 * 学生端走 `GET /api/v1/stu/live/sessions/{id}/slides`（student-pc 侧新增）。
 *
 * 学生点列表 = 打开本地预览弹窗（SlidePeekDialog），**不写 stage**；
 * 主舞台永远由老师控制（只有收到 slide / snapshot 才会变化）。
 *
 * 早期版本把清单做成完全点不动，学生连自己翻一眼课件都做不到，属于矫枉过正；
 * 现在放开点击，但只走覆盖层，主舞台不受影响。
 */
const slides = ref([])
const slidesLoading = ref(false)
const slidesLoaded = ref(false)
const slidesError = ref('')

async function loadSlides() {
  if (!SESSION_ID.value || mockMode) return
  slidesLoading.value = true
  try {
    const d = await slidesList(SESSION_ID.value)
    slides.value = Array.isArray(d?.list) ? d.list : []
    slidesLoaded.value = true
  } catch (e) {
    // 403 = 不在选课名单（正常拦截，不打扰用户）；其余给一次提示即可
    if (e?.code !== 403) slidesError.value = '课件列表加载失败'
  } finally {
    slidesLoading.value = false
  }
}

function slideIcon(type) {
  return String(type || '').includes('video') ? 'video' : 'file-text'
}

/* ---------------- 本地预览（点击课件弹出，不接管主舞台） ----------------
 *
 * ★ 2026-11-09：课件清单从「只读」改为「可点开预览」。
 *   注意**只开覆盖层**，不写 stage —— 主屏必须一直是老师正在演示的那一份，
 *   学生自己翻看不能把老师的内容顶掉（这正是上一版把学生关死的原因，矫枉过正了）。
 */

const peekVisible = ref(false)
const peeking = ref(null)

function openSlidePeek(s) {
  if (!s) return
  peeking.value = s
  peekVisible.value = true
}

/* ---------------- 上课流程（教师备课时的上课模板） ----------------
 *
 * ★ 2026-11-09：替代原「课堂聊天」的位置。
 *   数据不是编的：步骤来自 lesson_template.steps，执行态来自 session_step_log，
 *   与教师端课堂页看到的是同一份（后端 /stu/live/sessions/{id}/steps 按同样优先级取模板）。
 */

const flow = ref({ loading: false, loaded: false, currentStepIndex: -1, steps: [], error: '' })

/** 步骤类型 → 中文名（类型枚举与教案模板一致） */
const STEP_TYPE_LABEL = {
  roll: '点名',
  review: '复习',
  intro: '课引',
  teach: '讲授',
  practice: '练习',
  discuss: '讨论',
  vote: '投票',
  quiz: '测试',
  summary: '小结',
  homework: '作业'
}

function stepTypeName(t) {
  return STEP_TYPE_LABEL[t] || '环节'
}

/** 时长文案：优先老师排的区间，没有就留空（不编造） */
function stepDuration(st) {
  const a = st?.durationMin
  const b = st?.durationMax
  if (a && b && b !== a) return `${a}–${b} 分钟`
  if (a) return `${a} 分钟`
  if (b) return `${b} 分钟`
  return ''
}

async function loadSteps(silent = false) {
  if (!SESSION_ID.value || mockMode) return
  if (!silent) flow.value.loading = true
  try {
    const d = await stepsList(SESSION_ID.value)
    flow.value.steps = Array.isArray(d?.steps) ? d.steps : []
    flow.value.currentStepIndex = Number.isFinite(Number(d?.currentStepIndex))
      ? Number(d.currentStepIndex)
      : -1
    flow.value.loaded = true
    flow.value.error = ''
    syncCurrentStepName()
  } catch (e) {
    // 403 = 不在选课名单，属正常拦截，不打扰
    if (e?.code !== 403) flow.value.error = '上课流程加载失败'
  } finally {
    flow.value.loading = false
  }
}

/** 顶部「当前步骤」跟随流程里的 current 步骤 */
function syncCurrentStepName() {
  const st = flow.value.steps.find((x) => x.state === 'current')
  if (st) currentStep.value = st.name || stepTypeName(st.type)
}

function emptyStage() {
  return {
    mode: 'none',
    resourceId: null,
    fileName: '',
    fileType: '',
    previewUrl: '',
    pageNo: 1,
    pageCount: 0,
    timeSec: 0,
    playing: false,
    playbackRate: 1,
    serverTimeMs: 0,
    clockOffset: 0
  }
}

/**
 * 教师端只下发 `{index, stepNo, name}` 三个定位字段，不带地址 ——
 * 这是有意的：地址是 MinIO 预签名 URL，学生端自己按权限换，避免把长期地址广播到整个课堂。
 * 所以这里用文件名（其次 stepNo）在「本节课件」里反查，拿到预览地址。
 */
function findSlide(s) {
  if (!slides.value.length) return null
  // ① 资源 ID 最可靠（教师端 11-09 起随 slide 信令下发）
  if (s.resourceId != null) {
    const byId = slides.value.find((x) => Number(x.resourceId) === Number(s.resourceId))
    if (byId) return byId
  }
  // ② 文件名（老版本教师端只发 name/fileName）
  if (s.name) {
    const byName = slides.value.find((x) => x.fileName === s.name)
    if (byName) return byName
  }
  // ③ 按步骤挂载
  if (s.stepNo != null) {
    const byStep = slides.value.find((x) => Number(x.stepNo) === Number(s.stepNo))
    if (byStep) return byStep
  }
  // 老数据没有 step_no：整节课只有一份课件时直接兜底，与教师端的匹配策略一致
  return slides.value.length === 1 ? slides.value[0] : null
}

let pendingSlide = null

/** 老师切换展示课件（或重连补发 snapshot） */
async function applySyncedSlide(s) {
  if (!s) {
    stage.value = emptyStage()
    return
  }
  // 有定位字段才能反查课件。教师端补发的 snapshot 在旧版本里只带 index，
  // 没有 name / resourceId / stepNo —— 这不是「老师清空了展示」，而是「没说是哪一份」，
  // 此时清空舞台会让 PPT 直接消失，保留现状才是对的。
  const hasLocator = s.resourceId != null || !!s.name || s.stepNo != null
  if (!hasLocator) return
  let hit = findSlide(s)
  // 信令可能先于课件列表到达：先补拉一次，再匹配
  if (!hit && !slidesLoaded.value) {
    pendingSlide = s
    await loadSlides()
    if (pendingSlide === s) {
      pendingSlide = null
      hit = findSlide(s)
    }
  }
  if (!hit || !hit.previewUrl) {
    // 老师展示的课件不在自己的资源列表里（如未选课/刚上传未同步），不要静默空白
    stage.value = { ...emptyStage(), fileName: s.name || '' }
    return
  }
  // 教师端 11-09 起的 slide/snapshot 帧带 page/totalPages，旧帧只有 index；
  // 页码取新字段优先、资源记录兜底，保证翻页能跟着老师走
  const pageNo = Math.max(1, Number(s.page) || 1)
  const pageCount = Math.max(Number(s.totalPages) || 0, Number(hit.pageCount) || 0)
  stage.value = {
    mode: 'slide',
    resourceId: hit.resourceId,
    fileName: hit.fileName || '',
    fileType: hit.fileType || '',
    previewUrl: hit.previewUrl,
    pageNo,
    pageCount,
    // 页码/课件变化由 slide 帧驱动，播放进度由 playback 帧驱动，互不覆盖
    timeSec: stage.value.timeSec || 0,
    playing: stage.value.playing || false,
    playbackRate: stage.value.playbackRate || 1,
    serverTimeMs: stage.value.serverTimeMs || 0,
    clockOffset: stage.value.clockOffset || 0
  }
}

/* ==================== ② 实时通道 ==================== */

const userStore = useUserStore()

/** 课堂消息统一进「课堂消息」卡片（★ 2026-11-09：与教师端课堂聊天对齐，独立成卡并补历史） */
function pushChatMsg(m) {
  pushMsg(m)
}

const { connected, statusText, onlineCount, send } = useClassroomSocket(SESSION_ID, {
  onEvent(type, payload, frame) {
    switch (type) {
      case 'chat': {
        // ★ 自己发的消息按 senderId 判定，不能用 senderName 比 username：
        //   服务端下发的是真实姓名（刘浩艺），登录名是 lihaoyi，永远不相等。
        const myId = Number(userStore.info?.userId)
        pushChatMsg({
          messageId: payload.messageId,
          senderId: payload.senderId,
          senderName: payload.senderName || '同学',
          content: payload.content,
          sendTime: payload.sendTime,
          mine: myId > 0 && Number(payload.senderId) === myId
        })
        break
      }
      case 'attendance':
        if (payload.status != null) {
          if (payload.late === true) {
            ElMessage.warning('老师已进入课堂 · 你本次签到被记为「迟到」')
          } else {
            ElMessage.info('老师已进入课堂，签到已开启')
          }
        } else if (payload.signedCount != null) {
          ElMessage.info(
            `签到更新：已签 ${payload.signedCount}` +
              (payload.shouldCount ? ` / ${payload.shouldCount}` : '') +
              ' 人'
          )
        }
        break
      case 'step_advance':
        if (payload.stepIndex != null) flow.value.currentStepIndex = Number(payload.stepIndex)
        if (payload.stepName) currentStep.value = payload.stepName
        // 步骤执行态（哪几步 done / 当前哪一步）以服务端流水为准，重拉一次最省心
        loadSteps(true)
        break
      case 'quiz_start':
        ElMessage.success(
          `老师发起随堂测试：${payload.questionCount || '?'} 题` +
            (payload.durationSec ? `，限时 ${Math.round(payload.durationSec / 60)} 分钟` : '')
        )
        loadInteraction(payload.quizId)
        break
      case 'interact':
        ElMessage.info(`老师发起${payload.interType === 'vote' ? '投票' : '互动'}：${payload.question || ''}`)
        loadInteraction(payload.interactId)
        break
      case 'interact_result':
        if (payload.correctRate != null) {
          ElMessage.success(
            `互动结果：${payload.total} 人参与，正确率 ${Math.round(payload.correctRate * 100)}%`
          )
        }
        break
      case 'rollcall':
        ElMessage.warning(`随机点名：${payload.studentName || ''}`)
        break
      case 'session_end':
        ElMessage.warning('课堂已结束，实时通道已关闭')
        itx.value = null
        stage.value = { ...stage.value, mode: 'none' }
        break

      /* 舞台信令：教师端 /ws/teacher/live → SessionBroadcastBridge → /ws/session
         P1：传完整信封，useStageSync 据此做 seq/rev 去重与缺口检测 */
      case 'slide':
      case 'stroke':
      case 'clear':
      case 'snapshot':
      case 'playback':
      case 'state-digest':
      case 'state-reset':
        stageIngestFrame(frame || { type, payload })
        break

      case 'error':
        ElMessage.error(payload.message || '实时通道错误')
        break
      default:
        break
    }
  }
})

watch(onlineCount, (n) => {
  if (connected.value && n > 0) viewers.value = n
})

/**
 * 课堂主通道（/ws/session）恢复后主动补一次舞台状态。
 *
 * 舞台信令主通道是 /ws/session，/ws/cast 只负责连接快照；
 * 以 connected 为准，避免「/ws/cast 断了但画面其实还在同步」时误报。
 */
watch(connected, (ok) => {
  if (!ok) return
  stageRefresh()
  // P1：重连时按 lastSeq/lastRev 请求一次权威状态修复
  stageRequestResync('reconnect')
})

/** P1：播放状态 → 舞台渲染参数；clockOffset 用于抵消客户端与服务端时钟偏差 */
watch(stagePlayback, (pb) => {
  const patch = pb
    ? {
        timeSec: Number(pb.timeSec) || 0,
        playing: pb.state === 'playing',
        playbackRate: Number(pb.rate) || 1,
        serverTimeMs: Number(pb.serverTimeMs) || 0,
        clockOffset: Number(pb.clockOffset) || 0
      }
    : { playing: false, timeSec: 0 }
  stage.value = { ...stage.value, ...patch }
}, { deep: true })

/** 同步状态文案：以 /ws/session 为准，/ws/cast 仅补快照 */
const stageSyncLabel = computed(() => {
  if (mockMode) return '本地演示数据'
  if (connected.value) return '画面已跟随老师'
  if (stageSyncStatus.value === 'connecting') return '正在连接老师…'
  return statusText.value || '等待老师开启演示'
})

/* ==================== ③ 全屏 ==================== */

const stageBoxRef = ref(null)

function toggleFull() {
  const el = stageBoxRef.value
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
    return
  }
  el.requestFullscreen?.()
}

/* ==================== ④ 课堂消息（与教师端「课堂聊天」同一条流） ==================== */

const SENSITIVE = ['垃圾', '傻逼', '作弊']
const hasSensitive = (t) => SENSITIVE.some((w) => t.includes(w))

/**
 * 课堂消息 = 历史（REST 补拉）+ 实时（WS `chat` 下行），按 messageId 去重。
 *
 * ★ 与教师端 `GET /teacher/live/sessions/{id}/chat` 同表同语义：
 *   老师发的话通过 REST 落库后，后端 `SessionBroadcastBridge` 推到这条 WS 上；
 *   学生发的话走 WS 上行 `chat`，入库后同样广播给全班 + 教师端轮询可见。
 *
 * ★ 自己发的怎么认：用 `senderId === 当前 userId`，不是 senderName。
 *   服务端下发的 senderName 是真实姓名（刘浩艺），userStore 里的 username 是登录名（lihaoyi），
 *   拿两者比较永远不相等 —— 之前自己发的消息会显示成「同学」。
 */
const msgs = ref([])
const msgInput = ref('')
const msgBoxRef = ref(null)
let msgCursor = 0

function scrollMsgToEnd() {
  nextTick(() => {
    const el = msgBoxRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function pushMsg(m) {
  if (!m || m.messageId == null) return
  if (msgs.value.some((x) => x.messageId === m.messageId)) return
  msgs.value.push(m)
  msgCursor = Math.max(msgCursor, Number(m.messageId) || 0)
  scrollMsgToEnd()
}

/** 进课堂 / 刷新后补历史：此前只有 WS 下行，刷新一次消息就全空 */
async function loadChat() {
  if (!SESSION_ID.value) return
  try {
    const d = await chatHistory(SESSION_ID.value, 0, 50)
    const list = d?.list || []
    if (!list.length) return
    const exist = new Set(msgs.value.map((x) => x.messageId))
    const fresh = list.filter((x) => !exist.has(x.messageId))
    if (!fresh.length) return
    msgs.value = msgs.value.concat(fresh).sort((a, b) => a.messageId - b.messageId)
    msgCursor = Math.max(msgCursor, ...list.map((x) => Number(x.messageId) || 0))
    scrollMsgToEnd()
  } catch {
    /* 历史拉不到不影响实时收发 */
  }
}

function sendChatText(text, clearFn) {
  const v = (text || '').trim()
  if (!v) return
  if (hasSensitive(v)) {
    ElMessage.warning('内容包含敏感词，已拦截')
    clearFn()
    return
  }
  if (!connected.value) {
    ElMessage.warning('实时通道未连接，消息未发送')
    return
  }
  send('chat', { content: v, msgType: 'text' })
  clearFn()
}

function sendMsg() {
  sendChatText(msgInput.value, () => {
    msgInput.value = ''
  })
}

/* ==================== ⑤ 课堂互动 ==================== */

const raceText = computed(() =>
  itx.value?.interType === 'rush' ? (itxDone.value ? '已抢答' : '抢答') : '抢答'
)
const raceDone = computed(() => itx.value?.interType === 'rush' && itxDone.value)
function doRace() {
  if (!itx.value || itx.value.interType !== 'rush') {
    ElMessage.warning('当前没有进行中的抢答 —— 等老师发起后这里会自动可用')
    return
  }
  if (itxDone.value) return
  itxText.value = '抢答'
  submitItx()
}

const voteVisible = ref(false)

const qaVisible = ref(false)
const qaInput = ref('')
function sendQA() {
  const v = qaInput.value.trim()
  if (!v) {
    ElMessage.warning('请先填写问题描述')
    return
  }
  if (hasSensitive(v)) {
    ElMessage.warning('内容包含敏感词，已拦截')
    return
  }
  if (!connected.value) {
    ElMessage.warning('实时通道未连接，问题未发送')
    return
  }
  send('chat', { content: '【提问】' + v, msgType: 'text' })
  qaInput.value = ''
  qaVisible.value = false
  ElMessage.success('问题已发送到课堂消息')
}

const itx = ref(null)
const itxAnswers = ref({})
const itxText = ref('')
const itxDone = ref(false)
const itxSubmitting = ref(false)

const itxTitle = computed(() => (itx.value?.interType === 'quiz' ? '随堂测试' : itx.value ? '课堂互动' : '随堂测试'))
const itxTypeLabel = computed(
  () =>
    ({ quiz: '随堂测试', vote: '投票', rush: '抢答', discuss: '讨论', ask: '提问' }[itx.value?.interType] ||
    '互动')
)

function itxOpts(q) {
  let arr = []
  try {
    arr = JSON.parse(q?.options || '[]')
  } catch {
    arr = []
  }
  if (!Array.isArray(arr) || !arr.length) {
    return q?.qType === 'judge'
      ? [
          { key: '正确', text: '正确' },
          { key: '错误', text: '错误' }
        ]
      : []
  }
  return arr.filter((o) => o && o.key)
}

async function loadInteraction(interactionId) {
  if (!interactionId) return
  try {
    const d = await interactionDetail(SESSION_ID.value, interactionId)
    itx.value = d
    itxText.value = ''
    const ans = {}
    ;(d?.questions || []).forEach((q) => {
      if (q.qType === 'multi') ans[q.questionId] = []
    })
    itxAnswers.value = ans
    itxDone.value = !!d?.answered
    leftSec.value = d?.durationSec || 0
    if (d?.answered) ElMessage.info('你已提交过本次互动')
  } catch {
    itx.value = null
  }
}

async function submitItx() {
  const it = itx.value
  if (!it || itxDone.value || itxSubmitting.value) return
  let answer
  if (it.interType === 'quiz') {
    const list = (it.questions || []).map((q) => {
      const v = itxAnswers.value[q.questionId]
      return {
        questionId: q.questionId,
        answer: Array.isArray(v) ? v.slice().sort().join(',') : String(v || '').trim()
      }
    })
    if (!list.some((x) => x.answer)) {
      ElMessage.warning('请先作答再交卷')
      return
    }
    answer = { answers: list }
  } else {
    const text = itxText.value.trim()
    if (!text) {
      ElMessage.warning('请输入内容再提交')
      return
    }
    answer = { text }
  }
  itxSubmitting.value = true
  try {
    await answerInteraction(SESSION_ID.value, {
      interactionId: it.interactionId,
      interType: it.interType,
      answer
    })
    itxDone.value = true
    ElMessage.success(it.interType === 'quiz' ? '已交卷，等待老师公布结果' : '已提交')
  } catch {
    // 重复提交后端返回 422，拦截器已提示
  } finally {
    itxSubmitting.value = false
  }
}

/* ==================== ⑥ 倒计时 / 在线人数 ==================== */

const viewers = ref(0)
const leftSec = ref(0)
const cd = computed(() => {
  const m = Math.floor(leftSec.value / 60)
  const s = leftSec.value % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
})

/* ==================== ⑦ 本地演示（仅 DEV 且 URL 显式带 mockStage=1） ====================
 * 教师端舞台接口还没上线时，用 `?sessionId=9001&mockStage=1` 验证渲染链路：
 * 真 PDF（public/demo/lecture.pdf，5 页）+ 模拟板书 + 每 4 秒自动翻页。
 * 生产构建里 `import.meta.env.DEV` 为 false，整段会被 tree-shake 掉。
 */
let mockTimer = null

/** 生成一段平滑曲线（归一化坐标） */
function mockStroke(x0, y0, x1, y1, wobble = 0.006, n = 26) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([
      +(x0 + (x1 - x0) * t).toFixed(4),
      +(y0 + (y1 - y0) * t + Math.sin(t * Math.PI * 3) * wobble).toFixed(4)
    ])
  }
  return pts
}

function applyMockStage() {
  // mockStage=blank → 空白画盘模式；其余按课件模式演示
  const blank = route.query.mockStage === 'blank'
  stage.value = blank
    ? {
        mode: 'blank',
        resourceId: null,
        fileName: '',
        fileType: '',
        previewUrl: '',
        pageNo: 1,
        pageCount: 0,
        timeSec: 0
      }
    : {
        mode: 'slide',
        resourceId: 9001,
        fileName: '数据结构-第2章-栈与队列.pdf',
        fileType: 'doc',
        previewUrl: '/demo/lecture.pdf',
        pageNo: 1,
        pageCount: 5,
        timeSec: 0
      }
  boardOps.value = [
    // 标题下划红线
    { opId: 1, tool: 'pen', color: '#ff4d4f', width: 0.004, points: mockStroke(0.16, 0.3, 0.46, 0.3, 0.004) },
    // 黄色荧光笔划重点
    { opId: 2, tool: 'highlighter', color: '#fbbf24', width: 0.012, points: mockStroke(0.15, 0.46, 0.6, 0.46, 0.002, 12) },
    // 手写圈
    {
      opId: 3,
      tool: 'circle',
      color: '#2f6bff',
      width: 0.003,
      points: [
        [0.6, 0.4],
        [0.78, 0.5]
      ]
    },
    // 箭头指向注释
    {
      opId: 4,
      tool: 'arrow',
      color: '#ff4d4f',
      width: 0.003,
      points: [
        [0.63, 0.56],
        [0.7, 0.66]
      ]
    }
  ]
  if (blank) return
  mockTimer = setInterval(() => {
    stage.value = {
      ...stage.value,
      pageNo: (stage.value.pageNo % stage.value.pageCount) + 1
    }
  }, 4000)
}

function stopMock() {
  if (mockTimer) {
    clearInterval(mockTimer)
    mockTimer = null
  }
}

let t1 = null

/**
 * 进入课堂后要拉的一次性数据。
 *
 * ★ 2026-11-09 联调补：原来这段直接写在 onMounted 里，只有「进页面那一刻已有 sessionId」才执行。
 *   但真实场景是「上课前就打开页面」—— 那时 liveState=waiting、SESSION_ID=0，
 *   10 秒轮询到老师开课后才填上 sessionId，课件列表/流程/消息却再也没人拉。
 *   表现为：老师推了课件，学生端因为是空列表而匹配不到，舞台一直空白。
 */
function loadClassData() {
  if (!SESSION_ID.value) return
  // 课件列表：老师下发 slide 时用它反查预览地址；板书由服务端 snapshot 补齐，无需额外拉取
  loadSlides()
  // 上课流程：右栏「上课流程」卡片，老师推进步骤后靠 WS step_advance 增量刷新
  loadSteps()
  // 课堂消息历史：刷新/迟到进课堂时把之前说过的话补回来
  loadChat()
  if (!mockMode) {
    currentInteraction(SESSION_ID.value)
      .then((d) => {
        if (d && d.interactionId) loadInteraction(d.interactionId)
      })
      .catch(() => {})
  }
}

// 轮询把 waiting → live 时 SESSION_ID 才第一次有值，这里兜住
watch(SESSION_ID, (id, old) => {
  if (id && id !== old) loadClassData()
})

/**
 * ★ 2026-11-10 修复：同路由只变 query 时 Vue 会复用组件实例，setup 里的常量不会重算。
 *   现象：从「课程 A 的进入课堂」切到课程 B，或点侧栏「课堂」（无参数）后，
 *   页面仍停留在第一次定位的那节课（例如一直显示「数据结构 · 课堂已结束」，
 *   看不到此刻正在上的课）。这里按 query 重新定位。
 *   SESSION_ID 变化由上面的 watch 触发课件/流程/消息重拉；
 *   舞台通道由 useStageSync 内部 watch(sessionId) 自动重连。
 */
watch(
  () => [sessionIdFromQuery.value, courseFromQuery.value],
  ([sid, cid], [oldSid, oldCid]) => {
    if (sid === oldSid && cid === oldCid) return
    SESSION_ID.value = sid
    liveState.value = 'loading'
    currentClass.value = null
    nextClass.value = null
    currentError.value = ''
    info.value = { course: '—', teacher: '—', room: '—' }
    initCurrentClass().then(() => {
      if (SESSION_ID.value) loadClassData()
    })
  }
)

onMounted(async () => {
  await initCurrentClass()
  startPoll()
  loadClassData()
  if (mockMode) applyMockStage()
  t1 = setInterval(() => {
    if (leftSec.value <= 0) return
    leftSec.value--
    if (leftSec.value === 0 && itx.value?.interType === 'quiz' && !itxDone.value) {
      ElMessage.warning('计时结束，已自动交卷')
      submitItx()
    }
  }, 1000)
})

onUnmounted(() => {
  clearInterval(t1)
  stopPoll()
  stopMock()
})

/* 课堂主通道重连只影响聊天/互动；课件与板书由 useStageSync 自己的退避重连负责 */
</script>

<template>
  <div>
    <!-- ① 判定中 -->
    <div v-if="liveState === 'loading'" v-loading="true" class="live-state-card live-loading" />

    <!-- ② 当前没有课 -->
    <div v-else-if="liveState === 'no_class'" class="live-state-card">
      <div class="ls-icon"><BaseIcon name="monitor-play" :size="30" /></div>
      <h2 class="ls-title">当前没有正在进行的课程</h2>
      <p class="ls-desc">
        {{ nextClass ? '到了上课时间，老师开启课堂后课件会同步到这里' : '本学期暂时没有查到排课记录' }}
      </p>
      <p v-if="currentError" class="ls-desc ls-error">
        <BaseIcon name="alert-triangle" :size="13" />{{ currentError }}
      </p>

      <div v-if="nextClass" class="next-card">
        <div class="next-label">下一节课</div>
        <div class="next-course">{{ nextClass.courseName }}</div>
        <div class="next-meta">
          <span><BaseIcon name="clock" :size="13" />{{ fmtClassTime(nextClass.classTime) }}</span>
          <span v-if="nextClass.periodNo"><BaseIcon name="calendar-days" :size="13" />第 {{ nextClass.periodNo }} 节</span>
          <span v-if="nextClass.classroomName"><BaseIcon name="map-pin" :size="13" />{{ nextClass.classroomName }}</span>
        </div>
        <div class="next-count">{{ countdownText(nextClass.startsInSec) }}</div>
      </div>

      <div class="ls-actions">
        <el-button @click="initCurrentClass(true)"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
        <el-button @click="router.push('/student/schedule')">
          <BaseIcon name="calendar-days" :size="14" />查看课表
        </el-button>
      </div>
      <div class="ls-tip small muted">每 10 秒自动检查一次，老师开课后自动进入课堂</div>
    </div>

    <!-- ③ 有课，但老师还没开启课堂 -->
    <div v-else-if="liveState === 'waiting'" class="live-state-card">
      <div class="ls-icon pulse"><BaseIcon name="radio" :size="28" /></div>
      <h2 class="ls-title">{{ currentClass?.courseName }} · 等待老师开启课堂</h2>
      <p class="ls-desc">
        {{ fmtClassTime(currentClass?.classTime) }}<template v-if="currentClass?.periodNo"> 第 {{ currentClass.periodNo }} 节</template>
        · {{ currentClass?.teacherName || '—' }} · {{ currentClass?.classroomName || '—' }}
      </p>
      <div class="wait-badge"><span class="wdot" />已到上课时间，老师开启后课件会自动出现</div>

      <div class="ls-actions">
        <el-button type="primary" @click="initCurrentClass(true)">
          <BaseIcon name="refresh-cw" :size="14" />立即检查
        </el-button>
        <el-button @click="router.push('/student/schedule')">
          <BaseIcon name="calendar-days" :size="14" />查看课表
        </el-button>
      </div>
      <div class="ls-tip small muted">每 10 秒自动检查一次</div>
    </div>

    <!-- ③-b 该课程最近一节课堂已结束（课程卡入口专用，不连 WS） -->
    <div v-else-if="liveState === 'ended'" class="live-state-card">
      <div class="ls-icon"><BaseIcon name="monitor-play" :size="30" /></div>
      <h2 class="ls-title">{{ currentClass?.courseName || courseNameFromQuery || '该课程' }} · 课堂已结束</h2>
      <p class="ls-desc">这节课老师已经结束授课，实时课件与音频不再同步。可到课程详情查看课件与作业。</p>
      <div class="ls-actions">
        <el-button type="primary" @click="initCurrentClass(true)">
          <BaseIcon name="refresh-cw" :size="14" />检查是否开了新课堂
        </el-button>
        <el-button @click="router.push({ name: 'StuCourseDetail', params: { courseId: courseFromQuery } })">
          <BaseIcon name="arrow-left" :size="14" />返回课程详情
        </el-button>
      </div>
      <div class="ls-tip small muted">老师在本课程开启新课堂后会自动进入</div>
    </div>

    <!-- ④ 课堂主体 -->
    <template v-else>
      <!-- 课堂头卡（紧凑版） -->
      <div class="live-head">
        <div class="between">
          <div>
            <div class="row" style="gap: 10px">
              <h1 class="lh-title">{{ currentClass?.courseName || info.course }} · 实时课堂</h1>
              <span class="live-tag">
                <BaseIcon name="radio" :size="11" />{{ liveState === 'opening' ? '即将开始' : '进行中' }}
              </span>
            </div>
            <div class="lh-sub">
              当前步骤：<b>{{ currentStep }}</b> · {{ info.teacher }} · {{ info.room }}
              <span v-if="currentClass?.classTime" class="lh-time">
                · {{ fmtClassTime(currentClass.classTime) }}<template v-if="currentClass.periodNo"> 第 {{ currentClass.periodNo }} 节</template>
              </span>
              <span class="ws-state" :class="connected ? 'on' : 'off'">
                <i />{{ connected ? '实时通道已连接' : statusText }}
              </span>
            </div>
          </div>
          <div class="row" style="gap: 8px">
            <span class="online-pill"><BaseIcon name="users" :size="13" />{{ viewers }} 人在线</span>
            <el-button
              class="btn-white"
              @click="router.push({ name: 'StuAttendance', query: { sessionId: SESSION_ID } })"
            >
              <BaseIcon name="qr-code" :size="15" />课堂签到
            </el-button>
          </div>
        </div>
      </div>

      <div class="live-main mt16">
        <!-- 左：舞台 -->
        <div class="stage-col">
          <div ref="stageBoxRef" class="stage-box">
            <StageCanvas
              :mode="stageMode"
              :url="stage.previewUrl"
              :file-name="stage.fileName"
              :page-no="stage.pageNo"
              :page-count="stage.pageCount"
              :time-sec="stage.timeSec"
              :playing="stage.playing"
              :playback-rate="stage.playbackRate"
              :server-time-ms="stage.serverTimeMs"
              :clock-offset="stage.clockOffset"
              :ops="boardOps"
              :rev="boardRev"
            />
          </div>

          <!-- 舞台工具条：课堂音频 + 全屏 -->
          <div class="stage-tools">
            <AudioBar
              class="grow"
              :state="audioState"
              :mic-enabled="audioMicEnabled"
              :can-publish="audioCanPublish"
              :blocked="audioBlocked"
              :speaking="audioSpeaking"
              :participants="audioParticipants"
              :network="audioNetwork"
              :error-text="audioError"
              :volume="audioVolume"
              @resume="resumeAudio"
              @toggle-mic="toggleAudioMic"
              @retry="retryAudio"
              @update:volume="setAudioVolume"
            />
            <el-button size="small" @click="toggleFull">
              <BaseIcon name="maximize-2" :size="13" />全屏
            </el-button>
          </div>

          <div class="stage-caption">
            <BaseIcon :name="stageMode === 'slide' ? 'presentation' : stageMode === 'blank' ? 'pencil' : 'info'" :size="13" />
            <span>{{ stageHint }}</span>
            <span v-if="stageMode === 'slide' && stage.pageCount > 0" class="cap-page">
              第 {{ stage.pageNo }} / {{ stage.pageCount }} 页
            </span>
            <span class="cap-tip">{{ stageSyncLabel }}</span>
          </div>
        </div>

        <!-- 右：互动栏 -->
        <aside class="side-col">
          <!-- 本节课件（可点开本地预览；主舞台始终跟随老师，不被学生点击改写） -->
          <el-card shadow="never" class="side-card">
            <div class="between">
              <div class="card-title no-margin">本节课件</div>
            </div>
            <div v-if="slidesError" class="small muted mt8">{{ slidesError }}</div>
            <div v-else-if="!slidesLoaded && slidesLoading" class="small muted mt8">加载中…</div>
            <div v-else-if="!slides.length" class="small muted mt8">本课程还没有上传课件</div>
            <div v-else class="slide-list mt8">
              <div
                v-for="s in slides"
                :key="s.resourceId"
                class="slide-item"
                :class="{ on: Number(stage.resourceId) === Number(s.resourceId) }"
                :title="`点击预览：${s.fileName}`"
                role="button"
                tabindex="0"
                @click="openSlidePeek(s)"
                @keydown.enter.prevent="openSlidePeek(s)"
                @keydown.space.prevent="openSlidePeek(s)"
              >
                <BaseIcon :name="slideIcon(s.fileType)" :size="13" />
                <span class="si-name">{{ s.fileName }}</span>
                <span v-if="Number(stage.resourceId) === Number(s.resourceId)" class="si-meta">展示中</span>
                <span v-else-if="s.weekNum" class="si-meta">第{{ s.weekNum }}周</span>
              </div>
            </div>
            <div class="small muted mt8">
              {{ stage.mode === 'none' ? '老师尚未开始展示，可点击课件自行预览' : '主屏跟随老师实时演示，点击课件可另行预览' }}
            </div>
          </el-card>

          <!-- 课堂消息：与教师端「课堂聊天」同一条流（同表 chat_message）
               ★ 放在第二位：右栏 5 张卡必然超一屏要滚动，课件与消息是学生最常看的两个，
                 其余（流程/测试/互动）次之。 -->
          <el-card shadow="never" class="side-card">
            <div class="between">
              <div class="card-title no-margin">课堂消息</div>
              <span class="small muted">
                {{ connected ? (onlineCount > 0 ? onlineCount + ' 人在线' : '已连接') : '连接中…' }}
              </span>
            </div>
            <div ref="msgBoxRef" class="chat-list mt12">
              <div v-if="!msgs.length" class="small muted">还没有人发言，说点什么吧</div>
              <div v-for="m in msgs" :key="m.messageId" class="chat-item" :class="{ mine: m.mine }">
                <div class="chat-head">
                  <span class="chat-name">{{ m.mine ? '我' : m.senderName }}</span>
                  <span class="chat-time">{{ (m.sendTime || '').slice(11, 16) }}</span>
                </div>
                <div class="chat-text">{{ m.content }}</div>
              </div>
            </div>
            <div class="row mt12" style="gap: 8px">
              <el-input
                v-model="msgInput"
                size="small"
                maxlength="500"
                placeholder="发条消息……（Enter 发送）"
                @keyup.enter="sendMsg"
              />
              <el-button type="primary" size="small" :disabled="!connected" @click="sendMsg">
                <BaseIcon name="send" :size="13" />
              </el-button>
            </div>
          </el-card>

          <!-- 上课流程（教师备课时的上课模板，实时反映推进到第几步） -->
          <el-card shadow="never" class="side-card flow-card">
            <div class="between">
              <div class="card-title no-margin">上课流程</div>
              <span v-if="flow.steps.length" class="small muted">
                {{ flow.currentStepIndex + 1 }} / {{ flow.steps.length }}
              </span>
            </div>
            <div v-if="flow.error" class="small muted mt8">{{ flow.error }}</div>
            <div v-else-if="!flow.loaded && flow.loading" class="small muted mt8">加载中…</div>
            <div v-else-if="!flow.steps.length" class="small muted mt8">老师尚未编排这节课的流程</div>
            <ol v-else class="flow-list mt8">
              <li
                v-for="st in flow.steps"
                :key="st.stepIndex"
                class="flow-item"
                :class="st.state"
              >
                <span class="fi-dot">
                  <BaseIcon v-if="st.state === 'done'" name="check" :size="10" />
                  <template v-else>{{ st.state === 'current' ? '' : st.stepIndex + 1 }}</template>
                </span>
                <div class="fi-main">
                  <div class="fi-name">
                    {{ st.name || stepTypeName(st.type) }}
                    <span v-if="st.state === 'current'" class="fi-now">进行中</span>
                    <span v-else-if="st.overTime === 1" class="fi-over">超时</span>
                  </div>
                  <div class="fi-meta">
                    {{ stepDuration(st) || stepTypeName(st.type) }}
                  </div>
                </div>
              </li>
            </ol>
          </el-card>

          <!-- 随堂测试 / 互动 -->
          <el-card shadow="never" class="side-card">
            <div class="between">
              <div class="card-title no-margin">{{ itxTitle }}</div>
              <el-tag v-if="itx && leftSec > 0" type="warning" effect="light">
                <BaseIcon name="timer" :size="11" />{{ cd }}
              </el-tag>
            </div>

            <template v-if="itx">
              <div class="small muted mt8">
                {{ itxTypeLabel }}<template v-if="itx.title"> · {{ itx.title }}</template>
                <template v-if="itx.interType === 'quiz'"> · {{ itx.questions.length }} 题</template>
              </div>

              <template v-if="itx.interType === 'quiz'">
                <div v-for="(q, i) in itx.questions" :key="q.questionId" class="q-box">
                  <b class="small">{{ i + 1 }}. {{ q.content }}</b>
                  <el-radio-group
                    v-if="q.qType === 'single' || q.qType === 'judge'"
                    v-model="itxAnswers[q.questionId]"
                    class="stack mt8"
                    style="gap: 6px"
                    :disabled="itxDone"
                  >
                    <el-radio v-for="o in itxOpts(q)" :key="o.key" :value="o.key">
                      {{ o.key }}. {{ o.text }}
                    </el-radio>
                  </el-radio-group>
                  <el-checkbox-group
                    v-else-if="q.qType === 'multi'"
                    v-model="itxAnswers[q.questionId]"
                    class="stack mt8"
                    style="gap: 6px"
                    :disabled="itxDone"
                  >
                    <el-checkbox v-for="o in itxOpts(q)" :key="o.key" :value="o.key">
                      {{ o.key }}. {{ o.text }}
                    </el-checkbox>
                  </el-checkbox-group>
                  <el-input
                    v-else
                    v-model="itxAnswers[q.questionId]"
                    placeholder="请输入答案"
                    class="mt8"
                    :disabled="itxDone"
                  />
                </div>
              </template>

              <el-input
                v-else
                v-model="itxText"
                type="textarea"
                :rows="2"
                class="mt8"
                :disabled="itxDone"
                :placeholder="itx.interType === 'rush' ? '点下方按钮抢答' : '输入你的选择（如 A）或观点'"
              />

              <el-button
                type="primary"
                class="w100 mt12"
                :loading="itxSubmitting"
                :disabled="itxDone"
                @click="submitItx"
              >
                {{ itxDone ? '已提交' : itx.interType === 'rush' ? '抢答' : itx.interType === 'quiz' ? '交卷' : '提交' }}
              </el-button>
            </template>

            <div v-else class="small muted mt8">老师尚未发起随堂测试或互动</div>
          </el-card>

          <!-- 课堂互动：抢答 / 投票 / 提问（发言已独立到下方「课堂消息」卡） -->
          <el-card shadow="never" class="side-card">
            <div class="between">
              <div class="card-title no-margin">课堂互动</div>
              <span class="small muted">抢答 / 投票 / 提问</span>
            </div>
            <div class="row mt12 acts">
              <el-button size="small" :type="raceDone ? 'primary' : 'default'" :disabled="raceDone" @click="doRace">
                <BaseIcon name="hand" :size="13" />{{ raceText }}
              </el-button>
              <el-button size="small" @click="voteVisible = true"><BaseIcon name="bar-chart-3" :size="13" />投票</el-button>
              <el-button size="small" @click="qaVisible = true"><BaseIcon name="mic" :size="13" />提问</el-button>
            </div>
            <div class="small muted mt8">老师发起的互动会自动出现在这里，无需手动刷新</div>
          </el-card>
        </aside>
      </div>

      <!-- 课件本地预览（覆盖层，不接管主舞台） -->
      <SlidePeekDialog v-model="peekVisible" :slide="peeking" />

      <!-- 投票 -->
      <el-dialog v-model="voteVisible" title="课堂投票" width="440px">
        <template v-if="itx && itx.interType === 'vote'">
          <div class="small">
            <b>{{ itx.title || '课堂投票' }}</b>
            <span class="small muted"> · 由老师发起</span>
          </div>
          <el-input v-model="itxText" class="mt12" placeholder="输入你的选择（如 A）或观点" :disabled="itxDone" />
          <div v-if="itxDone" class="small muted mt8">已提交，等待老师公布结果</div>
        </template>
        <div v-else class="small muted">当前没有进行中的投票。投票需由老师端发起，发起后这里会自动出现。</div>
        <template #footer>
          <el-button @click="voteVisible = false">关闭</el-button>
          <el-button
            v-if="itx && itx.interType === 'vote'"
            type="primary"
            :loading="itxSubmitting"
            :disabled="itxDone"
            @click="submitItx"
          >
            提交投票
          </el-button>
        </template>
      </el-dialog>

      <!-- 提问 -->
      <el-dialog v-model="qaVisible" title="向老师提问" width="480px">
        <div class="field-label">问题描述</div>
        <el-input v-model="qaInput" type="textarea" :rows="4" placeholder="描述你的问题，老师将在课上或课后解答" />
        <div class="small muted mt12 note">
          <BaseIcon name="shield-check" :size="14" class="ic-brand" />提交内容将经过敏感词过滤；同一问题不会重复推送。
        </div>
        <template #footer>
          <el-button @click="qaVisible = false">取消</el-button>
          <el-button type="primary" @click="sendQA"><BaseIcon name="send" :size="14" />提交问题</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
/* ===== 头卡（沿用原风格，压缩高度） ===== */
.live-head {
  background: linear-gradient(135deg, var(--brand-600), var(--brand-700));
  color: #fff;
  border-radius: var(--r-lg);
  padding: 16px 18px;
}
.lh-title {
  font-size: 18px;
  color: #fff;
  font-weight: 700;
}
.live-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border-radius: 99px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 600;
}
.lh-sub {
  font-size: 12.5px;
  color: var(--brand-100);
  margin-top: 8px;
}
.ws-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 10px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.ws-state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #86efac;
  display: inline-block;
}
.ws-state.off i {
  background: #fca5a5;
}
.btn-white {
  background: #fff;
  color: var(--brand-700);
  border-color: #fff;
}
.online-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}

/* ===== 主区：舞台 + 右栏 ===== */
.live-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 336px;
  gap: 16px;
  align-items: start;
}
.stage-col {
  min-width: 0;
}
.stage-box {
  border-radius: 14px;
  background: #eef1f6;
}
.stage-box:fullscreen {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b1020;
  border-radius: 0;
  padding: 12px;
  /* ★ 2026-11-11 全屏自适应：撑满视口并允许收缩，内部 stage 用 min() 等比缩放 */
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  box-sizing: border-box;
}
.stage-box:fullscreen :deep(.stage-wrap) {
  width: 100%;
  height: 100%;
}
.stage-box:fullscreen :deep(.stage) {
  /* 全屏时去掉 250px 页面预留，改用整个视口高度做上限，舞台铺满且不溢出 */
  max-width: min(100%, calc((100dvh - 24px) * 7 / 5));
  max-height: calc(100dvh - 24px);
  box-shadow: none;
}

.stage-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.stage-tools .grow {
  flex: 1;
  min-width: 0;
}
.stage-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 0 2px;
  font-size: 12px;
  color: #9aa3b2;
}
.cap-page {
  color: #4b5563;
}
.cap-tip {
  margin-left: auto;
}

/* ===== 右栏 ===== */
.side-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}
/*
 * ★ 关键：flex 子项默认 flex-shrink:1，5 张卡总高超过容器时会被等比压缩，
 *   而卡片内部 overflow:hidden —— 表现为「课堂消息」的输入框被裁掉、看不清。
 *   固定不收缩，超出部分交给 .side-col 自己滚动。
 */
.side-col > * {
  flex: 0 0 auto;
}
.side-card :deep(.el-card__body) {
  padding: 14px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 10px;
}

/* ===== 本节课件 ===== */
.slide-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
}
.slide-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  color: #374151;
  cursor: pointer;
  transition: background 0.15s;
}
/* ★ 可点击：点开只是本地预览弹窗，主舞台仍由老师控制 */
.slide-item:hover {
  background: #f2f5fb;
}
.slide-item:focus-visible {
  outline: 2px solid rgba(47, 107, 255, 0.35);
  outline-offset: -1px;
}
.slide-item.on {
  background: #e8f0ff;
  color: #1d4ed8;
}
.si-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-meta {
  flex: none;
  font-size: 11px;
  color: #9aa3b2;
}

/* ===== 课堂消息（对齐教师端「课堂聊天」：发送者 + 时间 + 气泡） ===== */
.chat-list {
  max-height: 220px;
  min-height: 88px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.chat-item {
  padding: 7px 10px;
  border-radius: 8px;
  background: #f7f9fc;
  word-break: break-word;
}
.chat-item.mine {
  background: rgba(47, 107, 255, 0.08);
}
.chat-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}
.chat-name {
  font-size: 11.5px;
  font-weight: 600;
  color: #6b7280;
}
.chat-item.mine .chat-name {
  color: #2559d8;
}
.chat-time {
  flex: none;
  font-size: 10.5px;
  color: #9aa3b2;
}
.chat-text {
  font-size: 12.5px;
  line-height: 1.6;
  color: #374151;
}
.chat-item.mine .chat-text {
  color: #2559d8;
}
/* ===== 上课流程（教师备课的上课模板） ===== */
.flow-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 228px;
  overflow-y: auto;
}
.flow-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  border-radius: 8px;
  color: #6b7280;
}
/* 步骤之间的连接线：与圆点中心对齐 */
.flow-item + .flow-item::before {
  content: '';
  position: absolute;
  left: 16px;
  top: -7px;
  width: 1px;
  height: 14px;
  background: #e5e9f0;
}
.flow-item.current {
  background: #eef4ff;
  color: #1d4ed8;
}
.flow-item.done {
  color: #4b5563;
}
.fi-dot {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  background: #f0f2f6;
  color: #8a94a6;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.flow-item.done .fi-dot {
  background: #d9f5e7;
  color: #059669;
}
.flow-item.current .fi-dot {
  background: #2f6bff;
  box-shadow: 0 0 0 3px rgba(47, 107, 255, 0.15);
}
.flow-item.current .fi-dot::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
}
.fi-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fi-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.flow-item.current .fi-name {
  font-weight: 600;
}
.fi-meta {
  flex: none;
  font-size: 11px;
  color: #9aa3b2;
  line-height: 1.5;
}
.fi-now {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: #2f6bff;
  color: #fff;
  line-height: 16px;
}
.fi-over {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: #fee2e2;
  color: #dc2626;
  line-height: 16px;
}
.q-box {
  padding: 10px 0;
  border-bottom: 1px dashed #eef1f6;
}
.q-box:last-child {
  border-bottom: 0;
}

/* ===== 空状态（沿用原样式） ===== */
.live-state-card {
  background: #fff;
  border-radius: var(--r-lg);
  padding: 44px 24px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}
.live-loading {
  min-height: 320px;
}
.ls-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: var(--brand-50, #eef4ff);
  color: var(--brand-600);
  margin-bottom: 14px;
}
.ls-icon.pulse {
  animation: ls-pulse 2s infinite;
}
@keyframes ls-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(47, 107, 255, 0.25);
  }
  60% {
    box-shadow: 0 0 0 12px rgba(47, 107, 255, 0);
  }
}
.ls-title {
  font-size: 17px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}
.ls-desc {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 6px;
}
.ls-error {
  color: #d97706;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.next-card {
  display: inline-block;
  text-align: left;
  margin: 18px 0 4px;
  padding: 14px 18px;
  border-radius: 12px;
  background: #f7f9fc;
  border: 1px solid #eef1f6;
  min-width: 280px;
}
.next-label {
  font-size: 11.5px;
  color: #9aa3b2;
}
.next-course {
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
  margin: 4px 0 6px;
}
.next-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
}
.next-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.next-count {
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand-600);
}
.ls-actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  justify-content: center;
}
.ls-tip {
  margin-top: 14px;
}
.wait-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #f7f9fc;
  font-size: 12.5px;
  color: #4b5563;
}
.wdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  animation: ls-pulse 1.6s infinite;
}

/* ===== 响应式：窄屏右栏折叠到下方 ===== */
@media (max-width: 1180px) {
  .live-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .side-col {
    max-height: none;
    overflow: visible;
  }
}
</style>
