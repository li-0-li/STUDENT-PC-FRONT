<script setup>
/**
 * 班级学情看板（M-D · 教师 PC 端）
 *
 * 对应原型：ui-prototype/pc/teacher-analytics.html（1:1 还原）
 * 路由：/teacher/analytics（菜单 id = analytics）
 * 数据：GET /api/v1/analytics/class?courseId=（Day 1 新增接口）
 *
 * 还原要点：
 *   1. 顶部标题 + 班级选择 + 导出
 *   2. 四指标卡（「班级平均分」可点击进入班级成绩明细，原型即如此）
 *   3. 两栏：知识点掌握度雷达图 / 成绩趋势折线
 *   4. 两栏：成绩分布柱状 / 预警名单表格
 *
 * 容错：后端不可用时退回原型同款演示数据 + 顶部明确提示。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import RadarChart from '@/components/business/RadarChart.vue'
import LineChart from '@/components/business/LineChart.vue'
import BarChart from '@/components/business/BarChart.vue'
import { classAnalytics } from '@/api/teacher/analytics'

const router = useRouter()

const CLASSES = [
  { value: 13, label: '数据结构 · 计算机 2301' },
  { value: 10, label: '高等数学 A · 软件 2201' }
]
const courseId = ref(13)
const loading = ref(false)
const offline = ref(false)

const stats = ref({ studentCount: null, avgScore: null, passRate: null, submitRate: null, alertCount: 0 })
const radarItems = ref([])
const trend = ref([])
const dist = ref([])
const alerts = ref([])

/** 后端不可用时的演示数据（原型数值） */
function buildDemo() {
  stats.value = { studentCount: 32, avgScore: 82.6, passRate: 93.5, submitRate: 96.8, alertCount: 4 }
  radarItems.value = [
    { name: '线性表', percent: 88 },
    { name: '栈队列', percent: 84 },
    { name: '树', percent: 70 },
    { name: '图', percent: 86 },
    { name: '查找排序', percent: 74 }
  ]
  trend.value = [
    { label: '作业1', value: 80.2 },
    { label: '作业2', value: 81.5 },
    { label: '作业3', value: 80.8 },
    { label: '作业4', value: 84.1 },
    { label: '作业5', value: 83.2 },
    { label: '作业6', value: 86.4 }
  ]
  dist.value = [
    { label: '<60', value: 2 },
    { label: '60-70', value: 6 },
    { label: '70-80', value: 14 },
    { label: '80-90', value: 10 }
  ]
  alerts.value = [
    { studentName: '张同学', type: '连续未提交', score: 52, level: 'high' },
    { studentName: '刘同学', type: '成绩退步', score: 61, level: 'mid' },
    { studentName: '陈同学', type: '低分预警', score: 58, level: 'mid' },
    { studentName: '王同学', type: '参与度低', score: 66, level: 'low' }
  ]
}

async function load() {
  loading.value = true
  offline.value = false
  try {
    const d = await classAnalytics(courseId.value)
    // 没有任何数据（既没成绩也没知识点掌握度）→ 走演示数据
    if (!d || (!d.kpMastery?.length && !d.trend?.length && !d.studentCount)) {
      buildDemo()
      offline.value = true
      return
    }
    stats.value = {
      studentCount: d.studentCount,
      avgScore: d.avgScore,
      passRate: d.passRate,
      submitRate: d.submitRate,
      alertCount: d.alertCount ?? (d.alerts || []).length
    }
    radarItems.value = (d.kpMastery || []).map((k) => ({ name: k.kpName, percent: Number(k.percent) }))
    trend.value = d.trend || []
    dist.value = (d.distribution || []).map((b) => ({ label: b.range, value: b.count }))
    alerts.value = d.alerts || []
  } catch (e) {
    buildDemo()
    offline.value = true
  } finally {
    loading.value = false
  }
}

const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`)

function levelTag(level) {
  return level === 'high' ? 'danger' : level === 'mid' ? 'warning' : 'info'
}
function levelText(level) {
  return level === 'high' ? '高' : level === 'mid' ? '中' : '低'
}

function toScores() {
  router.push({ name: 'teacher_classScores', query: { courseId: courseId.value } })
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="班级学情看板" desc="班级掌握度、成绩趋势与预警名单">
      <template #actions>
        <el-select v-model="courseId" style="width: 220px" @change="load">
          <el-option v-for="c in CLASSES" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
        <el-button><BaseIcon name="download" :size="15" />导出</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      type="warning"
      :closable="false"
      show-icon
      class="mb16"
      title="未取到后端数据，当前显示演示数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 库里已灌 db/seed_md.sql 与作业提交数据"
    />

    <!-- ① 指标卡 -->
    <div class="grid g4">
      <div class="link-card" @click="toScores">
        <StatCard label="班级平均分" :value="fmt(stats.avgScore)" />
        <div class="link-tip">查看成绩明细 <BaseIcon name="chevron-right" :size="13" /></div>
      </div>
      <StatCard label="及格率" :value="fmt(stats.passRate, '%')" />
      <StatCard label="作业提交率" :value="fmt(stats.submitRate, '%')" />
      <StatCard label="预警学生" :value="stats.alertCount ?? 0" tone="warning" />
    </div>

    <!-- ② 雷达 + 趋势 -->
    <div class="grid g2 mt16">
      <el-card shadow="never">
        <div class="card-title">知识点掌握度（班级平均）</div>
        <RadarChart :items="radarItems" :size="270" />
      </el-card>
      <el-card shadow="never">
        <div class="card-title">成绩趋势（近 {{ trend.length }} 次作业）</div>
        <LineChart :points="trend" :height="180" />
      </el-card>
    </div>

    <!-- ③ 分布 + 预警名单 -->
    <div class="grid g2 mt16">
      <el-card shadow="never">
        <div class="card-title">成绩分布</div>
        <BarChart :bars="dist" :height="170" />
      </el-card>
      <el-card shadow="never" class="no-pad">
        <div class="card-pad-b"><div class="card-title no-margin">预警名单</div></div>
        <el-table :data="alerts" style="width: 100%" max-height="260">
          <el-table-column prop="studentName" label="学生" />
          <el-table-column prop="type" label="类型" show-overflow-tooltip />
          <el-table-column prop="score" label="当前分" width="90" />
          <el-table-column label="等级" width="80">
            <template #default="{ row }">
              <el-tag :type="levelTag(row.level)" size="small" effect="light">{{ levelText(row.level) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="right">
            <template #default><el-button link type="primary">关注</el-button></template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
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
.link-card {
  cursor: pointer;
}
.link-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--brand-600);
  display: flex;
  align-items: center;
  gap: 2px;
}
.no-pad :deep(.el-card__body) {
  padding: 0;
}
.card-pad-b {
  padding: 16px 16px 8px;
}
.mb16 {
  margin-bottom: 16px;
}
</style>
