<script setup>
/**
 * 成绩申诉弹窗（学生端）
 *
 * 对应后端：POST /api/v1/submissions/{submissionId}/appeal
 *
 * ★ 入参字段名必须是 appealReason（SubmissionActionBo.Appeal），
 *   不是 reason —— 传 reason 会被 @NotBlank 打回 400「申诉理由不能为空」。
 *
 * 后端的三条硬约束（SubmissionActionServiceImpl#appeal），前端在弹窗里前置校验，
 * 学生打开就能看到为什么不能申诉，而不是填完理由才吃 409：
 *   1. submission.status 必须是 finished（只有已完成批改的才可申诉）；
 *   2. assignment.allow_appeal = 1（教师关闭申诉时入口不该出现，兜底由后端 409）；
 *   3. 批改完成（graded_time）后 7 天内，超时关闭入口。
 *
 * 用法：
 *   <AppealDialog v-model="visible" :assignment-id="id" :title="title" @success="load" />
 *   <AppealDialog v-model="visible" :submission="sub" :title="title" @success="load" />
 *   （已有提交详情时传 submission，省一次请求；只传 assignmentId 则弹窗内自行拉取）
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { appealSubmission, mySubmission } from '@/api/student/homework'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 作业 id（用于拉本人提交详情） */
  assignmentId: { type: Number, default: 0 },
  /** 已有的提交详情（GET /api/v1/stu/submission 的返回），传了就不再请求 */
  submission: { type: Object, default: null },
  /** 作业标题，仅用于展示 */
  title: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'success'])

/** 与后端 SubmissionActionServiceImpl.APPEAL_WINDOW_DAYS 保持一致 */
const WINDOW_DAYS = 7
const DAY_MS = 86400000

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const submitting = ref(false)
const detail = ref(null)
const reason = ref('')
const loadError = ref('')

const ST_TEXT = {
  draft: '草稿',
  submitted: '已提交待批改',
  queued: '排队中',
  grading: '批改中',
  manual: '待人工复核',
  finished: '已批改',
  appealing: '申诉处理中',
  returned: '已退回'
}

