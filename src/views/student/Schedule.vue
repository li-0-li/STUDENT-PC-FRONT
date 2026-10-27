<script setup>
/**
 * 我的课表（分支 stu-pc-schedule）
 * ★ 2026-10-15 数据源切换：GET /api/v1/stu/schedule?weekRef=N（stu-pc 模块自有接口，
 *   学生视角、按教学周直查本人课表；旧 /api/v1/schedules 需 startDate/endDate 且按教师过滤）。
 * 视觉：ui-prototype/pc/student-schedule.html 的「节次行 × 周一~周日 网格 + 本周列高亮 + 周切换」
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { mySchedule } from '@/api/student/schedule'

const router = useRouter()

/** 节次行（照原型） */
const PERIODS = [
  { no: '1-2', label: '1-2 节', time: '08:30-10:05' },
  { no: '3-4', label: '3-4 节', time: '10:25-12:00' },
  { no: '5-6', label: '5-6 节', time: '14:00-15:35' },
  { no: '7-8', label: '7-8 节', time: '15:55-17:30' },
  { no: '9-10', label: '晚 9-10 节', time: '19:00-20:35' }
]
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MON = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

/** 空课表（取不到数据就显示空网格 + 明确提示，不显示假数据） */
const emptyGrid = () => PERIODS.map(() => Array(7).fill(null))

/* ---------------- 周计算（学期第 1 周以 2026-08-31 周一 起算） ---------------- */
const SEMESTER_MONDAY = new Date(2026, 7, 31)
function mondayOf(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return t
}
const currentWeek = (() => {
  const diff = Math.round((mondayOf(new Date()) - SEMESTER_MONDAY) / 86400000)
  return Math.min(20, Math.max(1, Math.floor(diff / 7) + 1))
})()

