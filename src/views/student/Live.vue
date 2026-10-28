<script setup>
/**
 * 实时课堂（分支 stu-pc-live）
 * 关联接口（接口设计文档表号）：表 3-13 进入课堂、表 3-15 课堂互动、表 3-16 随堂测试、
 *                              表 6-1 / 6-2 WebSocket 实时通道
 * 对应原型：ui-prototype/pc/student-live.html —— ★ 1:1 还原
 *   （渐变课堂头卡、投屏区(LIVE/延迟/观看人数/全屏/声音)、课堂互动(弹幕·抢答·投票·提问)、
 *    右栏随堂测试(倒计时+3 题)与课堂聊天、投票/提问两个弹窗）
 *
 * 实时通道：已接入 **表 6-1 WebSocket**（`/ws/session/{sessionId}`）——
 *   弹幕跨用户实时同步、在线人数实时更新；心跳 25s / ACK 重发 / 指数退避重连按契约第 6 章实现。
 *   连接不可用时自动降级为本地演示交互（页面仍可用）。
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useClassroomSocket } from '@/composables/useClassroomSocket'
import { useCastSignaling } from '@/composables/useCastSignaling'
import { useUserStore } from '@/store/user'
import {
  signinDetail,
  interactionDetail,
  currentInteraction,
  answerInteraction,
  currentLive
} from '@/api/student/live'

const router = useRouter()
const route = useRoute()

/**
 * 课堂 ID 的来源（★ 2026-10-28 重写）
 *
 * 旧实现写死 9001（数据结构那节课），导致**无论什么时间打开，标题永远是「数据结构」**，
 * 与本时刻真实排课无关。现在改为：
 *   ① URL 带 `?sessionId=xxx` → 联调时强制指定，优先级最高；
 *   ② 否则调 `GET /api/v1/stu/live/current`，按此刻课表 + 老师是否已开课堂决定。
 * 初始为 0（未就绪），拿到值后 `useClassroomSocket` / `useCastSignaling` 的 watch 会自动建连。
 */
const SESSION_ID = ref(Number(route.query.sessionId) || 0)

/** loading | live（老师已开课）| opening（已建课堂待开始）| waiting（有课未开）| no_class（无课） */
const liveState = ref('loading')
/** 此刻这节（或即将开始的）课 */
const currentClass = ref(null)
/** 下一节课（无课时填充空状态，有课时做底部提示） */
const nextClass = ref(null)

/**
 * 课堂信息
 * ★ 2026-10-10：改为从接口取真值。原来写死「高等数学 A / 第 3 章 微分中值定理 / 张老师 / 明德楼 302」，
 *   与库里的实际课堂（数据结构 / 张老师）对不上。
 *   契约里没有「课堂详情」接口，这里用 `GET /sessions/{id}/signin` 返回的
 *   courseName / teacherName / classroomName（实测为真值，已记入差异清单）。
 */
const info = ref({ course: '—', teacher: '—', room: '—' })
/** 当前课堂步骤：由 WebSocket 的 step_advance 事件驱动，接口不提供初始值 */
/* ★ 2026-10-26 实时下行：随堂测试 / 当前互动（供作答入口使用） */

const currentStep = ref('—')

/** 拉取课堂真实信息（课程 / 教师 / 教室）；取不到就保持占位，不编造 */
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

/**
 * 判定「现在该上哪节课」（★ 2026-10-28 新增）
 *
 * 有课且老师已开课堂 → live，连接该 session；
 * 有课但老师还没开   → waiting，页面提示等待，同时显示下一节课；
 * 没课               → no_class，空状态 + 下一节课。
 *
 * 轮询每 10 秒调一次（force），老师一开课堂页面就自动切换，学生不用手动刷新。
 */
const pinnedByUrl = !!Number(route.query.sessionId)

async function initCurrentClass(force = false)
{
  // URL 显式指定 sessionId（联调场景）直接进课堂，不做课表判定
  if (pinnedByUrl) {
    liveState.value = 'live'
    await loadSessionInfo()
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
      // 接口没给课程名时用课表兜底，避免标题显示 '—'
      if ((!info.value.course || info.value.course === '—') && currentClass.value) {
        info.value = {
          course: currentClass.value.courseName || '—',
          teacher: currentClass.value.teacherName || '—',
          room: currentClass.value.classroomName || '—'
        }
      }
    } else {
      // waiting（有课未开）或 no_class
      liveState.value = st === 'waiting' ? 'waiting' : 'no_class'
    }
  } catch {
    liveState.value = 'no_class'
  }
}

