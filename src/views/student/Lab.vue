<script setup>
/**
 * 实验报告（分支 stu-pc-lab）
 * 关联接口（接口设计文档表号）：表 3-17 提交实验报告、表 3-18 实验报告详情、表 3-22 报告下载
 * 对应原型：ui-prototype/pc/student-lab.html —— ★ 1:1 还原
 *   （课程筛选 + 4 张统计卡 + 实验列表表格：查看指导书 / 上传报告 / 查看评语）
 *
 * ★ 2026-10-10 接真接口，删掉原来的原型演示数据（LABS 硬编码 4 条，会显示"大学物理"等库里没有的课）。
 *   列表改走 `GET /api/v1/experiments`（实测按 JWT 返回本人实验，含成绩与查重率）。
 *
 * ★ 2026-10-19 「上传报告」接真（原注释误判「后端无此路由」）：
 *   表 3-17 `POST /api/v1/experiments/{taskId}/submissions` 实际存在，body {formData: Map, attachment?}，
 *   支持纯文本提交（无需附件，无对象存储也能用）。弹窗填写「实验结论」即提交；逾期策略由后端判定。
 *   仍缺：表 3-18 报告详情/评语（后端 500），因此「查看评语」列不渲染（不编造）。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import { experimentList, submitLabReport, labReportDetail, downloadLabReport } from '@/api/student/lab'
import { uploadFile } from '@/api/auth'

const labs = ref([])
const loading = ref(false)
const courseSel = ref('')

/** 课程下拉：由真实数据去重得到（不再写死课程名） */
const COURSES = computed(() => [...new Set(labs.value.map((r) => r.course).filter(Boolean))])

const rows = computed(() => (courseSel.value ? labs.value.filter((r) => r.course === courseSel.value) : labs.value))
const todoCount = computed(() => rows.value.filter((r) => r.status === '待提交' || r.status === '未开始').length)
const subCount = computed(() => rows.value.filter((r) => r.status === '待批阅').length)
const doneCount = computed(() => rows.value.filter((r) => r.status === '已批阅').length)

const tagType = (s) => ({ 待提交: 'warning', 待批阅: 'info', 已批阅: 'success', 未开始: 'info' })[s] || 'info'

/** 后端 deadline（ISO 'yyyy-MM-ddTHH:mm:ss'）→ 原型同款 'MM-DD HH:mm' */
function fmtDue(t) {
  if (!t) return '—'
  const s = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s)
    : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 后端 ISO 时间（yyyy-MM-ddTHH:mm:ss）→ yyyy-MM-dd HH:mm，详情展示用 */
function fmtFull(t) {
  if (!t) return '—'
  const s = String(t).trim().replace('T', ' ')
  return s.length >= 16 ? s.slice(0, 16) : s
}

/**
 * 后端实验任务 → 页面行（状态由 subStatus 推导，不再写死）
 *
 * ★ 2026-10-30：数据源从 student-mp 的 `/api/v1/experiments` 换成本模块
 *   `/api/v1/stu/experiments`，字段口径**由 snake_case 变为 camelCase**
 *   （taskId / courseName / subId / subStatus / duplicateRate …）。
 *   这里同步改，否则 subId 取不到，「查看报告」入口不会出现。
 */
function mapLab(e) {
  let status = '待提交'
  if (e.subId != null) status = e.subStatus === 'GRADED' ? '已批阅' : '待批阅'
  else if (e.taskStatus && e.taskStatus !== 'published') status = '未开始'
  return {
    taskId: e.taskId,
    subId: e.subId ?? null,
    name: e.title,
    course: e.courseName,
    due: fmtDue(e.deadline),
    status,
    score: e.score != null ? String(e.score) : null,
    // 评语不在这里取（列表查询不带评审表），由详情弹窗按需加载
    note: '',
    guide: e.guide || '',
    dupRate: e.duplicateRate ?? null
  }
}

async function load() {
  loading.value = true
  try {
    const d = await experimentList()
    labs.value = (Array.isArray(d) ? d : d?.list || []).map(mapLab)
  } catch {
    labs.value = []
    ElMessage.error('实验列表加载失败，请确认后端与 SSH 隧道已启动')
  } finally {
    loading.value = false
  }
}

