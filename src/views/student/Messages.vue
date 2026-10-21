<script setup>
/**
 * 消息（分支 stu-pc-message）
 * 关联接口（接口设计文档表号）：表 2-10 会话列表、表 2-11 发送消息、表 2-12 消息记录
 * 对应原型：ui-prototype/pc/student-messages.html —— ★ 1:1 还原
 *   （左侧会话列表 + 右侧聊天窗：系统提示、左右气泡、时间、输入区带图片/附件工具）
 *
 * ★ 2026-10-10 接入真实接口。原实现用原型演示数据（CONVS），现改为读后端，并修正 3 处与契约不符的 bug：
 *   ① convType 判断写成 `=== 'group'` —— 契约（表 2-10）取值是 **direct / course_group / system**，
 *      导致课程群永远被显示成「课程答疑」；
 *   ② 会话时间读 `c.lastTime` —— 契约字段是 **`c.lastMessageTime`**，导致列表右侧时间恒为空；
 *   ③ `title` 为空时硬编码兜底成 `'?'` —— 实测 direct 会话后端 title 为 null（见下方「待后端补」），
 *      页面于是显示成「?」。现改为按 convType 给出可读名称，绝不再出现问号。
 *
 * ⚠️ 待后端（M-A/M-E 公共域）补齐（已实测，非前端可解）：
 *   GET /api/v1/conversations 的 `title` 与 `lastMessage` 返回 **null**（契约表 2-10 要求返回），
 *   `unreadCount` 恒为 0。后端 ConversationMapper.xml 里已有注释自认：
 *   「lastMessage 与 unreadCount 为扩展字段…当前暂未映射，分别返回 null 与 0」。
 *   → direct 会话的 `title` 应由后端解析成**对方昵称**（如「李老师」），前端拿不到对方姓名。
 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import ReportDialog from '@/components/business/ReportDialog.vue'
import { useUserStore } from '@/store/user'
import {
  conversationList,
  messageHistory,
  sendMessage,
  deleteTarget,
  createConversation,
  recallMessage,
  updateConvSettings,
  conversationPrefs,
  forwardMessage
} from '@/api/student/message'
import { myCourses, courseContacts } from '@/api/student/course'
import { uploadFile } from '@/api/auth'

const router = useRouter()
const userStore = useUserStore()

/** 契约表 2-10 convType 取值 → 中文标签 */
const CONV_TAG = { direct: '课程答疑', course_group: '课程群', system: '通知' }
/** 无 title 时的兜底名称（按类型给可读文案，不用 '?'） */
const CONV_FALLBACK = { direct: '一对一私聊', course_group: '课程群', system: '系统通知' }

const convs = ref([])
const cur = ref(null)
const kw = ref('')
const input = ref('')
const bodyRef = ref()
const loading = ref(false)
const sending = ref(false)

/** 我自己的 userId（来自 GET /users/me，用于判断气泡左右） */
const myId = computed(() => userStore.info?.userId)

const unreadTotal = () => convs.value.reduce((s, c) => s + (c.unread || 0), 0)
const shownConvs = computed(() => convs.value.filter((x) => !kw.value || x.name.includes(kw.value)))

/** 后端时间 → 列表用短时间：今天 14:20 / 昨天 / 10/08 */
function fmtTime(t) {
  if (!t) return ''
  const s = String(t).trim()
  // 带时区（Z / +08:00）直接交给 Date；否则按「本地时间」解析（Safari 不吃 yyyy-MM-dd HH:mm:ss）
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s)
    : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s
  const now = new Date()
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return hm
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return '昨天'
  return String(d.getMonth() + 1) + '/' + String(d.getDate())
}

/** 表 2-10 会话 → 页面结构（映射成原型同款字段，模板不用改） */
function mapConv(c) {
  const name = c.title || c.className || CONV_FALLBACK[c.convType] || '会话'
  return {
    id: c.conversationId,
    name,
    tag: CONV_TAG[c.convType] || '会话',
    sub: c.messageCount > 0 ? '最后消息 ' + fmtTime(c.lastMessageTime) : '暂无消息',
    avatar: name.slice(0, 1),
    time: fmtTime(c.lastMessageTime),
    unread: c.unreadCount || 0,
    last: c.lastMessage || '',
    pinned: Number(c.isPinned ?? c.is_pinned) === 1 || c.pinned === true,
    muted: Number(c.isMuted ?? c.is_muted) === 1 || c.muted === true,
    msgs: null, // null = 尚未加载（首次点开才拉记录）
    loaded: false
  }
}

