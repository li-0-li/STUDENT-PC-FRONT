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

const route = useRoute()
const router = useRouter()

const all = ref([])
const loading = ref(false)
const offline = ref(false)
/** 全部 / homework / experiment / overdue */
const filter = ref('')
const kw = ref('')

/** URL 查询参数：?taskType=homework|experiment|overdue、?courseId=13（课程页/课表页跳转带上下文） */
const courseIdF = computed(() => Number(route.query.courseId) || 0)
const courseNameF = computed(() => {
  const hit = all.value.find((t) => Number(t.courseId) === courseIdF.value)
  return hit ? hit.courseName : (courseIdF.value ? `课程 #${courseIdF.value}` : '')
})

const CHIPS = [
  { v: '', label: '全部' },
  { v: 'homework', label: '作业' },
  { v: 'experiment', label: '实验报告' },
  { v: 'overdue', label: '已截止' }
]

const now = Date.now()
const isOverdue = (t) => !!t.deadline && new Date(t.deadline).getTime() < now

const list = computed(() => {
  let ls = all.value
  if (filter.value === 'homework' || filter.value === 'experiment') {
    ls = ls.filter((t) => t.taskType === filter.value)
  } else if (filter.value === 'overdue') {
    ls = ls.filter(isOverdue)
  }
  if (courseIdF.value) {
    ls = ls.filter((t) => Number(t.courseId) === courseIdF.value)
  }
  const k = kw.value.trim()
  if (k) ls = ls.filter((t) => (t.title || '').includes(k) || (t.courseName || '').includes(k))
  return ls
})

/** 清除课程筛选（回到全部任务） */
function clearCourse() {
  router.replace({ path: '/student/tasks', query: {} })
}

/** URL 参数变化（顶栏跳转）时同步 */
watch(
  () => route.query.taskType,
  (v) => {
    if (v === 'homework' || v === 'experiment' || v === 'overdue') filter.value = v
  }
)

const counts = computed(() => ({
  all: all.value.length,
  homework: all.value.filter((t) => t.taskType === 'homework').length,
  experiment: all.value.filter((t) => t.taskType === 'experiment').length,
  overdue: all.value.filter(isOverdue).length
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
    const d = await myTasks()
    all.value = Array.isArray(d) ? d : d?.list || []
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
    router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: t.taskRefId } })
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
    <PageHeader title="我的任务" desc="作业与实验报告统一任务流，按截止时间排序">
      <template #actions>
        <el-input
          v-model="kw"
          placeholder="搜索任务名 / 课程"
          clearable
          style="width: 220px"
        >
          <template #prefix><BaseIcon name="search" :size="15" /></template>
        </el-input>
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
        <span v-if="courseIdF" class="course-filter">
          课程：{{ courseNameF }}
          <el-link type="primary" style="margin-left: 6px" @click="clearCourse">清除</el-link>
        </span>
      </div>

      <div class="rows">
        <div v-for="t in list" :key="t.taskType + '-' + t.taskRefId" class="row" @click="openTask(t)">
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
  gap: 8px;
  padding: 2px 0 12px;
  border-bottom: 1px solid var(--border);
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
.course-filter {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--ink-600);
  background: var(--bg-soft);
  border-radius: var(--r-full);
  padding: 4px 12px;
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