/* ---------------- 自动轮询：老师一开课堂，页面自动进入 ---------------- */
let pollTimer = null

function startPoll()
{
  if (pinnedByUrl || pollTimer) return
  pollTimer = setInterval(() => {
    if (liveState.value === 'live' || liveState.value === 'opening') {
      stopPoll()
      return
    }
    initCurrentClass(true)
  }, 10000)
}

function stopPoll()
{
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 课表时间 "2026-10-28 14:30:00" → 今天 14:30 / 明天 14:30 / 10-30 14:30 */
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function fmtClassTime(t)
{
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

/** 距开始还有多久："还有 12 分钟" / "还有 3 小时 20 分" */
function countdownText(sec)
{
  const s = Number(sec)
  if (!Number.isFinite(s)) return ''
  if (s <= 0) return '即将开始'
  if (s < 3600) return `还有 ${Math.max(1, Math.round(s / 60))} 分钟`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `还有 ${h} 小时 ${m} 分` : `还有 ${h} 小时`
}

/* ---------------- 实时通道（表 6-1 WebSocket） ---------------- */

/**
 * ★ 2026-10-10 改为「**不做本地乐观渲染**，一切以服务端广播为准」。
 *   原因：契约表 6-1 的下行 chat payload（messageId/senderId/senderName/content/sendTime）
 *   里**没有 clientMsgId**，客户端无法按 id 丢弃自己的回声；再叠加本地乐观渲染，
 *   同一条消息会在页面上出现 2~3 次（实测过）。
 *   现在：发送 → 服务端入库并广播给全房间（含发送者） → 由 onEvent 统一渲染，
 *   页面消息与服务端完全一致，也去掉了原来那套「15 秒内容窗口去重」的补丁。
 */
const userStore = useUserStore()

/** 弹幕与课堂聊天同属表 6-1 的 chat 通道，收到消息时两个面板一起更新 */
function pushChatMsg(m) {
  danmu.value.push(m)
  chat.value.push(m)
}

const { connected, statusText, onlineCount, send } = useClassroomSocket(SESSION_ID, {
  onEvent(type, payload) {
    switch (type) {
      case 'chat': {
        // 契约表 6-1 下行 payload 字段是 content（不是 text），2026-10-10 修正
        const isMine = !!payload.senderName && payload.senderName === userStore.info?.username
        pushChatMsg({
          who: isMine ? '我' : payload.senderName || '同学',
          text: payload.content,
          mine: isMine
        })
        break
      }
      case 'attendance':
        // ★ 2026-10-26 按《课堂实时通道对接说明 v1.0》：payload = { sessionId, status, late }
        if (payload.status != null) {
          if (payload.late === true) {
            ElMessage.warning('老师已进入课堂 · 你本次签到被记为「迟到」')
          } else {
            ElMessage.info('老师已进入课堂，签到已开启')
          }
        } else if (payload.signedCount != null) {
          // 兼容旧口径（教师端早期版本）
          ElMessage.info(
            `签到更新：已签 ${payload.signedCount}` +
              (payload.shouldCount ? ` / ${payload.shouldCount}` : '') +
              ' 人'
          )
        }
        break
      case 'step_advance':
        if (payload.stepName) currentStep.value = payload.stepName
        break
      case 'quiz_start':
        // payload = { quizId, questionCount, durationSec }；quizId = interaction_record.interaction_id
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
        break
      case 'error':
        ElMessage.error(payload.message || '实时通道错误')
        break
      default:
        break
    }
  }
})

/** 连上实时通道后，观看人数以服务端广播为准（未连接时保留演示值） */
watch(onlineCount, (n) => {
  if (connected.value && n > 0) viewers.value = n
})

/* ---------------- 投屏信令 + WebRTC（表 6-2 /ws/cast/{sessionId}） ---------------- */
const videoRef = ref()
/**
 * ★ 2026-10-28 修正投屏方向：学生 PC 端**只能是接收端**（role 默认 'viewer'）。
 *   此前页面上挂着「共享屏幕」按钮（当初教师端未接入、为了自测链路临时加的），
 *   导致学生也能抓屏发起共享，与「教师共享 → 学生接收」的业务方向相反，现已移除。
 */
const {
  remoteStream,
  castState,
  errorText,
  wsConnected
} = useCastSignaling(SESSION_ID, {
  role: 'viewer',
  onEvent(type) {
    if (type === 'start') ElMessage.info('教师开始共享屏幕')
    if (type === 'stop') ElMessage.info('教师已结束屏幕共享')
    if (type === 'stream') ElMessage.success('已接收教师共享的屏幕')
  }
})

/** 远端流到达后绑定到 <video>（WebRTC 媒体流不能写在模板属性里） */
watch(remoteStream, (stream) => {
  const el = videoRef.value
  if (!el) return
  el.srcObject = stream || null
  if (!stream) return
  // ★ 先静音起步：浏览器只放行「静音自动播放」，播起来后再按声音开关恢复，
  //   否则学生点了「声音」后刷新页面会拿到一个被策略拦住的黑屏。
  el.muted = true
  el.play().then(() => { el.muted = !audioOn.value }).catch(() => {})
})
watch(errorText, (text) => {
  if (text) ElMessage.warning(text)
})

/** 投屏通道状态文案（演示排障用：一眼看出是没连上，还是连上了在等老师共享） */
const castText = computed(() => {
  // ★ 用可选链：万一 composable 的字段因热更新未及时生效而为 undefined，
  //   这里降级成"连接中"即可，绝不能让一个状态文案把整页渲染打断（2026-10-28 白屏事故）。
  if (remoteStream?.value) return '正在接收教师屏幕'
  if (!wsConnected?.value) return '投屏通道连接中…'
  if (castState?.value === 'negotiating') return '已连接 · 协商中…'
  return '投屏通道已连接 · 等待教师共享屏幕'
})

/* ---------------- 投屏 ---------------- */
/** 观看人数：以服务端广播的在线人数为准，未连接时为 0（原来写死 28） */
const viewers = ref(0)
/** 延迟：没有真实来源，显示 '—'（原来随机编 0.8~1.6s） */
const latency = ref('—')
const audioOn = ref(true)
const screenRef = ref()
function toggleFull() {
  const el = screenRef.value
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
    return
  }
  if (el.requestFullscreen) el.requestFullscreen()
}
function toggleAudio() {
  audioOn.value = !audioOn.value
  // ★ 真实作用于 <video>（原来只换图标，点了没效果）
  if (videoRef.value) videoRef.value.muted = !audioOn.value
  ElMessage.success(audioOn.value ? '声音已开启' : '已静音')
}

/* ---------------- 弹幕 / 课堂聊天（敏感词过滤，照原型） ---------------- */
const SENSITIVE = ['垃圾', '傻逼', '作弊']
const hasSensitive = (t) => SENSITIVE.some((w) => t.includes(w))

/** 弹幕列表：★ 2026-10-10 清空原来的 3 条演示弹幕，只显示**真实 WebSocket 收到的消息** */
const danmu = ref([])
const danmuInput = ref('')
/** 弹幕输入框 ref：focusDanmu 真聚焦用 */
const danmuRef = ref(null)

/** 统一的发送逻辑（弹幕 / 课堂聊天共用，都是表 6-1 的 chat 通道） */
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
  // 契约表 6-1：上行 payload 字段是 content（原来是 text，会被后端判「content 不能为空」）
  // 不做本地乐观渲染，等服务端广播回来再渲染（保证与服务端一致，不会重复显示）
  send('chat', { content: v, msgType: 'text' })
  clearFn()
}

