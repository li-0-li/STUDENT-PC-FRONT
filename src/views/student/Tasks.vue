<script setup>
/**
 * 我的任务（新 UI 侧栏③，分支 stu-pc-task）
 * 数据源：stu-pc 模块自有接口 GET /api/v1/stu/tasks（作业 + 实验报告统一任务流）
 * 归组说明见：交付文档/学生PC端-新UI功能清单-按钮级-20261014.md
 *   —— 「我的作业」「实验报告」不再各占一个侧栏位，合并为任务流；
 *      旧页面 /student/homeworks、/student/lab 保留可达（本页行点击跳转）。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { myTasks } from '@/api/student/task'
import { myCourses } from '@/api/student/course'

const route = useRoute()
const router = useRouter()

const all = ref([])
const loading = ref(false)
const offline = ref(false)
/** 全部 / homework / experiment / overdue */
const filter = ref('')

/**
 * ★ 2026-11-10 课程下拉筛选：取消按任务名/课程名的文本搜索，改为只列本人已选课程。
 * 顺序直接沿用 myCourses() 的返回顺序（后端 ORDER BY enroll_time DESC，与「我的课程」一致），
 * 不额外排序，保证选课顺序可预期；选中后同步到 URL ?courseId=，课程页跳转过来自动带上。
 */
const courseOptions = ref([])
const courseIdF = computed(() => Number(route.query.courseId) || 0)
const selectedCourse = computed({
  get: () => courseIdF.value,
  set: (v) => {
    const q = { ...route.query }
    if (v) q.courseId = String(v)
    else delete q.courseId
    router.replace({ path: '/student/tasks', query: q })
  }
})

const CHIPS = [
  { v: '', label: '全部' },
  { v: 'homework', label: '作业' },
  { v: 'experiment', label: '实验报告' },
  { v: 'overdue', label: '已截止' }
]

const isOverdue = (t) => !!t.deadline && new Date(t.deadline).getTime() < Date.now()

/**
 * ★ 2026-11-10 优先级（临近截止更高，已完成最低）：
 *   P0 紧急 —— 未完成且已逾期或 24h 内截止
 *   P1 较高 —— 未完成且 3 天内截止
 *   P2 中等 —— 未完成且 7 天内截止
 *   P3 常规 —— 未完成且 7 天以后 / 无截止时间
 *   P4 完成 —— 已提交 / 已批改 / 申诉中（排最后）
 * 排序：优先级升序 → 截止时间升序（早截止在前）→ 任务名。
 */
const DAY = 86400000
const PRIORITY_LEGEND = [
  { level: 0, short: 'P0', label: '紧急', desc: '24 小时内截止或已逾期', cls: 'p0' },
  { level: 1, short: 'P1', label: '较高', desc: '3 天内截止', cls: 'p1' },
  { level: 2, short: 'P2', label: '中等', desc: '7 天内截止', cls: 'p2' },
  { level: 3, short: 'P3', label: '常规', desc: '7 天以后或无截止', cls: 'p3' },
  { level: 4, short: 'P4', label: '完成', desc: '已提交 / 已批改', cls: 'p4' }
]
function isDone(t) {
  const s = (t.submitStatus || '').toLowerCase()
  return ['submitted', 'graded', 'finished', 'reviewed', 'appealing'].includes(s) || t.score != null
}
function deadlineTs(t) {
  if (!t.deadline) return 0
  const s = String(t.deadline).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}
function priorityOf(t) {
  if (isDone(t)) return PRIORITY_LEGEND[4]
  const ts = deadlineTs(t)
  if (!ts) return PRIORITY_LEGEND[3]
  const left = ts - Date.now()
  if (left <= DAY) return PRIORITY_LEGEND[0]
  if (left <= 3 * DAY) return PRIORITY_LEGEND[1]
  if (left <= 7 * DAY) return PRIORITY_LEGEND[2]
  return PRIORITY_LEGEND[3]
}

/** 课程筛选后的基础集合（chip 计数也按它算，避免选中课程后计数对不上） */
const baseList = computed(() =>
  courseIdF.value ? all.value.filter((t) => Number(t.courseId) === courseIdF.value) : all.value
)

