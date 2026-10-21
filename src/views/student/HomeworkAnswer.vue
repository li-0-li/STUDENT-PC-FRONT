<script setup>
/**
 * 作业作答（分支 stu-pc-homework）
 * 关联接口（接口设计文档表号）：
 *   表 3-6  提交作业        POST /api/v1/assignments/{assignmentId}/submissions
 *   表 3-8  试卷题目        GET  /api/v1/assignments/{assignmentId}/questions（题干/选项/满分，不含答案）
 *   ★ 2026-10-19 新增：GET /api/v1/stu/submission?assignmentId=（判断是否已提交）
 * 对应原型：ui-prototype/pc/student-homework.html —— 1:1 还原（★ 2026-10-19 去演示数据）
 *
 * ★ 2026-10-19 重写要点（参考学习通作答页）：
 *   1. **原页面整页是假的**：题目写死 5 道数学题、提交传 courseId=0、草稿/评测都是假提示。
 *      实际 /questions（题目）与 /submissions（提交）接口早就存在，本次全部接真；
 *   2. 题型按 q_type 渲染：single 单选 / multi 多选 / judge 判断 / blank 填空 / short 简答 /
 *      program 编程（无判题服务，运行测试如实提示）；题目缺选项时给文本输入兜底；
 *   3. 倒计时按真实 deadline 计算；过期提示「提交将标记逾期」（后端 is_late 自动打标）；
 *   4. 提交成功跳转「作业详情」查看成绩；已提交再次进入时顶部提示「可重新提交（版本 +1）」。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { submitHomework, mySubmission, assignmentQuestions } from '@/api/student/homework'
import { uploadFile } from '@/api/auth'
import { myTasks } from '@/api/student/task'

const route = useRoute()
const router = useRouter()

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/student/tasks')
}

const assignmentId = ref(Number(route.params.assignmentId) || 0)
const loading = ref(false)
const submitting = ref(false)

/** 任务信息（标题/课程/截止） */
const task = ref(null)
/** 已有提交（null = 未提交；非 null 表示重交场景） */
const existing = ref(null)
/** 题目：{ questionId, qType, typeText, content, options:[{key,text}], maxScore, value } */
const questions = ref([])

const totalScore = computed(() => questions.value.reduce((s, q) => s + (Number(q.maxScore) || 0), 0))

/**
 * 是否允许提交（与后端状态机一致，实测口径）：
 *   未提交 → 允许；
 *   returned（教师退回）/ draft → 允许重新提交；
 *   submitted / graded / finished / appealing → 后端 409「当前状态不允许再次提交」。
 */
const canSubmit = computed(
  () => !existing.value || ['returned', 'draft'].includes(existing.value.status)
)

/** 不允许提交时的原因文案 */
const blockReason = computed(() => {
  if (!existing.value) return ''
  const M = {
    submitted: '本次作业已提交、正在批改中',
    graded: '本次作业已批改',
    finished: '本次作业已完成评阅',
    appealing: '成绩申诉处理中'
  }
  return `${M[existing.value.status] || '当前状态'}，如需修改请联系任课教师将作业退回后再作答`
})

const answeredCount = computed(
  () =>
    questions.value.filter((q) => {
      const v = q.value
      return Array.isArray(v) ? v.length > 0 : String(v || '').trim().length > 0
    }).length
)

/* ---------------- 截止时间与倒计时 ---------------- */
const deadline = computed(() => (task.value?.deadline ? new Date(task.value.deadline) : null))
const now = ref(Date.now())
let timer = null

const overdue = computed(() => !!deadline.value && now.value > deadline.value.getTime())

const leftText = computed(() => {
  if (!deadline.value) return '—'
  const diff = deadline.value.getTime() - now.value
  if (diff <= 0) return '已截止'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (d > 0) return `${d} 天 ${h} 小时`
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
})

/** 题型标签（后端 typeText 优先） */
function typeLabelOf(q) {
  const M = {
    single: '单选题',
    multi: '多选题',
    judge: '判断题',
    blank: '填空题',
    short: '简答题',
    program: '编程题'
  }
  return q.typeText || M[q.qType] || q.qType
}

