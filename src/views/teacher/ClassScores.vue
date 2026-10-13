<script setup>
/**
 * 班级成绩明细（M-D · 教师 PC 端）
 *
 * 对应原型：ui-prototype/pc/teacher-class-scores.html（1:1 还原）
 * 路由：/teacher/class-scores（不在菜单内，由「班级学情」页点击统计卡进入）
 * 数据：GET /api/v1/analytics/class/scores?courseId=（Day 1 新增接口）
 *
 * 还原要点：
 *   1. 标题带返回箭头（回班级学情）+ 导出成绩单
 *   2. 四指标卡：班级平均分 / 最高分 / 最低分 / 标准差
 *   3. 两栏：分数段分布柱状（柱顶人数）/ 学生成绩明细表（可滚动）
 *   4. 各次作业班级均分对比柱状（带柱顶数值）
 *
 * 容错：后端不可用时退回原型同款演示数据 + 顶部明确提示。
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BarChart from '@/components/business/BarChart.vue'
import { classScores } from '@/api/teacher/analytics'

const router = useRouter()
const route = useRoute()

const courseId = ref(Number(route.query.courseId) || 13)
const loading = ref(false)
const offline = ref(false)

const stats = ref({ studentCount: 0, avgScore: null, maxScore: null, minScore: null, stdDev: null })
const dist = ref([])
const avgByHw = ref([])
const rows = ref([])

/** 后端不可用时的演示数据（原型数值） */
function buildDemo() {
  stats.value = { studentCount: 32, avgScore: 82.6, maxScore: 96, minScore: 52, stdDev: 9.4 }
  dist.value = [
    { label: '<60', value: 2 },
    { label: '60-70', value: 6 },
    { label: '70-80', value: 14 },
    { label: '80-90', value: 10 }
  ]
  avgByHw.value = [
    { label: '作业1', value: 80.2 },
    { label: '作业2', value: 78.9 },
    { label: '作业3', value: 82.6 },
    { label: '作业4', value: 81.4 },
    { label: '作业5', value: 85.1 }
  ]
  const demo = [
    [1, '赵同学', 95, 92, 96, 98, 95.3, 'up'],
    [2, '张同学', 90, 88, 92, 95, 91.3, 'up'],
    [3, '吴同学', 88, 90, 86, 92, 89.0, 'flat'],
    [4, '刘同学', 82, 85, 85, 88, 85.0, 'up'],
    [5, '郑同学', 80, 78, 84, 85, 81.8, 'flat'],
    [6, '陈同学', 76, 80, 78, 82, 79.0, 'down'],
    [7, '王同学', 70, 66, null, 72, 69.3, 'down'],
    [8, '周同学', 62, 58, 63, 68, 62.8, 'down'],
    [9, '孙同学', 55, 52, 50, 60, 54.3, 'down']
  ]
  rows.value = demo.map((d) => ({
    rank: d[0],
    studentName: d[1],
    scores: [
      { assignmentId: 1, title: '作业1', score: d[2] },
      { assignmentId: 2, title: '作业2', score: d[3] },
      { assignmentId: 3, title: '作业3', score: d[4] }
    ],
    avgScore: d[6],
    trend: d[7]
  }))
}

async function load() {
  loading.value = true
  offline.value = false
  try {
    const d = await classScores(courseId.value)
    if (!d || !(d.students || []).length) {
      buildDemo()
      offline.value = true
      return
    }
    stats.value = {
      studentCount: d.studentCount,
      avgScore: d.avgScore,
      maxScore: d.maxScore,
      minScore: d.minScore,
      stdDev: d.stdDev
    }
    dist.value = (d.distribution || []).map((b) => ({ label: b.range, value: b.count }))
    avgByHw.value = d.homeworkAvg || []
    rows.value = d.students || []
  } catch (e) {
    buildDemo()
    offline.value = true
  } finally {
    loading.value = false
  }
}

const fmt = (v) => (v == null ? '—' : Number(v).toFixed(1))
function totalTone(v) {
  if (v == null) return ''
  if (v >= 90) return 'success'
  if (v < 60) return 'error'
  if (v < 70) return 'warning'
  return ''
}
const trendTag = (t) => (t === 'up' ? 'success' : t === 'down' ? 'warning' : 'info')
const trendIcon = (t) => (t === 'up' ? '↑' : t === 'down' ? '↓' : '→')

function back() {
  router.push({ name: 'teacher_analytics' })
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="班级成绩明细 · 数据结构 · 计算机 2301">
      <template #actions>
        <el-button @click="back"><BaseIcon name="arrow-left" :size="15" />返回班级学情</el-button>
        <el-button><BaseIcon name="download" :size="15" />导出成绩单</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      type="warning"
      :closable="false"
      show-icon
      class="mb16"
      title="未取到后端数据，当前显示演示数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 库里已有该课程的作业提交数据"
    />

    <!-- ① 指标卡 -->
    <div class="grid g4">
      <StatCard label="班级平均分" :value="fmt(stats.avgScore)" />
      <StatCard label="最高分" :value="fmt(stats.maxScore)" tone="success" />
      <StatCard label="最低分" :value="fmt(stats.minScore)" tone="error" />
      <StatCard label="标准差" :value="fmt(stats.stdDev)" />
    </div>

    <!-- ② 分布 + 明细 -->
    <div class="two-col mt16">
      <el-card shadow="never">
        <div class="card-title">分数段分布</div>
        <BarChart :bars="dist" show-values :height="190" />
        <div class="small muted center">单位：人（按学生总评统计，共 {{ stats.studentCount || 0 }} 人）</div>
      </el-card>

      <el-card shadow="never" class="no-pad">
        <div class="card-pad-b">
          <div class="card-title no-margin">学生成绩明细（{{ stats.studentCount || 0 }}）</div>
        </div>
        <div class="scroll">
          <el-table :data="rows" style="width: 100%">
            <el-table-column prop="rank" label="排名" width="60" />
            <el-table-column prop="studentName" label="学生" width="96" />
            <el-table-column
              v-for="(col, i) in rows[0]?.scores || []"
              :key="i"
              :label="col.title || `作业${i + 1}`"
              width="82"
            >
              <template #default="{ row }">
                {{ row.scores?.[i]?.score ?? '—' }}
              </template>
            </el-table-column>
            <el-table-column label="当前总评" width="96">
              <template #default="{ row }">
                <b :class="`t-${totalTone(row.avgScore)}`">{{ fmt(row.avgScore) }}</b>
              </template>
            </el-table-column>
            <el-table-column label="趋势" width="76">
              <template #default="{ row }">
                <el-tag :type="trendTag(row.trend)" size="small" effect="light">
                  {{ trendIcon(row.trend) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="small muted center pad-b">未提交的作业显示为「—」</div>
      </el-card>
    </div>

    <!-- ③ 各次作业均分对比 -->
    <el-card shadow="never" class="mt16">
      <div class="card-title">各次作业班级均分对比</div>
      <BarChart :bars="avgByHw" show-values :height="190" />
    </el-card>
  </div>
</template>

<style scoped>
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 14px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 18px;
}
@media (max-width: 1200px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
.no-pad :deep(.el-card__body) {
  padding: 0;
}
.card-pad-b {
  padding: 16px 16px 8px;
}
.scroll {
  max-height: 420px;
  overflow-y: auto;
}
.pad-b {
  padding: 10px 0 14px;
}
.t-success {
  color: var(--success);
}
.t-warning {
  color: var(--warning);
}
.t-error {
  color: var(--error);
}
.mb16 {
  margin-bottom: 16px;
}
</style>
