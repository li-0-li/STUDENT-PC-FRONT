<script setup>
/**
 * 实验报告详情（分支 stu-pc-lab）—— ★ 2026-11-24 独立完整页面
 *
 * 为什么独立成页：
 *   旧实现点击实验任务（作业中心实验页签 / 课程详情任务行 / 实验列表）后，
 *   仍落到 /student/lab 的**列表页**，仅靠 query.taskId 高亮一行并弹一个 dialog，
 *   外层已经看过列表、再进一次列表是多余的一层，详情也不该只塞在弹窗里。
 *   本页把「实验基本信息 + 报告内容/结果 + 相关操作」做成完整页面。
 *
 * 数据源（全部真实接口，不编造）：
 *   - GET /api/v1/stu/experiments                → 按 taskId 取任务基本信息 + 最近提交摘要（subId/成绩/查重）
 *   - GET /api/v1/stu/experiment-submissions/{subId} → 报告正文 formData / reportContent / dataFiles / 评语 / AI 预审
 *   - GET /api/v1/stu/experiment-submissions/{subId}/report → 下载 Word（返回 {fileName,url}）
 *   - POST /api/v1/stu/experiments/{taskId}/submissions → 提交/重新提交报告
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import {
  experimentList,
  submitLabReport,
  labReportDetail,
  downloadLabReport
} from '@/api/student/lab'
import { pickAndUpload } from '@/utils/upload'
import { downloadFile, previewFile } from '@/utils/filePreview'

const route = useRoute()
const router = useRouter()

const taskId = computed(() => Number(route.params.taskId) || 0)
const loading = ref(true)
const notFound = ref(false)
/** 任务基本信息（来自实验列表按 taskId 定位） */
const task = ref(null)
/** 报告详情（来自 GET /experiment-submissions/{subId}，未提交时为 null） */
const detail = ref(null)
const detailError = ref('')

function parseTime(t) {
  if (!t) return null
  const s = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? null : d
}
function fmtFull(t) {
  const d = parseTime(t)
  if (!d) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function deadlineText(t) {
  const d = parseTime(t)
  return d ? fmtFull(t) : '未设置'
}
/** 是否已过截止（只看截止时间，与作业中心口径一致） */
const overdue = computed(() => {
  const d = parseTime(task.value?.deadline)
  return !!d && Date.now() > d.getTime()
})

/** 与列表/作业中心同口径：提交态优先；未提交且已过截止显示「已截止」 */
const statusText = computed(() => {
  const s = String(detail.value?.status || task.value?.subStatus || '').toUpperCase()
  if (s === 'GRADED') return '已批阅'
  if (s === 'SUBMITTED') return '待批阅'
  if (overdue.value) return '已截止'
  return '待提交'
})
const statusType = computed(() => ({
  已批阅: 'success', 待批阅: 'info', 已截止: 'info', 待提交: 'warning'
})[statusText.value])
const hasReport = computed(() => !!(detail.value?.subId || task.value?.subId))

async function load() {
  loading.value = true
  notFound.value = false
  detail.value = null
  detailError.value = ''
  try {
    const d = await experimentList()
    const list = Array.isArray(d) ? d : d?.list || []
    const raw = list.find((r) => Number(r.taskId) === taskId.value)
    if (!raw) {
      notFound.value = true
      return
    }
    task.value = {
      taskId: raw.taskId,
      subId: raw.subId ?? null,
      title: raw.title,
      courseName: raw.courseName,
      objective: raw.objective || '',
      guide: raw.guide || '',
      deadline: raw.deadline,
      startTime: raw.startTime,
      totalScore: raw.totalScore,
      allowLate: raw.allowLate === true || raw.allowLate === 1,
      subStatus: raw.subStatus,
      score: raw.score,
      duplicateRate: raw.duplicateRate
    }
    if (raw.subId != null) {
      try {
        detail.value = await labReportDetail(raw.subId) || null
      } catch (e) {
        detailError.value = e?.message || '报告内容加载失败，请稍后重试'
      }
    }
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

/* ---------------- 报告正文 / 附件（兼容多种历史格式） ---------------- */
/** formData 可能是 JSON 字符串，兼容 {sections:[{section,content}]} 与 {键:值} 两种形态 */
function parseReportBody(raw) {
  if (!raw) return []
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return [{ section: '报告内容', content: raw }]
    }
  }
  if (!obj || typeof obj !== 'object') return []
  if (Array.isArray(obj.sections)) {
    return obj.sections
      .map((s) => ({ section: s?.section || s?.title || '内容', content: s?.content ?? '' }))
      .filter((s) => String(s.content ?? '').trim() !== '')
  }
  return Object.entries(obj)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => ({ section: k, content: typeof v === 'object' ? JSON.stringify(v) : String(v) }))
}
const bodySections = computed(() => {
  const fromForm = parseReportBody(detail.value?.formData)
  if (fromForm.length) return fromForm
  const text = String(detail.value?.reportContent || '').trim()
  return text ? [{ section: '报告内容', content: text }] : []
})

