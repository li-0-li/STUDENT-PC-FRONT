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
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import ReportDialog from '@/components/business/ReportDialog.vue'
import { useUserStore } from '@/store/user'
import { useMessageStore } from '@/store/message'
import {
  conversationList,
  messageHistory,
  sendMessage,
  deleteTarget,
  createConversation,
  createGroupConversation,
  recallMessage,
  updateConvSettings,
  conversationPrefs,
  conversationPeers,
  markConversationRead,
  forwardMessage,
  conversationMembers
} from '@/api/student/message'
import { myCourses, courseContacts } from '@/api/student/course'
import { uploadFile } from '@/api/auth'
import { resolveAvatarUrl, avatarFallbackUrl, resolveMediaUrl, mediaFallbackUrl, objectNameOf } from '@/utils/media'

const router = useRouter()
const userStore = useUserStore()
const msgStore = useMessageStore()

/**
 * ★ 2026-11-10 「消息」分区导航：我的对话（本页）/ 系统通知 / 在线客服。
 * 侧栏「消息」与顶栏铃铛都能直达「我的对话」；本页始终展示会话列表 + 当前对话窗。
 */
const msgTab = ref('chat')
function onMsgTabChange(v) {
  if (v === 'notice') router.push({ name: 'StuNotice' })
  else if (v === 'support') router.push({ name: 'StuSupport' })
}

/** 契约表 2-10 convType 取值 → 中文标签（★ 2026-10-27 兼容库里实际的 group / notice 写法） */
const CONV_TAG = { direct: '课程答疑', course_group: '课程群', group: '课程群', system: '通知', notice: '通知' }
/** 无 title 时的兜底名称（按类型给可读文案，不用 '?'） */
const CONV_FALLBACK = {
  direct: '一对一私聊',
  course_group: '课程群',
  group: '课程群',
  system: '系统通知',
  notice: '系统通知'
}

const convs = ref([])
const cur = ref(null)
const kw = ref('')
const input = ref('')
const bodyRef = ref()
const loading = ref(false)
const sending = ref(false)

/** 我自己的 userId（来自 GET /users/me，用于判断气泡左右） */
const myId = computed(() => userStore.info?.userId)

/**
 * ★ 2026-11-12 我自己的头像 / 姓名首字。
 *
 * 为什么头像要过 resolveAvatarUrl：库里 avatar 有 4 种历史格式（/files/、/profile/、
 * 裸 /2026/、MinIO 预签名），直接 :src 只有一种能加载。见 utils/media.js 头注释。
 * 图片加载失败（文件被清理 / 生产未反代）时回退姓名首字，绝不出现裂图。
 */
const myAvatarSrc = computed(() => resolveAvatarUrl(userStore.info?.avatar))
const myInitial = computed(() => String(userStore.name || '我').slice(0, 1) || '我')

/**
 * 头像加载状态（key：conv{会话id} / head{会话id} / msg{消息id}）：
 *   0 未记录 → 用首选地址
 *   1 → 首选 /files/... 404（生产 MinIO 模式磁盘上没有该文件），改走
 *       /api/v1/files/obj/... 只读代理重试一次
 *   2 → 两跳都失败，回退姓名首字，并记住不再请求坏地址
 */
const avatarState = ref({})
function avatarSrcFor(key, url) {
  const st = avatarState.value[key] || 0
  if (st === 2) return ''
  if (st === 1) return avatarFallbackUrl(url)
  return url || ''
}
function onAvatarError(key, url) {
  if (!key) return
  const st = avatarState.value[key] || 0
  if (st === 0 && avatarFallbackUrl(url)) {
    avatarState.value[key] = 1
    return
  }
  avatarState.value[key] = 2
}
/** 某条消息该不该显示头像图片（'' 表示不显示，回退首字） */
function avatarOf(m) {
  if (!m) return ''
  return m.who === 'me' ? myAvatarSrc.value : m.avatarUrl || ''
}

const unreadTotal = () => msgStore.total
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
    hasTitle: !!c.title,
    convType: c.convType, // ★ 2026-10-28 保留原始类型，用于判断是否群聊（群成员入口）
    tag: CONV_TAG[c.convType] || '会话',
    sub: c.messageCount > 0 ? '最后消息 ' + fmtTime(c.lastMessageTime) : '暂无消息',
    avatar: name.slice(0, 1),
    // ★ 2026-11-12 会话头像图（私聊取对方 sys_user.avatar，见 load() 合并 peers）；
    // 群聊/课程群沿用首字，除非后端给了会话头像（conversation.avatar）。
    avatarUrl: resolveAvatarUrl(c.avatar),
    time: fmtTime(c.lastMessageTime),
    // ★ 2026-11-12 未读一律以 /stu/conversation-unread 为准（见下方 load/refreshConvMeta 写入）。
    // 不能直接用列表接口的 unreadCount：那是 conversation_member.unread_count 历史字段，
    // 存在未清零的脏值（如 9027 该字段为 1，但其最后一条消息已撤回，按阅读时间口径应为 0），
    // 先渲染再被覆盖会造成红点「闪一下又没了」。
    unread: 0,
    last: c.lastMessage || '',
    // ★ 2026-11-12 轮询用的「最后消息」指纹：仅在变化时才去拉聊天记录，
    // 避免 3 秒一轮把每个会话的 messageHistory 都打一遍。
    // lastMessageId 是主判据（每次发消息后端都会 UPDATE conversation.last_message_id），
    // 时间/条数作为兜底：覆盖撤回这类不改 last_message_id 但内容变了的场景。
    lastMsgId: Number(c.lastMessageId || 0),
    lastTs: parseTs(c.lastMessageTime),
    msgCount: Number(c.messageCount || 0),
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
    // ★ 2026-11-12 对方头像（后端 Message.senderAvatar 新增，取 sys_user.avatar）。
    // 群聊里每条消息的发送人不同，所以头像必须逐条取，不能用会话头像顶替。
    avatarUrl: mine ? '' : resolveAvatarUrl(m.senderAvatar),
    id: m.messageId,
    senderId: m.senderId
  }

  /**
   * ★ 2026-11-13 图片 / 文件 / 视频消息（后端 msgType 早支持，前端此前整类丢弃）。
   *
   * 附件地址的三种历史形态统一交给 resolveMediaUrl：
   *   /files/CHAT/2026/11/13/x.png（local 模式，可直接取）
   *   CHAT/2026/11/13/x.png（裸对象名，库里常见）
   *   http://ip:9000/zhike/CHAT/...?X-Amz-...（MinIO 预签名，7 天过期 + HTTPS 下被拦）
   * 后两种都会被归一成第一种；渲染时再按「/files → /api/v1/files/obj」两跳兜底。
   */
  const kind = ['image', 'file', 'video'].includes(m.msgType) ? m.msgType : 'text'
  if (kind === 'text') return { ...base, kind, text: m.content || '' }

  const raw = m.fileUrl || m.file_url || m.content || ''
  const fallbackName = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文件'
  return {
    ...base,
    kind,
    text: MEDIA_LABEL[kind],
    media: {
      raw,
      url: resolveMediaUrl(raw),
      name: m.fileName || m.file_name || nameFromObject(objectNameOf(raw)) || fallbackName,
      size: Number(m.fileSize ?? m.file_size ?? 0)
    }
  }
}

