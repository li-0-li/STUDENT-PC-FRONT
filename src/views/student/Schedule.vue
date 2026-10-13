<script setup>
/**
 * 我的课表（分支 stu-pc-schedule）
 * 关联接口（接口设计文档表号）：表 3-12 课表查询 GET /api/v1/schedules
 * 对应原型：ui-prototype/pc/student-schedule.html —— ★ 1:1 还原
 *   （节次行 × 周一~周日 网格、四色课程块、本周列高亮、上/下一周切换、图例）
 */
import { ref, computed, onMounted } from 'vue'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { scheduleList } from '@/api/student/schedule'

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

/** 课程配色（照原型 c0~c3） */
const COLORS_NAME = ['高等数学 A', '数据结构', '大学英语 III', '程序设计基础']

/** 空课表（★ 2026-10-10 删掉了原来的演示课表 DEMO_GRID —— 它会在取不到数据时标成"演示数据"显示假课表，
 *  评审时容易被误当成真数据。现在取不到就显示空网格 + 明确提示。） */
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
  W.value = Math.min(20, Math.max(1, W.value + d))
}

/* ---------------- 课表数据 ---------------- */
const grid = ref(emptyGrid())
const offline = ref(false)
const loading = ref(false)

function colorOf(name) {
  const n = name || ''
  const i = COLORS_NAME.findIndex((x) => n.includes(x.slice(0, 4)))
  return i >= 0 ? i : n.length % 4
}

/** 图例由**真实课表里出现过的课程**生成（原来写死 4 门课，会显示课表里根本没有的课） */
const legend = computed(() => {
  const seen = []
  grid.value.forEach((row) =>
    row.forEach((c) => {
      if (!c) return
      const ci = colorOf(c.n)
      if (!seen.some((x) => x.ci === ci)) seen.push({ ci, n: c.n })
    })
  )
  return seen.sort((a, b) => a.ci - b.ci)
})
const hasAny = computed(() => legend.value.length > 0)

async function load() {
  loading.value = true
  try {
    const ds = weekDates.value
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // ★ 经理版要求 ISO 格式 yyyy-MM-dd
    const d = await scheduleList(fmt(ds[0]), fmt(ds[6]))
    const list = d?.list || []
    if (list.length) {
      const g = PERIODS.map(() => Array(7).fill(null))
      list.forEach((s) => {
        const pi = PERIODS.findIndex((p) => p.no === String(s.periodNo || ''))
        const di = (Number(s.weekday) || 1) - 1
        if (pi >= 0 && di >= 0 && di < 7) {
          const room = s.classroomName || '—'
          const tch = s.teacherName || ''
          g[pi][di] = { n: s.courseName, r: tch ? `${room} · ${tch}` : room, c: colorOf(s.courseName) }
        }
      })
      grid.value = g
      offline.value = false
    } else {
      grid.value = emptyGrid()
      offline.value = true
    }
  } catch {
    grid.value = emptyGrid()
    offline.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我的课表" desc="按周查看上课安排">
      <template #actions>
        <el-button size="small" @click="week(-1)"><BaseIcon name="chevron-left" :size="14" />上一周</el-button>
        <el-tag type="info" effect="light" style="margin: 0 4px">{{ weekLabel }}</el-tag>
        <el-button size="small" @click="week(1)">下一周<BaseIcon name="chevron-right" :size="14" /></el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="未取到课表数据（本周课表为空）"
      description="接口 GET /api/v1/schedules 未返回数据。已知原因：后端 ScheduleMapper 的 SQL 目前只按 teacher_id 过滤，学生视角查询结果为 0 条 —— 需后端补齐学生视角后本页才有数据。"
    />

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
              <div v-if="grid[pi] && grid[pi][di]" class="cls" :class="`c${grid[pi][di].c}`">
                <b>{{ grid[pi][di].n }}</b>
                <div class="sub">{{ grid[pi][di].r }}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="!hasAny && !loading" class="empty-hint">本周暂无排课</div>

      <div v-if="hasAny" class="row mt16" style="gap: 14px; flex-wrap: wrap">
        <span v-for="l in legend" :key="l.ci" class="row small muted" style="gap: 6px">
          <span class="legend" :class="`c${l.ci}`" />{{ l.n }}
        </span>
      </div>
    </el-card>
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
</style>
