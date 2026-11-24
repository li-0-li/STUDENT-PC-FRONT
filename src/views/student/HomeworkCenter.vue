<script setup>
/**
 * 作业中心（学生端，2026-11-24 推倒重建）
 *
 * 背景：旧「我的任务」(Tasks.vue) 用 P0–P4 优先级任务流，教师端根本没有这个概念，
 * 字段也薄（只有标题/课程/截止/状态）；旧「我的作业」(Homeworks.vue) 又各自为政。
 * 本页把两页合并为一个「作业中心」，结构与教师端作业管理一一对齐：
 *   课程/状态/标题筛选 + 最近截止提醒 + 状态口径 + 提交进度(我方) + 历史归档 + 分页。
 *
 * 与教师端对称的字段/状态（后端 AssignmentItemVo / StuSubmissionDetailVo）：
 *   - 作业状态 status: draft/published/closed/archived（草稿学生不可见，后端已过滤）
 *   - 提交状态 myStatus: draft/submitted/queued/grading/manual/finished/appealing/returned
 *   - 题型构成 assignType: objective/subjective/mixed
 *   - 成绩构成: score = objectiveScore + subjectiveScore − lateDeduct（后端算，前端只展示）
 *
 * 数据源：
 *   - 进行中 GET /api/v1/assignments（status 不传，后端按角色返回我选课范围内全部）
 *   - 历史   GET /api/v1/assignments?status=archived + closed 且已过截止的前端归桶
 *   - 实验   GET /api/v1/stu/experiments
 *   - 课程   GET /api/v1/stu/courses（用于课程下拉，失败退化为从列表去重）
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import AppealDialog from '@/components/business/AppealDialog.vue'
import { homeworkList } from '@/api/student/homework'
import { experimentList } from '@/api/student/lab'
import { myCourses } from '@/api/student/course'
import { assignTypeLabel } from '@/utils/questionType'

const route = useRoute()
const router = useRouter()

/* ---------- 状态口径（与教师端、后端常量逐字一致） ---------- */
const HW_STATUS = {
  draft: { text: '草稿', cls: 'is-draft' },
  published: { text: '已发布', cls: 'is-published' },
  closed: { text: '已截止', cls: 'is-closed' },
  archived: { text: '已归档', cls: 'is-archived' }
}
/** 学生提交状态 8 态（McStatus），文案与教师端 grading / appeal 页一致 */
const SUB_STATUS = {
  draft: { text: '待提交', cls: 'is-todo', action: 'answer' },
  submitted: { text: '待批改', cls: 'is-doing', action: 'view' },
  queued: { text: '排队批改中', cls: 'is-doing', action: 'view' },
  grading: { text: '批改中', cls: 'is-doing', action: 'view' },
  manual: { text: '待人工复核', cls: 'is-doing', action: 'view' },
  finished: { text: '已批改', cls: 'is-done', action: 'view' },
  appealing: { text: '申诉处理中', cls: 'is-appeal', action: 'view' },
  returned: { text: '已退回', cls: 'is-return', action: 'answer' }
}

/* ---------- 页面状态 ---------- */
const loading = ref(false)
const offline = ref(false)
/** 当前页签：homework 作业（全部，含已截止/已归档）/ lab 实验 */
const tab = ref('homework')
const allHomework = ref([])
const allLabs = ref([])
const courseOptions = ref([])

const query = ref({ courseId: 0, status: '', keyword: '', weekNum: 0 })
const pageNum = ref(1)
const pageSize = ref(10)
const now = ref(Date.now())
let clockTimer = null

/* ---------- 排序（固定：严格按学习通规则，不提供切换控件） ---------- */
/**
 * 排序规则（写死，列表恒定按此展示）：
 *   ⓪ 已截止（截止时间已过）一律沉底，未截止的排前面
 *      注意：只看截止时间，不看 status——教师归档(archived)但截止未到的不算已截止
 *   ① 未截止组：提交紧迫度升序（待提交 → 待批改 → 已批改）+ 截止时间升序（临期优先）
 *   ② 已截止组：先按完成度（已截止未交 → 已批改），同档再按截止时间降序
 *              ——越早截止（越久远）越沉底，最近刚截止的排在这组最前
 *   ③ 同截止时间按标题（中文拼音序）
 *   ④ 完全相同按 ID（作业 assignmentId / 实验 taskId）兜底，保证稳定
 * 不暴露排序字段/升降序切换。
 */
