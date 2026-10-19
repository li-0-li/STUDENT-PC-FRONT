<script setup>
/**
 * 作业详情（分支 stu-pc-homework）
 *
 * 关联接口（接口设计文档表号）：
 *   表 3-7  作业申诉        POST /api/v1/submissions/{submissionId}/appeal
 *   表 3-8  试卷题目        GET  /api/v1/assignments/{assignmentId}/questions（题干/选项/满分，不含答案）
 *   ★ 2026-10-19 新增：GET /api/v1/stu/submission?assignmentId=（stu-pc 只读：本人最新提交）
 * 对应原型：ui-prototype/pc/student-submission.html —— 1:1 还原（★ 2026-10-19 去演示数据，全真接入）
 *
 * ★ 2026-10-19 重写要点（参考学习通「作业详情」）：
 *   1. 移除原型 SUB 演示数据（原注释误判「契约无提交详情接口」，实为缺「按作业查我的提交」，
 *      已在 stu-pc 模块补齐）；
 *   2. 成绩卡：总分 / 满分 / 客观分 / 主观分 / 提交时间 / 批改时间 / 是否逾期；
 *   3. 逐题展示：题干 + 选项（我的选项高亮）+ 我的作答；
 *   4. 申诉：已批改状态可发起（表 3-7），申诉中展示理由；教师退回时展示原因并可重新作答；
 *   5. 未提交 → 空态 + 去作答。
 */
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { appealSubmission, mySubmission, assignmentQuestions } from '@/api/student/homework'
import { myTasks } from '@/api/student/task'

const route = useRoute()
const router = useRouter()

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/student/tasks')
}

/** 作业 id：新跳转统一用 ?assignmentId=（兼容旧 params.submissionId 传的作业 id） */
const assignmentId = ref(Number(route.query.assignmentId || route.params.submissionId) || 0)

const loading = ref(false)
const offline = ref(false)

/** 任务信息（标题/课程/截止，从「我的任务」按 assignmentId 取） */
const task = ref(null)
/** 我的最新提交（null = 未提交） */
const sub = ref(null)
/** 试卷题目（题干/选项/满分） */
const questions = ref([])

/** 我的作答：questionId → answer */
const myAnswers = computed(() => {
  if (!sub.value?.answers) return {}
  try {
    const arr = JSON.parse(sub.value.answers)
    const m = {}
    ;(Array.isArray(arr) ? arr : []).forEach((x) => {
      if (x?.questionId != null) m[x.questionId] = x.answer
    })
    return m
  } catch {
    return {}
  }
})

/** 状态文案与色调（后端 status 原样） */
const ST_MAP = {
  draft: { text: '草稿', tag: 'info' },
  submitted: { text: '已提交 · 待批改', tag: 'primary' },
  graded: { text: '已批改', tag: 'success' },
  finished: { text: '已完成', tag: 'success' },
  appealing: { text: '申诉处理中', tag: 'warning' },
  returned: { text: '已退回', tag: 'danger' }
}
const st = computed(() => ST_MAP[sub.value?.status] || { text: sub.value?.status || '—', tag: 'info' })

/** 能否申诉：已批改/已完成，且未在申诉中 */
const canAppeal = computed(
  () => !!sub.value && ['graded', 'finished'].includes(sub.value.status) && !sub.value.appealReason
)

const fullScore = computed(() => {
  const qs = questions.value
  if (!qs.length) return null
  return qs.reduce((s, q) => s + (Number(q.maxScore) || 0), 0)
})

function optionText(q, key) {
  const o = (q.options || []).find((x) => x.key === key)
  return o ? `${key}. ${o.text}` : key || '—'
}

async function load() {
  if (!assignmentId.value) {
    offline.value = true
    return
  }
  loading.value = true
  offline.value = false
  try {
    // 1) 任务信息（标题/课程/截止）
    const t = await myTasks().catch(() => [])
    const arr = Array.isArray(t) ? t : t?.list || []
    task.value =
      arr.find((x) => x.taskType === 'homework' && Number(x.taskRefId) === assignmentId.value) || null

    // 2) 我的最新提交
    sub.value = await mySubmission(assignmentId.value)

    // 3) 试卷题目（失败不影响其余展示）
    const q = await assignmentQuestions(assignmentId.value).catch(() => [])
    questions.value = Array.isArray(q) ? q : q?.list || []
  } catch {
    offline.value = true
  } finally {
    loading.value = false
  }
}

