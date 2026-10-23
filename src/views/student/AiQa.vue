<script setup>
/**
 * AI 答疑（分支 stu-pc-ai-qa）
 *
 * 关联接口（接口设计文档表号）：
 *   表 3-9  课程AI答疑      POST /api/v1/qa/ask
 *   表 3-10 答疑反馈        POST /api/v1/qa/{qaId}/feedback
 *   ★ 2026-10-19 新增：GET /api/v1/stu/qa-history（stu-pc 模块，本人答疑历史）
 * 对应原型：ui-prototype/pc/student-ai.html（1:1 还原，★ 2026-10-19 按学习通 AI 助教改版）
 *
 * ★ 2026-10-19 改版要点（参考学习通 / 雨课堂 AI 助教）：
 *   1. **知识库 = 我的课程（动态拉取）**，不再写死 3 门课；支持 ?courseId= 直达
 *   2. **左侧「历史提问」栏**：拉本人 qa_record（按时间倒序），点击回看当时问答；
 *      「新对话」清空会话。「历史」是本次改版最像成熟产品的一部分。
 *   3. 用户头像取真实姓名首字（原来写死「黎」）
 *   4. 保留：引用来源 chips、有用/无用反馈、命中率低于 60% 的降级提示、检索动画
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { askQuestion, qaFeedback, qaHistory } from '@/api/student/qa'
import { myCourses } from '@/api/student/course'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** 命中率可信阈值：低于此值视为「未命中知识库」（与原型一致） */
const DEGRADE_THRESHOLD = 0.6

/** 通用快捷问题（各课程通用，不写死某门课） */
const QUICK = ['这一章的重点是什么？', '用一个例子解释核心概念', '有哪些常见易错点？']

/** 知识库 = 我的课程（动态） */
const kbList = ref([])
const kbKey = ref(null)
const kb = computed(() => kbList.value.find((k) => k.courseId === kbKey.value) || kbList.value[0] || null)

/** 会话轮次：{ role: 'user' | 'ai', text, refs, qaId, score, degrade, feedback } */
const turns = ref([])
/** 历史提问记录（GET /api/v1/stu/qa-history） */
const history = ref([])
const input = ref('')
const asking = ref(false)
const loadingHistory = ref(false)
const chatEl = ref(null)

/** 用户头像：真实姓名首字 */
const myAvatar = computed(() => (userStore.name || '我').slice(0, 1))

function scrollToBottom() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  })
}

/** 开场白（新对话 / 切换知识库时） */
function greet() {
  turns.value = kb.value
    ? [
        {
          role: 'ai',
          text: `已选择「${kb.value.courseName}」知识库。直接提问即可，我会基于该课程资源检索作答并附引用来源；命中率低时会建议你咨询教师。`,
          refs: [`知识库范围 · ${kb.value.courseName}`]
        }
      ]
    : [
        {
          role: 'ai',
          text: '你还没有已选课程。加入课程后，即可选择课程知识库进行提问。'
        }
      ]
  scrollToBottom()
}

/**
 * ★ 2026-10-23 引用格式统一为 { label, title }：
 *   label = 「文件名 · 第 N 段」（可读性），title = 片段原文（hover 查看）
 */
function fmtRef(c) {
  if (typeof c === 'string') return { label: c, title: c }
  const file = c?.sourceFile || c?.file || '课件'
  const seg = c?.chunkIndex ?? c?.chunk ?? null
  const label = seg === null || seg === undefined ? file : `${file} · 第 ${Number(seg) + 1} 段`
  const snip = c?.snippet || c?.text || ''
  return { label, title: snip || label }
}

/** qa_record.citations（JSON 原文）→ 引用 chips */
function parseRefs(citations) {
  if (!citations) return []
  try {
    const arr = JSON.parse(citations)
    return (Array.isArray(arr) ? arr : []).map(fmtRef).filter((r) => r && r.label)
  } catch {
    const arr = String(citations)
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean)
    return arr.map((x) => ({ label: x, title: x }))
  }
}

/** 拉我的课程作知识库 */
async function loadKb() {
  try {
    const d = await myCourses()
    const arr = Array.isArray(d) ? d : d?.list || []
    kbList.value = arr.map((c) => ({ courseId: c.courseId, courseName: c.courseName }))
    const qid = Number(route.query.courseId)
    kbKey.value = kbList.value.some((k) => k.courseId === qid)
      ? qid
      : (kbList.value[0]?.courseId ?? null)
  } catch {
    kbList.value = []
  }
}

/** 拉历史提问（本人，按课程过滤） */
async function loadHistory() {
  if (!kb.value) {
    history.value = []
    return
  }
  loadingHistory.value = true
  try {
    const d = await qaHistory(kb.value.courseId)
    history.value = Array.isArray(d) ? d : d?.list || []
  } catch {
    history.value = []
  } finally {
    loadingHistory.value = false
  }
}