/** 时间字符串 → 毫秒时间戳（兼容 ISO / yyyy-MM-dd HH:mm） */
function parseTs(t) {
  if (!t) return 0
  const s0 = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s0)
    ? new Date(s0)
    : new Date(s0.replace('T', ' ').replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

/** 日期分组标签：今天 / 昨天 / 10月12日（聊天记录按天分隔） */
function dayTag(t) {
  if (!t) return ''
  const s0 = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s0)
    ? new Date(s0)
    : new Date(s0.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return '今天'
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return '昨天'
  return d.getMonth() + 1 + '月' + d.getDate() + '日'
}

/** 表 2-12 消息 → 气泡结构（保留 id/senderId 供举报/撤回/删除；day 供日期分隔） */
function mapMsg(m) {
  const day = dayTag(m.sendTime)
  if (Number(m.isRecalled) === 1) return { who: 'sys', text: '该消息已被撤回', id: m.messageId, day }
  const mine = myId.value != null && m.senderId === myId.value
  const base = {
    who: mine ? 'me' : 'other',
    time: fmtTime(m.sendTime),
    day,
    ts: parseTs(m.sendTime),
    replyToId: m.replyToId || m.reply_to_id || null,
    sender: mine ? '' : m.senderName || '',
    id: m.messageId,
    senderId: m.senderId
  }
  // ★ 2026-10-20 图片 / 文件消息：真渲染（此前只显示文字占位）
  if (m.msgType === 'image') {
    return { ...base, type: 'image', url: m.fileUrl || '', text: '[图片]' }
  }
  if (m.msgType === 'file') {
    return {
      ...base,
      type: 'file',
      url: m.fileUrl || '',
      name: m.fileName || '文件',
      size: m.fileSize,
      text: '[文件] ' + (m.fileName || '')
    }
  }
  return { ...base, text: m.content || '' }
}

/** 连续消息：与上一条同人、同天 → 不重复显示头像并收紧间距（微信/学习通风格） */
function isCont(i) {
  const list = cur.value?.msgs || []
  const m = list[i]
  if (!m || m.who === 'sys') return false
  const prev = list[i - 1]
  return !!prev && prev.who === m.who && prev.day === m.day
}

/** 按天分隔：当前条与上一条的日期标签不同则显示分隔线 */
function showDay(i) {
  const list = cur.value?.msgs || []
  const m = list[i]
  if (!m?.day) return false
  if (i === 0) return true
  return list[i - 1]?.day !== m.day
}

/* ---------------- 消息本地删除（仅本人可见，localStorage 记录隐藏） ---------------- */
const HIDDEN_PREFIX = 'itap_msg_hidden_'
function hiddenOf(convId) {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_PREFIX + convId) || '[]')
  } catch {
    return []
  }
}
function hideLocal(convId, msgId) {
  const arr = hiddenOf(convId)
  if (!arr.includes(msgId)) arr.push(msgId)
  localStorage.setItem(HIDDEN_PREFIX + convId, JSON.stringify(arr))
}
function deleteLocal(m) {
  if (!cur.value?.id || !m?.id) return
  hideLocal(cur.value.id, m.id)
  cur.value.msgs = (cur.value.msgs || []).filter((x) => x.id !== m.id)
  ElMessage.success('已删除（仅对你可见）')
}
async function copyMsg(m) {
  const v = m.type === 'image' ? m.url : m.type === 'file' ? m.name + ' ' + m.url : m.text
  try {
    await navigator.clipboard.writeText(v || '')
    ElMessage.success('已复制')
  } catch {
    ElMessage.info('复制失败，请手动选择文本')
  }
}