const list = computed(() => {
  let ls = baseList.value
  if (filter.value === 'homework' || filter.value === 'experiment') {
    ls = ls.filter((t) => t.taskType === filter.value)
  } else if (filter.value === 'overdue') {
    ls = ls.filter(isOverdue)
  }
  return [...ls].sort((a, b) => {
    const lv = priorityOf(a).level - priorityOf(b).level
    if (lv) return lv
    const ta = deadlineTs(a)
    const tb = deadlineTs(b)
    if (ta && tb && ta !== tb) return ta - tb
    if (ta && !tb) return -1
    if (!ta && tb) return 1
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
})

/** URL 参数变化（顶栏跳转）时同步 */
watch(
  () => route.query.taskType,
  (v) => {
    if (v === 'homework' || v === 'experiment' || v === 'overdue') filter.value = v
  }
)

const counts = computed(() => ({
  all: baseList.value.length,
  homework: baseList.value.filter((t) => t.taskType === 'homework').length,
  experiment: baseList.value.filter((t) => t.taskType === 'experiment').length,
  overdue: baseList.value.filter(isOverdue).length
}))

/** 提交状态文案（后端口径：null=未提交 / draft / submitted / graded / finished / appealing，SQL 已统一小写） */
function statusOf(t) {
  const s = (t.submitStatus || '').toLowerCase()
  if (s === 'graded' || s === 'finished' || s === 'reviewed') {
    return { text: t.score != null ? `已批改 ${t.score} 分` : '已批改', cls: 'ok' }
  }
  if (s === 'submitted') return { text: '已提交', cls: 'done' }
  if (s === 'draft') return { text: '草稿', cls: 'todo' }
  if (s === 'appealing') return { text: '申诉中', cls: 'todo' }
  if (isOverdue(t)) return { text: '已截止', cls: 'over' }
  return { text: '待提交', cls: 'todo' }
}

const typeTag = (t) =>
  t.taskType === 'experiment'
    ? { text: '实验', cls: 't-exp' }
    : { text: '作业', cls: 't-hw' }

const fmt = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const [d, cs] = await Promise.all([myTasks(), myCourses().catch(() => [])])
    all.value = Array.isArray(d) ? d : d?.list || []
    const arr = Array.isArray(cs) ? cs : cs?.list || []
    // 顺序即 myCourses 的返回顺序（后端按选课时间倒序），不重排
    courseOptions.value = arr
      .filter((c) => c?.courseId != null)
      .map((c) => ({ courseId: Number(c.courseId), courseName: c.courseName || `课程 #${c.courseId}` }))
    // 课程接口不可用时退化为「从本人任务里去重」（仍只含自己的课）
    if (!courseOptions.value.length) {
      const byId = new Map()
      for (const t of all.value) {
        if (t.courseId == null || byId.has(Number(t.courseId))) continue
        byId.set(Number(t.courseId), {
          courseId: Number(t.courseId),
          courseName: t.courseName || `课程 #${t.courseId}`
        })
      }
      courseOptions.value = [...byId.values()]
    }
    offline.value = false
  } catch {
    all.value = []
    offline.value = true
  } finally {
    loading.value = false
  }
}

/** 行点击：作业 → 作答页；实验 → 实验报告页（旧路由保留可达） */
function openTask(t) {
  if (t.taskType === 'experiment') {
    router.push({ name: 'StuLab' })
  } else {
    // ★ 2026-10-19 按状态分流（参考学习通）：已提交/已批改 → 作业详情；未提交 → 作答页
    const submitted = t.score != null || (t.submitStatus && String(t.submitStatus).length > 0)
    if (submitted) {
      router.push({ name: 'StuSubmission', query: { assignmentId: t.taskRefId } })
    } else {
      router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: t.taskRefId } })
    }
  }
}