/** 消息类型 → 列表/气泡里的文字占位（与后端 ConversationMapper 的 last_message 口径一致） */
const MEDIA_LABEL = { image: '[图片]', video: '[视频]', file: '[文件]' }

/** 对象名 → 文件名（去掉目录与 uuid 冗余，保留扩展名给图标与下载用） */
function nameFromObject(obj) {
  const s = String(obj || '')
  const i = s.lastIndexOf('/')
  return i < 0 ? s : s.slice(i + 1)
}

/* ---------------- ★ 2026-11-13 聊天附件：图片 / 视频 / 文件的显示与发送 ---------------- */

/**
 * 附件加载状态（key：'m'+messageId），与头像同一套两跳逻辑：
 *   0 → 先试 /files/{对象名}（local 模式直接命中，无需绕后端）
 *   1 → 404 后改走 /api/v1/files/obj/{对象名}（MinIO 模式唯一可读入口）
 *   2 → 两跳都失败，图片显示占位、视频显示「无法播放」、文件仍可点下载
 */
const mediaState = ref({})
function mediaSrcFor(m) {
  if (!m?.media) return ''
  const key = 'm' + m.id
  const st = mediaState.value[key] || 0
  if (st === 2) return ''
  if (st === 1) return mediaFallbackUrl(m.media.url) || m.media.url
  return m.media.url
}
function onMediaError(m) {
  const key = 'm' + (m?.id || '')
  const st = mediaState.value[key] || 0
  if (st === 0 && mediaFallbackUrl(m?.media?.url)) {
    mediaState.value[key] = 1
    return
  }
  mediaState.value[key] = 2
}

/** 文件大小：1.2 MB */
function fmtSize(n) {
  const v = Number(n) || 0
  if (v <= 0) return ''
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(1) + ' MB'
}

/** 文件类型 → 图标 */
function fileIcon(name = '') {
  const ext = String(name).split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'ogg'].includes(ext)) return 'video'
  if (['pdf'].includes(ext)) return 'file-warning'
  return 'file-text'
}

/** 图片点击看大图（ElImageViewer，点遮罩即关） */
const imageViewer = ref(null)
function openImage(m) {
  const url = mediaSrcFor(m) || m.media?.url
  if (!url) return
  imageViewer.value = { url, name: m.media?.name || '图片' }
}