/** 提交紧迫度档位：数字越小越紧急；兼容实验的 subStatus */
function urgencyOf(row) {
  const lab = String(row.subStatus || '').toLowerCase()
  if (lab) {
    if (['not_started', 'in_progress', 'revision', ''].includes(lab)) return 0 // 未做/打回
    if (lab === 'submitted') return 2                                          // 待批改
    if (['graded', 'finished'].includes(lab)) return 3                        // 已批阅
    return 0
  }
  const s = row.myStatus || ''
  if (s === 'draft' || s === '' || s === 'returned') return 0 // 待提交 / 退回重做
  if (s === 'appealing') return 1                              // 申诉中
  if (['submitted', 'queued', 'grading', 'manual'].includes(s)) return 2 // 待批改/批改中
  return 3                                                     // finished 已批改 → 最后
}
function deadlineTs(row) {
  const d = parseTime(row.deadline)
  return d ? d.getTime() : 0
}
/** 学习通固定排序比较器 */
function compareRows(a, b) {
  // ⓪ 已截止（截止时间已过）一律沉底；只看时间，不看 status（归档但截止未到的不算已截止）
  const expiredA = isOverdue(a) ? 1 : 0
  const expiredB = isOverdue(b) ? 1 : 0
  if (expiredA !== expiredB) return expiredA - expiredB
  const ta = deadlineTs(a) || Number.MAX_SAFE_INTEGER
  const tb = deadlineTs(b) || Number.MAX_SAFE_INTEGER
  if (expiredA === 1) {
    // ① 已截止组：未完成（已截止未交）优先于已完成（已批改）——学习通「未完成在前」
    //    这样学生先看到需要处理的过期作业，已拿到分数的沉到后面
    const u = urgencyOf(a) - urgencyOf(b)
    if (u) return u
    // ② 再按截止时间降序——越早截止越沉底，最近刚截止的排这组最前
    if (ta !== tb) return tb - ta
  } else {
    // ① 未截止组：紧迫度升序（待提交 → 待批改 → 已批改）
    const u = urgencyOf(a) - urgencyOf(b)
    if (u) return u
    // ② 组内截止时间升序（临期优先）
    if (ta !== tb) return ta - tb
  }
  // ③ 标题中文拼音序
  const tc = String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
  if (tc) return tc
  // ④ 完全相同按 ID 兜底（作业 assignmentId / 实验 taskId），保证顺序稳定
  return Number(a.assignmentId || a.taskId || 0) - Number(b.assignmentId || b.taskId || 0)
}

/* ---------- 申诉弹窗 ---------- */
const appealVisible = ref(false)
const appealTarget = ref(null)