const W = ref(currentWeek)
const weekDates = computed(() => {
  const start = new Date(SEMESTER_MONDAY)
  start.setDate(start.getDate() + (W.value - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
})
const fmtMD = (d) => MON[d.getMonth()] + '-' + String(d.getDate()).padStart(2, '0')
const weekLabel = computed(() => {
  const ds = weekDates.value
  return `第 ${W.value} 周 · ${ds[0].getFullYear()}-${fmtMD(ds[0])} ~ ${fmtMD(ds[6])}`
})
const todayIdx = computed(() => {
  const t = new Date()
  const same = mondayOf(t).getTime() === mondayOf(weekDates.value[0]).getTime()
  return same ? (t.getDay() + 6) % 7 : -1
})
function week(d) {
  W.value = Math.min(maxWeek.value, Math.max(1, W.value + d))
}

/* ---------------- 课表数据 ---------------- */
const grid = ref(emptyGrid())
const offline = ref(false)
const loading = ref(false)

/** 配色：按 courseId 稳定散列到 5 色（同一门课跨周同色） */
function colorOf(courseId) {
  return Math.abs(Number(courseId) || 0) % 5
}

/** 图例由**真实课表里出现过的课程**生成 */
const legend = computed(() => {
  const seen = []
  grid.value.forEach((row) =>
    row.forEach((c) => {
      if (!c) return
      if (!seen.some((x) => x.ci === c.c && x.n === c.n)) seen.push({ ci: c.c, n: c.n })
    })
  )
  return seen.sort((a, b) => a.ci - b.ci)
})
const hasAny = computed(() => legend.value.length > 0)

async function load() {
  loading.value = true
  try {
    const list = await mySchedule(W.value)
    const arr = Array.isArray(list) ? list : list?.list || []
    const g = emptyGrid()
    arr.forEach((s) => {
      const pi = PERIODS.findIndex((p) => p.no === String(s.periodNo || ''))
      const di = (Number(s.weekday) || 1) - 1
      if (pi >= 0 && di >= 0 && di < 7) {
        const room = s.classroomName || '—'
        const tch = s.teacherName || ''
        g[pi][di] = {
          n: s.courseName,
          r: tch ? `${room} · ${tch}` : room,
          c: colorOf(s.courseId),
          // 供详情弹窗与跳转使用
          courseId: s.courseId,
          teacher: tch || '—',
          room: s.classroomName || '—',
          periodNo: s.periodNo || '',
          classTime: s.classTime,
          durationMin: s.durationMin
        }
      }
    })
    grid.value = g
    offline.value = false
  } catch {
    grid.value = emptyGrid()
    offline.value = true
  } finally {
    loading.value = false
  }
}

/** 本周课节数（统计条用） */
const weekCount = computed(() => grid.value.flat().filter(Boolean).length)

/** 全学期「有排课的周次」——空周提示与快速跳周用（mySchedule 不带 weekRef = 全部周） */
const weeksWithData = ref([])
async function loadWeeks() {
  try {
    const list = await mySchedule()
    const arr = Array.isArray(list) ? list : list?.list || []
    weeksWithData.value = [...new Set(arr.map((s) => Number(s.weekRef)).filter(Boolean))].sort((a, b) => a - b)
  } catch {
    weeksWithData.value = []
  }
}

/** 教学周上限：按实际有排课的最大周次（至少 20），避免「下一周」卡在 20 周 */
const maxWeek = computed(() => Math.max(20, ...weeksWithData.value))

/**
 * 周次下拉选项：只列「有排课的周次」+ 当前周。
 * ★ 2026-10-27 改版：原来是把 20+ 个「第N周」链接平铺在统计行里，两行还换行、很难看。
 */
const weekOptions = computed(() => {
  const base = weeksWithData.value.length
    ? weeksWithData.value
    : Array.from({ length: maxWeek.value }, (_, i) => i + 1)
  return [...new Set([...base, W.value])].sort((a, b) => a - b)
})

/** 空周时只给就近 3 个有课周次，不铺一长串 */
const nearbyWeeks = computed(() =>
  [...weeksWithData.value]
    .sort((a, b) => Math.abs(a - W.value) - Math.abs(b - W.value))
    .slice(0, 3)
    .sort((a, b) => a - b)
)

/** 课程色块 → 详情弹窗 */
const detailVisible = ref(false)
const selected = ref(null)
function openCell(cell) {
  selected.value = cell
  detailVisible.value = true
}
const fmtTime = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function gotoCourse() {
  if (!selected.value) return
  detailVisible.value = false
  router.push({ name: 'StuCourseDetail', params: { courseId: selected.value.courseId } })
}
function gotoTask() {
  if (!selected.value) return
  detailVisible.value = false
  // 新 UI：作业+实验统一任务流，带课程筛选
  router.push({ name: 'StuTasks', query: { courseId: selected.value.courseId } })
}

/** 切周即刷新（该接口按 weekRef 查询，不缓存）；回到本周 */
watch(W, load)
function backToday() {
  W.value = currentWeek
}
function refreshAll() {
  load()
  loadWeeks()
}
onMounted(() => {
  load()
  loadWeeks()
})
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我的课表" desc="按周查看上课安排">
      <template #actions>
        <el-button size="small" @click="week(-1)"><BaseIcon name="chevron-left" :size="14" />上一周</el-button>
        <el-select v-model="W" size="small" class="wk-select" placeholder="选择周次">
          <el-option v-for="w in weekOptions" :key="w" :label="`第 ${w} 周`" :value="w" />
        </el-select>
        <el-button size="small" @click="week(1)">下一周<BaseIcon name="chevron-right" :size="14" /></el-button>
        <el-button size="small" :disabled="W === currentWeek" @click="backToday">回到本周</el-button>
        <el-button size="small" @click="refreshAll"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="未取到课表数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 接口 GET /api/v1/stu/schedule 可用"
    />

    <div class="hint-bar row" style="gap: 8px; align-items: center">
      <span class="small muted">
        {{ weekLabel }} · 共 <b>{{ weekCount }}</b> 节课
      </span>
      <el-tag v-if="W === currentWeek" size="small" type="success" effect="plain">本周</el-tag>
      <el-tag v-if="weeksWithData.length" size="small" type="info" effect="plain">
        本学期 {{ weeksWithData.length }} 周有排课
      </el-tag>
    </div>

    <el-card shadow="never">
      <table class="tt">
        <thead>
          <tr>
            <th class="slot">节次</th>
            <th v-for="(d, i) in weekDates" :key="i" :class="{ today: i === todayIdx }">
              {{ DAYS[i] }}
              <div class="dmd">{{ fmtMD(d) }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, pi) in PERIODS" :key="pi">
            <td class="slot">{{ p.label }}<br />{{ p.time }}</td>
            <td v-for="(d, di) in weekDates" :key="di" :class="{ today: di === todayIdx }">
              <div
                v-if="grid[pi] && grid[pi][di]"
                class="cls"
                :class="`c${grid[pi][di].c}`"
                @click="openCell(grid[pi][di])"
              >
                <b>{{ grid[pi][di].n }}</b>
                <div class="sub">{{ grid[pi][di].r }}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="!hasAny && !loading" class="empty-hint">
        第 {{ W }} 周暂无排课
        <div v-if="nearbyWeeks.length" class="small muted" style="margin-top: 6px">
          就近有课：<el-link v-for="w in nearbyWeeks" :key="w" type="primary" class="wk" @click="W = w">第{{ w }}周</el-link>
        </div>
      </div>

      <div v-if="hasAny" class="row mt16" style="gap: 14px; flex-wrap: wrap">
        <span v-for="l in legend" :key="l.ci" class="row small muted" style="gap: 6px">
          <span class="legend" :class="`c${l.ci}`" />{{ l.n }}
        </span>
      </div>
    </el-card>

    <!-- 课程详情弹窗（点击色块） -->
    <el-dialog v-model="detailVisible" title="课程信息" width="420px">
      <template v-if="selected">
        <div class="d-row"><span class="d-label">课程</span><b>{{ selected.n }}</b></div>
        <div class="d-row"><span class="d-label">教师</span><span>{{ selected.teacher }}</span></div>
        <div class="d-row"><span class="d-label">教室</span><span>{{ selected.room }}</span></div>
        <div class="d-row"><span class="d-label">节次</span><span>第 {{ selected.periodNo }} 节（{{ selected.durationMin || '—' }} 分钟）</span></div>
        <div class="d-row"><span class="d-label">时间</span><span>{{ fmtTime(selected.classTime) }}</span></div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="gotoTask">该课任务</el-button>
        <el-button type="primary" @click="gotoCourse">进入课程</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tt {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.tt th,
.tt td {
  border: 1px solid var(--border);
  padding: 6px;
  text-align: center;
  vertical-align: top;
}
.tt th {
  background: var(--bg-soft);
  font-weight: 600;
  font-size: 13px;
  padding: 10px 6px;
}
.tt th.today {
  background: var(--brand-600);
  color: #fff;
}
.tt .slot {
  background: var(--bg-soft);
  color: var(--ink-500);
  font-size: 12px;
  width: 86px;
  vertical-align: middle;
}
.tt td.today {
  background: var(--brand-50);
}
.tt .dmd {
  font-weight: 400;
  font-size: 12px;
}
.cls {
  margin: 2px;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: 0.12s;
}
.cls:hover {
  transform: translateY(-1px);
  box-shadow: var(--sh-1);
}
.cls b {
  display: block;
  font-size: 12.5px;
}
.cls .sub {
  color: var(--ink-500);
  font-size: 11px;
  margin-top: 2px;
}
.c0 {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}
.c1 {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.c2 {
  background: #fef3c7;
  border: 1px solid #fde68a;
}
.c3 {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
}
.c4 {
  background: #fdf2f8;
  border: 1px solid #fbcfe8;
}
.legend {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  display: inline-block;
}
.mb16 {
  margin-bottom: 16px;
}
.empty-hint {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-400);
}
.hint-bar {
  margin-bottom: 12px;
}
.wk-select {
  width: 112px;
  margin: 0 4px;
}
.wk {
  margin-left: 8px;
  vertical-align: baseline;
}
.wk.cur {
  font-weight: 700;
}
.d-row {
  display: flex;
  gap: 12px;
  padding: 7px 0;
  font-size: 13.5px;
  border-bottom: 1px dashed var(--bg-soft);
}
.d-label {
  width: 44px;
  color: var(--ink-500);
  flex-shrink: 0;
}
</style>