/** 附件下载：同源 a[download] 直接落盘，文件名用原始名 */
function downloadMedia(m) {
  const url = mediaSrcFor(m) || m.media?.url
  if (!url) {
    ElMessage.warning('文件地址无效，无法下载')
    return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = m.media?.name || 'download'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
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
  const v = m.text || ''
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
  const t = src.text || ''
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
/* ---------------- ★ 2026-10-26 建群（stu-pc /conversations/group） ---------------- */
const chatMode = ref('direct') // direct | group
const groupTitle = ref('')
const groupMemberIds = ref([])
const creatingGroup = ref(false)

function toggleGroupMember(uid, checked) {
  const set = new Set(groupMemberIds.value)
  if (checked) set.add(uid)
  else set.delete(uid)
  groupMemberIds.value = [...set]
}

async function createGroupChat() {
  const title = groupTitle.value.trim()
  if (!title) {
    ElMessage.warning('请填写群名称')
    return
  }
  if (!groupMemberIds.value.length) {
    ElMessage.warning('请至少选择 1 位成员')
    return
  }
  if (creatingGroup.value) return
  creatingGroup.value = true
  try {
    const r = await createGroupConversation({
      title,
      courseId: contactCourseId.value || undefined,
      memberIds: groupMemberIds.value
    })
    ElMessage.success(`群聊已创建（${r?.memberCount || groupMemberIds.value.length + 1} 人）`)
    newVisible.value = false
    chatMode.value = 'direct'
    groupTitle.value = ''
    groupMemberIds.value = []
    await load()
    const conv = convs.value.find((x) => x.id === r?.conversationId)
    if (conv) {
      cur.value = conv
      await loadMessages(conv)
      scrollBottom()
    }
  } catch {
    // 400/403/422 由拦截器提示
  } finally {
    creatingGroup.value = false
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

/** 表 2-12 拉某个会话的消息记录
 *
 * ★ 2026-11-11 三态化：loaded=false 为「加载中」、loadError=true 为「加载失败」、
 *   loaded=true 且 msgs 为空才是真正的「还没有聊天记录」。
 *   此前三者共用同一个空态分支，导致消息还在路上时先骗用户一句「还没有聊天记录」。
 */
async function loadMessages(c, force = false) {
  if (!c || (c.loaded && !force && !c.loadError)) return
  c.loadError = false
  try {
    // ★ 2026-11-13 首屏取「最新 100 条」：显式传 beforeId（Long.MAX_VALUE）走倒序分支。
    // 旧后端在不传 beforeId 时是 PageHelper 正序第 1 页 = 会话**最早** 20 条，
    // 会话一过 20 条，别人新发的消息永远进不来（与后端 page=1 语义修复双向兜底）。
    const d = await messageHistory(c.id, 1, 100, { beforeId: Number.MAX_SAFE_INTEGER })
    const hidden = hiddenOf(c.id)
    const cleared = clearedAtOf(c.id)
    c.msgs = (d?.list || [])
      .map(mapMsg)
      .filter(Boolean) // mapMsg 现在对 image/file/video 返回媒体结构，只有撤回/空值才可能为 null
      .filter((x) => !hidden.includes(x.id) && (!cleared || x.ts > cleared))
    c.loaded = true
  } catch {
    c.msgs = c.msgs || []
    c.loadError = true
    ElMessage.error('消息记录加载失败')
  }
}

/**
 * ★ 2026-11-12 当前会话增量同步（对方在我正看着这个会话时发来消息）
 *
 * 只拉当前这一个会话，且由 refreshConvMeta 判定「最后消息指纹变了」才调用，
 * 所以常态下每轮轮询仍只有 1 次列表请求，不会变成逐会话拉记录。
 *
 * 两种分支（按用户要求）：
 *  - 已经在最底部：追加消息并滚到底，视线跟着新消息走；
 *  - 不在底部（正在往上翻历史）：数据照样追加，但不动滚动位置 ——
 *    追加发生在列表尾部，已有内容的 scrollTop 不受影响，正在看的那屏不会被顶走；
 *    右下角浮出「N 条新消息」，点它才回到底部。
 */
async function syncActive(c) {
  if (!c || !c.loaded) return
  // 与 loadMessages 同口径：最新 100 条（否则增量的新鲜消息也会被「最早 20 条」挡住）
  const d = await messageHistory(c.id, 1, 100, { beforeId: Number.MAX_SAFE_INTEGER })
  const hidden = hiddenOf(c.id)
  const cleared = clearedAtOf(c.id)
  const fresh = (d?.list || [])
    .map(mapMsg)
    .filter(Boolean)
    .filter((x) => !hidden.includes(x.id) && (!cleared || x.ts > cleared))
  const known = new Set((c.msgs || []).map((m) => m.id).filter(Boolean))
  const added = fresh.filter((m) => m.id && !known.has(m.id))
  const fromOthers = added.filter((m) => m.who !== 'me').length
  // 没有新增（例如对方撤回导致内容变了）→ 静默替换，不弹「新消息」
  if (!added.length) {
    c.msgs = fresh
    return
  }
  const stayBottom = atBottom.value
  c.msgs = fresh
  if (stayBottom) {
    await scrollBottom()
    newHint.value = 0
    // 正在看就等于已读：顺手清掉红点并推进服务端 last_read_time，
    // 否则人在窗口里看着消息、侧栏角标却一直往上涨。
    if (fromOthers > 0) {
      msgStore.clearOne(c.id)
      markConversationRead(c.id).catch(() => {})
    }
  } else if (fromOthers > 0) {
    newHint.value += fromOthers
  }
}

/**
 * ★ 2026-10-21 静默刷新：更新会话列表的「未读/最后消息」，不切换当前会话、不重载记录。
 * ★ 2026-11-12 未读改由 message store 提供（与侧栏总角标同源），这里只负责把
 * store 里的值映射回列表项，不再自己算一遍 —— 两份数据各算各的，数字必然对不上。
 * ★ 2026-11-12 新增：当前会话有新消息时增量同步（见 syncActive）。
 */
async function refreshConvMeta() {
  if (document.hidden || loading.value) return
  try {
    const d = await conversationList()
    // 3 秒节流：与侧栏的全局轮询合并，避免两个定时器同时打同一接口
    await msgStore.refresh(3000)
    const list = (d?.list || []).map(mapConv)
    const byId = new Map(list.map((c) => [c.id, c]))
    // 先比对指纹，再覆盖字段：覆盖之后就比不出「变了」
    const active = cur.value
    const freshActive = active ? byId.get(active.id) : null
    const prevMarker = active
      ? { lastMsgId: active.lastMsgId, lastTs: active.lastTs, msgCount: active.msgCount }
      : null
    const activeChanged =
      !!freshActive &&
      !!active.loaded &&
      (freshActive.lastMsgId !== active.lastMsgId ||
        freshActive.msgCount !== active.msgCount ||
        freshActive.lastTs !== active.lastTs)
    convs.value = convs.value.map((c) => {
      const fresh = byId.get(c.id)
      if (!fresh) return c
      // 当前会话不显示未读（正在看）
      c.unread = cur.value && cur.value.id === c.id ? 0 : msgStore.getOne(c.id)
      c.last = fresh.last
      c.time = fresh.time
      c.lastMsgId = fresh.lastMsgId
      c.lastTs = fresh.lastTs
      c.msgCount = fresh.msgCount
      return c
    })
    if (activeChanged) {
      try {
        await syncActive(active)
      } catch {
        // 拉记录失败要把指纹退回去，否则这一轮的「变了」被吃掉，
        // 那条消息要等到下一个人再发一条才会出现
        if (prevMarker) Object.assign(active, prevMarker)
      }
    }
  } catch {
    // 静默失败，等下一轮
  }
}

/* ---------------- ★ 2026-10-28 群成员（后端接口已存在，前端此前未接） ---------------- */
const memberDrawer = ref(false)
const members = ref([])
const memberLoading = ref(false)

/** 仅群聊显示成员入口：契约取值为 direct / course_group / group / system（库里还有 notice） */
const isGroup = computed(() => {
  const t = cur.value?.convType
  return t === 'group' || t === 'course_group'
})

async function openMembers() {
  if (!cur.value) return
  memberDrawer.value = true
  memberLoading.value = true
  members.value = []
  try {
    const r = await conversationMembers(cur.value.id)
    members.value = Array.isArray(r) ? r : r?.list || []
  } catch {
    members.value = []
    ElMessage.warning('无法获取群成员（可能不是群聊或已退出）')
  } finally {
    memberLoading.value = false
  }
}

function roleTag(role) {
  return { owner: '群主', admin: '管理员', member: '成员' }[role] || '成员'
}

async function pickConv(c) {
  cur.value = c
  // 换会话等于把上一个会话的「新消息」提示作废
  newHint.value = 0
  atBottom.value = true
  const hadUnread = c.unread > 0 || msgStore.getOne(c.id) > 0
  c.unread = 0
  // ★ 2026-11-12 立即同步到全局 store：列表红点当场消失、侧栏总角标当场减少。
  // 只改本地 c.unread 的话，侧栏要等下一次轮询（最长 10 秒）才更新，
  // 用户点了却看到角标还挂着，会以为点击没生效。
  msgStore.clearOne(c.id)
  // ★ 2026-11-12 点开会话强制重拉记录。
  // 原先传 force=false，已加载过的会话直接命中 guard 返回，
  // 于是「切走再切回来」看到的仍是离开那一刻的快照，这段时间对方发来的消息
  // 既不显示在聊天区、红点又已经被清掉 —— 用户会以为消息丢了。
  await loadMessages(c, true)
  scrollBottom()
  // ★ 2026-10-21 打开会话即标记已读（失败静默）
  if (hadUnread) markConversationRead(c.id).catch(() => {})
}

async function send() {
  const v = input.value.trim()
  if (!v || !cur.value || sending.value) return
  sending.value = true
  try {
    const body = { msgType: 'text', content: v }
    if (replyTo.value?.id) body.replyToId = replyTo.value.id
    const sent = await sendMessage(cur.value.id, body)
    input.value = ''
    replyTo.value = null
    autoGrow()
    // 以服务端为准重载该会话记录
    await loadMessages(cur.value, true)
    cur.value.last = v
    cur.value.time = fmtTime(new Date())
    // 自己刚发的消息已经加载进来，把指纹对齐，免得下一轮轮询误判「有新消息」再拉一次
    if (sent?.messageId) cur.value.lastMsgId = Number(sent.messageId)
    atBottom.value = true
    newHint.value = 0
    scrollBottom()
  } catch {
    ElMessage.error('发送失败，请稍后重试')
  } finally {
    sending.value = false
  }
}

/* ---------------- ★ 2026-11-13 附件发送：图片 / 文件 / 视频 → MinIO → 消息 ---------------- */

/** 单文件上限（与后端 512MB multipart 上限取一个对聊天合理的口径） */
const LIMITS = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  file: 50 * 1024 * 1024
}
const LIMIT_TEXT = { image: '10MB', video: '100MB', file: '50MB' }
const ACCEPT = {
  image: 'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/bmp',
  video: 'video/mp4,video/webm,video/quicktime,video/ogg',
  file: ''
}

const uploading = ref(false)
const uploadName = ref('')
const imgPicker = ref(null)
const filePicker = ref(null)
const videoPicker = ref(null)

function pickAttachment(kind) {
  if (uploading.value) return
  const el = kind === 'image' ? imgPicker.value : kind === 'video' ? videoPicker.value : filePicker.value
  el?.click?.()
}

function onPicked(e, kind) {
  const f = e?.target?.files?.[0]
  if (e?.target) e.target.value = ''
  if (f) sendAttachment(f, kind)
}

/** 按 MIME 判类型（粘贴/拖拽时没有「用户选的是哪个按钮」这个信息） */
function kindOfFile(f) {
  const t = String(f?.type || '')
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  return 'file'
}

/**
 * 上传并发送一条附件消息。
 *
 * 落库口径：file_url 存**同域可用地址** `/files/CHAT/...`。
 * 后端两种存储模式返回的 url 不同（local 是 /files/...，MinIO 是 7 天过期的预签名），
 * 这里一律过一遍 resolveMediaUrl 把预签名剥成 /files/{对象名}，
 * 这样消息永不过期，渲染时再按两跳兜底（MinIO 模式 /files 404 → /obj 代理）。
 */
async function sendAttachment(file, kind = null) {
  if (!cur.value || uploading.value) return
  const type = kind || kindOfFile(file)
  const limit = LIMITS[type] || LIMITS.file
  if (file.size > limit) {
    ElMessage.warning(`「${file.name}」${fmtSize(file.size)}，超过${LIMIT_TEXT[type]}上限，请压缩后再发`)
    return
  }
  uploading.value = true
  uploadName.value = file.name
  try {
    const up = await uploadFile(file, 'CHAT')
    const url = resolveMediaUrl(up?.url || up?.fileUrl || '')
    if (!url) throw new Error('上传未返回可用地址')
    const body = {
      msgType: type,
      // content 存文字占位：老客户端只读 content 时至少显示「[图片]」而不是空白
      content: MEDIA_LABEL[type] || '[文件]',
      fileUrl: url,
      fileName: up?.fileName || up?.originalFilename || file.name,
      fileSize: Number(up?.size || file.size)
    }
    if (replyTo.value?.id) body.replyToId = replyTo.value.id
    const sent = await sendMessage(cur.value.id, body)
    replyTo.value = null
    await loadMessages(cur.value, true)
    cur.value.last = MEDIA_LABEL[type] || '[文件]'
    cur.value.time = fmtTime(new Date())
    if (sent?.messageId) cur.value.lastMsgId = Number(sent.messageId)
    atBottom.value = true
    newHint.value = 0
    scrollBottom()
  } catch (e) {
    ElMessage.error(e?.message ? `发送失败：${e.message}` : '发送失败，请稍后重试')
  } finally {
    uploading.value = false
    uploadName.value = ''
  }
}

/** 粘贴发图（微信/QQ 习惯：截图后 Ctrl+V 直接发） */
function onPaste(e) {
  const items = e.clipboardData?.items || []
  for (const it of items) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (!f) continue
    e.preventDefault()
    sendAttachment(f, kindOfFile(f))
    return
  }
}

/** 拖拽发文件：整个聊天区可落 */
const dragging = ref(false)
let dragDepth = 0
function onDragEnter(e) {
  if (!cur.value) return
  if (!e.dataTransfer?.types?.includes('Files')) return
  dragDepth += 1
  dragging.value = true
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}
function onDrop(e) {
  dragDepth = 0
  dragging.value = false
  if (!cur.value) return
  const files = e.dataTransfer?.files
  if (!files?.length) return
  e.preventDefault()
  // 一次最多发 3 个，避免误拖整个文件夹
  Array.from(files)
    .slice(0, 3)
    .forEach((f) => sendAttachment(f, kindOfFile(f)))
}

/* ---------------- ★ 2026-10-20 聊天输入增强 ----------------
 * 快捷短语（学习通同款）、Enter 发送 / Shift+Enter 换行、输入框自动增高、
 * 字数上限 2000、离开底部时出现「回到底部」浮钮。
 */
const QUICK_REPLIES = ['收到', '稍等我看下', '好的，谢谢老师', '马上到']
const taRef = ref(null)
const atBottom = ref(true)
/** ★ 2026-11-12 未读的新消息条数：只在「不在底部」时累积，右下角提示用 */
const newHint = ref(0)

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
  // 自己滚到底了，「N 条新消息」提示就失去意义
  if (atBottom.value) newHint.value = 0
}
function backToBottom() {
  const el = bodyRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  atBottom.value = true
  newHint.value = 0
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

/* ---------------- 举报用户（表 2-28，targetType=user） ---------------- */
const userReportVisible = ref(false)
const reportMember = ref(null)
const userReportLabel = computed(() => (reportMember.value ? `用户：${reportMember.value.name || ''}` : ''))
function openUserReport(m) {
  if (!m?.userId) {
    ElMessage.warning('缺少用户标识，暂不能举报')
    return
  }
  reportMember.value = m
  userReportVisible.value = true
}

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
    // ★ 2026-10-27 修：后端契约是 targetIds（数组），原来传 targetId（单数）→ 400
    //   「请提供 targetType（notice/conversation）与 targetIds」
    await deleteTarget({ targetType: 'conversation', targetIds: [c.id] })
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
    // ★ 2026-11-12 未读不再单独拉一份，统一走 message store（与侧栏总角标同源）
    const [d, prefs, peers] = await Promise.all([
      conversationList(),
      conversationPrefs().catch(() => []),
      conversationPeers().catch(() => []),
      msgStore.refresh(0)
    ])
    // ★ 2026-10-21 私聊显示对方昵称（title 为空的 direct 会话）
    const peerMap = new Map(
      (Array.isArray(peers) ? peers : peers?.list || []).map((p) => [p.conversationId, p])
    )
    const prefMap = new Map(
      (Array.isArray(prefs) ? prefs : prefs?.list || []).map((p) => [p.conversationId, p])
    )
    const toBool = (v) => v === true || Number(v) === 1
    // ★ 2026-11-11 刷新前留存旧会话对象：新列表按 id 回收已加载的 msgs，
    //   否则每次刷新（含 30 秒静默刷新后的手动刷新）右侧消息区都会闪成空态。
    const prevById = new Map(convs.value.map((c) => [c.id, c]))
    convs.value = (d?.list || [])
      .map(mapConv)
      .map((c) => {
        const p = prefMap.get(c.id)
        if (p) {
          c.pinned = toBool(p.pinned)
          c.muted = toBool(p.muted)
        }
        const peer = peerMap.get(c.id)
        if (!c.hasTitle && peer?.peerName) {
          c.name = peer.peerName
          c.avatar = String(peer.peerName).slice(0, 1)
        }
        // ★ 2026-11-12 私聊对方头像：会话列表与聊天气泡共用（群聊保留会话自身的 avatar，缺省首字）
        if (!c.avatarUrl && peer?.peerAvatar) {
          c.avatarUrl = resolveAvatarUrl(peer.peerAvatar)
        }
        c.unread = msgStore.getOne(c.id)
        return c
      })
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    // ★ 2026-11-11 把旧会话已加载的消息接回新对象，避免刷新后「先空态再填充」
    convs.value.forEach((c) => {
      const old = prevById.get(c.id)
      if (old && old.loaded) {
        c.msgs = old.msgs
        c.loaded = true
      }
    })
    if (convs.value.length) {
      // ★ 2026-11-11 保留用户当前选中的会话（此前无条件跳回第一个，等于强制切走对话窗）
      const keep = cur.value ? convs.value.find((c) => c.id === cur.value.id) : null
      const target = keep || convs.value[0]
      const changed = !cur.value || cur.value.id !== target.id
      cur.value = target
      // ★ 2026-11-12 默认选中的会话同样算「已看过」：本地清零 + 服务端标记已读 + 全局角标减少。
      // 此前只把 target.unread 置 0、没有落库，下一次轮询又把未读拉回来，
      // 表现为「刷新页面后第一个会话的红点反复出现、总角标也减不掉」。
      const targetUnread = target.unread > 0 || msgStore.getOne(target.id) > 0
      target.unread = 0
      msgStore.clearOne(target.id)
      if (targetUnread) markConversationRead(target.id).catch(() => {})
      if (changed || !target.loaded) await loadMessages(target)
    } else {
      cur.value = null
    }
  } catch {
    // ★ 2026-11-11 请求失败不再清空已渲染的界面：一次网络抖动不该把对话框和列表一起抹掉
    if (!convs.value.length) {
      cur.value = null
      ElMessage.error('会话列表加载失败，请确认后端与 SSH 隧道已启动')
    } else {
      ElMessage.error('会话列表刷新失败，已保留上次内容')
    }
  } finally {
    loading.value = false
  }
}