/** 是否客观选择题控件可用（有选项才算） */
function hasOptions(q) {
  return Array.isArray(q.options) && q.options.length > 0
}

/** 判断题固定两个选项（库中标准答案为「正确/错误」字样） */
const JUDGE_OPTS = [
  { key: '正确', text: '正确' },
  { key: '错误', text: '错误' }
]

async function load() {
  if (!assignmentId.value) return
  loading.value = true
  try {
    const t = await myTasks().catch(() => [])
    const arr = Array.isArray(t) ? t : t?.list || []
    task.value =
      arr.find((x) => x.taskType === 'homework' && Number(x.taskRefId) === assignmentId.value) || null

    existing.value = await mySubmission(assignmentId.value).catch(() => null)
    if (existing.value?.attachment) {
      attachmentUrl.value = existing.value.attachment
      attachmentName.value = String(existing.value.attachment).split('/').pop() || '已提交的附件'
    }

    const raw = await assignmentQuestions(assignmentId.value).catch(() => [])
    const list = Array.isArray(raw) ? raw : raw?.list || []
    questions.value = list.map((q) => ({
      questionId: q.questionId,
      qType: q.qType,
      typeText: q.typeText,
      content: q.content,
      options:
        q.qType === 'judge'
          ? JUDGE_OPTS
          : (q.options || []).map((o) => ({ key: o.key, text: o.text })),
      maxScore: q.maxScore,
      value: q.qType === 'multi' ? [] : ''
    }))
  } catch {
    ElMessage.error('作业数据加载失败，请确认后端与 SSH 隧道已启动')
  } finally {
    loading.value = false
  }
}

/* ---------------- ★ 2026-10-21 整份附件（本地存储已启用） ---------------- */
const attachmentUrl = ref('')
const attachmentName = ref('')
const attaching = ref(false)

function pickAttachment() {
  if (attaching.value) return
  const el = document.createElement('input')
  el.type = 'file'
  el.onchange = async () => {
    const f = el.files?.[0]
    if (!f) return
    if (f.size > 20 * 1024 * 1024) {
      ElMessage.warning('附件不能超过 20MB')
      return
    }
    attaching.value = true
    try {
      const up = await uploadFile(f)
      attachmentUrl.value = up?.url || ''
      attachmentName.value = up?.fileName || f.name
      ElMessage.success('附件已添加')
    } catch {
      ElMessage.error('附件上传失败，请重试')
    } finally {
      attaching.value = false
    }
  }
  el.click()
}
function removeAttachment() {
  attachmentUrl.value = ''
  attachmentName.value = ''
}

/** 提交作业（表 3-6）：多选 join(',')，其余去空格；整份附件走 attachment 字段 */
async function submit() {
  if (!questions.value.length) return
  const un = questions.value.length - answeredCount.value
  if (un > 0) {
    try {
      await ElMessageBox.confirm(`还有 ${un} 题未作答，确定现在提交吗？`, '提交确认', {
        confirmButtonText: '仍然提交',
        cancelButtonText: '继续作答',
        type: 'warning'
      })
    } catch {
      return
    }
  }
  const answers = questions.value.map((q) => ({
    questionId: q.questionId,
    answer: Array.isArray(q.value) ? q.value.join(',') : String(q.value || '').trim()
  }))
  submitting.value = true
  try {
    const body = { answers }
    if (attachmentUrl.value) body.attachment = attachmentUrl.value
    await submitHomework(assignmentId.value, body)
    ElMessage.success('提交成功，正在跳转成绩页…')
    router.replace({ name: 'StuSubmission', query: { assignmentId: assignmentId.value } })
  } catch {
    // 4xx/5xx（含教师未发布/重复提交限制）由拦截器提示
  } finally {
    submitting.value = false
  }
}

/** 编程题「运行测试」：无本地判题服务，如实说明 */
function runTest() {
  ElMessage.info('提交后由系统批改服务执行测试用例；本地暂不提供在线运行')
}