/** 互动面板的弹幕发送 */
function sendDanmu() {
  sendChatText(danmuInput.value, () => {
    danmuInput.value = ''
  })
}
function focusDanmu() {
  danmuRef.value?.focus?.()
}

/** 课堂聊天列表：★ 2026-10-10 清空原来的 3 条演示消息，与弹幕共用表 6-1 chat 通道 */
const chat = ref([])
const chatInput = ref('')
function sendChat() {
  sendChatText(chatInput.value, () => {
    chatInput.value = ''
  })
}

/* ---------------- 抢答 ----------------
 * ★ 2026-10-10：删掉原来的随机名次（`Math.random()` 编出「第 2 名 +3 分」并发一条假系统消息）。
 *   后端目前**没有**抢答/互动的下行广播（经理版 WS 只广播 chat），也没有「当前互动」查询接口，
 *   所以这里只能如实提示「需教师发起互动」。
 */
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

/* ---------------- 投票 ----------------
 * 同上：没有后端支持，弹窗内不再放假的选项与假的百分比。
 */
const voteVisible = ref(false)

/* ---------------- 提问 ---------------- */
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
  // 走表 6-1 chat 通道（老师可在课堂消息里看到）
  send('chat', { content: '【提问】' + v, msgType: 'text' })
  qaInput.value = ''
  qaVisible.value = false
  ElMessage.success('问题已发送到课堂消息')
}