/** 切换知识库：重置会话 + 重新拉历史 */
function switchKb() {
  greet()
  loadHistory()
}

/** 点历史项：回看当时的问答 */
function openHistoryItem(h) {
  const refs = parseRefs(h.citations)
  turns.value = [
    { role: 'user', text: h.question },
    {
      role: 'ai',
      text: h.answer || '（当时未生成回答）',
      refs,
      qaId: h.qaId,
      degrade: Number(h.hitKnowledge) === 0
    }
  ]
  scrollToBottom()
}

/** 新对话 */
function newChat() {
  input.value = ''
  greet()
}

async function ask(preset) {
  const text = String(preset ?? input.value ?? '').trim()
  if (!text) return
  if (asking.value) return
  if (!kb.value) {
    ElMessage.warning('请先加入课程，再使用课程知识库提问')
    return
  }

  input.value = ''
  turns.value.push({ role: 'user', text })
  asking.value = true
  scrollToBottom()

  const parentQaId = [...turns.value].reverse().find((t) => t.role === 'ai' && t.qaId)?.qaId

  try {
    const data = await askQuestion({ courseId: kb.value.courseId, question: text, parentQaId })
    const score = Number(data?.score ?? data?.topScore ?? 1)
    const refs = (data?.citations || []).map(fmtRef)
    const hit = data?.hitKnowledge !== false && refs.length > 0 && score >= DEGRADE_THRESHOLD

    turns.value.push(
      hit
        ? { role: 'ai', text: data?.answer || '', refs, qaId: data?.qaId, score, provider: data?.provider }
        : {
            role: 'ai',
            degrade: true,
            score,
            qaId: data?.qaId,
            text:
              data?.answer ||
              `未在当前知识库（${kb.value.courseName}）检索到与「${text}」高度相关的内容。`
          }
    )
    // 提问成功后刷新历史栏
    loadHistory()
  } catch (e) {
    // request.js 已统一提示（含配额 429「今日次数已达上限」）
    turns.value.push({
      role: 'ai',
      degrade: true,
      score: 0,
      text: `本次提问未完成：${e?.message || '请稍后重试'}`
    })
  } finally {
    asking.value = false
    scrollToBottom()
  }
}

/** 反馈：有用 / 无用（表 3-10） */
async function fb(turn, type) {
  if (turn.feedback === type) return
  turn.feedback = type
  ElMessage.success(type === 'up' ? '感谢反馈，已记录为「有用」' : '已记录，我们会优化该知识点的检索')
  if (!turn.qaId) return
  try {
    await qaFeedback(turn.qaId, { feedback: type === 'up' ? 'useful' : 'useless' })
  } catch {
    /* 已统一提示，反馈失败不影响本地标记 */
  }
}

onMounted(async () => {
  await loadKb()
  greet()
  loadHistory()
})
</script>