function parseFiles(raw) {
  if (!raw) return []
  let arr = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        arr = JSON.parse(s)
      } catch {
        arr = [s]
      }
    } else {
      arr = [s]
    }
  }
  if (!Array.isArray(arr)) arr = [arr]
  return arr
    .map((it) => {
      if (typeof it === 'string') return { name: it.split('/').pop() || it, url: it }
      const url = it?.url || it?.path || ''
      return { name: it?.name || url.split('/').pop() || '附件', url }
    })
    .filter((f) => f.url)
}
const files = computed(() => parseFiles(detail.value?.dataFiles))
function openFile(f) {
  previewFile(f.url, { title: f.name || '实验附件' })
}

/** 教师批注：annotations 可能是 JSON 字符串 / 数组 / 对象，统一成可读列表 */
const annotations = computed(() => {
  const raw = detail.value?.annotations
  if (!raw) return []
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return [{ text: raw }]
    }
  }
  if (Array.isArray(obj)) {
    return obj.map((a) => ({
      text: typeof a === 'string' ? a : (a?.content || a?.text || a?.comment || JSON.stringify(a))
    })).filter((a) => a.text)
  }
  if (typeof obj === 'object') {
    return Object.entries(obj)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => ({ text: `${k}：${typeof v === 'object' ? JSON.stringify(v) : v}` }))
  }
  return []
})

/* ---------------- 操作 ---------------- */
function viewGuide() {
  previewFile(task.value?.guide, {
    title: (task.value?.title || '实验') + ' 指导书',
    tip: '该实验任务未提供可访问的指导书文件'
  })
}

const downloading = ref(false)
async function downloadWord() {
  const subId = detail.value?.subId || task.value?.subId
  if (!subId || downloading.value) return
  downloading.value = true
  try {
    const d = await downloadLabReport(subId)
    if (!d?.url) {
      ElMessage.warning(d?.message || '报告文件暂不可下载')
      return
    }
    downloadFile(d.url, d.fileName || `report${subId}.docx`, { tip: '报告文件暂不可下载' })
    ElMessage.success('报告已开始下载（Word 格式）')
  } catch (e) {
    ElMessage.error(e?.message || '报告下载失败')
  } finally {
    downloading.value = false
  }
}

/** 提交 / 重新提交报告 */
const submitVisible = ref(false)
const reportText = ref('')
const reportUrl = ref('')
const attUrl = ref('')
const attName = ref('')
const attLoading = ref(false)
const submitting = ref(false)

function openSubmit() {
  if (overdue.value && !task.value?.allowLate) {
    ElMessage.warning('已过截止时间且教师未开启逾期提交，无法提交报告')
    return
  }
  reportText.value = ''
  reportUrl.value = ''
  attUrl.value = ''
  attName.value = ''
  submitVisible.value = true
}
/** 附件上传：统一走 utils/upload（空文件拦截 + 真实失败原因提示 + 兼容性处理） */
async function pickAttachment() {
  if (attLoading.value) return
  attLoading.value = true
  try {
    const up = await pickAndUpload({ maxMB: 20 })
    if (up) {
      attUrl.value = up.url
      attName.value = up.name
    }
  } finally {
    attLoading.value = false
  }
}
async function doSubmit() {
  const text = reportText.value.trim()
  const url = reportUrl.value.trim()
  if (!text && !url && !attUrl.value) {
    ElMessage.warning('请填写实验报告内容或上传附件')
    return
  }
  submitting.value = true
  try {
    const body = { formData: { conclusion: text || '见附件' } }
    if (attUrl.value || url) body.attachment = attUrl.value || url
    await submitLabReport(taskId.value, body)
    ElMessage.success('实验报告已提交，等待教师批阅')
    submitVisible.value = false
    await load()
  } catch {
    // 4xx/5xx（含逾期策略拒绝）由拦截器提示
  } finally {
    submitting.value = false
  }
}

function backToList() {
  router.push({ name: 'StuLab' })
}

