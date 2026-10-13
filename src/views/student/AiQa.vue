<script setup>
/**
 * AI 答疑（分支 stu-pc-ai-qa）
 *
 * 关联接口（接口设计文档表号）：
 *   表 3-9  课程AI答疑      POST /api/v1/qa/ask
 *   表 3-10 答疑反馈        POST /api/v1/qa/{qaId}/feedback
 * 对应原型：ui-prototype/pc/student-ai.html（1:1 还原）
 *
 * 还原要点：
 *   1. 顶部标题 + 右侧「知识库（课程）」选择器，切换后重置会话并给出切换提示
 *   2. 对话区：用户气泡右对齐（品牌色实底）、AI 气泡左对齐（白底描边 + sparkles 图标）
 *   3. AI 气泡内含「引用来源」chips（虚线分隔）与「有用 / 无用」反馈按钮
 *   4. 命中率低于可信阈值（60%）时展示降级提示（原型：不做无依据生成 → 建议咨询教师）
 *   5. 检索中显示三点跳动动画 + 「正在检索课程知识库…」
 *   6. 底部固定输入卡片：输入框 + 提问按钮 + 快捷问题 chips + 说明文案
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { askQuestion, qaFeedback } from '@/api/student/qa'

/** 命中率可信阈值：低于此值视为「未命中知识库」（与原型一致） */
const DEGRADE_THRESHOLD = 0.6

/** 知识库选项（一门课一个知识库，courseId 与课程列表一致） */
const KBS = [
  { key: 'math', courseId: 10, name: '高等数学 A 知识库', quick: ['什么是导数？', '泰勒公式怎么用？', '洛必达法则的适用条件'] },
  { key: 'ds', courseId: 13, name: '数据结构知识库', quick: ['栈和队列的区别？', '什么是时间复杂度？', '二叉树遍历方式'] },
  { key: 'en', courseId: 11, name: '大学英语 III 知识库', quick: ['虚拟语气怎么用？', '非谓语动词辨析'] }
]

const kbKey = ref('math')
const kb = computed(() => KBS.find((k) => k.key === kbKey.value) || KBS[0])

/** 会话轮次：{ role: 'user' | 'ai', text, refs, qaId, score, degrade, feedback } */
const turns = ref([])
const input = ref('')
const asking = ref(false)
const chatEl = ref(null)

function scrollToBottom() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  })
}

/** 切换知识库：重置会话并给出提示（原型行为） */
function switchKb(key) {
  kbKey.value = key
  turns.value = [
    { role: 'user', text: `切换到「${kb.value.name}」` },
    {
      role: 'ai',
      text: `已切换知识库。你可以在下方直接提问，我会只基于「${kb.value.name}」中的资源作答，并附上引用来源。`,
      refs: [`知识库范围 · ${kb.value.name}`]
    }
  ]
  scrollToBottom()
}

async function ask(preset) {
  const text = String(preset ?? input.value ?? '').trim()
  if (!text) return
  if (asking.value) return

  input.value = ''
  turns.value.push({ role: 'user', text })
  asking.value = true
  scrollToBottom()

  const parentQaId = [...turns.value].reverse().find((t) => t.role === 'ai' && t.qaId)?.qaId

  try {
    const data = await askQuestion({ courseId: kb.value.courseId, question: text, parentQaId })
    const score = Number(data?.score ?? data?.topScore ?? 1)
    const refs = (data?.citations || []).map((c) =>
      typeof c === 'string' ? c : [c?.sourceFile, c?.snippet].filter(Boolean).join(' · ')
    )
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
              `未在当前知识库（${kb.value.name}）检索到与「${text}」高度相关的内容。`
          }
    )
  } catch (e) {
    // request.js 已统一提示错误，这里只保证会话不卡在「检索中」
    turns.value.push({
      role: 'ai',
      degrade: true,
      score: 0,
      text: `检索失败：${e?.message || '请稍后重试'}`
    })
  } finally {
    asking.value = false
    scrollToBottom()
  }
}

/** 反馈：有用 / 无用（表 3-10）。后端不可用时仅本地标记，不阻断交互 */
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

onMounted(() => {
  const first = kb.value.quick?.[0]
  scrollToBottom()
  // 首屏给一句引导，避免空白；不预置假对话内容
  if (!turns.value.length && first) {
    turns.value.push({
      role: 'ai',
      text: `选择知识库后直接提问即可，我会基于「${kb.value.name}」检索作答并附引用来源。也可以点下面的快捷问题试试。`,
      refs: [`知识库范围 · ${kb.value.name}`]
    })
    scrollToBottom()
  }
})
</script>

<template>
  <div>
    <PageHeader title="AI 答疑" desc="基于课程知识库检索作答，回答附引用来源；命中率低时建议咨询教师">
      <template #actions>
        <el-select v-model="kbKey" style="width: 220px" @change="switchKb">
          <el-option v-for="k in KBS" :key="k.key" :label="k.name" :value="k.key" />
        </el-select>
      </template>
    </PageHeader>

    <!-- 对话区 -->
    <div ref="chatEl" class="chat-wrap">
      <div class="chat">
        <template v-for="(t, i) in turns" :key="i">
          <!-- 用户气泡：右对齐、品牌色实底 -->
          <div v-if="t.role === 'user'" class="msg user">
            <span class="avatar">黎</span>
            <div class="bubble">{{ t.text }}</div>
          </div>

          <!-- AI 气泡：左对齐、白底描边 -->
          <div v-else class="msg ai">
            <span class="icon-box"><BaseIcon name="sparkles" :size="16" /></span>
            <div class="bubble">
              {{ t.text }}

              <!-- 降级提示：命中率低于可信阈值 -->
              <div v-if="t.degrade" class="degrade">
                <BaseIcon name="circle-alert" :size="15" class="warn" />
                <span>
                  知识库最高匹配度仅 <b>{{ Math.round((t.score || 0) * 100) }}%</b>，低于可信阈值（60%）。
                  按照平台约定，AI 不做无依据生成——建议换一种说法再问，或到「客服」提交问题由任课教师解答。
                </span>
              </div>

              <!-- 引用来源 -->
              <div v-else-if="t.refs && t.refs.length" class="refs">
                引用来源：
                <span v-for="(r, ri) in t.refs" :key="ri" class="chip">{{ r }}</span>
              </div>

              <!-- 反馈（表 3-10） -->
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

    <!-- 底部输入卡片（固定） -->
    <div class="composer">
      <div class="row">
        <el-input
          v-model="input"
          placeholder="基于课程知识库提问……"
          @keydown.enter.prevent="ask()"
        />
        <el-button type="primary" :loading="asking" @click="ask()">
          <BaseIcon name="send" :size="15" />提问
        </el-button>
      </div>
      <div class="quick">
        <button v-for="(q, i) in kb.quick" :key="i" @click="ask(q)">{{ q }}</button>
      </div>
      <div class="small muted mt8">回答基于本课程知识库检索生成并附引用；命中率低时将建议咨询教师。</div>
    </div>
  </div>
</template>

<style scoped>
.chat-wrap {
  max-width: 860px;
  height: calc(100vh - 268px);
  min-height: 320px;
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
  max-width: 80%;
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
  position: sticky;
  bottom: 16px;
  max-width: 860px;
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
</style>