/* ---------------- 撤回消息（POST /api/v1/messages/{id}/recall，24h 内） ---------------- */
async function recallMsg(m) {
  try {
    await ElMessageBox.confirm('撤回后对方将看到「该消息已被撤回」，确定撤回？', '撤回消息', {
      confirmButtonText: '撤回',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    await recallMessage(m.id)
    ElMessage.success('已撤回')
    await loadMessages(cur.value, true)
  } catch {
    // 非本人/超时/已撤回由拦截器提示
  }
}

/* ---------------- ★ 2026-10-21 清空聊天记录（仅本机，微信同款语义） ---------------- */
function clearedAtOf(convId) {
  return Number(localStorage.getItem('itap_msg_cleared_' + convId) || 0)
}
async function clearHistory(c) {
  try {
    await ElMessageBox.confirm(
      '清空后仅影响本机显示，对方与服务器记录不受影响。确定清空？',
      '清空聊天记录',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  localStorage.setItem('itap_msg_cleared_' + c.id, String(Date.now()))
  if (cur.value && cur.value.id === c.id) cur.value.msgs = []
  ElMessage.success('已清空聊天记录')
}

/* ---------------- ★ 2026-10-21 会话菜单：置顶 / 免打扰 / 清空 / 删除 ---------------- */
async function convCmd(cmd, c) {
  if (cmd === 'delete') {
    delConv(c)
    return
  }
  if (cmd === 'clear') {
    clearHistory(c)
    return
  }
  try {
    if (cmd === 'pin' || cmd === 'unpin') {
      const v = cmd === 'pin'
      await updateConvSettings(c.id, { pinned: v })
      c.pinned = v
      convs.value = [...convs.value].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      ElMessage.success(v ? '已置顶会话' : '已取消置顶')
    } else if (cmd === 'mute' || cmd === 'unmute') {
      const v = cmd === 'mute'
      await updateConvSettings(c.id, { muted: v })
      c.muted = v
      ElMessage.success(v ? '已开启消息免打扰' : '已关闭消息免打扰')
    }
  } catch {
    // 403/404 由拦截器提示
  }
}

/* ---------------- ★ 2026-10-21 引用回复（后端 SendMessageRequest.replyToId 已支持） ---------------- */
const replyTo = ref(null)
function startReply(m) {
  if (m.type) return
  replyTo.value = m
  requestAnimationFrame(() => taRef.value?.focus?.())
}
function cancelReply() {
  replyTo.value = null
}
/** 引用块文案：从当前消息列表找被引用那条（找不到则兜底） */
function quoteOf(m) {
  const src = (cur.value?.msgs || []).find((x) => x.id === m.replyToId)
  if (!src) return '引用的消息'
  const t =
    src.type === 'image' ? '[图片]' : src.type === 'file' ? '[文件] ' + (src.name || '') : src.text || ''
  return t.length > 40 ? t.slice(0, 40) + '…' : t
}

/* ---------------- ★ 2026-10-21 转发消息 ---------------- */
const forwardVisible = ref(false)
const forwardMsg = ref(null)
const forwardTargetId = ref(null)
const forwarding = ref(false)
/** 目标候选：除当前会话外的会话 */
const forwardCandidates = computed(() =>
  convs.value.filter((c) => !cur.value || c.id !== cur.value.id)
)

function openForward(m) {
  forwardMsg.value = m
  forwardTargetId.value = forwardCandidates.value[0]?.id ?? null
  forwardVisible.value = true
}
async function doForward() {
  if (!forwardMsg.value?.id || !forwardTargetId.value) return
  forwarding.value = true
  try {
    await forwardMessage(forwardMsg.value.id, forwardTargetId.value)
    ElMessage.success('已转发')
    forwardVisible.value = false
    if (cur.value && cur.value.id === forwardTargetId.value) {
      await loadMessages(cur.value, true)
      scrollBottom()
    }
  } catch {
    // 403/404 由拦截器提示
  } finally {
    forwarding.value = false
  }
}

/* ---------------- 发起会话（课程联系人：老师 + 同班同学） ---------------- */
const newVisible = ref(false)
const contactCourses = ref([])
const contactCourseId = ref(null)
const contacts = ref([])
const contactLoading = ref(false)
const contactKw = ref('')
const starting = ref(false)

const shownContacts = computed(() => {
  const k = contactKw.value.trim()
  if (!k) return contacts.value
  return contacts.value.filter((c) => (c.nickName || '').includes(k) || (c.userName || '').includes(k))
})
const teacherContacts = computed(() => shownContacts.value.filter((c) => c.roleName === 'teacher'))
const studentContacts = computed(() => shownContacts.value.filter((c) => c.roleName === 'student'))

async function openNew() {
  newVisible.value = true
  contactKw.value = ''
  contacts.value = []
  try {
    const d = await myCourses()
    const arr = Array.isArray(d) ? d : d?.list || []
    contactCourses.value = arr.map((c) => ({ id: c.courseId, name: c.courseName }))
    if (contactCourses.value.length) {
      contactCourseId.value = contactCourses.value[0].id
      loadContacts()
    }
  } catch {
    contactCourses.value = []
  }
}
async function loadContacts() {
  if (!contactCourseId.value) return
  contactLoading.value = true
  try {
    const d = await courseContacts(contactCourseId.value)
    contacts.value = Array.isArray(d) ? d : d?.list || []
  } catch {
    contacts.value = []
  } finally {
    contactLoading.value = false
  }
}
async function startChat(c) {
  if (starting.value) return
  starting.value = true
  try {
    const r = await createConversation({ targetUserId: c.userId, convType: 'direct' })
    ElMessage.success(r?.created === false ? '已有会话，已打开' : '会话已创建')
    newVisible.value = false
    await load()
    const conv = convs.value.find((x) => x.id === r?.conversationId)
    if (conv) {
      cur.value = conv
      await loadMessages(conv)
      scrollBottom()
    }
  } catch {
    // 403/400 由拦截器提示
  } finally {
    starting.value = false
  }
}

async function scrollBottom() {
  await nextTick()
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
}

/** 表 2-12 拉某个会话的消息记录 */
async function loadMessages(c, force = false) {
  if (!c || (c.loaded && !force)) return
  try {
    const d = await messageHistory(c.id)
    const hidden = hiddenOf(c.id)
    const cleared = clearedAtOf(c.id)
    c.msgs = (d?.list || [])
      .map(mapMsg)
      .filter((x) => !hidden.includes(x.id) && (!cleared || x.ts > cleared))
    c.loaded = true
  } catch {
    c.msgs = c.msgs || []
    ElMessage.error('消息记录加载失败')
  }
}

async function pickConv(c) {
  cur.value = c
  c.unread = 0
  await loadMessages(c)
  scrollBottom()
}

async function send() {
  const v = input.value.trim()
  if (!v || !cur.value || sending.value) return
  sending.value = true
  try {
    const body = { msgType: 'text', content: v }
    if (replyTo.value?.id) body.replyToId = replyTo.value.id
    await sendMessage(cur.value.id, body)
    input.value = ''
    replyTo.value = null
    autoGrow()
    // 以服务端为准重载该会话记录
    await loadMessages(cur.value, true)
    cur.value.last = v
    cur.value.time = fmtTime(new Date())
    atBottom.value = true
    scrollBottom()
  } catch {
    ElMessage.error('发送失败，请稍后重试')
  } finally {
    sending.value = false
  }
}

/* ---------------- ★ 2026-10-20 聊天输入增强 ----------------
 * 快捷短语（学习通同款）、Enter 发送 / Shift+Enter 换行、输入框自动增高、
 * 字数上限 2000、离开底部时出现「回到底部」浮钮。
 */
const QUICK_REPLIES = ['收到', '稍等我看下', '好的，谢谢老师', '马上到']
const taRef = ref(null)
const atBottom = ref(true)

function fillQuick(t) {
  input.value = (input.value ? input.value + ' ' : '') + t
  requestAnimationFrame(() => {
    taRef.value?.focus?.()
    autoGrow()
  })
}
function autoGrow() {
  const el = taRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 96) + 'px'
}
function onBodyScroll() {
  const el = bodyRef.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
function backToBottom() {
  const el = bodyRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  atBottom.value = true
}

/* ---------------- ★ 2026-10-20 图片 / 文件消息（本地存储已启用） ---------------- */
function fmtSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}
function openImg(url) {
  if (url) window.open(url, '_blank')
}

/** 选择并上传文件 → 以 image / file 类型发送消息 */
function chooseAndSend(accept, kind) {
  if (!cur.value || sending.value) return
  const el = document.createElement('input')
  el.type = 'file'
  if (accept) el.accept = accept
  el.onchange = async () => {
    const f = el.files?.[0]
    if (!f) return
    if (f.size > 20 * 1024 * 1024) {
      ElMessage.warning('单个文件不能超过 20MB')
      return
    }
    sending.value = true
    try {
      const up = await uploadFile(f)
      await sendMessage(cur.value.id, {
        msgType: kind,
        content: '',
        fileUrl: up?.url || '',
        fileName: up?.fileName || f.name,
        fileSize: up?.size ?? f.size
      })
      await loadMessages(cur.value, true)
      cur.value.time = fmtTime(new Date())
      atBottom.value = true
      scrollBottom()
    } catch {
      ElMessage.error('上传失败，请重试')
    } finally {
      sending.value = false
    }
  }
  el.click()
}
function pickImg() {
  chooseAndSend('image/*', 'image')
}
function pickFile() {
  chooseAndSend('', 'file')
}

/* ---------------- 举报消息（stu-pc 模块 POST /api/v1/reports） ---------------- */
const reportVisible = ref(false)
const reportMsg = ref(null)
function openReport(m) {
  if (!m?.id) return
  reportMsg.value = m
  reportVisible.value = true
}
const reportLabel = computed(() => {
  if (!reportMsg.value) return ''
  const who = reportMsg.value.sender || (cur.value ? cur.value.name : '对方')
  const t = reportMsg.value.text || ''
  return `${who}：${t.length > 60 ? t.slice(0, 60) + '…' : t}`
})

/* ---------------- 删除会话（本人退出，POST /api/v1/messages/delete） ---------------- */
async function delConv(c) {
  try {
    await ElMessageBox.confirm(
      `确定删除与「${c.name}」的会话？删除后该会话与消息对其他人保留。`,
      '删除会话',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await deleteTarget({ targetType: 'conversation', targetId: c.id })
    ElMessage.success('会话已删除')
    if (cur.value && cur.value.id === c.id) cur.value = null
    await load()
  } catch {
    // 403 越权等由拦截器提示
  }
}

async function load() {
  loading.value = true
  try {
    // 刷新页面后 Pinia 里可能还没有用户信息（判断气泡左右要用 userId）
    if (!userStore.info) {
      try {
        await userStore.fetchInfo()
      } catch {
        /* 拿不到就退化为全部靠右显示，不阻塞会话列表 */
      }
    }
    // ★ 2026-10-21 会话列表（M-E）不返回置顶/免打扰 → 并发拉本模块只读补充并合并
    const [d, prefs] = await Promise.all([
      conversationList(),
      conversationPrefs().catch(() => [])
    ])
    const prefMap = new Map(
      (Array.isArray(prefs) ? prefs : prefs?.list || []).map((p) => [p.conversationId, p])
    )
    const toBool = (v) => v === true || Number(v) === 1
    convs.value = (d?.list || [])
      .map(mapConv)
      .map((c) => {
        const p = prefMap.get(c.id)
        if (p) {
          c.pinned = toBool(p.pinned)
          c.muted = toBool(p.muted)
        }
        return c
      })
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    if (convs.value.length) {
      cur.value = convs.value[0]
      cur.value.unread = 0
      await loadMessages(cur.value)
    } else {
      cur.value = null
    }
  } catch {
    convs.value = []
    cur.value = null
    ElMessage.error('会话列表加载失败，请确认后端与 SSH 隧道已启动')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  scrollBottom()
})
</script>

<template>
  <div class="msg-page">
    <PageHeader title="消息" desc="课程答疑与课程群" back back-to="/student/courses">
      <template #actions>
        <el-tag type="info" effect="light">{{ unreadTotal() }} 条未读</el-tag>
        <el-button size="small" type="primary" @click="openNew">
          <BaseIcon name="plus" :size="13" />发起会话
        </el-button>
        <el-button size="small" @click="router.push({ name: 'StuNotice' })">
          <BaseIcon name="bell" :size="13" />系统通知
        </el-button>
        <el-button size="small" @click="router.push({ name: 'StuSupport' })">
          <BaseIcon name="headphones" :size="13" />在线客服
        </el-button>
        <el-button size="small" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
      </template>
    </PageHeader>

    <div class="chat-wrap">
      <!-- 会话列表 -->
      <div class="conv-list">
        <div class="conv-search">
          <el-input v-model="kw" placeholder="搜索联系人 / 课程群" />
        </div>
        <div class="conv-scroll">
          <EmptyState v-if="loading" :loading="true" />
          <EmptyState v-else-if="!shownConvs.length" desc="暂无会话" />
          <template v-else>
            <div
              v-for="c in shownConvs"
              :key="c.id"
              class="conv"
              :class="{ active: cur && c.id === cur.id }"
              @click="pickConv(c)"
            >
              <span class="avatar">{{ c.avatar }}</span>
              <div class="c-body">
                <div class="c-name">
                  <BaseIcon v-if="c.pinned" name="pin" :size="11" class="pin-ic" />
                  {{ c.name }}<time>{{ c.time }}</time>
                </div>
                <div class="c-last">{{ c.last }}</div>
              </div>
              <span v-if="c.muted" class="muted-ic" title="已免打扰">
                <BaseIcon name="bell-off" :size="12" />
              </span>
              <span v-if="c.unread" class="unread">{{ c.unread }}</span>
              <el-dropdown
                trigger="click"
                placement="bottom-end"
                @command="(cmd) => convCmd(cmd, c)"
                @click.stop
              >
                <span class="more" title="会话设置" @click.stop>
                  <BaseIcon name="more-horizontal" :size="14" />
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :command="c.pinned ? 'unpin' : 'pin'">
                      {{ c.pinned ? '取消置顶' : '置顶会话' }}
                    </el-dropdown-item>
                    <el-dropdown-item :command="c.muted ? 'unmute' : 'mute'">
                      {{ c.muted ? '取消免打扰' : '消息免打扰' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="clear">清空聊天记录</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除会话</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </div>
      </div>

      <!-- 聊天窗 -->
      <div v-if="cur" class="chat-main">
        <div class="chat-head">
          <span class="avatar">{{ cur.avatar }}</span>
          <div>
            <b>{{ cur.name }}</b>
            <div class="small muted">{{ cur.sub || ' ' }}</div>
          </div>
          <el-tag type="info" effect="light" style="margin-left: auto">{{ cur.tag }}</el-tag>
        </div>

        <div ref="bodyRef" class="chat-body" @scroll="onBodyScroll">
          <div v-if="!cur.msgs || !cur.msgs.length" class="chat-empty-hint">
            <span class="ce-av">{{ cur.avatar }}</span>
            <div class="small muted">还没有和「{{ cur.name }}」的聊天记录，发条消息开始吧</div>
          </div>
          <template v-for="(m, i) in cur.msgs || []" :key="i">
            <div v-if="showDay(i)" class="day-div">{{ cur.msgs[i].day }}</div>
            <div v-if="m.who === 'sys'" class="chat-sys"><span>{{ m.text }}</span></div>
            <div v-else class="bubble-row" :class="{ me: m.who === 'me', cont: isCont(i) }">
              <span v-if="!isCont(i)" class="avatar">{{ m.who === 'me' ? '我' : cur.avatar }}</span>
              <div class="bubble">
                <div v-if="m.sender" class="sender">{{ m.sender }}</div>

                <!-- 引用块（引用回复） -->
                <div v-if="m.replyToId" class="quote">
                  <span class="q-text">{{ quoteOf(m) }}</span>
                </div>

                <!-- 图片消息 -->
                <img
                  v-if="m.type === 'image'"
                  :src="m.url"
                  class="b-img"
                  alt="图片消息"
                  @click="openImg(m.url)"
                />
                <!-- 文件消息 -->
                <a v-else-if="m.type === 'file'" class="b-file" :href="m.url" target="_blank" rel="noopener">
                  <BaseIcon name="paperclip" :size="15" />
                  <span class="b-fname">{{ m.name }}</span>
                  <span class="b-fsize">{{ fmtSize(m.size) }}</span>
                </a>
                <!-- 文本消息 -->
                <template v-else>{{ m.text }}</template>

                <span class="b-time">{{ m.time }}</span>
                <span
                  v-if="m.who === 'other' && m.id"
                  class="b-flag"
                  title="举报该消息"
                  @click="openReport(m)"
                >
                  <BaseIcon name="flag" :size="11" />
                </span>
              </div>

              <!-- 消息操作：复制 / 撤回（自己发的）/ 删除（仅自己可见） -->
              <div v-if="m.id" class="msg-ops">
                <span v-if="!m.type" title="引用回复" @click.stop="startReply(m)">
                  <BaseIcon name="quote" :size="11" />
                </span>
                <span title="转发" @click.stop="openForward(m)">
                  <BaseIcon name="send" :size="11" />
                </span>
                <span title="复制" @click.stop="copyMsg(m)"><BaseIcon name="file-text" :size="11" /></span>
                <span v-if="m.who === 'me'" title="撤回" @click.stop="recallMsg(m)">
                  <BaseIcon name="refresh-cw" :size="11" />
                </span>
                <span title="删除（仅自己可见）" @click.stop="deleteLocal(m)">
                  <BaseIcon name="trash-2" :size="11" />
                </span>
              </div>
            </div>
          </template>
        </div>

        <!-- 回到底部浮钮（离开底部 / 来新消息时出现） -->
        <div v-show="!atBottom" class="back-bottom" title="回到底部" @click="backToBottom">
          <BaseIcon name="chevron-down" :size="16" />
        </div>

        <div class="chat-input">
          <!-- 引用条 -->
          <div v-if="replyTo" class="reply-bar">
            <BaseIcon name="quote" :size="12" />
            <span class="r-text">引用 {{ replyTo.who === 'me' ? '我' : replyTo.sender || cur?.name }}：{{ replyTo.text }}</span>
            <span class="r-x" @click="cancelReply">取消</span>
          </div>
          <!-- 快捷短语 -->
          <div class="qi-row">
            <button v-for="q in QUICK_REPLIES" :key="q" class="qi" @click="fillQuick(q)">{{ q }}</button>
          </div>
          <div class="ci-row">
            <div class="tools">
              <el-button size="small" title="发送图片（需对象存储）" @click="pickImg">
                <BaseIcon name="image" :size="15" />
              </el-button>
              <el-button size="small" title="发送文件（需对象存储）" @click="pickFile">
                <BaseIcon name="paperclip" :size="15" />
              </el-button>
            </div>
            <textarea
              ref="taRef"
              v-model="input"
              class="input ta"
              maxlength="2000"
              :placeholder="'给 ' + (cur?.name || '对方') + ' 发消息，Enter 发送，Shift+Enter 换行'"
              @input="autoGrow"
              @keydown.enter.exact.prevent="send"
            />
            <span class="ta-meta">{{ input.length }}/2000</span>
            <el-button type="primary" :loading="sending" @click="send">
              <BaseIcon name="send" :size="15" />发送
            </el-button>
          </div>
        </div>
      </div>
      <EmptyState v-else desc="请选择左侧会话开始聊天" />
    </div>

    <!-- 转发消息 -->
    <el-dialog v-model="forwardVisible" title="转发消息" width="420px">
      <div class="fwd-preview">
        <span class="small muted">消息内容：</span>
        <div class="fwd-text">{{ forwardMsg?.type === 'image' ? '[图片]' : forwardMsg?.type === 'file' ? '[文件] ' + (forwardMsg?.name || '') : forwardMsg?.text }}</div>
      </div>
      <div class="field-label" style="margin-top: 12px">转发到</div>
      <el-select v-model="forwardTargetId" placeholder="选择会话" style="width: 100%">
        <el-option v-for="c in forwardCandidates" :key="c.id" :label="c.name + '（' + c.tag + '）'" :value="c.id" />
      </el-select>
      <div v-if="!forwardCandidates.length" class="small muted" style="margin-top: 8px">
        没有其他会话可转发；可先用「+ 发起会话」新建一个
      </div>
      <template #footer>
        <el-button @click="forwardVisible = false">取消</el-button>
        <el-button type="primary" :loading="forwarding" :disabled="!forwardTargetId" @click="doForward">转发</el-button>
      </template>
    </el-dialog>

    <!-- 发起会话（课程联系人：任课教师 + 同班同学） -->
    <el-dialog v-model="newVisible" title="发起会话" width="480px">
      <div class="row" style="gap: 10px; margin-bottom: 12px">
        <el-select v-model="contactCourseId" placeholder="选择课程" style="width: 200px" @change="loadContacts">
          <el-option v-for="c in contactCourses" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="contactKw" placeholder="搜索姓名 / 学号" style="flex: 1" />
      </div>

      <div v-if="!contactCourses.length" class="small muted" style="padding: 12px 0">
        你还没有已选课程；加入课程后即可联系任课教师与同班同学
      </div>
      <div v-else v-loading="contactLoading" class="contact-box">
        <template v-if="teacherContacts.length">
          <div class="c-group">任课教师</div>
          <div v-for="c in teacherContacts" :key="c.userId" class="contact">
            <span class="avatar">{{ (c.nickName || '师').slice(0, 1) }}</span>
            <div style="flex: 1; min-width: 0">
              <b class="small">{{ c.nickName || c.userName }}</b>
              <div class="small muted">{{ c.userName }}</div>
            </div>
            <el-button size="small" type="primary" :loading="starting" @click="startChat(c)">发消息</el-button>
          </div>
        </template>
        <template v-if="studentContacts.length">
          <div class="c-group">同班同学</div>
          <div v-for="c in studentContacts" :key="c.userId" class="contact">
            <span class="avatar">{{ (c.nickName || '学').slice(0, 1) }}</span>
            <div style="flex: 1; min-width: 0">
              <b class="small">{{ c.nickName || c.userName }}</b>
              <div class="small muted">{{ c.userName }}</div>
            </div>
            <el-button size="small" :loading="starting" @click="startChat(c)">发消息</el-button>
          </div>
        </template>
        <div v-if="!shownContacts.length" class="small muted" style="padding: 12px 0">
          该课程暂无可联系的人（可能还没同学选课，或教师未分配）
        </div>
      </div>
    </el-dialog>

    <!-- 举报消息弹窗（stu-pc 模块，targetType=chat_message） -->
    <ReportDialog
      v-model="reportVisible"
      target-type="chat_message"
      :target-id="reportMsg?.id"
      :target-user-id="reportMsg?.senderId"
      :target-label="reportLabel"
    />
  </div>
</template>

<style scoped>
/**
 * ★ 2026-10-20 页面高度精确吃满（消除页面级滚动条）：
 * 根容器 = 视口 - 顶栏(--topbar-h) - 内容区上下 padding(24*2)；
 * PageHeader 占自身高度，聊天区 flex:1 占剩余 → 总高精确等于可用区，不溢出
 * （原 calc(100vh - 188px) 依赖对页头高度的估算，差几像素就会出页面滚动条）。
 */
.msg-page {
  height: calc(100vh - var(--topbar-h, 56px) - 48px);
  min-height: 420px;
  display: flex;
  flex-direction: column;
}
.msg-page :deep(.page-head) {
  flex: none;
}
.chat-wrap {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  overflow: hidden;
  background: #fff;
}
.conv-list {
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--bg-subtle);
}
.conv-search {
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
.conv-scroll {
  flex: 1;
  overflow-y: auto;
}
.conv {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: 0.12s;
  position: relative;
}
.conv .del {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 24px;
  height: 24px;
  border-radius: var(--r-md);
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--ink-400);
  background: #fff;
  border: 1px solid var(--border);
  cursor: pointer;
}
.conv:hover .del {
  display: flex;
}
.conv .del:hover {
  color: var(--error);
  border-color: #fca5a5;
  background: #fef2f2;
}
/* ★ 2026-10-20 聊天增强：日期分隔 + 消息操作条 */
.day-div {
  align-self: center;
  font-size: 11px;
  color: var(--ink-400);
  background: var(--bg-soft);
  border-radius: 99px;
  padding: 2px 10px;
  margin: 6px 0 2px;
}
.msg-ops {
  display: none;
  align-self: center;
  gap: 6px;
  flex: none;
}
.bubble-row:hover .msg-ops {
  display: flex;
}
.msg-ops span {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--border);
  color: var(--ink-400);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.msg-ops span:hover {
  color: var(--brand-600);
  border-color: var(--brand-300);
}
.contact-box {
  max-height: 320px;
  overflow-y: auto;
}
.c-group {
  font-size: 11.5px;
  color: var(--ink-400);
  margin: 10px 0 4px;
}
.contact {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px dashed var(--border);
}
.contact:hover {
  background: var(--primary-softer);
}

/* ==================== ★ 2026-10-20 聊天 UI 重做（简约 / 平滑，参考学习通·飞书） ==================== */
.chat-body {
  background: #f7f9f9;
  padding: 18px 20px 8px;
  scroll-behavior: smooth;
}
.chat-body::-webkit-scrollbar {
  width: 6px;
}
.chat-body::-webkit-scrollbar-track {
  background: transparent;
}
.chat-body::-webkit-scrollbar-thumb {
  background: #dbe4e2;
  border-radius: 99px;
}
.chat-body::-webkit-scrollbar-thumb:hover {
  background: #c3d2ce;
}

.bubble-row {
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
  animation: msgIn 0.18s ease-out;
}
@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.bubble-row.cont {
  margin-top: -6px;
}

/* 头像：圆角方块（比圆形更现代），自己用浅青底 */
.bubble-row .avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  color: var(--brand-700);
  border: 1px solid #e6ecea;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.bubble-row.me .avatar {
  background: var(--primary-soft);
  border-color: transparent;
}

/* 气泡：对方白底细边；自己浅青底深青字（原来深绿实底太重） */
.bubble {
  max-width: min(62%, 560px);
  background: #fff;
  border: 1px solid #e7efec;
  border-radius: 4px 16px 16px 16px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink-800, var(--ink-700));
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  word-break: break-word;
}
.bubble-row.me .bubble {
  background: #e7f5f1;
  color: #115e56;
  border-color: #d5ebe5;
  border-radius: 16px 4px 16px 16px;
}
.bubble .b-time {
  float: right;
  margin: 6px 0 0 12px;
  font-size: 10.5px;
  color: var(--ink-400);
}
.bubble-row.me .b-time {
  color: #5f9e94;
}
.bubble .sender {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-400);
  margin-bottom: 2px;
}
/* 图片消息：限宽 + 圆角，点击新窗口查看原图 */
.b-img {
  display: block;
  max-width: 240px;
  max-height: 240px;
  border-radius: 10px;
  cursor: zoom-in;
  object-fit: cover;
}
/* 文件消息：一行卡片（图标 + 名称 + 大小） */
.b-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--border);
  color: var(--ink-700);
  text-decoration: none;
  max-width: 260px;
}
.b-file:hover {
  border-color: var(--brand-300);
}
.b-file .b-fname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
  font-size: 13px;
}
.b-file .b-fsize {
  flex: none;
  font-size: 11px;
  color: var(--ink-400);
}