/** 去作答 / 重新作答 */
function goAnswer() {
  router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: assignmentId.value } })
}

/** 发起申诉（表 3-7）：弹窗输入理由 */
async function appeal() {
  let reason = ''
  try {
    const r = await ElMessageBox.prompt(
      '请填写申诉理由（5–200 字），教师复核后会更新成绩。',
      '发起申诉',
      {
        confirmButtonText: '提交申诉',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '例如：第 3 题评分有误，我的推导过程完整……',
        inputValidator: (v) => {
          const t = String(v || '').trim()
          if (t.length < 5) return '理由至少 5 个字'
          if (t.length > 200) return '理由不超过 200 字'
          return true
        }
      }
    )
    reason = String(r?.value || '').trim()
  } catch {
    return
  }
  if (!reason) return
  try {
    await appealSubmission(sub.value.submissionId, { reason })
    ElMessage.success('申诉已提交，等待教师复核')
    await load()
  } catch {
    // 4xx/5xx 由拦截器提示
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <!-- 头部 -->
    <div class="between mb16">
      <div class="row" style="gap: 10px">
        <el-button text circle title="返回上一页" @click="goBack">
          <BaseIcon name="arrow-left" :size="17" />
        </el-button>
        <div>
          <div class="row" style="gap: 10px">
            <h1 class="h1">{{ task?.title || '作业详情' }}</h1>
            <el-tag v-if="sub" :type="st.tag" effect="light">{{ st.text }}</el-tag>
            <el-tag v-else type="info" effect="light">未提交</el-tag>
          </div>
          <div class="small muted mt6">
            {{ task?.courseName || '—' }}
            <template v-if="task?.deadline">
              · 截止 {{ String(task.deadline).replace('T', ' ').slice(0, 16) }}
            </template>
          </div>
        </div>
      </div>
      <div class="row" style="gap: 8px">
        <el-button v-if="canAppeal" @click="appeal"><BaseIcon name="flag" :size="14" />申诉</el-button>
        <el-button v-if="!sub || sub.status === 'returned'" type="primary" @click="goAnswer">
          <BaseIcon name="pencil" :size="14" />{{ sub?.status === 'returned' ? '重新作答' : '去作答' }}
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="作业数据加载失败"
      description="请确认后端与 SSH 隧道已启动，或从「我的任务」重新进入"
    />

    <template v-else>
      <!-- 未提交空态 -->
      <el-card v-if="!sub" shadow="never">
        <EmptyState desc="你还没有提交这次作业，完成作答并提交后可在这里查看成绩与批改情况">
          <el-button type="primary" @click="goAnswer">去作答</el-button>
        </EmptyState>
      </el-card>

      <template v-else>
        <div class="dt-grid">
          <div class="stack">
            <!-- 成绩卡 -->
            <el-card shadow="never">
              <div class="score-row">
                <div class="score-main">
                  <span class="num">{{ sub.score ?? '—' }}</span>
                  <span class="unit">分<template v-if="fullScore"> / {{ fullScore }}</template></span>
                </div>
                <div class="score-sub">
                  <div class="s-line">
                    <span class="k">客观题</span>
                    <span>{{ sub.objectiveScore ?? '—' }}</span>
                  </div>
                  <div class="s-line">
                    <span class="k">主观题</span>
                    <span>{{ sub.subjectiveScore ?? '—' }}</span>
                  </div>
                  <div class="s-line">
                    <span class="k">提交时间</span>
                    <span>{{ sub.submitTime || '—' }}</span>
                  </div>
                  <div class="s-line">
                    <span class="k">批改时间</span>
                    <span>{{ sub.gradedTime || '待批改' }}</span>
                  </div>
                </div>
                <el-tag v-if="sub.isLate === 1" type="warning" effect="light" class="late">逾期提交</el-tag>
              </div>

              <!-- 退回原因 -->
              <div v-if="sub.status === 'returned' && sub.returnReason" class="banner warn">
                <BaseIcon name="circle-alert" :size="15" />
                <span>教师退回：{{ sub.returnReason }}</span>
              </div>
              <!-- 申诉状态 -->
              <div v-else-if="sub.appealReason" class="banner info">
                <BaseIcon name="flag" :size="15" />
                <span>申诉已提交：{{ sub.appealReason }}</span>
              </div>
            </el-card>

            <!-- 逐题 -->
            <el-card shadow="never">
              <div class="card-title">作答详情（{{ questions.length || '—' }} 题）</div>
              <div v-if="questions.length" class="q-list">
                <div v-for="(q, i) in questions" :key="q.questionId" class="q-item">
                  <div class="q-head">
                    <span class="q-no">{{ i + 1 }}</span>
                    <el-tag size="small" type="info" effect="plain">{{ q.typeText || q.qType }}</el-tag>
                    <span class="q-score">{{ q.maxScore ?? '—' }} 分</span>
                  </div>
                  <div class="q-content">{{ q.content }}</div>
                  <div v-if="q.options && q.options.length" class="q-options">
                    <span
                      v-for="o in q.options"
                      :key="o.key"
                      class="opt"
                      :class="{ mine: myAnswers[q.questionId] === o.key }"
                    >
                      {{ o.key }}. {{ o.text }}
                    </span>
                  </div>
                  <div class="q-answer">
                    <span class="k">我的作答</span>
                    <span v-if="myAnswers[q.questionId] == null" class="muted">（未作答）</span>
                    <span v-else-if="q.options && q.options.length">
                      {{ optionText(q, myAnswers[q.questionId]) }}
                    </span>
                    <span v-else class="ans-text">{{ myAnswers[q.questionId] }}</span>
                  </div>
                </div>
              </div>
              <EmptyState v-else desc="试卷题目暂不可用（教师端可能尚未发布题目明细）" />
            </el-card>
          </div>

          <!-- 右栏：作业信息 -->
          <div class="stack">
            <el-card shadow="never">
              <div class="card-title">作业信息</div>
              <div class="pf-row">
                <span class="k">课程</span><span class="small">{{ task?.courseName || '—' }}</span>
              </div>
              <div class="pf-row">
                <span class="k">截止时间</span>
                <span class="small">
                  {{ task?.deadline ? String(task.deadline).replace('T', ' ').slice(0, 16) : '—' }}
                </span>
              </div>
              <div class="pf-row">
                <span class="k">提交版本</span><span class="small">第 {{ sub.versionNo }} 次提交</span>
              </div>
              <div class="pf-row">
                <span class="k">是否逾期</span><span class="small">{{ sub.isLate === 1 ? '是' : '否' }}</span>
              </div>
              <div v-if="sub.attachment" class="pf-row">
                <span class="k">附件</span>
                <span class="small attach"><BaseIcon name="paperclip" :size="13" />{{ sub.attachment }}</span>
              </div>
              <div class="mt12 row" style="gap: 8px">
                <el-button size="small" @click="router.push({ name: 'StuTasks' })">全部任务</el-button>
                <el-button v-if="canAppeal" size="small" @click="appeal">发起申诉</el-button>
              </div>
            </el-card>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
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
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.dt-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  align-items: start;
}
.score-row {
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
}
.score-main {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--brand-700);
}
.score-main .num {
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
}
.score-main .unit {
  font-size: 13px;
  color: var(--ink-500);
}
.score-sub {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
.score-sub .s-line {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.score-sub .s-line .k {
  color: var(--ink-500);
}
.late {
  margin-left: auto;
}
.banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12.8px;
  line-height: 1.7;
}
.banner.warn {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}
.banner.info {
  background: var(--primary-softer);
  border: 1px solid var(--brand-200);
  color: var(--brand-700);
}
.q-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.q-item {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.q-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.q-no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--brand-100);
  color: var(--brand-700);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.q-score {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-500);
}
.q-content {
  margin-top: 8px;
  font-size: 13.8px;
  line-height: 1.7;
  color: var(--ink-800, var(--ink-700));
}
.q-options {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.opt {
  font-size: 13px;
  color: var(--ink-600);
  padding: 2px 6px;
  border-radius: 6px;
}
.opt.mine {
  background: var(--primary-soft);
  color: var(--brand-700);
  font-weight: 600;
}
.q-answer {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  font-size: 13px;
  line-height: 1.7;
}
.q-answer .k {
  flex: none;
  color: var(--ink-500);
}
.ans-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.pf-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 13.5px;
}
.pf-row:last-of-type {
  border-bottom: none;
}
.pf-row .k {
  color: var(--ink-500);
}
.attach {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  word-break: break-all;
}
@media (max-width: 1000px) {
  .dt-grid {
    grid-template-columns: 1fr;
  }
}
</style>