/** 从列表「去提交 / 去补交」进来时自动打开提交弹窗，减少一次点击 */
async function init() {
  await load()
  if (['submit', 'makeup'].includes(String(route.query.action || '')) && !task.value?.subId) openSubmit()
}
onMounted(init)
</script>

<template>
  <div v-loading="loading">
    <PageHeader back back-to="/student/lab" title="实验详情"
      desc="实验基本信息 · 报告内容 · 批阅结果" />

    <el-alert v-if="notFound && !loading" class="mb16" type="warning" :closable="false" show-icon
      title="未找到该实验任务" description="任务可能已删除或不在你的选课范围内，请返回实验列表查看" />

    <template v-if="task && !notFound">
      <!-- 基本信息 -->
      <el-card shadow="never">
        <template #header>
          <div class="between">
            <span class="card-title">{{ task.title }}</span>
            <div class="row" style="gap: 8px">
              <el-tag :type="statusType" effect="light">{{ statusText }}</el-tag>
              <el-tag v-if="overdue && statusText !== '已截止'" type="info" effect="light">已过截止</el-tag>
            </div>
          </div>
        </template>
        <el-descriptions :column="3" size="small" border>
          <el-descriptions-item label="课程">{{ task.courseName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="截止时间">{{ deadlineText(task.deadline) }}</el-descriptions-item>
          <el-descriptions-item label="总分">{{ task.totalScore != null ? task.totalScore : '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtFull(detail?.submitTime || task?.submitTime) }}</el-descriptions-item>
          <el-descriptions-item label="报告版本">{{ (detail?.versionNo || task?.versionNo) ? `第 ${detail?.versionNo || task?.versionNo} 版` : '—' }}</el-descriptions-item>
          <el-descriptions-item label="成绩">
            <b v-if="(detail?.score ?? task?.score) != null" class="score">{{ detail?.score ?? task?.score }} / {{ task.totalScore ?? '—' }}</b>
            <span v-else class="muted">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="查重率">
            {{ (detail?.duplicateRate ?? task?.duplicateRate) != null ? (detail?.duplicateRate ?? task?.duplicateRate) + '%' : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="逾期提交">
            {{ detail?.isLate === 1 || detail?.isLate === true ? '是' : '否' }}
          </el-descriptions-item>
          <el-descriptions-item label="允许逾期">{{ task.allowLate ? '是' : '否' }}</el-descriptions-item>
          <el-descriptions-item label="实验要求" :span="3">
            <div class="pre-wrap">{{ task.objective || '该实验任务未填写要求说明' }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 相关操作入口 -->
        <div class="ops">
          <el-button v-if="task.guide" size="small" @click="viewGuide">
            <BaseIcon name="book-open" :size="14" />查看指导书
          </el-button>
          <el-button v-if="!hasReport && (!overdue || task.allowLate)" type="primary" size="small" @click="openSubmit">
            <BaseIcon name="upload" :size="14" />{{ overdue ? '去补交' : '上传报告' }}
          </el-button>
          <el-button v-else-if="hasReport && (!overdue || task.allowLate)" size="small" @click="openSubmit">
            <BaseIcon name="refresh-cw" :size="14" />重新提交
          </el-button>
          <el-button v-if="hasReport" size="small" :loading="downloading" @click="downloadWord">
            <BaseIcon name="download" :size="14" />下载 Word 报告
          </el-button>
          <el-button size="small" @click="backToList">返回实验列表</el-button>
        </div>
      </el-card>

      <!-- 未提交：空状态 + 提交入口；已提交：正文 / 附件 / 评语 -->
      <el-card v-if="!hasReport" shadow="never" class="mt16">
        <EmptyState desc="该实验尚未提交报告，可在上方点击「上传报告」提交" />
      </el-card>

      <template v-else>
        <el-alert v-if="detailError" class="mt16" type="warning" :closable="false" show-icon
          :title="detailError" />
        <el-card shadow="never" class="mt16">
          <div class="card-title mb12">报告正文</div>
          <div v-if="bodySections.length" class="report-body">
            <div v-for="(s, i) in bodySections" :key="i" class="report-sec">
              <div class="report-sec-title">{{ s.section }}</div>
              <div class="report-sec-body">{{ s.content }}</div>
            </div>
          </div>
          <div v-else class="muted">本次提交没有填写正文内容</div>

          <template v-if="files.length">
            <div class="card-title mt16 mb12">报告附件（{{ files.length }}）</div>
            <div class="links">
              <el-link v-for="(f, i) in files" :key="i" type="primary" :underline="false" @click="openFile(f)">
                <BaseIcon name="paperclip" :size="12" />{{ f.name }}
              </el-link>
            </div>
          </template>
        </el-card>

        <el-card shadow="never" class="mt16">
          <div class="card-title mb12">批阅结果</div>
          <div class="result-grid">
            <div><span class="lbl">教师评分</span><b class="val">{{ detail?.score != null ? detail.score : '待批阅' }}</b></div>
            <div><span class="lbl">等级</span><b class="val">{{ detail?.grade || '—' }}</b></div>
            <div><span class="lbl">AI 预审分</span><b class="val">{{ detail?.aiScore != null ? detail.aiScore : '—' }}</b></div>
            <div><span class="lbl">批阅时间</span><b class="val">{{ fmtFull(detail?.gradedTime) }}</b></div>
          </div>
          <div class="card-title mt16 mb12">教师评语</div>
          <div v-if="detail?.comment" class="comment-box">{{ detail.comment }}</div>
          <div v-else class="muted">教师尚未填写评语</div>
          <template v-if="detail?.aiComment">
            <div class="card-title mt16 mb12">AI 预审意见</div>
            <div class="comment-box ai">{{ detail.aiComment }}</div>
          </template>
          <template v-if="annotations.length">
            <div class="card-title mt16 mb12">教师批注</div>
            <div v-for="(a, i) in annotations" :key="i" class="comment-box">{{ a.text }}</div>
          </template>
        </el-card>
      </template>
    </template>

    <!-- 提交 / 重新提交报告 -->
    <el-dialog v-model="submitVisible" title="提交实验报告" width="560px">
      <div class="small muted mb12">
        {{ task?.title }} · {{ task?.courseName }} · 截止 {{ deadlineText(task?.deadline) }}
      </div>
      <div class="field-label">实验结论 / 报告内容</div>
      <el-input v-model="reportText" type="textarea" :rows="7" maxlength="2000" show-word-limit
        placeholder="填写实验步骤、数据结果与分析结论" />
      <div class="field-label mt12">报告附件（选填，≤20MB）</div>
      <div class="row" style="gap: 8px; align-items: center">
        <el-tag v-if="attName" closable @close="attUrl = ''; attName = ''">{{ attName }}</el-tag>
        <el-button v-else size="small" :loading="attLoading" @click="pickAttachment">选择文件上传</el-button>
        <span class="small muted">或粘贴外部链接</span>
      </div>
      <el-input v-model="reportUrl" class="mt8" placeholder="https://（选填，与文件二选一）" />
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doSubmit">提交报告</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mb16 { margin-bottom: 16px; }
.mt16 { margin-top: 16px; }
.mb12 { margin-bottom: 12px; }
.mt12 { margin-top: 12px; }
.card-title { font-size: 15px; font-weight: 700; color: var(--ink-900); }
.between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.row { display: flex; align-items: center; }
.score { color: var(--brand-600); font-size: 16px; }
.muted { color: var(--ink-500); font-size: 13px; }
.small { font-size: 12.5px; }
.pre-wrap { white-space: pre-wrap; line-height: 1.7; }
.ops { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border); }
.report-body { border: 1px solid var(--line-200, #e5e7eb); border-radius: 8px; padding: 12px 14px; background: var(--surface-1, #fafafa); }
.report-sec + .report-sec { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line-200, #e5e7eb); }
.report-sec-title { font-size: 13px; font-weight: 600; color: var(--ink-800, #374151); margin-bottom: 4px; }
.report-sec-body { font-size: 13px; line-height: 1.7; color: var(--ink-700, #4b5563); white-space: pre-wrap; word-break: break-word; }
.links { display: flex; flex-wrap: wrap; gap: 14px; }
.result-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.result-grid > div { background: var(--bg-soft, #f8fafc); border-radius: 8px; padding: 10px 12px; }
.result-grid .lbl { display: block; font-size: 12px; color: var(--ink-500); margin-bottom: 4px; }
.result-grid .val { font-size: 14px; color: var(--ink-900); }
.comment-box { padding: 10px 12px; border-left: 3px solid var(--brand-500, #0d9488); background: var(--brand-50, #f0fdfa); border-radius: 4px; font-size: 13px; line-height: 1.7; color: var(--ink-700, #4b5563); white-space: pre-wrap; }
.comment-box + .comment-box { margin-top: 8px; }
.comment-box.ai { border-left-color: #8b5cf6; background: #f5f3ff; }
.field-label { font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 6px; }
@media (max-width: 900px) {
  .result-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