/* ---------- 日期 / 状态工具 ---------- */
function parseTime(s) {
  if (!s) return null
  const t = String(s).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(t) ? new Date(t) : new Date(t.replace('T', ' ').replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? null : d
}
function fmt(s) {
  const d = parseTime(s)
  if (!d) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function isOverdue(row) {
  const d = parseTime(row.deadline)
  return !!d && d.getTime() < now.value
}
/**
 * 倒计时文案：只看截止时间，与 subMeta 状态判定、compareRows 排序口径完全一致。
 * 不再用 status=closed/archived 判「已结束」——教师归档但截止未到的作业，学生仍可作答，
 * 应显示剩余时间而非「已结束」（否则出现「待提交+去作答」却标「已结束」的自相矛盾）。
 */
function deadlineMeta(row) {
  const d = parseTime(row.deadline)
  if (!d) return { text: '未设置', cls: 'muted', ms: 0 }
  const ms = d.getTime() - now.value
  if (ms <= 0) return { text: '已截止', cls: 'muted', ms: 0 }
  const hours = ms / 3600000
  if (hours <= 24) return { text: hours < 1 ? '不足 1 小时' : `剩 ${Math.ceil(hours)} 小时`, cls: 'danger', ms }
  if (hours <= 72) return { text: `剩 ${Math.ceil(hours / 24)} 天`, cls: 'warning', ms }
  return { text: `剩 ${Math.ceil(hours / 24)} 天`, cls: 'normal', ms }
}
/**
 * 学生提交状态判定（学习通口径：先看截止时间，再看提交态）：
 *  - 已提交 / 批改中 / 已批改 / 申诉 / 退回：按 myStatus 显示（提交动作已完成，不受截止影响）
 *  - 未提交（myStatus 为空或 draft，后端对未提交作业不返回该字段）：
 *      · 截止未到 → 待提交，可作答
 *      · 截止已过 → 「已截止」（灰色），只能查看作业内容；
 *                  教师开启补交(allowLate)时额外出现「去补交」按钮
 */
function subMeta(row) {
  // 实验页：与作业完全同口径——先看提交态，未提交再看截止时间
  // （不再直接把后端英文 subStatus 显示出来，也不再让已过截止的实验显示「待提交/未开始」）
  if (tab.value === 'lab') {
    const lab = String(row.subStatus || '').toLowerCase()
    if (['graded', 'finished'].includes(lab)) return { text: '已批阅', cls: 'is-done', action: 'view' }
    if (lab === 'submitted') return { text: '待批阅', cls: 'is-doing', action: 'view' }
    if (lab === 'revision') return { text: '打回重做', cls: 'is-return', action: 'view' }
    if (isOverdue(row)) return { text: '已截止', cls: 'is-closed', action: 'view' }
    return { text: '待提交', cls: 'is-todo', action: 'view' }
  }
  // 作业页：先看提交态。已提交/已批改等明确状态，提交动作已完成，不受截止时间影响
  const s = row.myStatus || ''
  if (s && s !== 'draft' && SUB_STATUS[s]) return SUB_STATUS[s]
  // 未提交：按是否过截止时间区分。已截止统一显示「已截止」，查看/补交由操作列单独控制
  if (isOverdue(row)) {
    return { text: '已截止', cls: 'is-closed', action: 'view' }
  }
  return SUB_STATUS.draft
}

/** 是否已有提交（含批改中/已批改/申诉/退回）——决定进提交详情还是作答页 */
function hasSubmission(row) {
  const s = row.myStatus || ''
  return !!s && s !== 'draft' && !!SUB_STATUS[s]
}
/** 教师是否开启补交（后端 allow_late → JSON boolean，兼容 1 / "1" 历史数据） */
function canMakeUp(row) {
  return row.allowLate === true || row.allowLate === 1 || String(row.allowLate) === '1'
}
function hwMeta(row) {
  const s = row.status || ''
  return HW_STATUS[s] || { text: s || '—', cls: 'is-published' }
}
/** 已完成 = 已批改完成（含申诉中，分数已定） */
function isDone(row) {
  return ['finished', 'appealing'].includes(row.myStatus) || row.myScore != null
}
function scoreText(row) {
  if (!isDone(row)) return '—'
  return row.myScore != null ? `${row.myScore}${row.totalScore != null ? ' / ' + row.totalScore : ''}` : '—'
}
/** 可申诉：已批改 + 教师开启 + 无申诉理由（后端 7 天窗口兜底） */
function canAppeal(row) {
  return row.myStatus === 'finished' && row.allowAppeal === true
}

/* ---------- 数据加载 ---------- */
async function load() {
  loading.value = true
  try {
    const [hw, labs, cs] = await Promise.all([
      homeworkList().catch(() => []),
      experimentList().catch(() => []),
      myCourses().catch(() => [])
    ])
    allHomework.value = Array.isArray(hw) ? hw : hw?.list || []
    allLabs.value = Array.isArray(labs) ? labs : labs?.list || []
    const carr = Array.isArray(cs) ? cs : cs?.list || []
    courseOptions.value = carr
      .filter((c) => c?.courseId != null)
      .map((c) => ({ courseId: Number(c.courseId), courseName: c.courseName || `课程 #${c.courseId}` }))
    if (!courseOptions.value.length) {
      const m = new Map()
      for (const r of allHomework.value) {
        if (r.courseId == null || m.has(Number(r.courseId))) continue
        m.set(Number(r.courseId), { courseId: Number(r.courseId), courseName: r.courseName || `课程 #${r.courseId}` })
      }
      courseOptions.value = [...m.values()]
    }
    offline.value = false
  } catch {
    allHomework.value = []
    allLabs.value = []
    offline.value = true
  } finally {
    loading.value = false
  }
}

/* ---------- 作业列表 + 筛选（不再拆分进行中/历史归档，全部作业同表展示） ---------- */
/**
 * 学生可见作业 = 排除草稿（草稿是教师未发布，学生不该看到）。
 * 已截止、已归档作业同样在本表展示，只是状态列显示「已截止」——与教师端历史作业口径一致。
 */
const visibleHomework = computed(() => allHomework.value.filter((r) => r.status !== 'draft'))

/** 最近截止提醒（未截止、未完成，取最近 3 条） */
const upcoming = computed(() => visibleHomework.value
  .filter((r) => !isDone(r) && deadlineMeta(r).ms > 0)
  .sort((a, b) => deadlineMeta(a).ms - deadlineMeta(b).ms)
  .slice(0, 3))

/** 按课程 / 状态 / 标题（前端本地，后端无 keyword）过滤 */
function applyFilter(rows) {
  let ls = rows
  if (query.value.courseId) ls = ls.filter((r) => Number(r.courseId) === Number(query.value.courseId))
  if (query.value.status) {
    ls = ls.filter((r) => {
      const s = query.value.status
      // 已截止未交：截止已过且未提交（不管 allowLate，补交也属于已截止范畴）
      if (s === 'overdue') return isOverdue(r) && !isDone(r) && (!r.myStatus || r.myStatus === 'draft')
      // 待提交：截止未到且未提交
      if (s === 'todo') return ['draft', ''].includes(r.myStatus || '') && !isDone(r) && !isOverdue(r)
      if (s === 'doing') return ['submitted', 'queued', 'grading', 'manual'].includes(r.myStatus)
      if (s === 'done') return r.myStatus === 'finished'
      if (s === 'appeal') return r.myStatus === 'appealing' || r.myStatus === 'returned'
      if (s === 'closed') return r.status === 'closed' || r.status === 'archived'
      return true
    })
  }
  if (query.value.weekNum) ls = ls.filter((r) => Number(r.weekNum) === Number(query.value.weekNum))
  const kw = query.value.keyword.trim().toLowerCase()
  if (kw) ls = ls.filter((r) => String(r.title || '').toLowerCase().includes(kw))
  return ls
}
/** 计算当前页签的过滤结果 + 排序 + 分页 */
const filtered = computed(() => {
  const rows = tab.value === 'lab' ? applyLabFilter(allLabs.value) : applyFilter(visibleHomework.value)
  return [...rows].sort(compareRows)
})
const paged = computed(() => filtered.value.slice((pageNum.value - 1) * pageSize.value, pageNum.value * pageSize.value))
const total = computed(() => filtered.value.length)

function applyLabFilter(rows) {
  let ls = rows
  // 实验列表接口只返回 courseName、没有 courseId：课程下拉选的是 myCourses 的 ID，先映射成名称
  if (query.value.courseId) {
    const c = courseOptions.value.find((x) => Number(x.courseId) === Number(query.value.courseId))
    const name = c?.courseName
    ls = name
      ? ls.filter((r) => r.courseName === name || r.course === name)
      : ls.filter((r) => Number(r.courseId) === Number(query.value.courseId))
  }
  if (query.value.status) {
    ls = ls.filter((r) => {
      const lab = String(r.subStatus || '').toLowerCase()
      const graded = ['graded', 'finished'].includes(lab)
      const submitted = lab === 'submitted'
      const overdue = isOverdue(r)
      const s = query.value.status
      // 未提交口径与作业一致：待提交只算截止未到，已过截止归「已截止」
      if (s === 'todo') return !graded && !submitted && lab !== 'revision' && !overdue
      if (s === 'overdue') return !graded && !submitted && lab !== 'revision' && overdue
      if (s === 'doing') return submitted
      if (s === 'done') return graded
      if (s === 'appeal') return lab === 'revision'
      return true
    })
  }
  const kw = query.value.keyword.trim().toLowerCase()
  if (kw) ls = ls.filter((r) => String(r.title || '').toLowerCase().includes(kw))
  return ls
}

/** 统计卡基于全部可见作业（含已截止/已归档），与下方作业表格数据一致 */
const counts = computed(() => ({
  homework: visibleHomework.value.length,
  lab: allLabs.value.length,
  // 待提交只算截止未到的；已截止未交归到「已截止」，不计入待提交
  todo: visibleHomework.value.filter((r) => (!r.myStatus || r.myStatus === 'draft') && !isDone(r) && !isOverdue(r)).length,
  overdue: visibleHomework.value.filter((r) => (!r.myStatus || r.myStatus === 'draft') && !isDone(r) && isOverdue(r)).length,
  doing: visibleHomework.value.filter((r) => ['submitted', 'queued', 'grading', 'manual'].includes(r.myStatus)).length,
  done: visibleHomework.value.filter((r) => isDone(r)).length,
  week: visibleHomework.value.filter((r) => {
    const ms = deadlineMeta(r).ms
    return ms > 0 && ms <= 7 * 86400000 && !isDone(r)
  }).length
}))
/** 实验页统计卡：与作业同口径（已过截止未交归「已截止」，不再算「待提交」） */
const labCounts = computed(() => {
  const unfinished = (r) => {
    const lab = String(r.subStatus || '').toLowerCase()
    return !['graded', 'finished', 'submitted', 'revision'].includes(lab)
  }
  return {
    todo: allLabs.value.filter((r) => unfinished(r) && !isOverdue(r)).length,
    overdue: allLabs.value.filter((r) => unfinished(r) && isOverdue(r)).length,
    doing: allLabs.value.filter((r) => String(r.subStatus || '').toLowerCase() === 'submitted').length,
    done: allLabs.value.filter((r) => ['graded', 'finished'].includes(String(r.subStatus || '').toLowerCase())).length,
    week: allLabs.value.filter((r) => {
      const ms = deadlineMeta(r).ms
      return ms > 0 && ms <= 7 * 86400000 && unfinished(r)
    }).length
  }
})
/** 汇总卡随页签切换展示当前页签数据（原先实验页也显示作业统计，全是假数） */
const activeCounts = computed(() => (tab.value === 'lab' ? labCounts.value : counts.value))
const hasLabSubmission = (row) => row.subId != null

const STATUS_OPTIONS = [
  { v: '', l: '全部状态' },
  { v: 'todo', l: '待提交' },
  { v: 'doing', l: '待批改 / 批改中' },
  { v: 'done', l: '已批改' },
  { v: 'appeal', l: '申诉 / 退回重做' },
  { v: 'overdue', l: '已截止' }
]

function reload() { pageNum.value = 1 }
function reset() {
  query.value = { courseId: 0, status: '', keyword: '', weekNum: 0 }
  pageNum.value = 1
}
function switchTab(t) {
  tab.value = t
  pageNum.value = 1
}
watch(() => route.query.courseId, (v) => {
  if (v) query.value.courseId = Number(v) || 0
}, { immediate: true })

/* ---------- 行操作 ---------- */
/**
 * 作业行入口：
 *  - 已提交（含批改/申诉/退回）→ 提交详情
 *  - 未提交且已截止 → 作答页只读模式（view=1），可查看题目内容但不能提交
 *  - 未提交且未截止 → 作答页；若教师开启补交(allowLate)，带 allowLate=1 允许逾期提交
 *  - 补交按钮显式传 'answer'，绕过只读模式进入可提交状态
 */
function open(row, forceMode) {
  if (tab.value === 'lab') {
    // 与作业行一致：直达该实验的独立详情页；去提交/去补交由详情页自动打开提交弹窗
    // 注意：mode 在作业分支才声明，这里不能引用它（会触发 TDZ ReferenceError）
    const labAction = forceMode === 'submit' || forceMode === 'makeup' ? forceMode : ''
    router.push({ name: 'StuLabDetail', params: { taskId: row.taskId }, query: labAction ? { action: labAction } : {} })
    return
  }
  const mode = forceMode || (hasSubmission(row) ? 'detail' : (isOverdue(row) ? 'view' : 'answer'))
  if (mode === 'detail') {
    router.push({
      name: 'StuSubmission',
      params: { submissionId: row.mySubmissionId || row.assignmentId },
      query: { assignmentId: row.assignmentId }
    })
    return
  }
  if (mode === 'view') {
    router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: row.assignmentId }, query: { view: '1' } })
  } else {
    router.push({
      name: 'StuHomeworkAnswer',
      params: { assignmentId: row.assignmentId },
      query: canMakeUp(row) && isOverdue(row) ? { allowLate: '1' } : {}
    })
  }
}
function openAppeal(row) {
  appealTarget.value = row
  appealVisible.value = true
}