let metaTimer = null
onMounted(async () => {
  await load()
  scrollBottom()
  // ★ 2026-10-21 静默刷新会话未读/最后消息
  // ★ 2026-11-12 间隔 8s → 3s：红点、最后消息、当前会话的新消息都要「几乎即时」。
  // 代价是每 3 秒 1 次列表请求 + 1 次未读请求（与侧栏定时器经 store 合并），
  // 聊天记录只在「最后消息指纹变了」时才拉，不做全量轮询。
  // 页面不可见时 refreshConvMeta 内部会直接跳过，不产生请求。
  metaTimer = setInterval(refreshConvMeta, 3000)
})
onUnmounted(() => {
  if (metaTimer) clearInterval(metaTimer)
  metaTimer = null
})
</script>

<template>
  <div class="msg-page">
    <PageHeader title="消息 · 我的对话" desc="会话列表与当前对话窗口" back back-to="/student/courses">
      <template #actions>
        <el-tag type="info" effect="light">{{ unreadTotal() }} 条未读</el-tag>
        <!-- ★ 2026-11-10 消息分区：我的对话 / 系统通知 / 在线客服，入口明确可达 -->
        <el-radio-group v-model="msgTab" size="small" @change="onMsgTabChange">
          <el-radio-button value="chat">我的对话</el-radio-button>
          <el-radio-button value="notice">系统通知</el-radio-button>
          <el-radio-button value="support">在线客服</el-radio-button>
        </el-radio-group>
        <el-button size="small" type="primary" @click="openNew">
          <BaseIcon name="plus" :size="13" />发起会话
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
              <span class="avatar">
                <img
                  v-if="avatarSrcFor('conv' + c.id, c.avatarUrl)"
                  :src="avatarSrcFor('conv' + c.id, c.avatarUrl)"
                  alt=""
                  @error="onAvatarError('conv' + c.id, c.avatarUrl)"
                />
                <template v-else>{{ c.avatar }}</template>
              </span>
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
      <div
        v-if="cur"
        class="chat-main"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div class="chat-head">
          <span class="avatar">
            <img
              v-if="avatarSrcFor('head' + cur.id, cur.avatarUrl)"
              :src="avatarSrcFor('head' + cur.id, cur.avatarUrl)"
              alt=""
              @error="onAvatarError('head' + cur.id, cur.avatarUrl)"
            />
            <template v-else>{{ cur.avatar }}</template>
          </span>
          <div>
            <b>{{ cur.name }}</b>
            <div class="small muted">{{ cur.sub || ' ' }}</div>
          </div>
          <el-tag type="info" effect="light" style="margin-left: auto">{{ cur.tag }}</el-tag>
          <!-- ★ 2026-10-28 群聊才显示成员入口 -->
          <el-button
            v-if="isGroup"
            size="small"
            style="margin-left: 8px"
            @click="openMembers"
          >
            <BaseIcon name="users" :size="14" />成员
          </el-button>
        </div>

        <div ref="bodyRef" class="chat-body" @scroll="onBodyScroll">
          <!-- ★ 2026-11-11 三态：加载中 / 加载失败 / 真正没有记录，不再把「还没回来」说成「没有记录」 -->
          <div v-if="!cur.loaded && !cur.loadError" class="chat-empty-hint">
            <span class="ce-av">{{ cur.avatar }}</span>
            <div class="small muted">正在加载聊天记录…</div>
          </div>
          <div v-else-if="cur.loadError" class="chat-empty-hint">
            <span class="ce-av">{{ cur.avatar }}</span>
            <div class="small muted">聊天记录加载失败，请检查网络后重试</div>
            <el-button size="small" text type="primary" @click="loadMessages(cur, true)">重新加载</el-button>
          </div>
          <div v-else-if="!cur.msgs || !cur.msgs.length" class="chat-empty-hint">
            <span class="ce-av">{{ cur.avatar }}</span>
            <div class="small muted">还没有和「{{ cur.name }}」的聊天记录，发条消息开始吧</div>
          </div>
          <template v-for="(m, i) in cur.msgs || []" :key="i">
            <div v-if="showDay(i)" class="day-div">{{ cur.msgs[i].day }}</div>
            <div v-if="m.who === 'sys'" class="chat-sys"><span>{{ m.text }}</span></div>
            <div v-else class="bubble-row" :class="{ me: m.who === 'me', cont: isCont(i) }">
              <!-- ★ 2026-11-12 每条消息都带头像（此前连续消息只显示第一条，用户反馈「第二条没头像」）。
                   有图片走图片，加载失败/无头像回退姓名首字；自己用真实头像，对方用该条消息发送人头像。 -->
              <span
                class="avatar"
                :class="{ 'has-img': avatarSrcFor('msg' + (m.id || i), avatarOf(m)) }"
              >
                <img
                  v-if="avatarSrcFor('msg' + (m.id || i), avatarOf(m))"
                  :src="avatarSrcFor('msg' + (m.id || i), avatarOf(m))"
                  alt=""
                  @error="onAvatarError('msg' + (m.id || i), avatarOf(m))"
                />
                <template v-else>{{ m.who === 'me' ? myInitial : (m.sender || cur.avatar || '?').slice(0, 1) }}</template>
              </span>
              <div class="bubble" :class="{ 'is-img': m.kind === 'image', 'is-file': m.kind === 'file' }">
                <div v-if="m.sender" class="sender">{{ m.sender }}</div>

                <!-- 引用块（引用回复） -->
                <div v-if="m.replyToId" class="quote">
                  <span class="q-text">{{ quoteOf(m) }}</span>
                </div>

                <!-- ★ 2026-11-13 附件消息：图片 / 视频 / 文件（此前整类被丢弃，只剩文字） -->
                <template v-if="m.kind === 'image'">
                  <div v-if="mediaSrcFor(m)" class="b-media b-img" @click="openImage(m)">
                    <img :src="mediaSrcFor(m)" :alt="m.media?.name" @error="onMediaError(m)" />
                  </div>
                  <div v-else class="b-media-fail">
                    <BaseIcon name="image" :size="14" />图片已失效或被清理
                  </div>
                </template>

                <template v-else-if="m.kind === 'video'">
                  <div v-if="mediaSrcFor(m)" class="b-media b-video">
                    <video
                      :src="mediaSrcFor(m)"
                      controls
                      preload="metadata"
                      playsinline
                      @error="onMediaError(m)"
                    />
                  </div>
                  <div v-else class="b-media-fail">
                    <BaseIcon name="video" :size="14" />视频无法播放，可尝试下载
                  </div>
                  <div class="b-file-meta">
                    <span class="bf-name">{{ m.media?.name }}</span>
                    <span v-if="m.media?.size" class="bf-size">{{ fmtSize(m.media.size) }}</span>
                    <span class="bf-dl" @click="downloadMedia(m)">下载</span>
                  </div>
                </template>

                <template v-else-if="m.kind === 'file'">
                  <div class="b-file" @click="downloadMedia(m)">
                    <span class="bf-ic"><BaseIcon :name="fileIcon(m.media?.name)" :size="18" /></span>
                    <span class="bf-main">
                      <span class="bf-name">{{ m.media?.name }}</span>
                      <span class="bf-size">{{ fmtSize(m.media?.size) || '文件' }}</span>
                    </span>
                    <span class="bf-dl"><BaseIcon name="download" :size="14" /></span>
                  </div>
                </template>

                <!-- 纯文本消息 -->
                <span v-else>{{ m.text }}</span>

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
                <span title="引用回复" @click.stop="startReply(m)">
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

        <!-- ★ 2026-11-12 新消息提示：人在会话里、但正在往上翻历史时不打断浏览，只在右下角提示 -->
        <div v-if="newHint > 0" class="new-msg-hint" title="回到最新消息" @click="backToBottom">
          <BaseIcon name="chevron-down" :size="14" />
          <span>{{ newHint }} 条新消息</span>
        </div>

        <!-- 回到底部浮钮（离开底部时出现；有新消息提示时让位给提示，避免两个控件叠在一起） -->
        <div
          v-show="!atBottom && newHint === 0"
          class="back-bottom"
          title="回到底部"
          @click="backToBottom"
        >
          <BaseIcon name="chevron-down" :size="16" />
        </div>

        <div class="chat-input">
          <!-- 引用条 -->
          <div v-if="replyTo" class="reply-bar">
            <BaseIcon name="quote" :size="12" />
            <span class="r-text">引用 {{ replyTo.who === 'me' ? '我' : replyTo.sender || cur?.name }}：{{ replyTo.text }}</span>
            <span class="r-x" @click="cancelReply">取消</span>
          </div>

          <!-- ★ 2026-11-13 附件工具条：图片 / 文件 / 视频（上传中显示进度文案） -->
          <div class="qi-row qi-tools">
            <button
              class="tool"
              title="发送图片（也可直接在输入框粘贴截图）"
              :disabled="uploading"
              @click="pickAttachment('image')"
            >
              <BaseIcon name="image" :size="14" />图片
            </button>
            <button class="tool" title="发送文件（也可把文件拖到聊天区）" :disabled="uploading" @click="pickAttachment('file')">
              <BaseIcon name="paperclip" :size="14" />文件
            </button>
            <button class="tool" title="发送视频（mp4 / webm，≤100MB）" :disabled="uploading" @click="pickAttachment('video')">
              <BaseIcon name="video" :size="14" />视频
            </button>
            <span v-if="uploading" class="up-tip">
              <BaseIcon name="upload-cloud" :size="13" />正在上传 {{ uploadName }}…
            </span>
            <input ref="imgPicker" type="file" :accept="ACCEPT.image" hidden @change="onPicked($event, 'image')" />
            <input ref="filePicker" type="file" hidden @change="onPicked($event, 'file')" />
            <input ref="videoPicker" type="file" :accept="ACCEPT.video" hidden @change="onPicked($event, 'video')" />
          </div>

          <!-- 快捷短语 -->
          <div class="qi-row">
            <button v-for="q in QUICK_REPLIES" :key="q" class="qi" @click="fillQuick(q)">{{ q }}</button>
          </div>
          <div class="ci-row">
            <textarea
              ref="taRef"
              v-model="input"
              class="input ta"
              maxlength="2000"
              :placeholder="'给 ' + (cur?.name || '对方') + ' 发消息，Enter 发送，Shift+Enter 换行'"
              @input="autoGrow"
              @keydown.enter.exact.prevent="send"
              @paste="onPaste"
            />
            <span class="ta-meta">{{ input.length }}/2000</span>
            <el-button type="primary" :loading="sending" @click="send">
              <BaseIcon name="send" :size="15" />发送
            </el-button>
          </div>
        </div>

        <!-- ★ 2026-11-13 拖拽落区提示：拖文件进聊天窗时整块高亮 -->
        <div v-if="dragging" class="drop-mask">
          <BaseIcon name="upload-cloud" :size="28" />
          <div>松开即可发送</div>
          <div class="dm-sub">支持图片、视频、文档，单个最大 {{ LIMIT_TEXT.file }}</div>
        </div>
      </div>
      <EmptyState v-else desc="请选择左侧会话开始聊天" />
    </div>

    <!-- ★ 2026-11-13 聊天图片大图预览（点缩略图打开，点遮罩关闭） -->
    <el-image-viewer
      v-if="imageViewer"
      :url-list="[imageViewer.url]"
      hide-on-click-modal
      teleported
      @close="imageViewer = null"
    />

    <!-- 转发消息 -->
    <el-dialog v-model="forwardVisible" title="转发消息" width="420px">
      <div class="fwd-preview">
        <span class="small muted">消息内容：</span>
        <div class="fwd-text">{{ forwardMsg?.text }}</div>
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

    <!-- ★ 2026-10-28 群成员列表（GET /api/v1/stu/conversations/{id}/members） -->
    <el-dialog v-model="memberDrawer" title="群成员" width="420px">
      <div v-loading="memberLoading">
        <div v-if="members.length" class="mem-list">
          <div v-for="m in members" :key="m.userId" class="mem-row">
            <span class="avatar sm">{{ String(m.name || '?').slice(0, 1) }}</span>
            <span class="mem-name">{{ m.name }}</span>
            <el-tag v-if="m.role === 'owner'" size="small" type="warning" effect="light">{{ roleTag(m.role) }}</el-tag>
            <el-tag v-else-if="m.role === 'admin'" size="small" type="info" effect="light">{{ roleTag(m.role) }}</el-tag>
            <!-- ★ 2026-11-04 举报该用户（targetType=user），自己不显示 -->
            <el-link
              v-if="m.userId && m.userId !== myId"
              type="info"
              :underline="false"
              class="mem-rp"
              @click="openUserReport(m)"
            >
              举报
            </el-link>
          </div>
        </div>
        <div v-else-if="!memberLoading" class="small muted">没有成员记录</div>
        <div class="small muted" style="margin-top: 10px">共 {{ members.length }} 人</div>
      </div>
      <template #footer>
        <el-button @click="memberDrawer = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 发起会话（课程联系人：任课教师 + 同班同学） -->
    <el-dialog v-model="newVisible" :title="chatMode === 'group' ? '创建群聊' : '发起会话'" width="480px">
      <div class="row" style="gap: 10px; margin-bottom: 10px">
        <el-radio-group v-model="chatMode" size="small">
          <el-radio-button value="direct">一对一</el-radio-button>
          <el-radio-button value="group">建群聊</el-radio-button>
        </el-radio-group>
        <span v-if="chatMode === 'group'" class="small muted">选择同课程同学，创建后可在群里讨论</span>
      </div>
      <el-input
        v-if="chatMode === 'group'"
        v-model="groupTitle"
        placeholder="群名称，如：数据结构复习小组"
        maxlength="100"
        show-word-limit
        style="margin-bottom: 10px"
      />
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
            <el-checkbox
              v-if="chatMode === 'group'"
              :model-value="groupMemberIds.includes(c.userId)"
              @change="(v) => toggleGroupMember(c.userId, v)"
            />
            <el-button v-else size="small" type="primary" :loading="starting" @click="startChat(c)">发消息</el-button>
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
            <el-checkbox
              v-if="chatMode === 'group'"
              :model-value="groupMemberIds.includes(c.userId)"
              @change="(v) => toggleGroupMember(c.userId, v)"
            />
            <el-button v-else size="small" :loading="starting" @click="startChat(c)">发消息</el-button>
          </div>
        </template>
        <div v-if="!shownContacts.length" class="small muted" style="padding: 12px 0">
          该课程暂无可联系的人（可能还没同学选课，或教师未分配）
        </div>
      </div>

      <template v-if="chatMode === 'group'" #footer>
        <div class="between">
          <span class="small muted">已选 {{ groupMemberIds.length }} 人（含你自己共 {{ groupMemberIds.length + 1 }} 人）</span>
          <div class="row" style="gap: 8px">
            <el-button size="small" @click="newVisible = false">取消</el-button>
            <el-button
              size="small"
              type="primary"
              :loading="creatingGroup"
              :disabled="!groupTitle.trim() || !groupMemberIds.length"
              @click="createGroupChat"
            >
              创建群聊
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 举报消息弹窗（stu-pc 模块，targetType=chat_message） -->
    <ReportDialog
      v-model="reportVisible"
      target-type="chat_message"
      :target-id="reportMsg?.id"
      :target-user-id="reportMsg?.senderId"
      :target-label="reportLabel"
    />

    <!-- 举报用户（stu-pc 模块，targetType=user） -->
    <ReportDialog
      v-model="userReportVisible"
      target-type="user"
      :target-user-id="reportMember?.userId"
      :target-label="userReportLabel"
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
  grid-template-columns: 280px minmax(0, 1fr); /* ★ minmax(0,1fr) 允许第二列收缩到 0，防止超宽内容撑破列宽裁掉发送框 */
  grid-template-rows: minmax(0, 1fr); /* ★ 2026-11-11 行高锁定为容器高度，防止消息内容撑高 grid 隐式行，把底部发送框挤出 overflow:hidden 裁剪区 */
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
/* ★ 2026-11-12 头像图片：撑满容器并裁圆角，避免依赖各处的固定宽高 */
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}
.avatar.has-img {
  padding: 0;
  overflow: hidden;
  background: transparent;
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
  /* ★ 2026-11-11 grid 子项允许收缩到列宽 + 裁剪内部瞬时溢出，防止发送框被裁/闪烁 */
  min-width: 0;
  overflow: hidden;
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
  min-width: 0;             /* ★ 2026-11-11 允许气泡收缩，配合 overflow-wrap 防止无空格长串撑破列宽 */
  overflow-wrap: anywhere;  /* ★ 2026-11-11 无空格长串/长 URL 强制断行，杜绝撑破 grid 列裁掉发送框 */
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
/* ★ 2026-11-12 「N 条新消息」：停在会话里翻历史时，新消息只提示不抢滚动条。
   与「回到底部」圆钮同位（后者此时隐藏），两者不会重叠。 */
.new-msg-hint {
  position: absolute;
  right: 22px;
  bottom: 128px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--brand-600);
  color: #fff;
  font-size: 12.5px;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 6px 16px rgba(13, 148, 136, 0.28);
  cursor: pointer;
  z-index: 3;
  animation: nmh-in 0.18s ease-out;
}
.new-msg-hint:hover {
  background: var(--brand-700);
}
@keyframes nmh-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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

