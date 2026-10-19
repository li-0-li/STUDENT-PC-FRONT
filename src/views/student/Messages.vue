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
import { conversationList, messageHistory, sendMessage, deleteTarget } from '@/api/student/message'

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
    msgs: null, // null = 尚未加载（首次点开才拉记录）
    loaded: false
  }
}

/** 表 2-12 消息 → 原型气泡结构 {who, text, time, sender}（保留 id/senderId 供举报） */
function mapMsg(m) {
  if (m.isRecalled === 1) return { who: 'sys', text: '该消息已被撤回' }
  const mine = myId.value != null && m.senderId === myId.value
  let text = m.content || ''
  if (m.msgType === 'image') text = text || '[图片]'
  else if (m.msgType === 'file') text = (m.fileName ? '[' + m.fileName + '] ' : '[文件] ') + text
  return {
    who: mine ? 'me' : 'other',
    text,
    time: fmtTime(m.sendTime),
    sender: mine ? '' : m.senderName || '',
    id: m.messageId,
    senderId: m.senderId
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
    c.msgs = (d?.list || []).map(mapMsg)
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
    await sendMessage(cur.value.id, { msgType: 'text', content: v })
    input.value = ''
    // 以服务端为准重载该会话记录
    await loadMessages(cur.value, true)
    cur.value.last = v
    cur.value.time = fmtTime(new Date())
    scrollBottom()
  } catch {
    ElMessage.error('发送失败，请稍后重试')
  } finally {
    sending.value = false
  }
}

function pickImg() {
  ElMessage.info('图片发送需对象存储服务（MinIO）部署后启用，当前暂不可用')
}
function pickFile() {
  ElMessage.info('文件发送需对象存储服务（MinIO）部署后启用，当前暂不可用')
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
    const d = await conversationList()
    convs.value = (d?.list || []).map(mapConv)
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
  <div>
    <PageHeader title="消息" desc="课程答疑与课程群">
      <template #actions>
        <el-tag type="info" effect="light">{{ unreadTotal() }} 条未读</el-tag>
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
                <div class="c-name">{{ c.name }}<time>{{ c.time }}</time></div>
                <div class="c-last">{{ c.last }}</div>
              </div>
              <span v-if="c.unread" class="unread">{{ c.unread }}</span>
              <span class="del" title="删除会话" @click.stop="delConv(c)">
                <BaseIcon name="trash-2" :size="13" />
              </span>
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

        <div ref="bodyRef" class="chat-body">
          <div v-if="!cur.msgs || !cur.msgs.length" class="chat-sys"><span>暂无消息，发一条试试</span></div>
          <template v-for="(m, i) in cur.msgs || []" :key="i">
            <div v-if="m.who === 'sys'" class="chat-sys"><span>{{ m.text }}</span></div>
            <div v-else class="bubble-row" :class="{ me: m.who === 'me' }">
              <span class="avatar">{{ m.who === 'me' ? '我' : cur.avatar }}</span>
              <div class="bubble">
                <div v-if="m.sender" class="sender">{{ m.sender }}</div>
                {{ m.text }}
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
            </div>
          </template>
        </div>

        <div class="chat-input">
          <div class="tools">
            <el-button size="small" title="发送图片" @click="pickImg"><BaseIcon name="image" :size="15" /></el-button>
            <el-button size="small" title="发送文件" @click="pickFile"><BaseIcon name="paperclip" :size="15" /></el-button>
          </div>
          <textarea
            v-model="input"
            class="input ta"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            @keydown.enter.exact.prevent="send"
          />
          <el-button type="primary" :loading="sending" @click="send">
            <BaseIcon name="send" :size="15" />发送
          </el-button>
        </div>
      </div>
      <EmptyState v-else desc="请选择左侧会话开始聊天" />
    </div>

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
.chat-wrap {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: calc(100vh - 210px);
  min-height: 460px;
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
  padding: 12px 14px;
  display: flex;
  gap: 10px;
  align-items: flex-end;
  background: #fff;
}
.ta {
  flex: 1;
  resize: none;
  height: 44px;
  font-family: inherit;
  font-size: 14px;
}
.tools {
  display: flex;
  gap: 6px;
}
</style>