onMounted(() => {
  load()
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 60 * 1000)
})
onBeforeUnmount(() => { if (clockTimer) window.clearInterval(clockTimer) })
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="作业中心" desc="作业、实验与成绩统一入口，字段与状态口径对齐教师端作业管理">
      <template #actions>
        <el-button size="small" @click="router.push({ name: 'StuGrades' })">
          <BaseIcon name="bar-chart-3" :size="14" />成绩单
        </el-button>
        <el-button size="small" @click="router.push({ name: 'StuWeeklyReport' })">
          <BaseIcon name="calendar-clock" :size="14" />学习周报
        </el-button>
        <el-button size="small" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="offline" class="mb16" type="warning" :closable="false" show-icon
      title="未取到作业数据" description="请确认：① 后端已启动 ② 接口 GET /api/v1/assignments 可用" />

    <!-- 筛选栏（教师端同款：放在页面顶部、列表卡片外；课程 / 状态 / 标题，标题前端本地过滤） -->
    <div class="filter-card" role="search" aria-label="作业筛选">
      <el-form :inline="true" size="small" class="filter-form" @submit.prevent>
        <el-form-item label="课程">
          <el-select v-model="query.courseId" placeholder="全部课程" style="width: 200px"
            aria-label="按课程筛选" @change="reload">
            <el-option label="全部课程" :value="0" />
            <el-option v-for="c in courseOptions" :key="c.courseId" :label="c.courseName" :value="c.courseId" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 160px"
            aria-label="按状态筛选" @change="reload">
            <el-option v-for="s in STATUS_OPTIONS" :key="s.v" :label="s.l" :value="s.v" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="query.keyword" clearable placeholder="按标题模糊搜索" style="width: 200px"
            aria-label="按标题搜索" @keyup.enter="reload" />
        </el-form-item>
      </el-form>
      <div class="filter-actions">
        <el-button type="primary" size="small" @click="reload"><BaseIcon name="search" :size="14" />查询</el-button>
        <el-button size="small" @click="reset">重置</el-button>
      </div>
    </div>

    <!-- 汇总卡（学生视角，对齐教师端顶部统计） -->
    <div class="summary-row">
      <div class="sum"><span class="ic ic-warn"><BaseIcon name="clock" :size="18" /></span><div><div class="num">{{ activeCounts.todo }}</div><div class="lbl">待提交</div></div></div>
      <div class="sum"><span class="ic ic-closed"><BaseIcon name="clock" :size="18" /></span><div><div class="num">{{ activeCounts.overdue }}</div><div class="lbl">已截止</div></div></div>
      <div class="sum"><span class="ic ic-doing"><BaseIcon name="clock" :size="18" /></span><div><div class="num">{{ activeCounts.doing }}</div><div class="lbl">{{ tab === 'lab' ? '待批阅' : '批改中' }}</div></div></div>
      <div class="sum"><span class="ic ic-done"><BaseIcon name="circle-check" :size="18" /></span><div><div class="num">{{ activeCounts.done }}</div><div class="lbl">{{ tab === 'lab' ? '已批阅' : '已批改' }}</div></div></div>
      <div class="sum"><span class="ic ic-brand"><BaseIcon name="calendar-clock" :size="18" /></span><div><div class="num">{{ activeCounts.week }}</div><div class="lbl">本周截止</div></div></div>
    </div>

    <!-- 最近截止提醒条（对齐教师端 upcomingDeadlines，点进去作答/详情） -->
    <section v-if="upcoming.length && tab === 'homework'" class="deadline-strip">
      <div class="strip-title"><BaseIcon name="clock" :size="14" /><span>最近截止</span></div>
      <div class="strip-list">
        <button v-for="r in upcoming" :key="r.assignmentId" type="button" class="deadline-chip"
          :class="'tone-' + deadlineMeta(r).cls" @click="open(r)">
          <span class="dl-name">{{ r.title }}</span>
          <span class="teaching-deadline" :class="'is-' + deadlineMeta(r).cls">{{ deadlineMeta(r).text }}</span>
        </button>
      </div>
    </section>

    <el-card shadow="never" class="mt16">
      <!-- 页签：作业 / 实验（全部作业同表展示，不再拆分进行中/历史归档） -->
      <div class="tabs">
        <div class="tabs-left">
          <span v-for="t in [{v:'homework',l:'作业',n:counts.homework},{v:'lab',l:'实验',n:counts.lab}]"
            :key="t.v" class="tab" :class="{ active: tab === t.v }" @click="switchTab(t.v)">
            {{ t.l }} <span class="cnt">{{ t.n }}</span>
          </span>
        </div>
        <span class="total-txt">共 {{ total }} 条</span>
      </div>

      <!-- 桌面端表格（教师端同款列：作业 / 状态 / 截止 / 得分 / 操作） -->
      <div class="desktop-only">
        <el-table v-if="paged.length" :data="paged" :row-key="(r) => r.assignmentId || r.taskId" border size="small"
          class="hw-table" @row-click="open">
          <el-table-column label="作业 / 实验" min-width="260">
            <template #default="s">
              <div class="hw-title link-title" @click.stop="open(s.row)">{{ s.row.title }}</div>
              <div class="hw-sub" v-if="tab !== 'lab'">
                {{ assignTypeLabel(s.row.assignType) }} · {{ s.row.courseName || s.row.weekNum ? (s.row.courseName + (s.row.weekNum ? ' · 第' + s.row.weekNum + '周' : '')) : '—' }}
              </div>
              <div class="hw-sub" v-else>{{ s.row.courseName || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="118" align="center">
            <template #default="s">
              <span class="status" :class="subMeta(s.row).cls">{{ subMeta(s.row).text }}</span>
            </template>
          </el-table-column>
          <el-table-column label="截止时间" width="180">
            <template #default="s">
              <div>{{ fmt(s.row.deadline) }}</div>
              <span class="teaching-deadline" :class="'is-' + deadlineMeta(s.row).cls">{{ deadlineMeta(s.row).text }}</span>
            </template>
          </el-table-column>
          <el-table-column label="我的得分" width="110" align="center">
            <template #default="s">
              <span v-if="tab !== 'lab'" class="score" :class="{ ok: isDone(s.row) }">{{ scoreText(s.row) }}</span>
              <span v-else class="score" :class="{ ok: s.row.score != null }">{{ s.row.score != null ? s.row.score : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="230" align="right">
            <template #default="s">
              <template v-if="tab !== 'lab'">
                <!-- 已提交：看提交详情/成绩；未提交且已截止：查看作业内容；老师开了补交才多一个「去补交」 -->
                <el-button v-if="hasSubmission(s.row)" type="primary" size="small" @click.stop="open(s.row, 'detail')">
                  查看详情
                </el-button>
                <template v-else-if="isOverdue(s.row)">
                  <el-button size="small" @click.stop="open(s.row, 'view')">查看作业</el-button>
                  <el-button v-if="canMakeUp(s.row)" type="primary" size="small" @click.stop="open(s.row, 'answer')">
                    去补交
                  </el-button>
                </template>
                <el-button v-else type="primary" size="small" @click.stop="open(s.row, 'answer')">去作答</el-button>
                <el-button v-if="canAppeal(s.row)" size="small" @click.stop="openAppeal(s.row)">申诉</el-button>
                <el-tooltip v-else-if="s.row.myStatus === 'finished'" content="教师未开启该作业的成绩申诉" placement="top">
                  <el-button size="small" disabled>申诉</el-button>
                </el-tooltip>
              </template>
              <template v-else>
                <el-button v-if="hasLabSubmission(s.row)" type="primary" size="small" @click.stop="open(s.row)">查看详情</el-button>
                <template v-else-if="isOverdue(s.row)">
                  <el-button size="small" @click.stop="open(s.row)">查看实验</el-button>
                  <el-button v-if="canMakeUp(s.row)" type="primary" size="small" @click.stop="open(s.row, 'makeup')">去补交</el-button>
                </template>
                <el-button v-else type="primary" size="small" @click.stop="open(s.row, 'submit')">去提交</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 移动端卡片（同数据重排） -->
      <div class="mobile-only">
        <div v-for="r in paged" :key="r.assignmentId || r.taskId" class="hw-card" @click="open(r)">
          <div class="hw-card-top">
            <div class="hw-title">{{ r.title }}</div>
            <span v-if="tab !== 'lab'" class="status" :class="subMeta(r).cls">{{ subMeta(r).text }}</span>
          </div>
          <div class="hw-sub">{{ tab === 'lab' ? (r.courseName || '—') : (assignTypeLabel(r.assignType) + ' · ' + (r.courseName || '—')) }}</div>
          <div class="hw-card-foot">
            <span class="small muted">截止 {{ fmt(r.deadline) }}</span>
            <el-button v-if="tab !== 'lab' && isOverdue(r) && !hasSubmission(r) && canMakeUp(r)"
              size="small" type="primary" @click.stop="open(r, 'answer')">去补交</el-button>
            <el-button v-else-if="tab === 'lab' && isOverdue(r) && !hasLabSubmission(r) && canMakeUp(r)"
              size="small" type="primary" @click.stop="open(r, 'makeup')">去补交</el-button>
            <el-button v-else-if="tab !== 'lab' && canAppeal(r)" size="small" @click.stop="openAppeal(r)">申诉</el-button>
          </div>
        </div>
      </div>

      <el-empty v-if="!paged.length && !loading" description="暂无记录" />
      <div v-if="total > pageSize" class="pager">
        <el-pagination v-model:current-page="pageNum" v-model:page-size="pageSize" background
          layout="total, sizes, prev, pager, next" :total="total" :page-sizes="[10, 20, 50]" />
      </div>
    </el-card>

    <AppealDialog v-model="appealVisible" :assignment-id="appealTarget?.assignmentId || 0"
      :title="appealTarget?.title || ''" @success="load" />
  </div>
</template>

<style scoped>
.mb16 { margin-bottom: 16px; }
.mt16 { margin-top: 16px; }
.summary-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.sum { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px 16px; }
.sum .ic { width: 38px; height: 38px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: #fff; flex: none; }
.ic-warn { background: #d97706; }
.ic-closed { background: #6b7280; }
.ic-doing { background: #2563eb; }
.ic-done { background: var(--success); }
.ic-brand { background: var(--brand-600); }
.sum .num { font-size: 20px; font-weight: 800; color: var(--ink-900); line-height: 1.2; }
.sum .lbl { font-size: 12px; color: var(--ink-500); }

.deadline-strip { margin-top: 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: #fff; padding: 12px 16px; }
.strip-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ink-700); margin-bottom: 10px; }
.strip-list { display: flex; flex-wrap: wrap; gap: 10px; }
.deadline-chip { display: inline-flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-soft); cursor: pointer; font-size: 12.5px; color: var(--ink-800); }
.deadline-chip:hover { border-color: var(--brand-300); }
.deadline-chip .dl-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 顶部筛选栏（教师端 teaching-filter-bar 同款：标题下方、列表卡片外） */
.filter-card { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px 16px 6px; margin-bottom: 16px; }
.filter-form { flex: 1; }
.filter-form :deep(.el-form-item) { margin-bottom: 8px; }
.filter-actions { display: flex; gap: 8px; align-items: center; padding-bottom: 8px; flex-wrap: wrap; }

.tabs { display: flex; gap: 6px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.tabs-left { display: flex; gap: 6px; }
.tab { padding: 9px 16px; font-size: 13.5px; color: var(--ink-600); cursor: pointer; border-bottom: 2px solid transparent; user-select: none; }
.tab:hover { color: var(--brand-700); }
.tab.active { color: var(--brand-700); font-weight: 600; border-bottom-color: var(--brand-600); }
.cnt { font-size: 11px; color: var(--ink-400); margin-left: 3px; }
.total-txt { font-size: 12.5px; color: var(--ink-500); }

.hw-title { font-weight: 600; color: var(--ink-900); }
.link-title { cursor: pointer; }
.link-title:hover { color: var(--brand-600); text-decoration: underline; }
.hw-table :deep(.el-table__row) { cursor: pointer; }
.hw-table :deep(.el-table__row):hover > td { background: var(--brand-50, #f5f8ff) !important; }
.hw-sub { font-size: 12px; color: var(--ink-500); margin-top: 3px; }
.status { display: inline-block; padding: 3px 9px; border-radius: 5px; font-size: 11.5px; font-weight: 600; }
.status.is-todo, .status.is-draft { background: #fef3c7; color: #92400e; }
/* 学习通口径：灰色 = 已截止（含已截止未交），区别于进行中的蓝色 */
.status.is-closed { background: #f3f4f6; color: #6b7280; }
.status.is-doing, .status.is-submitted, .status.is-queued, .status.is-grading, .status.is-manual { background: #dbeafe; color: #1e40af; }
.status.is-done, .status.is-finished, .status.is-graded { background: #dcfce7; color: #15803d; }
.status.is-appeal { background: #fee2e2; color: #b91c1c; }
.status.is-return, .status.is-revision { background: #ffedd5; color: #c2410c; }
.teaching-deadline { font-size: 11.5px; }
.teaching-deadline.is-danger { color: #dc2626; }
.teaching-deadline.is-warning { color: #d97706; }
.teaching-deadline.is-normal { color: var(--ink-500); }
.teaching-deadline.is-muted { color: var(--ink-400); }
.score { font-size: 13px; color: var(--ink-500); }
.score.ok { color: #15803d; font-weight: 600; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }

.hw-card { background: #fff; border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px 16px; margin-bottom: 12px; cursor: pointer; }
.hw-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.hw-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border); }
.mobile-only { display: none; }
@media (max-width: 900px) {
  .summary-row { grid-template-columns: repeat(2, 1fr); }
  .desktop-only { display: none; }
  .mobile-only { display: block; }
}
</style>