/* ---------------- 提交实验报告（表 3-17） ---------------- */
const reportVisible = ref(false)
const reportRow = ref(null)
const reportText = ref('')
const reportUrl = ref('')
/** ★ 2026-10-21 报告附件：真上传（本地存储），文件 URL 走 attachment 字段 */
const attUrl = ref('')
const attName = ref('')
const attLoading = ref(false)

function pickLabAttachment() {
  if (attLoading.value) return
  const el = document.createElement('input')
  el.type = 'file'
  el.onchange = async () => {
    const f = el.files?.[0]
    if (!f) return
    if (f.size > 20 * 1024 * 1024) {
      ElMessage.warning('附件不能超过 20MB')
      return
    }
    attLoading.value = true
    try {
      const up = await uploadFile(f)
      attUrl.value = up?.url || ''
      attName.value = up?.fileName || f.name
      ElMessage.success('附件已添加')
    } catch {
      ElMessage.error('附件上传失败，请重试')
    } finally {
      attLoading.value = false
    }
  }
  el.click()
}
const submitting = ref(false)

function upload(row) {
  reportRow.value = row
  reportText.value = ''
  reportUrl.value = ''
  attUrl.value = ''
  attName.value = ''
  reportVisible.value = true
}

async function doSubmitReport() {
  const t = reportText.value.trim()
  if (!t) {
    ElMessage.warning('请填写实验结论/报告内容')
    return
  }
  submitting.value = true
  try {
    await submitLabReport(reportRow.value.taskId, {
      formData: { conclusion: t },
      attachment: attUrl.value || reportUrl.value.trim() || undefined
    })
    ElMessage.success('实验报告已提交，等待教师批阅')
    reportVisible.value = false
    await load()
  } catch {
    // 4xx/5xx（含逾期策略拒绝）由拦截器提示
  } finally {
    submitting.value = false
  }
}

/* ==================== 报告详情（表 3-18）+ 下载（表 3-22） ====================
 * ★ 2026-10-30 补齐：后端这两个接口（student-mp ExperimentController）其实早已实现，
 *   详情返回 review/comment/grade/annotations/ai_score/ai_comment，
 *   下载返回 { fileName, url: '/files/exp/report{subId}.docx', message }（Word 惰性生成）。
 *   此前前端一直没接，导致清单里「历史报告查阅 / 评分批注 / 报告下载」三项是空的。
 */
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref(null)

/** form_data 可能是 JSON 字符串，兼容 {sections:[{section,content}]} 与 {键:值} 两种形态 */
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

/** 附件：可能是数组、JSON 字符串、单个 URL 或相对路径 */
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

function downloadAttachment(f) {
  if (/^https?:\/\//i.test(f.url) || f.url.startsWith('/')) window.open(f.url, '_blank')
  else ElMessage.info('附件地址不可直接访问')
}

const detailSections = computed(() => parseReportBody(detail.value?.formData))
const detailFiles = computed(() => parseFiles(detail.value?.dataFiles))

async function viewReport(row) {
  if (!row?.subId) {
    ElMessage.info('该实验还没有提交记录')
    return
  }
  detailVisible.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    const d = await labReportDetail(row.subId)
    detail.value = d || {}
    // 顺便把评语回填到列表行，操作列的「查看评语」不再依赖空字段
    if (d?.comment) row.note = d.comment
  } catch (e) {
    detailError.value = e?.message || '报告详情加载失败，请稍后重试'
  } finally {
    detailLoading.value = false
  }
}

