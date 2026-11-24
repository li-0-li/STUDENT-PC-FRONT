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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import { experimentList, submitLabReport } from '@/api/student/lab'
import { pickAndUpload } from '@/utils/upload'
import { previewFile } from '@/utils/filePreview'

const router = useRouter()

const labs = ref([])
const loading = ref(false)
const courseSel = ref('')
const now = ref(Date.now())
let clockTimer = null

/** 课程下拉：由真实数据去重得到（不再写死课程名） */
const COURSES = computed(() => [...new Set(labs.value.map((r) => r.course).filter(Boolean))])

/* ---------- 状态 / 时间 / 排序：与作业中心（HomeworkCenter.vue）完全同口径 ---------- */
function parseTime(s) {
  if (!s) return null
  const t = String(s).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(t) ? new Date(t) : new Date(t.replace('T', ' ').replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? null : d
}
/** 是否过截止：只看截止时间，不看 subStatus / taskStatus（与作业一致） */
function isOverdue(row) {
  const d = parseTime(row.deadline)
  return !!d && d.getTime() < now.value
}
/** 截止倒计时：现作业中心 deadlineMeta 同款 */
function deadlineMeta(row) {
  const d = parseTime(row.deadline)
  if (!d) return { text: '未设置', cls: 'muted' }
  const ms = d.getTime() - now.value
  if (ms <= 0) return { text: '已截止', cls: 'muted' }
  const hours = ms / 3600000
  if (hours <= 24) return { text: hours < 1 ? '不足 1 小时' : `剩 ${Math.ceil(hours)} 小时`, cls: 'danger' }
  return { text: `剩 ${Math.ceil(hours / 24)} 天`, cls: hours <= 72 ? 'warning' : 'normal' }
}
/** 实验状态：先看提交态，再看截止时间（与作业 subMeta 同口径） */
function labMeta(row) {
  const s = String(row.subStatus || '').toLowerCase()
  if (['graded', 'finished'].includes(s)) return { text: '已批阅', cls: 'is-done' }
  if (s === 'submitted') return { text: '待批阅', cls: 'is-doing' }
  if (s === 'revision') return { text: '打回重做', cls: 'is-return' }
  if (isOverdue(row)) return { text: '已截止', cls: 'is-closed' }
  return { text: '待提交', cls: 'is-todo' }
}
/** 教师是否开启逾期提交（后端 allow_late） */
function canMakeUp(row) {
  return row.allowLate === true || row.allowLate === 1 || String(row.allowLate) === '1'
}
/** 紧迫度：0 未提交/打回，2 已提交待批阅，3 已批阅（与作业 urgencyOf 分档一致） */
function urgencyOf(row) {
  const s = String(row.subStatus || '').toLowerCase()
  if (['graded', 'finished'].includes(s)) return 3
  if (s === 'submitted') return 2
  return 0
}
function deadlineTs(row) {
  const d = parseTime(row.deadline)
  return d ? d.getTime() : 0
}
/**
 * 学习通固定排序（写死，不提供切换控件）：
 *  ⓪ 已截止沉底；① 未截止组按紧迫度升序 + 截止时间升序（临期优先）；
 *  ② 已截止组未交优先 + 截止时间降序（越早截止越沉底）；
 *  ③ 标题中文序；④ taskId 兜底。与作业中心 compareRows 逐条一致。
 */
function compareRows(a, b) {
  const expiredA = isOverdue(a) ? 1 : 0
  const expiredB = isOverdue(b) ? 1 : 0
  if (expiredA !== expiredB) return expiredA - expiredB
  const ta = deadlineTs(a) || Number.MAX_SAFE_INTEGER
  const tb = deadlineTs(b) || Number.MAX_SAFE_INTEGER
  const u = urgencyOf(a) - urgencyOf(b)
  if (u) return u
  if (expiredA === 1) { if (ta !== tb) return tb - ta }
  else if (ta !== tb) return ta - tb
  const tc = String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
  if (tc) return tc
  return Number(a.taskId || 0) - Number(b.taskId || 0)
}

/** 课程筛选后按学习通规则固定排序 */
const rows = computed(() => {
  const ls = courseSel.value ? labs.value.filter((r) => r.course === courseSel.value) : labs.value
  return [...ls].sort(compareRows)
})
/** 统计基于全部实验，不随课程筛选变化（与作业中心统计口径一致） */
const todoCount = computed(() => labs.value.filter((r) => labMeta(r).text === '待提交').length)
const overdueCount = computed(() => labs.value.filter((r) => labMeta(r).text === '已截止').length)
const subCount = computed(() => labs.value.filter((r) => labMeta(r).text === '待批阅').length)
const doneCount = computed(() => labs.value.filter((r) => labMeta(r).text === '已批阅').length)

/** 后端 deadline（ISO 'yyyy-MM-ddTHH:mm:ss'）→ 原型同款 'MM-DD HH:mm' */
function fmtDue(t) {
  const d = parseTime(t)
  if (!d) return t ? String(t) : '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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
  return {
    taskId: e.taskId,
    subId: e.subId ?? null,
    name: e.title,
    course: e.courseName,
    // 保留原始截止时间：状态判定 / 倒计时 / 排序都只看它，不再看 taskStatus
    deadline: e.deadline || '',
    due: fmtDue(e.deadline),
    subStatus: e.subStatus || '',
    allowLate: e.allowLate === true || e.allowLate === 1 || String(e.allowLate) === '1',
    score: e.score != null ? String(e.score) : null,
    // 评语不在列表接口里取，详情页按需加载
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

/** ★ 2026-11-24：列表行/「查看详情」直达独立详情页，不再弹窗或重复进入列表页 */
function openDetail(row) {
  router.push({ name: 'StuLabDetail', params: { taskId: row.taskId } })
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

/** 附件上传：统一走 utils/upload（空文件拦截 + 真实失败原因提示 + 兼容性处理） */
async function pickLabAttachment() {
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
const submitting = ref(false)

function upload(row, makeup = false) {
  if (makeup && !canMakeUp(row)) {
    ElMessage.warning('教师未开启该实验的逾期提交，仅可查看内容')
    return
  }
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

/** 指导书：guide 为 /files 路径时直接打开；否则如实提示 */
function viewGuide(row) {
  previewFile(row.guide, {
    title: (row.name || '实验') + ' 指导书',
    tip: '该实验任务未提供可访问的指导书文件'
  })
}

onMounted(() => {
  load()
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 60 * 1000)
})
onBeforeUnmount(() => { if (clockTimer) window.clearInterval(clockTimer) })
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

    <div class="stat-grid">
      <StatCard label="应交实验" :value="labs.length" />
      <StatCard label="待提交" :value="todoCount" tone="warning" />
      <StatCard label="已截止" :value="overdueCount" />
      <StatCard label="待批阅" :value="subCount" />
      <StatCard label="已批阅" :value="doneCount" tone="success" />
    </div>

    <el-card shadow="never" class="mt16">
      <div class="between">
        <div class="card-title no-margin">实验列表</div>
        <span class="small muted">按学习通规则排序：未截止优先、临期在前；已截止沉底</span>
      </div>
      <el-table v-loading="loading" :data="rows" class="mt12" @row-click="openDetail">
        <el-table-column prop="name" label="实验名称" min-width="260">
          <template #default="{ row }"><b class="link-title" @click.stop="openDetail(row)">{{ row.name }}</b></template>
        </el-table-column>
        <el-table-column prop="course" label="课程" width="110">
          <template #default="{ row }"><span class="small muted">{{ row.course }}</span></template>
        </el-table-column>
        <el-table-column prop="due" label="截止时间" width="160">
          <template #default="{ row }">
            <div>{{ row.due }}</div>
            <span class="teaching-deadline" :class="'is-' + deadlineMeta(row).cls">{{ deadlineMeta(row).text }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="status" :class="labMeta(row).cls">{{ labMeta(row).text }}</span>
          </template>
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
              <el-link type="primary" :underline="false" @click.stop="openDetail(row)">查看详情</el-link>
              <el-link v-if="row.guide" type="primary" :underline="false" @click.stop="viewGuide(row)">查看指导书</el-link>
              <el-link v-if="!isOverdue(row) && labMeta(row).text === '待提交'" type="primary" :underline="false" @click.stop="upload(row)">上传报告</el-link>
              <el-link v-if="isOverdue(row) && !row.subId && canMakeUp(row)" type="primary" :underline="false" @click.stop="upload(row, true)">去补交</el-link>
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

  </div>
</template>

<style scoped>
/* 与作业中心同款统计卡栅格（5 张） */
.stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
/* 与作业中心同款状态标签配色 */
.status { display: inline-block; padding: 3px 9px; border-radius: 5px; font-size: 11.5px; font-weight: 600; }
.status.is-todo { background: #fef3c7; color: #92400e; }
.status.is-closed { background: #f3f4f6; color: #6b7280; }
.status.is-doing { background: #dbeafe; color: #1e40af; }
.status.is-done { background: #dcfce7; color: #15803d; }
.status.is-return { background: #ffedd5; color: #c2410c; }
.teaching-deadline { font-size: 11.5px; }
.teaching-deadline.is-danger { color: #dc2626; }
.teaching-deadline.is-warning { color: #d97706; }
.teaching-deadline.is-normal { color: var(--ink-500); }
.teaching-deadline.is-muted { color: var(--ink-400); }
.link-title { cursor: pointer; }
.link-title:hover { color: var(--brand-600); text-decoration: underline; }
:deep(.el-table__row) { cursor: pointer; }
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
</style>