/* ---------------- ★ 2026-10-27 课堂互动（教师发起 → 下行 → 拉详情 → 作答） ----------------
 * 之前这里是一组静态假题、抢答/投票按钮只弹「后端未实现」。
 * 现在：quiz_start / interact 到达后调 /stu/sessions/{id}/interactions/{iid} 取题，
 * 作答走 student-mp 既有契约 POST /api/v1/sessions/{id}/interactions。
 */
const itx = ref(null)
const itxAnswers = ref({})
const itxText = ref('')
const itxDone = ref(false)
const itxSubmitting = ref(false)

const itxTitle = computed(() => (itx.value?.interType === 'quiz' ? '随堂测试' : '课堂互动'))
const itxTypeLabel = computed(
  () =>
    ({ quiz: '随堂测试', vote: '投票', rush: '抢答', discuss: '讨论', ask: '提问' }[itx.value?.interType] ||
    '互动')
)

/** 选项解析：兼容 options 为空（判断题合成 正确/错误） */
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

/* ---------------- 倒计时 + 观看人数/延迟 ----------------
 * ★ 2026-10-10：
 *   · 倒计时改为 0 起（没有真实测试就不该跑秒；有测试时由交互事件驱动，当前后端无此能力）
 *   · 删掉「观看人数 28 ± 随机」与「延迟 0.8~1.6s 随机」两个**假指标**：
 *     人数以 WS 广播的 onlineCount 为准（连接前为 0），延迟没有真实来源显示 '—'
 */
const leftSec = ref(0)
const cd = computed(() => {
  const m = Math.floor(leftSec.value / 60)
  const s = leftSec.value % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
})
let t1 = null
let t2 = null
onMounted(async () => {
  // ★ 2026-10-28 先判定「此刻该上哪节课」，拿到 sessionId 后 socket / cast 的 watch 会自动建连
  await initCurrentClass()
  startPoll()
  // ★ 2026-10-27 刷新后恢复进行中的互动（只靠 WS 推送的话刷新就丢了）
  if (SESSION_ID.value) {
    currentInteraction(SESSION_ID.value)
      .then((d) => {
        if (d && d.interactionId) loadInteraction(d.interactionId)
      })
      .catch(() => {})
  }
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
  clearInterval(t2)
  stopPoll()
})
</script>

