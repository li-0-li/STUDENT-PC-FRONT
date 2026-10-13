<script setup>
/**
 * 客服与帮助（分支 stu-pc-support；跨端公共页）
 * 关联接口（接口设计文档表号）：表 3-20 客服咨询、表 3-23~3-25 会话与工单
 * 对应原型：ui-prototype/pc/support.html —— ★ 1:1 还原
 *   （联系方式入口、常见问题手风琴、服务信息、咨询范围标签、在线客服会话弹窗）
 *   与小程序端 app-support.html 同一套 FAQ（端间镜像）
 *
 * 说明：智能助教应答按原型本地关键词匹配；未命中即提示转人工（对应 support_message.sender_type）。
 */
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'

/* ---------------- FAQ（照原型） ---------------- */
const FAQ = [
  {
    q: '如何添加课程？',
    a: '进入「我学的课」→ 右上角「添加课程」，输入教师提供的课程码即可加入；公开课可直接在课程列表中申请加入。加入成功后课程会同步出现在「我的课表」与「我的作业」中。'
  },
  {
    q: '作业提交后多久能批改？',
    a: '单选、多选、判断、填空提交后立即出分；简答题由 AI 评分后直接生效，教师复核后可修正；编程题提交后自动运行测试用例判分。教师完成批改会在「消息」中通知，也可在「我的作业」查看结果与评语。'
  },
  {
    q: '如何修改登录密码？',
    a: '点击右上角头像进入「个人资料」，在「账号安全」中点击「修改密码」，输入原密码与新密码即可。若原密码已遗忘，请在登录页点击「忘记密码」，通过绑定的手机号或邮箱验证后重置。'
  }
]
const openFaq = ref(-1)
const toggleFaq = (i) => (openFaq.value = openFaq.value === i ? -1 : i)

/* ---------------- 自动应答库（照原型 AUTO） ---------------- */
const AUTO = [
  { k: ['课程', '添加', '选课', '课程码'], a: '添加课程：进入「我学的课」→「添加课程」，输入教师提供的课程码即可加入。若提示课程码无效，请与任课教师确认。' },
  { k: ['作业', '批改', '评分', '成绩', '申诉'], a: '作业批改：客观题提交即出分；简答题 AI 评分后直接生效，教师可复核修正；编程题按测试用例自动判分。批改完成会在「消息」中通知你。' },
  { k: ['密码', '登录', '账号', '登不上', '验证码'], a: '账号与密码：可在「个人资料 → 账号安全 → 修改密码」自助修改；忘记原密码请在登录页点「忘记密码」，用已绑定的手机号或邮箱重置。' },
  { k: ['实验', '报告', '查重'], a: '实验报告：在「实验报告」页上传报告文件提交，教师审阅后给出评分与评语；系统会对报告做查重并标注相似片段。' },
  { k: ['签到', '点名', '迟到', '缺勤'], a: '课堂签到：按教师本次开启的方式签到（扫码 / 定位 / 拍照 / 数字口令 / 手动点名）。未在时效内签到记为迟到，可由教师在花名册补签。' }
]

/* ---------------- 在线客服会话 ---------------- */
const chatVisible = ref(false)
const chatStarted = ref(false)
const msgs = ref([])
const input = ref('')
const boxRef = ref()

async function scrollBottom() {
  await nextTick()
  if (boxRef.value) boxRef.value.scrollTop = boxRef.value.scrollHeight
}
function openChat() {
  chatVisible.value = true
  if (!chatStarted.value) {
    chatStarted.value = true
    msgs.value.push({ who: 'auto', text: '你好，我是智能助教。请描述遇到的问题，我会先尝试解答；若无法解决将为你转接人工客服。' })
    msgs.value.push({ who: 'auto', text: '也可以直接查看左侧「常见问题」，多数问题已有解答。' })
  }
  scrollBottom()
}
function sendMsg() {
  const t = input.value.trim()
  if (!t) {
    ElMessage.warning('请先输入问题内容')
    return
  }
  msgs.value.push({ who: 'me', text: t })
  input.value = ''
  scrollBottom()
  setTimeout(() => {
    let hit = ''
    for (const item of AUTO) {
      if (item.k.some((k) => t.includes(k))) {
        hit = item.a
        break
      }
    }
    msgs.value.push(
      hit
        ? { who: 'auto', text: hit }
        : { who: 'svc', text: '这个问题需要人工处理，已为你转接人工客服（工单已创建，管理员将在工作时间内回复）。' }
    )
    scrollBottom()
  }, 700)
}
function callPhone() {
  ElMessage.info('客服电话：0851-88886666（工作日 9:00–18:00）')
}

const SCOPES = ['账号与登录', '课程与资源', '作业与批改', '实验报告', '学情数据']
</script>