/** "2026-11-11 13:41" → Date（Safari 不认空格分隔，换成 T） */
function parseTime(s) {
  const t = String(s || '').trim()
  if (!t) return null
  const d = new Date(t.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

const submissionId = computed(() => detail.value?.submissionId || null)
const gradedAt = computed(() => parseTime(detail.value?.gradedTime))
const appealDeadline = computed(() =>
  gradedAt.value ? new Date(gradedAt.value.getTime() + WINDOW_DAYS * DAY_MS) : null
)
/** 剩余天数（向上取整；0 = 已过期） */
const daysLeft = computed(() => {
  if (!appealDeadline.value) return null
  const ms = appealDeadline.value.getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
})
const deadlineText = computed(() => {
  const d = appealDeadline.value
  if (!d) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

/** 不可申诉的原因（空串 = 可以申诉） */
const blocked = computed(() => {
  if (loading.value) return ''
  if (loadError.value) return loadError.value
  const d = detail.value
  if (!d) return '没有找到这次作业的提交记录'
  // 注意：submission.appeal_reason 被后端复用为「学生申诉理由 / 教师处理结论」两种语义，
  // 申诉中时是学生原话，教师处理完（status 回到 finished）后是结论。文案要分开，不能都写成「已提交申诉」。
  if (d.status === 'appealing') return '申诉已提交，正在等待教师复核'
  if (d.appealReason) return '本次成绩已申诉过（处理结果见下方），同一份成绩只能申诉一次'
  if (d.status !== 'finished') {
    return `当前状态为「${ST_TEXT[d.status] || d.status}」，只有已完成批改的作业可以申诉`
  }
  if (daysLeft.value === 0) return `已超过申诉时限（批改完成后 ${WINDOW_DAYS} 天内可申诉）`
  return ''
})

/** 已有申诉记录时的标题（区分「我提交的理由」和「教师给的处理结论」） */
const reasonLabel = computed(() =>
  detail.value?.status === 'appealing' ? '我提交的申诉理由' : '申诉处理结果'
)

const canSubmit = computed(
  () => !blocked.value && !submitting.value && reason.value.trim().length >= 5
)

async function load() {
  loadError.value = ''
  reason.value = ''
  if (props.submission) {
    detail.value = props.submission
    return
  }
  if (!props.assignmentId) {
    loadError.value = '缺少作业参数，请从作业列表重新进入'
    return
  }
  loading.value = true
  detail.value = null
  try {
    detail.value = await mySubmission(props.assignmentId)
  } catch {
    loadError.value = '提交记录加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) load()
  }
)

async function submit() {
  const r = reason.value.trim()
  if (r.length < 5) {
    ElMessage.warning('申诉理由至少 5 个字')
    return
  }
  if (r.length > 500) {
    ElMessage.warning('申诉理由不超过 500 字')
    return
  }
  if (!submissionId.value) return
  submitting.value = true
  try {
    // ★ 字段名 appealReason —— 后端 SubmissionActionBo.Appeal 的唯一入参
    await appealSubmission(submissionId.value, { appealReason: r })
    ElMessage.success('申诉已提交，等待教师复核')
    visible.value = false
    emit('success')
  } catch {
    // 4xx/5xx 由 request 拦截器统一提示
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="成绩申诉" width="560px" :close-on-click-modal="false">
    <div v-loading="loading" class="ap-body">
      <!-- 作业与成绩 -->
      <div class="ap-head">
        <div class="ap-title">{{ title || '本次作业' }}</div>
        <div class="ap-score">
          <span class="num">{{ detail?.score ?? '—' }}</span>
          <span class="unit">分</span>
        </div>
      </div>

      <div class="ap-meta">
        <div class="ap-row">
          <span class="k">批改时间</span>
          <span>{{ detail?.gradedTime || '—' }}</span>
        </div>
        <div class="ap-row">
          <span class="k">申诉截止</span>
          <span>
            {{ deadlineText }}
            <template v-if="daysLeft !== null && daysLeft > 0">
              <span class="left">（剩 {{ daysLeft }} 天）</span>
            </template>
          </span>
        </div>
      </div>

      <!-- 不可申诉说明 -->
      <el-alert
        v-if="blocked"
        class="mb12"
        type="warning"
        :closable="false"
        show-icon
        :title="blocked"
      />

      <!-- 已有申诉记录 -->
      <div v-if="detail?.appealReason" class="ap-reason">
        <div class="k">{{ reasonLabel }}</div>
        <div class="v">{{ detail.appealReason }}</div>
      </div>

      <template v-if="!blocked">
        <div class="ap-label">申诉理由</div>
        <el-input
          v-model="reason"
          type="textarea"
          :rows="5"
          maxlength="500"
          show-word-limit
          placeholder="请说明需要复核的地方，例如：第 3 题的推导过程完整，评分似有遗漏……"
        />
        <div class="ap-tip">
          <BaseIcon name="info" :size="13" />
          申诉提交后状态变为「申诉处理中」，教师复核后会更新成绩，请如实填写。
        </div>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
        提交申诉
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ap-body {
  min-height: 120px;
}
.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.ap-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
}
.ap-score {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--brand-700);
  flex: none;
}
.ap-score .num {
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
}
.ap-score .unit {
  font-size: 12px;
  color: var(--ink-500);
}
.ap-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  padding: 12px 0;
  font-size: 13px;
}
.ap-row {
  display: flex;
  gap: 8px;
}
.ap-row .k {
  color: var(--ink-500);
}
.ap-row .left {
  color: var(--warning);
  font-weight: 600;
}
.mb12 {
  margin-bottom: 12px;
}
.ap-reason {
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: 9px;
  background: var(--primary-softer);
  border: 1px solid var(--brand-200);
}
.ap-reason .k {
  font-size: 12px;
  color: var(--brand-700);
  font-weight: 600;
}
.ap-reason .v {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-800, var(--ink-700));
  white-space: pre-wrap;
}
.ap-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}
.ap-tip {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-500);
  line-height: 1.6;
}
</style>
