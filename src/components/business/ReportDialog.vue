<script setup>
/**
 * 业务层组件：内容举报弹窗（跨页面共享）
 *
 * 使用场景（targetType 取后端校验的 4 值）：
 *   chat_message    消息举报（Messages 页，气泡 hover）
 *   qa_record       AI 回答举报（AI 答疑页）
 *   support_message 客服消息举报（客服页）
 *   user            用户举报（个人中心 / 会话对方）
 *
 * 提交成功 emit('saved')；409（重复举报未处理）等错误由 request.js 拦截器统一提示。
 * 接口：POST /api/v1/reports（stu-pc 模块）
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { submitReport } from '@/api/student/report'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** chat_message | qa_record | support_message | user */
  targetType: { type: String, default: 'chat_message' },
  targetId: { type: [Number, String], default: null },
  targetUserId: { type: [Number, String], default: null },
  /** 弹窗副标题：被举报内容的可读描述（如「张老师：这道题这样做…」） */
  targetLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const REASONS = [
  { v: 'spam', label: '垃圾广告 / 骚扰信息' },
  { v: 'abuse', label: '辱骂 / 人身攻击' },
  { v: 'porn', label: '色情 / 低俗内容' },
  { v: 'fraud', label: '诈骗 / 虚假信息' },
  { v: 'other', label: '其他违规内容' }
]

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const reason = ref('')
const detail = ref('')
const evidenceUrl = ref('')
const submitting = ref(false)

function reset() {
  reason.value = ''
  detail.value = ''
  evidenceUrl.value = ''
}

async function submit() {
  if (!reason.value) {
    ElMessage.warning('请选择举报理由')
    return
  }
  // 理由 + 补充说明拼装（后端只收一个 reason 字符串）
  const reasonText = detail.value.trim()
    ? `${REASONS.find((r) => r.v === reason.value)?.label}：${detail.value.trim()}`
    : REASONS.find((r) => r.v === reason.value)?.label
  submitting.value = true
  try {
    await submitReport({
      targetType: props.targetType,
      targetId: props.targetId ?? undefined,
      targetUserId: props.targetUserId ?? undefined,
      reason: reasonText,
      evidenceUrl: evidenceUrl.value.trim() || undefined
    })
    ElMessage.success('举报已提交，管理员会尽快处理')
    visible.value = false
    reset()
    emit('saved')
  } catch {
    // 409 重复 / 422 校验等由拦截器提示
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="举报" width="440px">
    <div v-if="targetLabel" class="rp-target">
      <BaseIcon name="flag" :size="14" />
      <span>{{ targetLabel }}</span>
    </div>

    <div class="field-label">举报理由</div>
    <el-radio-group v-model="reason" class="rp-reasons">
      <el-radio v-for="r in REASONS" :key="r.v" :value="r.v" style="display: flex">{{ r.label }}</el-radio>
    </el-radio-group>

    <div class="field-label mt12">补充说明（选填）</div>
    <el-input
      v-model="detail"
      type="textarea"
      :rows="3"
      maxlength="200"
      show-word-limit
      placeholder="请描述具体违规情况，便于管理员核实"
    />

    <div class="field-label mt12">证据链接（选填）</div>
    <el-input v-model="evidenceUrl" placeholder="如截图 / 文件链接" />

    <div class="small muted mt8">举报将提交给平台管理员处理，恶意举报可能影响账号信用。</div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">提交举报</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rp-target {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--ink-600);
  background: var(--bg-subtle);
  border: 1px dashed var(--border);
  border-radius: 8px;
  line-height: 1.6;
  word-break: break-all;
}
.rp-target svg {
  flex: none;
  margin-top: 2px;
  color: var(--ink-400);
}
.rp-reasons {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.mt12 {
  margin-top: 12px;
}
.mt8 {
  margin-top: 8px;
}
</style>