<template>
  <div>
    <div class="between mb16">
      <div>
        <h1 class="h1">客服与帮助</h1>
        <div class="small muted mt6">遇到问题可通过在线客服或电话联系我们，工作时间外可留言等待回复</div>
      </div>
      <el-tag type="success" effect="light"><BaseIcon name="clock" :size="13" />客服在线 9:00–18:00</el-tag>
    </div>

    <div class="two-col">
      <div class="stack">
        <!-- 联系方式 -->
        <el-card shadow="never">
          <div class="card-title">联系方式</div>
          <div class="small muted sub-note">学生端 / 教师端账号均可使用</div>
          <div class="grid g2">
            <button class="entry" @click="openChat">
              <span class="ic"><BaseIcon name="message-circle" :size="20" /></span>
              <span class="mid">
                <span class="nm">在线客服</span>
                <span class="ds">智能助教先答，必要时转人工</span>
              </span>
              <BaseIcon name="chevron-right" :size="16" class="go" />
            </button>
            <button class="entry" @click="callPhone">
              <span class="ic"><BaseIcon name="phone" :size="20" /></span>
              <span class="mid">
                <span class="nm">电话客服</span>
                <span class="ds mono">0851-88886666</span>
              </span>
              <BaseIcon name="chevron-right" :size="16" class="go" />
            </button>
          </div>
        </el-card>

        <!-- 常见问题 -->
        <el-card shadow="never">
          <div class="card-title">常见问题</div>
          <div class="small muted sub-note">点击展开查看解答</div>
          <div v-for="(f, i) in FAQ" :key="i" class="faq" :class="{ open: openFaq === i }">
            <div class="q" @click="toggleFaq(i)">
              <BaseIcon name="circle-help" :size="16" class="ic-brand" />
              <span class="q-text">{{ f.q }}</span>
              <BaseIcon name="chevron-right" :size="16" class="arw" />
            </div>
            <div v-show="openFaq === i" class="a">{{ f.a }}</div>
          </div>
        </el-card>
      </div>

      <div class="stack">
        <!-- 服务信息 -->
        <el-card shadow="never">
          <div class="card-title">服务信息</div>
          <div class="pf-row"><span class="k">在线时间</span><span class="small">工作日 9:00–18:00</span></div>
          <div class="pf-row"><span class="k">电话</span><span class="small mono">0851-88886666</span></div>
          <div class="pf-row"><span class="k">响应时效</span><span class="small">在线客服 30 分钟内</span></div>
          <div class="pf-row">
            <span class="k">当前状态</span><el-tag type="success" effect="light">在线</el-tag>
          </div>
          <div class="small muted mt12 note">非工作时间提交的问题会保留在会话中，客服上线后按提交顺序回复。</div>
        </el-card>

        <!-- 咨询范围 -->
        <el-card shadow="never">
          <div class="card-title">可咨询的问题范围</div>
          <div class="row scopes">
            <el-tag v-for="s in SCOPES" :key="s" type="info" effect="light">{{ s }}</el-tag>
            <el-tag type="info" effect="plain">其他</el-tag>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 在线客服会话 -->
    <el-dialog v-model="chatVisible" width="560px" class="chat-dlg">
      <template #header>
        <div class="row">
          <b>在线客服</b>
          <el-tag type="success" effect="light" size="small">智能助教在线</el-tag>
        </div>
      </template>
      <div ref="boxRef" class="chatb">
        <div v-for="(m, i) in msgs" :key="i" class="bub" :class="m.who">
          <div v-if="m.who !== 'me'" class="who">{{ m.who === 'svc' ? '人工客服' : '智能助教' }}</div>
          {{ m.text }}
        </div>
      </div>
      <template #footer>
        <div class="row" style="gap: 8px">
          <el-input v-model="input" placeholder="描述你遇到的问题…" @keyup.enter="sendMsg" />
          <el-button type="primary" @click="sendMsg"><BaseIcon name="send" :size="14" />发送</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
}
.two-col {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 18px;
  align-items: start;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.sub-note {
  margin-top: -4px;
  margin-bottom: 14px;
}
.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: #fff;
  padding: 14px;
  cursor: pointer;
  text-align: left;
  transition: 0.15s;
  font-family: inherit;
}
.entry:hover {
  border-color: var(--brand-300);
  box-shadow: 0 4px 14px rgba(13, 148, 136, 0.08);
}
.entry .ic {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.entry .mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.entry .nm {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--ink-900);
}
.entry .ds {
  font-size: 12px;
  color: var(--ink-500);
}
.entry .go {
  color: var(--ink-400);
  flex: none;
}
.faq {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  margin-bottom: 10px;
  overflow: hidden;
}
.faq .q {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-800, var(--ink-700));
}
.faq .q-text {
  flex: 1;
}
.faq .arw {
  color: var(--ink-400);
  transition: transform 0.2s;
}
.faq.open .arw {
  transform: rotate(90deg);
}
.faq .a {
  padding: 0 14px 14px 38px;
  font-size: 13px;
  color: var(--ink-600);
  line-height: 1.8;
}
.ic-brand {
  color: var(--brand-600);
  flex: none;
}
.pf-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 2px;
  border-bottom: 1px dashed var(--border);
  font-size: 13.5px;
}
.pf-row:last-of-type {
  border-bottom: none;
}
.pf-row .k {
  color: var(--ink-500);
}
.note {
  line-height: 1.75;
}
.scopes {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.chatb {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
}
.bub {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.65;
  background: var(--bg-subtle);
  color: var(--ink-700);
  align-self: flex-start;
}
.bub.me {
  align-self: flex-end;
  background: var(--brand-600);
  color: #fff;
}
.bub.svc {
  background: var(--warning-soft);
  color: var(--ink-800, var(--ink-700));
}
.bub .who {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-600);
  margin-bottom: 3px;
}
.mb16 {
  margin-bottom: 16px;
}
.mt6 {
  margin-top: 6px;
}
.mt12 {
  margin-top: 12px;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