/** 下载：后端返回文件信息（非二进制流），拿到 url 后交给浏览器下载 */
const downloading = ref(false)
async function downloadReport(row) {
  if (!row?.subId || downloading.value) return
  downloading.value = true
  try {
    const d = await downloadLabReport(row.subId)
    const url = d?.url
    if (!url) {
      ElMessage.warning(d?.message || '报告文件暂不可下载')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = d?.fileName || `report${row.subId}.docx`
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
    ElMessage.success('报告已开始下载（Word 格式，可二次编辑）')
  } catch (e) {
    ElMessage.error(e?.message || '报告下载失败')
  } finally {
    downloading.value = false
  }
}

/** 指导书：guide 为 /files 路径时直接打开；否则如实提示 */
function viewGuide(row) {
  const g = row.guide || ''
  if (/^https?:\/\//i.test(g) || g.startsWith('/')) {
    window.open(g, '_blank')
  } else {
    ElMessage.info('该校验任务未提供可访问的指导书文件')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader back back-to="/student/tasks" title="实验报告" desc="任务列表 → 提交 → AI 预审 → 教师审阅">
      <template #actions>
        <el-select v-model="courseSel" placeholder="全部课程" clearable style="width: 160px">
          <el-option v-for="c in COURSES" :key="c" :label="c" :value="c" />
        </el-select>
      </template>
    </PageHeader>

    <div class="grid g4">
      <StatCard label="应交实验" :value="rows.length" />
      <StatCard label="待提交" :value="todoCount" tone="warning" />
      <StatCard label="已提交待批阅" :value="subCount" />
      <StatCard label="已批阅" :value="doneCount" tone="success" />
    </div>

    <el-card shadow="never" class="mt16">
      <div class="between">
        <div class="card-title no-margin">实验列表</div>
        <span class="small muted">按截止时间排序 · 逾期按每天 5 分扣减</span>
      </div>
      <el-table v-loading="loading" :data="rows" class="mt12">
        <el-table-column prop="name" label="实验名称" min-width="260">
          <template #default="{ row }"><b>{{ row.name }}</b></template>
        </el-table-column>
        <el-table-column prop="course" label="课程" width="110">
          <template #default="{ row }"><span class="small muted">{{ row.course }}</span></template>
        </el-table-column>
        <el-table-column prop="due" label="截止时间" width="130">
          <template #default="{ row }"><span class="small muted">{{ row.due }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag :type="tagType(row.status)" effect="light">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="成绩" width="90">
          <template #default="{ row }">
            <b v-if="row.score" class="score">{{ row.score }}</b>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="260">
          <template #default="{ row }">
            <span class="links">
              <el-link v-if="row.guide" type="primary" :underline="false" @click="viewGuide(row)">查看指导书</el-link>
              <el-link v-if="row.status === '待提交'" type="primary" :underline="false" @click="upload(row)">上传报告</el-link>
              <el-link v-if="row.subId" type="primary" :underline="false" @click="viewReport(row)">查看报告</el-link>
              <el-link v-if="row.subId && row.status === '已批阅'" type="primary" :underline="false" @click="downloadReport(row)">下载报告</el-link>
              <span v-if="!row.guide && !row.subId && row.status === '未开始'" class="muted">—</span>
            </span>
          </template>
        </el-table-column>
        <template #empty>{{ courseSel ? '该课程暂无实验' : '暂无实验任务（接口未返回数据）' }}</template>
      </el-table>
    </el-card>

    <!-- 提交实验报告（表 3-17：纯文本即可，附件选填链接） -->
    <el-dialog v-model="reportVisible" title="提交实验报告" width="520px">
      <div class="small muted" style="margin-bottom: 10px">
        {{ reportRow?.name }} · {{ reportRow?.course }} · 截止 {{ reportRow?.due }}
      </div>

      <div class="field-label">实验结论 / 报告内容 <span style="color: var(--error)">*</span></div>
      <el-input
        v-model="reportText"
        type="textarea"
        :rows="7"
        maxlength="2000"
        show-word-limit
        placeholder="填写实验步骤、数据结果与分析结论（提交后进入待批阅状态）"
      />

      <div class="field-label mt12">报告附件（选填，≤20MB）</div>
      <div class="row" style="gap: 8px; align-items: center">
        <el-tag v-if="attName" closable @close="attUrl = ''; attName = ''">{{ attName }}</el-tag>
        <el-button v-else size="small" :loading="attLoading" @click="pickLabAttachment">
          <BaseIcon name="paperclip" :size="13" />选择文件上传
        </el-button>
        <span class="small muted">或粘贴外部链接</span>
      </div>
      <el-input v-model="reportUrl" class="mt8" placeholder="https://（选填，与文件二选一）" />

      <div class="small muted mt8">支持 PDF / 图片 / 代码包等；提交后进入「待批阅」，教师可下载查看。</div>

      <template #footer>
        <el-button @click="reportVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doSubmitReport">提交报告</el-button>
      </template>
    </el-dialog>

    <!-- 实验报告详情（表 3-18）+ 报告下载（表 3-22） -->
    <el-dialog v-model="detailVisible" title="实验报告详情" width="720px" top="6vh">
      <div v-if="detailLoading" class="small muted">正在加载报告…</div>
      <el-alert
        v-else-if="detailError"
        :title="detailError"
        type="warning"
        :closable="false"
        show-icon
      />
      <div v-else-if="detail">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="实验名称">{{ detail.taskTitle || '—' }}</el-descriptions-item>
          <el-descriptions-item label="课程">{{ detail.courseName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtFull(detail.submitTime) }}</el-descriptions-item>
          <el-descriptions-item label="报告版本">
            {{ detail.versionNo ? `第 ${detail.versionNo} 版` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="得分">
            <b v-if="detail.score != null" class="score">{{ detail.score }}</b>
            <span v-else class="muted">待批阅</span>
          </el-descriptions-item>
          <el-descriptions-item label="等级">{{ detail.grade || '—' }}</el-descriptions-item>
          <el-descriptions-item label="查重率">
            {{ detail.duplicateRate != null ? detail.duplicateRate + '%' : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ detail.status === 'GRADED' ? '已批阅' : '待批阅' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="field-label mt12">报告正文</div>
        <div v-if="detailSections.length" class="report-body">
          <div v-for="(s, i) in detailSections" :key="i" class="report-sec">
            <div class="report-sec-title">{{ s.section }}</div>
            <div class="report-sec-body">{{ s.content }}</div>
          </div>
        </div>
        <div v-else class="small muted">本次提交没有填写正文内容</div>

        <template v-if="detailFiles.length">
          <div class="field-label mt12">本次提交附件（{{ detailFiles.length }}）</div>
          <div class="links">
            <el-link
              v-for="(f, i) in detailFiles"
              :key="i"
              type="primary"
              :underline="false"
              @click="downloadAttachment(f)"
            >
              {{ f.name }}
            </el-link>
          </div>
        </template>

        <div class="field-label mt12">教师评语</div>
        <div v-if="detail.comment" class="comment-box">{{ detail.comment }}</div>
        <div v-else class="small muted">教师尚未填写评语</div>

        <template v-if="detail.aiComment || detail.aiScore != null">
          <div class="field-label mt12">AI 预审</div>
          <div class="small muted">
            AI 评分：{{ detail.aiScore != null ? detail.aiScore : '—' }}（仅供参考，以教师评分为准）
          </div>
          <div v-if="detail.aiComment" class="comment-box">{{ detail.aiComment }}</div>
        </template>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          v-if="detail && detail.subId"
          type="primary"
          :loading="downloading"
          @click="downloadReport({ subId: detail.subId })"
        >
          下载 Word 报告
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
}
.card-title.no-margin {
  margin-bottom: 0;
}
.score {
  color: var(--brand-600);
}
.links {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mt12 {
  margin-top: 12px;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.field-label.mt12 {
  margin-top: 12px;
}
/* 报告详情：正文分段 + 评语块 */
.report-body {
  border: 1px solid var(--line-200, #e5e7eb);
  border-radius: 8px;
  padding: 12px 14px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface-1, #fafafa);
}
.report-sec + .report-sec {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--line-200, #e5e7eb);
}
.report-sec-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-800, #374151);
  margin-bottom: 4px;
}
.report-sec-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700, #4b5563);
  white-space: pre-wrap;
  word-break: break-word;
}
.comment-box {
  margin-top: 6px;
  padding: 10px 12px;
  border-left: 3px solid var(--brand-500, #0d9488);
  background: var(--brand-50, #f0fdfa);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-700, #4b5563);
  white-space: pre-wrap;
}
</style>