onMounted(() => {
  const v = route.query.taskType
  if (v === 'homework' || v === 'experiment' || v === 'overdue') filter.value = v
  load()
})
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我的任务" desc="作业与实验报告统一任务流，按优先级与截止时间排序">
      <template #actions>
        <el-button size="small" @click="router.push({ name: 'StuGrades' })">
          <BaseIcon name="bar-chart-3" :size="14" />成绩单
        </el-button>
        <!-- ★ 2026-11-04 补入口：学习周报页（/student/weekly-report）此前只挂在旧版菜单表
             layout/menus.js 的 MENUS 里，而 student 角色实际渲染的是 STUDENT_NAV，
             导致页面做完但学生无路可达。此处按「成绩单」同款方式给一个入口。 -->
        <el-button size="small" @click="router.push({ name: 'StuWeeklyReport' })">
          <BaseIcon name="calendar-clock" :size="14" />学习周报
        </el-button>
        <el-button size="small" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="未取到任务数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 接口 GET /api/v1/stu/tasks 可用"
    />

    <el-card shadow="never">
      <div class="bar">
        <span
          v-for="c in CHIPS"
          :key="c.v"
          class="chip"
          :class="{ active: filter === c.v }"
          @click="filter = c.v"
        >
          {{ c.label }}
          <span class="cnt">{{ c.v === '' ? counts.all : counts[c.v] }}</span>
        </span>
        <!-- ★ 2026-11-10 课程下拉筛选：只列本人已选课程，顺序与「我的课程」一致 -->
        <span class="course-pick">
          <span class="small muted">课程</span>
          <el-select v-model="selectedCourse" clearable placeholder="全部课程" style="width: 190px">
            <el-option label="全部课程" :value="0" />
            <el-option
              v-for="c in courseOptions"
              :key="c.courseId"
              :label="c.courseName"
              :value="c.courseId"
            />
          </el-select>
          <span class="small muted">共 {{ baseList.length }} 条</span>
        </span>
      </div>

      <!-- 优先级口径图例 -->
      <div class="prio-legend">
        <span class="small muted">优先级</span>
        <span v-for="p in PRIORITY_LEGEND" :key="p.short" class="lg-item" :title="p.desc">
          <span class="prio" :class="p.cls">{{ p.short }}</span>{{ p.label }}
          <span class="small muted lg-desc">{{ p.desc }}</span>
        </span>
      </div>

      <div class="rows">
        <div v-for="t in list" :key="t.taskType + '-' + t.taskRefId" class="row" @click="openTask(t)">
          <span class="prio" :class="priorityOf(t).cls" :title="priorityOf(t).desc">
            {{ priorityOf(t).short }} {{ priorityOf(t).label }}
          </span>
          <span class="tag" :class="typeTag(t).cls">{{ typeTag(t).text }}</span>
          <span class="name">{{ t.title }}</span>
          <span class="course">{{ t.courseName || '—' }}</span>
          <span class="ddl" :class="{ urgent: isOverdue(t) }">截止 {{ fmt(t.deadline) }}</span>
          <span class="st" :class="statusOf(t).cls">{{ statusOf(t).text }}</span>
        </div>
        <el-empty v-if="!list.length && !loading" description="暂无任务" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.mb16 {
  margin-bottom: 16px;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 12px;
  border-bottom: 1px solid var(--border);
}
.course-pick {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.prio-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--bg-soft);
  font-size: 12.5px;
  color: var(--ink-600);
}
.lg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg-desc {
  font-size: 11.5px;
}
.prio {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  white-space: nowrap;
}
.prio.p0 {
  background: #fee2e2;
  color: #b91c1c;
}
.prio.p1 {
  background: #ffedd5;
  color: #c2410c;
}
.prio.p2 {
  background: #e0f2fe;
  color: #0369a1;
}
.prio.p3 {
  background: var(--bg-soft);
  color: var(--ink-500);
}
.prio.p4 {
  background: #dcfce7;
  color: #15803d;
}
.chip {
  padding: 5px 14px;
  border-radius: var(--r-full);
  font-size: 13px;
  color: var(--ink-600);
  cursor: pointer;
  user-select: none;
}
.chip:hover {
  color: var(--brand-700);
}
.chip.active {
  background: var(--primary-soft);
  color: var(--brand-700);
  font-weight: 600;
}
.cnt {
  font-size: 12px;
  color: var(--ink-400);
  margin-left: 4px;
}
.rows {
  padding: 4px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 6px;
  border-bottom: 1px solid var(--bg-soft);
  cursor: pointer;
  border-radius: var(--r-sm);
}
.row:hover {
  background: var(--bg-subtle, #f8fafb);
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}
.t-hw {
  background: var(--primary-soft);
  color: var(--brand-700);
}
.t-exp {
  background: #dcfce7;
  color: #16a34a;
}
.name {
  flex: 1;
  font-size: 14px;
  color: var(--ink-900);
}
.course {
  width: 160px;
  font-size: 12.5px;
  color: var(--ink-500);
}
.ddl {
  width: 150px;
  font-size: 12.5px;
  color: var(--ink-500);
}
.ddl.urgent {
  color: #dc2626;
}
.st {
  width: 90px;
  text-align: right;
  font-size: 12.5px;
}
.st.todo {
  color: #d97706;
}
.st.done {
  color: var(--brand-700);
}
.st.ok {
  color: #16a34a;
}
.st.over {
  color: var(--ink-400);
}
</style>