/* ★ 2026-10-28 群成员列表 */
.mem-list {
  max-height: 320px;
  overflow-y: auto;
}
.mem-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line, #f1f5f9);
}
.mem-row:last-child {
  border-bottom: none;
}
.mem-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.avatar.sm {
  width: 28px;
  height: 28px;
  font-size: 13px;
}
.mem-rp {
  font-size: 12px;
  color: var(--ink-400);
}
.mem-rp:hover {
  color: var(--danger, #e34d59);
}

/* ===== ★ 2026-11-13 聊天附件：工具栏 / 图片 / 视频 / 文件 / 拖拽遮罩 ===== */
.qi-tools {
  align-items: center;
  gap: 6px;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--ink-600);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}
.tool:hover:not(:disabled) {
  border-color: var(--brand-300);
  color: var(--brand-700);
  background: var(--primary-softer, #f2fbf8);
}
.tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.up-tip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 4px;
  font-size: 12px;
  color: var(--brand-700);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 图片消息：缩略图，点击看大图 */
.b-media {
  display: block;
  line-height: 0;
}
.b-img {
  cursor: zoom-in;
}
.b-img img {
  max-width: 260px;
  max-height: 260px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
}
.b-video video {
  display: block;
  width: 280px;
  max-width: 100%;
  border-radius: 8px;
  background: #000;
}
.b-media-fail {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--ink-500);
}
.b-file-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-500);
}
.b-file-meta .bf-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.b-file-meta .bf-dl {
  color: var(--brand-700);
  cursor: pointer;
}
.b-file-meta .bf-dl:hover {
  text-decoration: underline;
}