<template>
  <div>
    <!-- ① 判定中 -->
    <div v-if="liveState === 'loading'" v-loading="true" class="live-state-card live-loading" />

    <!-- ② 当前没有课：给完整空状态，并提示下一节课 -->
    <div v-else-if="liveState === 'no_class'" class="live-state-card">
      <div class="ls-icon"><BaseIcon name="monitor-play" :size="30" /></div>
      <h2 class="ls-title">当前没有正在进行的课程</h2>
      <p class="ls-desc">
        {{ nextClass ? '到了上课时间，老师开启课堂后这里会自动出现直播画面' : '本学期暂时没有查到排课记录' }}
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
      <div class="wait-badge"><span class="wdot" />已到上课时间，老师开启后画面会自动出现</div>

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

    <!-- ④ 课堂主体（live=老师已开课 / opening=已建课堂待开始） -->
    <template v-else>
      <!-- 课堂头卡 -->
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
          <el-button
            class="btn-white"
            @click="router.push({ name: 'StuAttendance', query: { sessionId: SESSION_ID } })"
          >
            <BaseIcon name="qr-code" :size="15" />课堂签到
          </el-button>
        </div>
      </div>

      <div class="two-col mt16">
        <div class="stack">
          <!-- 投屏 -->
          <el-card shadow="never" class="no-pad">
            <div ref="screenRef" class="screen">
              <!-- 远端流到达：播放真实投屏画面 -->
              <video
                v-if="remoteStream"
                ref="videoRef"
                class="cast-video"
                autoplay
                playsinline
                muted
              />
              <!-- 尚无流：占位画面 -->
              <template v-else>
                <div class="tl">
                  <span class="live-badge"><i />LIVE</span>
                  <span class="ch-tag">{{ info.course }}</span>
                </div>
                <div class="tr">{{ '延迟 ' + latency }}</div>
                <BaseIcon name="monitor-play" :size="40" />
                <div>{{ castText }}</div>
                <div class="small screen-tip">
                  学生端为接收方 · 由教师发起屏幕共享{{
                    castState === 'negotiating' ? ' · 协商中…' : ''
                  }}
                </div>
              </template>
            </div>
            <div class="between screen-foot">
              <span class="row small"><BaseIcon name="users" :size="14" class="ic-brand" /><b>{{ viewers }}</b> 人正在观看</span>
              <span class="row" style="gap: 8px">
                <el-button size="small" @click="toggleFull"><BaseIcon name="maximize-2" :size="13" />全屏</el-button>
                <el-button size="small" @click="toggleAudio">
                  <BaseIcon :name="audioOn ? 'volume-2' : 'volume-x'" :size="13" />{{ audioOn ? '声音' : '已静音' }}
                </el-button>
              </span>
            </div>
          </el-card>

          <!-- 课堂互动 -->
          <el-card shadow="never">
            <div class="between">
              <div class="card-title no-margin">课堂互动</div>
              <span class="small muted">互动开关由教师控制 · 当前已开启<b> 弹幕 / 抢答 / 投票</b></span>
            </div>
            <div class="row mt12 acts">
              <el-button :type="raceDone ? 'primary' : 'default'" :disabled="raceDone" @click="doRace">
                <BaseIcon name="hand" :size="14" />{{ raceText }}
              </el-button>
              <el-button @click="voteVisible = true"><BaseIcon name="bar-chart-3" :size="14" />投票</el-button>
              <el-button @click="focusDanmu"><BaseIcon name="message-circle" :size="14" />讨论</el-button>
              <el-button @click="qaVisible = true"><BaseIcon name="mic" :size="14" />提问</el-button>
            </div>
            <div class="row mt12" style="gap: 10px">
              <el-input
                ref="danmuRef"
                v-model="danmuInput"
                placeholder="发送弹幕 / 提问……（敏感词自动过滤）"
                @keyup.enter="sendDanmu"
              />
              <el-button type="primary" @click="sendDanmu"><BaseIcon name="send" :size="14" />发送</el-button>
            </div>
            <div class="dm mt12">
              <div v-if="!danmu.length" class="small muted">暂无弹幕，发一条试试</div>
              <div v-for="(d, i) in danmu" :key="i" class="dm-item" :class="{ mine: d.mine }">
                <b>{{ d.who }}：</b>{{ d.text }}
              </div>
            </div>
          </el-card>
        </div>

        <div class="stack">
          <!-- ★ 2026-10-27 课堂互动（quiz_start / interact 下行 → 拉详情 → 页面作答） -->
          <el-card shadow="never">
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

              <!-- 随堂测试：逐题作答 -->
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

              <!-- 投票 / 抢答 / 讨论 / 提问：文本作答 -->
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

            <div v-else class="small muted mt8">教师尚未发起互动（随堂测试 / 投票 / 抢答）</div>
          </el-card>

          <!-- 课堂聊天 -->
          <el-card shadow="never">
            <div class="card-title">课堂聊天</div>
            <div class="chatbox">
              <div v-if="!chat.length" class="small muted">暂无消息</div>
              <div v-for="(c, i) in chat" :key="i" class="small"><b>{{ c.who }}：</b>{{ c.text }}</div>
            </div>
            <div class="row mt12" style="gap: 8px">
              <el-input v-model="chatInput" placeholder="发送消息…" @keyup.enter="sendChat" />
              <el-button type="primary" size="small" @click="sendChat"><BaseIcon name="send" :size="14" /></el-button>
            </div>
          </el-card>
        </div>
      </div>

      <!-- 投票 -->
      <el-dialog v-model="voteVisible" title="课堂投票" width="440px">
        <template v-if="itx && itx.interType === 'vote'">
          <div class="small">
            <b>{{ itx.title || '课堂投票' }}</b>
            <span class="small muted"> · 由老师发起</span>
          </div>
          <el-input
            v-model="itxText"
            class="mt12"
            placeholder="输入你的选择（如 A）或观点"
            :disabled="itxDone"
          />
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
.live-head {
  background: linear-gradient(135deg, var(--brand-600), var(--brand-700));
  color: #fff;
  border-radius: var(--r-lg);
  padding: 18px;
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
/* 实时通道连接状态（表 6-1） */
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
.two-col {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  align-items: start;
}
.no-pad :deep(.el-card__body) {
  padding: 0;
}
.cast-video {
  width: 100%;
  min-height: 300px;
  object-fit: contain;
  background: #000;
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  display: block;
}
.screen {
  position: relative;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--r-lg) var(--r-lg) 0 0;
}
.tl {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--error);
  color: #fff;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 700;
}
.live-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  display: inline-block;
}
.ch-tag {
  background: rgba(15, 23, 42, 0.55);
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  color: #fff;
}
.tr {
  position: absolute;
  top: 12px;
  right: 12px;
  font-size: 11.5px;
  opacity: 0.85;
}
.screen-tip {
  opacity: 0.7;
}
.screen-foot {
  padding: 11px 14px;
  border-top: 1px solid var(--border);
}
.ic-brand {
  color: var(--brand-600);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.acts {
  flex-wrap: wrap;
  gap: 10px;
}
.dm {
  max-height: 150px;
  overflow-y: auto;
  background: var(--bg-subtle);
  border-radius: var(--r-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dm-item {
  font-size: 12.5px;
  color: var(--ink-700);
}
.dm-item.mine {
  background: var(--primary-softer);
  border-radius: 6px;
  padding: 2px 6px;
}
.q-box {
  background: var(--bg-subtle);
  border-radius: var(--r-md);
  padding: 12px;
  margin-top: 12px;
}
.q-box :deep(.el-radio) {
  display: flex;
  height: auto;
  margin-right: 0;
}
.chatbox {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vote-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px 14px;
  cursor: pointer;
  transition: 0.15s;
}
.vote-opt:hover,
.vote-opt.voted {
  border-color: var(--brand-400);
  background: var(--primary-softer);
}
.vote-opt .nm {
  flex: none;
  font-size: 13.5px;
}
.vote-opt .bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-soft);
  overflow: hidden;
}
.vote-opt .bar i {
  display: block;
  height: 100%;
  background: var(--brand-500);
  border-radius: 4px;
  transition: width 0.3s;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}
.note {
  display: flex;
  gap: 6px;
  align-items: center;
}
.w100 {
  width: 100%;
}
.mt12 {
  margin-top: 12px;
}
.mt8 {
  margin-top: 8px;
}
@media (max-width: 1100px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}

/* ==================== ★ 2026-10-28 课堂四态（加载 / 无课 / 等待开课） ==================== */
.lh-time {
  opacity: 0.85;
}
.live-state-card {
  background: #fff;
  border: 1px solid var(--line, #e2e8f0);
  border-radius: var(--r-lg, 12px);
  padding: 44px 24px 32px;
  text-align: center;
  min-height: 320px;
}
.live-loading {
  min-height: 300px;
}
.ls-icon {
  width: 66px;
  height: 66px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0fdfa;
  color: #0d9488;
}
.ls-icon.pulse {
  animation: lsPulse 2s ease-in-out infinite;
}
@keyframes lsPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(13, 148, 136, 0.28);
  }
  50% {
    box-shadow: 0 0 0 12px rgba(13, 148, 136, 0);
  }
}
.ls-title {
  font-size: 19px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 8px;
}
.ls-desc {
  font-size: 13px;
  color: #64748b;
  margin: 0 0 20px;
  line-height: 1.7;
}
.next-card {
  max-width: 420px;
  margin: 0 auto 20px;
  padding: 16px 18px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  text-align: left;
}
.next-label {
  font-size: 11px;
  font-weight: 600;
  color: #0d9488;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.next-course {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}
.next-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: #64748b;
}
.next-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.next-count {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #0d9488;
}
.ls-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 14px;
}
.ls-tip {
  margin-top: 4px;
}
.wait-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 99px;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 13px;
  margin-bottom: 22px;
}
.wdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0d9488;
  animation: lsBlink 1.4s ease-in-out infinite;
}
@keyframes lsBlink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