/* 头像隐藏时保持气泡位置（连续消息靠 margin 收紧） */

/* 输入区：胶囊容器 + 无边框 textarea + 不换行按钮 */
.chat-input {
  padding: 8px 16px 14px;
  gap: 10px;
  border-top: 1px solid #eff3f2;
  background: #fff;
}
.qi {
  background: var(--bg-soft);
  color: var(--ink-500);
  padding: 4px 12px;
  border-radius: 99px;
}
.qi:hover {
  background: var(--primary-soft);
  color: var(--brand-700);
  border-color: transparent;
}
.ci-row {
  background: var(--bg-subtle);
  border: 1px solid transparent;
  border-radius: 14px;
  padding: 5px 8px 5px 10px;
  gap: 8px;
  align-items: flex-end;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}
.ci-row:focus-within {
  background: #fff;
  border-color: var(--brand-300);
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.08);
}
.ta {
  border: none;
  background: transparent;
  box-shadow: none;
  height: 38px;
  padding: 8px 0;
}
.ta:focus {
  outline: none;
  box-shadow: none;
  border: none;
}
.tools {
  padding-bottom: 5px;
}
.tools :deep(.el-button) {
  border: none;
  background: transparent;
  color: var(--ink-400);
}
.tools :deep(.el-button:hover) {
  color: var(--brand-600);
  background: var(--primary-soft);
}
.ta-meta {
  font-size: 10.5px;
  color: var(--ink-400);
  padding-bottom: 9px;
}
.ci-row :deep(.el-button--primary) {
  height: 38px;
  border-radius: 10px;
  padding: 0 16px;
  flex: none;
  white-space: nowrap;
}
.back-bottom {
  bottom: 150px;
}
.conv:hover {
  background: #fff;
}
.conv.active {
  background: #fff;
  border-left: 3px solid var(--brand-600);
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex: none;
}
.c-body {
  flex: 1;
  min-width: 0;
}
.c-name {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.c-name time {
  font-size: 11px;
  color: var(--ink-400);
  font-weight: 400;
}
.c-last {
  font-size: 12px;
  color: var(--ink-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.unread {
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--error);
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  flex: none;
  align-self: center;
}
.chat-main {
  display: flex;
  flex-direction: column;
  background: #fff;
  position: relative;
  /* ★ 2026-10-20 关键修复：flex 子项允许收缩，否则消息撑高后输入框被挤出可视区 */
  min-height: 0;
}
.chat-head {
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  background: var(--bg-subtle);
}
.chat-sys {
  text-align: center;
  margin: 6px 0 14px;
}
.chat-sys span {
  font-size: 11.5px;
  color: var(--ink-400);
  background: var(--bg-soft);
  border-radius: 99px;
  padding: 4px 12px;
}
.bubble-row {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.bubble-row.me {
  flex-direction: row-reverse;
}
.bubble {
  max-width: 62%;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px 14px 14px 14px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  position: relative;
}
.bubble .b-flag {
  position: absolute;
  top: -9px;
  right: -9px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--ink-400);
  background: #fff;
  border: 1px solid var(--border);
  cursor: pointer;
  z-index: 1;
}
.bubble:hover .b-flag {
  display: flex;
}
.bubble .b-flag:hover {
  color: var(--error);
  border-color: #fca5a5;
  background: #fef2f2;
}
.bubble-row.me .bubble {
  background: var(--brand-600);
  color: #fff;
  border-color: var(--brand-600);
  border-radius: 14px 4px 14px 14px;
}
.sender {
  font-size: 12px;
  color: var(--brand-600);
  font-weight: 600;
  margin-bottom: 2px;
}
.b-time {
  display: block;
  font-size: 10.5px;
  color: var(--ink-400);
  margin-top: 4px;
}
.bubble-row.me .b-time {
  color: rgba(255, 255, 255, 0.7);
  text-align: right;
}
.chat-input {
  border-top: 1px solid var(--border);
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fff;
  flex: none;
}
.qi-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.qi {
  font-family: inherit;
  font-size: 12px;
  color: var(--brand-700);
  background: var(--primary-soft);
  border: 1px solid transparent;
  border-radius: var(--r-full);
  padding: 3px 10px;
  cursor: pointer;
}
.qi:hover {
  border-color: var(--brand-300);
}
.ci-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.ta {
  flex: 1;
  resize: none;
  height: 44px;
  max-height: 96px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.ta-meta {
  flex: none;
  font-size: 11px;
  color: var(--ink-400);
  padding-bottom: 10px;
}
.tools {
  display: flex;
  gap: 6px;
  padding-bottom: 6px;
}
.back-bottom {
  position: absolute;
  right: 22px;
  bottom: 128px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--border);
  box-shadow: var(--sh-2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-500);
  cursor: pointer;
  z-index: 2;
}
.back-bottom:hover {
  color: var(--brand-600);
  border-color: var(--brand-300);
}
.chat-empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 12px;
}
/* 转发弹窗：消息预览 */
.fwd-preview {
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: 10px;
}
.fwd-preview .fwd-text {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-700);
  max-height: 96px;
  overflow-y: auto;
  word-break: break-word;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
/* ★ 2026-10-21 会话标识：置顶 / 静音 / 更多菜单 */
.pin-ic {
  color: var(--brand-600);
  margin-right: 2px;
}
.muted-ic {
  flex: none;
  color: var(--ink-400);
  display: inline-flex;
  align-items: center;
}
.more {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--ink-400);
  cursor: pointer;
}
.conv:hover .more {
  display: inline-flex;
}
.more:hover {
  background: var(--bg-soft);
  color: var(--brand-600);
}
/* 引用块（气泡内） */
.quote {
  margin-bottom: 6px;
  padding: 4px 8px 4px 10px;
  border-left: 3px solid var(--brand-300);
  background: rgba(255, 255, 255, 0.6);
  border-radius: 0 8px 8px 0;
  font-size: 12px;
  color: var(--ink-500);
}
.bubble-row.me .quote {
  background: rgba(255, 255, 255, 0.55);
}
/* 引用条（输入区） */
.reply-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--primary-softer);
  border-left: 3px solid var(--brand-400);
  border-radius: 6px;
  font-size: 12px;
  color: var(--brand-700);
}
.reply-bar .r-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-bar .r-x {
  flex: none;
  color: var(--ink-400);
  cursor: pointer;
}
.reply-bar .r-x:hover {
  color: var(--error);
}
.chat-empty-hint .ce-av {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--brand-700);
  font-size: 16px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