<template>
  <div>
    <PageHeader title="AI 答疑" desc="基于课程知识库检索作答，回答附引用来源；命中率低时建议咨询教师">
      <template #actions>
        <el-button @click="router.push({ name: 'StuAnalytics' })">学情分析</el-button>
        <el-select
          v-if="kbList.length"
          v-model="kbKey"
          style="width: 220px"
          placeholder="选择知识库"
          @change="switchKb"
        >
          <el-option
            v-for="k in kbList"
            :key="k.courseId"
            :label="k.courseName + ' 知识库'"
            :value="k.courseId"
          />
        </el-select>
        <el-button @click="newChat"><BaseIcon name="plus" :size="14" />新对话</el-button>
      </template>
    </PageHeader>

    <div class="qa-grid">
      <!-- 左：历史提问（参考学习通 AI 助教会话列表） -->
      <el-card shadow="never" class="hist-card">
        <div class="card-title">历史提问</div>
        <div class="hist-list">
          <div v-if="loadingHistory" class="hist-empty">加载中…</div>
          <div v-else-if="!history.length" class="hist-empty">
            {{ kbList.length ? '暂无提问记录，右侧直接提问即可' : '暂无已选课程' }}
          </div>
          <div
            v-for="h in history"
            :key="h.qaId"
            class="hist-item"
            @click="openHistoryItem(h)"
          >
            <div class="h-q">{{ h.question }}</div>
            <div class="h-meta">
              <span>{{ h.createdAt }}</span>
              <span v-if="Number(h.hitKnowledge) === 0" class="h-tag">未命中</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 右：对话 -->
      <div>
        <div ref="chatEl" class="chat-wrap">
          <div class="chat">
            <template v-for="(t, i) in turns" :key="i">
              <!-- 用户气泡 -->
              <div v-if="t.role === 'user'" class="msg user">
                <span class="avatar">{{ myAvatar }}</span>
                <div class="bubble">{{ t.text }}</div>
              </div>

              <!-- AI 气泡 -->
              <div v-else class="msg ai">
                <span class="icon-box"><BaseIcon name="sparkles" :size="16" /></span>
                <div class="bubble">
                  {{ t.text }}

                  <div v-if="t.degrade" class="degrade">
                    <BaseIcon name="circle-alert" :size="15" class="warn" />
                    <span>
                      知识库最高匹配度低于可信阈值（60%）。按照平台约定，AI 不做无依据生成——
                      建议换一种说法再问，或到「客服」提交问题由任课教师解答。
                    </span>
                  </div>

                  <div v-else-if="t.refs && t.refs.length" class="refs">
                    引用来源：
                    <span v-for="(r, ri) in t.refs" :key="ri" class="chip" :title="r.title || r">
                      {{ r.label || r }}
                    </span>
                  </div>

                  <div v-if="!t.degrade" class="fb">
                    <button :class="{ on: t.feedback === 'up' }" @click="fb(t, 'up')">
                      <BaseIcon name="thumbs-up" :size="14" />有用
                    </button>
                    <button :class="{ on: t.feedback === 'down' }" @click="fb(t, 'down')">
                      <BaseIcon name="thumbs-down" :size="14" />无用
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- 检索中 -->
            <div v-if="asking" class="msg ai">
              <span class="icon-box"><BaseIcon name="sparkles" :size="16" /></span>
              <div class="bubble">
                <span class="typing"><i /><i /><i /></span>
                <span class="small muted">正在检索课程知识库…</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部输入卡片 -->
        <div class="composer">
          <div class="row">
            <el-input
              v-model="input"
              placeholder="基于课程知识库提问……"
              :disabled="!kb"
              @keydown.enter.prevent="ask()"
            />
            <el-button type="primary" :loading="asking" :disabled="!kb" @click="ask()">
              <BaseIcon name="send" :size="15" />提问
            </el-button>
          </div>
          <div class="quick">
            <button v-for="(q, i) in QUICK" :key="i" @click="ask(q)">{{ q }}</button>
          </div>
          <div class="small muted mt8">
            回答基于所选课程知识库检索生成并附引用；命中率低时建议咨询教师。
            每日提问上限 50 次（课程另设配额时取较小值），超限次日恢复。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qa-grid {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.hist-card {
  position: sticky;
  top: 12px;
}
.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 10px;
}
.hist-list {
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hist-empty {
  font-size: 12.5px;
  color: var(--ink-400);
  padding: 18px 4px;
  line-height: 1.7;
}
.hist-item {
  padding: 8px 10px;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: 0.12s;
  border: 1px solid transparent;
}
.hist-item:hover {
  background: var(--primary-softer);
  border-color: var(--brand-200);
}
.hist-item .h-q {
  font-size: 12.8px;
  color: var(--ink-800, var(--ink-700));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hist-item .h-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-400);
}
.hist-item .h-tag {
  color: var(--warning);
  background: var(--warning-soft, #fef3c7);
  border-radius: 4px;
  padding: 0 5px;
}
.chat-wrap {
  height: calc(100vh - 300px);
  min-height: 300px;
  overflow-y: auto;
  padding-right: 6px;
}
.chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.msg {
  display: flex;
  gap: 10px;
  max-width: 82%;
}
.msg .bubble {
  padding: 12px 14px;
  border-radius: var(--r-lg);
  font-size: 14px;
  line-height: 1.6;
}
.msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.msg.user .bubble {
  background: var(--brand-600);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg.ai .bubble {
  background: #fff;
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--brand-100);
  color: var(--brand-700);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-box {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--brand-50);
  color: var(--brand-600);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.refs {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 12px;
  color: var(--ink-500);
}
.refs .chip {
  display: inline-block;
  background: var(--brand-50);
  color: var(--brand-700);
  border-radius: 6px;
  padding: 2px 8px;
  margin: 2px 4px 0 0;
  font-size: 11px;
}
.fb {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.fb button {
  font-size: 12px;
  color: var(--ink-400);
  background: none;
  border: none;
  cursor: pointer;
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-family: inherit;
}
.fb button:hover,
.fb button.on {
  color: var(--brand-600);
}
.fb button.on {
  font-weight: 600;
}
.typing {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 4px 0;
}
.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-400);
  animation: bl 1.2s infinite;
}
.typing i:nth-child(2) {
  animation-delay: 0.2s;
}
.typing i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes bl {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}
.degrade {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--bg-soft);
  border: 1px dashed var(--border);
  font-size: 12.5px;
  color: var(--ink-600);
  line-height: 1.7;
}
.degrade .warn {
  flex: none;
  color: var(--warning);
  margin-top: 2px;
}
.composer {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.quick button {
  font-size: 12.5px;
  color: var(--brand-700);
  background: var(--primary-soft);
  border: 1px solid transparent;
  border-radius: var(--r-full);
  padding: 6px 12px;
  cursor: pointer;
  font-family: inherit;
}
.quick button:hover {
  border-color: var(--brand-300);
}
@media (max-width: 1000px) {
  .qa-grid {
    grid-template-columns: 1fr;
  }
  .hist-card {
    position: static;
  }
}
</style>