/* 文件消息卡片 */
.b-file {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 250px;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.b-file:hover {
  border-color: var(--brand-300);
  background: var(--primary-softer, #f2fbf8);
}
.bf-ic {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-soft, #f4f7f6);
  color: var(--brand-700);
}
.bf-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.bf-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-800, #1f2d2a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bf-size {
  font-size: 11.5px;
  color: var(--ink-400);
}
.bf-dl {
  flex: none;
  margin-left: auto;
  color: var(--brand-700);
  display: inline-flex;
}

/* 图片消息：气泡本身让位给图片（无底色无边框），时间叠在图片右下 */
.bubble.is-img {
  padding: 0;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  position: relative;
  line-height: 0;
}
.bubble-row.me .bubble.is-img {
  background: transparent;
  border-color: transparent;
}
.bubble.is-img .sender {
  position: absolute;
  left: 8px;
  top: 6px;
  z-index: 2;
  margin: 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
}
.bubble.is-img .b-time {
  position: absolute;
  right: 7px;
  bottom: 7px;
  z-index: 2;
  float: none;
  margin: 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  line-height: 1.5;
}
.bubble-row.me .bubble.is-img .b-time {
  color: #fff;
}
.bubble.is-img .b-flag {
  position: absolute;
  left: 7px;
  bottom: 7px;
  z-index: 2;
  padding: 2px 5px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
}

/* 图片缩略图：不用 cover 裁切，按原比例缩到 280 内 */
.b-img img {
  max-width: 280px;
  max-height: 280px;
  width: auto;
  height: auto;
  border-radius: 10px;
  display: block;
  object-fit: contain;
}

/* 文件消息：卡片自身即气泡，不再套一层底色 */
.bubble.is-file {
  padding: 0;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.bubble-row.me .bubble.is-file {
  background: transparent;
  border-color: transparent;
}
.bubble.is-file .b-time {
  position: static;
  float: none;
  display: block;
  margin: 4px 2px 0;
  text-align: right;
}
.bubble.is-file .b-flag {
  float: right;
  margin-top: 4px;
}

/* 拖拽落区 */
.drop-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(232, 248, 243, 0.92);
  border: 2px dashed var(--brand-400, #5bb8a6);
  border-radius: 12px;
  color: var(--brand-700);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}
.drop-mask .dm-sub {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-500);
}
</style>