onMounted(() => {
  load()
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div v-loading="loading">
    <!-- 顶部信息卡 -->
    <el-card shadow="never">
      <div class="between">
        <div>
          <div class="row" style="gap: 10px">
            <el-button text circle title="返回上一页" @click="goBack">
              <BaseIcon name="arrow-left" :size="17" />
            </el-button>
            <h1 class="h1">{{ task?.title || '作业作答' }}</h1>
            <el-tag :type="overdue ? 'danger' : 'warning'" effect="light">
              {{ overdue ? '已截止' : '进行中' }}
            </el-tag>
            <el-tag v-if="existing" type="success" effect="light">已提交 · 第 {{ existing.versionNo }} 版</el-tag>
          </div>
          <div class="muted small mt8">
            {{ task?.courseName || '—' }} · 总分 {{ totalScore || '—' }}
            <template v-if="task?.deadline">
              · 截止 {{ String(task.deadline).replace('T', ' ').slice(0, 16) }}
            </template>
          </div>
        </div>
        <div style="text-align: right">
          <div class="small muted">{{ overdue ? '提交状态' : '剩余时间' }}</div>
          <div class="countdown" :class="{ bad: overdue }">{{ leftText }}</div>
        </div>
      </div>
    </el-card>

    <!-- 已提交 / 逾期提示 -->
    <el-alert
      v-if="existing && !canSubmit"
      class="mt12"
      type="info"
      :closable="false"
      show-icon
      :title="`已提交（第 ${existing.versionNo} 版）· ${blockReason}`"
    >
      <div class="mt8">
        <el-button size="small" @click="router.push({ name: 'StuSubmission', query: { assignmentId } })">
          查看成绩详情
        </el-button>
      </div>
    </el-alert>
    <el-alert
      v-else-if="existing"
      class="mt12"
      type="warning"
      :closable="false"
      show-icon
      :title="`教师已退回本次作业（第 ${existing.versionNo} 版），修改后可重新提交`"
    />
    <el-alert
      v-if="overdue"
      class="mt12"
      type="warning"
      :closable="false"
      show-icon
      title="已过截止时间：作业允许逾期时提交将标记「逾期」，不允许逾期时提交会被拒绝"
    />

    <!-- 题目列表 -->
    <div v-if="questions.length" class="stack mt16 cards">
      <el-card v-for="(q, i) in questions" :key="q.questionId" shadow="never">
        <div class="between">
          <b>
            {{ i + 1 }}.（{{ typeLabelOf(q) }} · {{ q.maxScore ?? '—' }} 分）{{ q.content }}
          </b>
          <el-tag
            :type="['single', 'multi', 'judge', 'blank'].includes(q.qType) ? 'info' : 'warning'"
            effect="light"
          >
            {{ ['single', 'multi', 'judge', 'blank'].includes(q.qType) ? '客观题' : '主观题' }}
          </el-tag>
        </div>

        <!-- 单选 / 判断（有选项时） -->
        <el-radio-group
          v-if="(q.qType === 'single' || q.qType === 'judge') && hasOptions(q)"
          v-model="q.value"
          class="stack mt12 opts"
        >
          <el-radio v-for="o in q.options" :key="o.key" :value="o.key">{{ o.key }}. {{ o.text }}</el-radio>
        </el-radio-group>

        <!-- 多选 -->
        <el-checkbox-group
          v-else-if="q.qType === 'multi' && hasOptions(q)"
          v-model="q.value"
          class="stack mt12 opts"
        >
          <el-checkbox v-for="o in q.options" :key="o.key" :value="o.key">{{ o.key }}. {{ o.text }}</el-checkbox>
        </el-checkbox-group>

        <!-- 选项缺失兜底（如教师端题目未录入选项） -->
        <template v-else-if="q.qType === 'single' || q.qType === 'multi' || q.qType === 'judge'">
          <el-alert
            class="mt12"
            type="info"
            :closable="false"
            show-icon
            title="该题暂未录入选项，请直接填写答案，或联系任课教师补录题目选项"
          />
          <el-input v-model="q.value" class="mt8" placeholder="填写你的答案" />
        </template>

        <!-- 填空 -->
        <el-input
          v-else-if="q.qType === 'blank'"
          v-model="q.value"
          class="mt12"
          placeholder="请输入答案"
          style="max-width: 320px"
        />

        <!-- 简答 -->
        <el-input
          v-else-if="q.qType === 'short'"
          v-model="q.value"
          class="mt12"
          type="textarea"
          :rows="6"
          placeholder="请输入作答内容（提交后 AI 初判 + 教师复核）"
        />

        <!-- 编程 -->
        <template v-else-if="q.qType === 'program'">
          <el-input
            v-model="q.value"
            class="mt12 code"
            type="textarea"
            :rows="8"
            placeholder="在此粘贴/编写代码，提交后由系统测试用例判分"
          />
          <div class="row mt12" style="gap: 10px">
            <el-button size="small" @click="runTest"><BaseIcon name="play" :size="14" />运行测试</el-button>
            <span class="small muted">提交后由系统批改服务执行测试用例</span>
          </div>
        </template>

        <!-- 未知题型兜底 -->
        <el-input v-else v-model="q.value" class="mt12" type="textarea" :rows="4" placeholder="请输入作答内容" />
      </el-card>
    </div>

    <el-card v-else-if="!loading" shadow="never" class="mt16">
      <EmptyState desc="该作业暂未发布题目，请稍后再试或联系任课教师" />
    </el-card>

    <!-- 底部粘性提交条 -->
    <el-card v-if="questions.length" shadow="always" class="sticky-bar">
      <div class="between">
        <div class="left-col">
          <span class="small muted">
            已作答 {{ answeredCount }} / {{ questions.length }} 题
            <template v-if="overdue"> · 已过截止，提交将标记逾期</template>
          </span>
          <div class="att-row">
            <template v-if="attachmentName">
              <span class="att-chip">
                <BaseIcon name="paperclip" :size="12" />
                <span class="att-name">{{ attachmentName }}</span>
                <span class="att-x" title="移除附件" @click="removeAttachment">×</span>
              </span>
            </template>
            <el-button v-else size="small" text :loading="attaching" @click="pickAttachment">
              <BaseIcon name="paperclip" :size="13" />添加附件（选填，≤20MB）
            </el-button>
          </div>
        </div>
        <div class="row" style="gap: 10px">
          <el-button @click="goBack">返回</el-button>
          <el-button v-if="canSubmit" type="primary" :loading="submitting" @click="submit">
            <BaseIcon name="send" :size="14" />{{ existing ? '重新提交' : '提交作业' }}
          </el-button>
          <el-button
            v-else
            type="primary"
            @click="router.push({ name: 'StuSubmission', query: { assignmentId } })"
          >
            查看成绩详情
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
}
.countdown {
  font-size: 22px;
  font-weight: 800;
  color: var(--warning);
  font-family: var(--font-mono);
}
.countdown.bad {
  color: var(--error);
  font-size: 18px;
}
.cards {
  max-width: 900px;
}
.opts :deep(.el-radio),
.opts :deep(.el-checkbox) {
  display: flex;
  height: auto;
  margin-right: 0;
}
.code :deep(textarea) {
  font-family: var(--font-mono);
}
.sticky-bar {
  position: sticky;
  bottom: 16px;
  margin-top: 16px;
  max-width: 900px;
}
.mt8 {
  margin-top: 8px;
}
.mt12 {
  margin-top: 12px;
}
.mt16 {
  margin-top: 16px;
}
.left-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.att-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.att-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--primary-soft);
  color: var(--brand-700);
  font-size: 12px;
  max-width: 320px;
}
.att-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-x {
  cursor: pointer;
  color: var(--ink-400);
  font-size: 14px;
  line-height: 1;
}
.att-x:hover {
  color: var(--error);
}
</style>
