<script setup>
/**
 * 全校学情统计看板（M-D · 管理端）
 *
 * 对应原型：ui-prototype/pc/admin-analytics.html（1:1 还原）
 * 路由：/admin/analytics（菜单 id = analytics）
 *
 * 还原要点：
 *   1. 三维筛选（学期 / 院系 / 课程）+ 右侧当前维度徽标
 *   2. 四指标卡：全校平均分 / 及格率 / 当前上课课堂（实时徽标）/ 预警学生
 *   3. 两栏：课程分类统计表 / 成绩分布柱状（5 段）
 *   4. 备课与实验进度监控：**按院系 / 按课程**切换 + 行可下钻（教师明细），含进度条与状态徽标
 *   5. 两栏：当前上课课堂表（实时）/ 成绩趋势折线（近 8 周）+ 实验完成率环形图
 *   6. 预警名单表
 *
 * 数据来源现状（2026-09-28 如实标注，页面上也有提示）：
 *   · 表 5-10 全校学情统计看板 GET /api/v1/admin/analytics/school
 *       只提供「课程数 / 教师数 / 学生数 / 平均掌握度 / 院系维度」——
 *       而本页原型还要「及格率 / 当前上课课堂 / 成绩分布 / 课程分类统计 / 备课与实验进度」，
 *       **这些在 101 个冻结契约里没有对应接口**（分属 M-B 备课、M-C 实验、M-E 实时课堂）。
 *   · 表 4-18 预警名单 GET /api/v1/alerts —— M-D 提供，可用于「预警名单」区块。
 *   → 因此本页**当前为演示数据为主**，页面顶部有明确提示；等相应模块给出接口后再逐个接真。
 */
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import LineChart from '@/components/business/LineChart.vue'
import BarChart from '@/components/business/BarChart.vue'
import { schoolStatsExtra } from '@/api/admin/ai'

/* ---------------- 三维筛选 ---------------- */
const terms = ['2026-2027 学年 第 1 学期', '2025-2026 学年 第 2 学期', '2025-2026 学年 第 1 学期']
const depts = ['计算机科学与技术学院', '数学与统计学院', '外国语学院', '软件学院']
const courses = ['数据结构', '高等数学 A', '大学英语 III', '程序设计基础', '离散数学', '软件工程', '计算机网络']
const fTerm = ref(terms[0])
const fDept = ref('')
const fCourse = ref('')
const dimBadge = computed(
  () => `${fTerm.value.replace(' 学年', '')} · ${fDept.value || '全部院系'} · ${fCourse.value || '全部课程'}`
)

/* ---------------- 总览 ---------------- */
const overview = [
  { label: '全校平均分', value: '78.4', trend: '▲ 较上月 +2.1' },
  { label: '及格率', value: '91.2%', trend: '▲ +0.8%' },
  { label: '当前上课课堂', value: '12', trend: '进行中', tone: '' },
  { label: '预警学生', value: '37', trend: '▼ -5', tone: '' }
]

/* ---------------- 课程分类统计（接真实接口，演示兜底） ---------------- */
const courseTypes = ref([
  { type: '公共基础课', tag: 'info', n: 42, students: '1,860', avg: 76.8, pass: '90.1%' },
  { type: '专业核心课', tag: 'success', n: 38, students: '1,120', avg: 79.5, pass: '92.4%' },
  { type: '实验实践课', tag: 'warning', n: 26, students: '308', avg: 81.2, pass: '94.0%' },
  { type: '通识选修课', tag: 'info', n: 22, students: '132', avg: 83.6, pass: '96.2%' }
])

const dist = ref([
  { label: '<60', value: 12 },
  { label: '60-70', value: 96 },
  { label: '70-80', value: 214 },
  { label: '80-90', value: 168 },
  { label: '90-100', value: 42 }
])

/** 课程类别编码 → 中文名 / tag */
const TYPE_LABEL = {
  required: { name: '必修课', tag: 'info' },
  core: { name: '专业核心课', tag: 'success' },
  public: { name: '公共基础课', tag: 'warning' },
  elective: { name: '通识选修课', tag: 'info' }
}

async function loadExtra() {
  try {
    const d = await schoolStatsExtra()
    const types = d?.courseTypes || []
    if (types.length) {
      courseTypes.value = types.map((t) => {
        const meta = TYPE_LABEL[t.type] || { name: t.type, tag: 'info' }
        return {
          type: meta.name,
          tag: meta.tag,
          n: t.courseCount ?? 0,
          students: t.studentCount ?? 0,
          avg: t.avgScore ?? '—',
          pass: t.passRate != null ? `${t.passRate}%` : '—'
        }
      })
    }
    const buckets = d?.distribution || []
    if (buckets.length) {
      dist.value = buckets.map((b) => ({ label: b.range, value: b.count ?? 0 }))
    }
  } catch (e) {
    /* 取不到就保留演示值，页面顶部已有提示 */
  }
}

onMounted(loadExtra)

/* ---------------- 备课与实验进度（按院系 / 按课程，可下钻） ---------------- */
/** 明细层：教师 × 课程 */
const PREP_DETAIL = [
  { teacher: '李老师', course: '数据结构', dept: '计算机科学与技术学院', prepW: 12, prepT: 16, expN: 6, expT: 10 },
  { teacher: '刘老师', course: '离散数学', dept: '计算机科学与技术学院', prepW: 3, prepT: 16, expN: 1, expT: 8 },
  { teacher: '王老师', course: '程序设计基础', dept: '计算机科学与技术学院', prepW: 6, prepT: 16, expN: 2, expT: 8 },
  { teacher: '张老师', course: '高等数学 A', dept: '数学与统计学院', prepW: 14, prepT: 16, expN: 4, expT: 8 },
  { teacher: '刘老师', course: '离散数学', dept: '数学与统计学院', prepW: 8, prepT: 16, expN: 3, expT: 8 },
  { teacher: '陈老师', course: '大学英语 III', dept: '外国语学院', prepW: 11, prepT: 16, expN: 6, expT: 8 },
  { teacher: '周老师', course: '软件工程', dept: '软件学院', prepW: 9, prepT: 16, expN: 5, expT: 10 },
  { teacher: '孙老师', course: '计算机网络', dept: '软件学院', prepW: 5, prepT: 16, expN: 2, expT: 8 }
]
const PREP_DIM = ref('dept')

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0
}
function statusOf(p) {
  return p >= 80
    ? { text: '正常', tag: 'success' }
    : p >= 50
      ? { text: '偏慢', tag: 'warning' }
      : { text: '滞后', tag: 'danger' }
}

/** 按维度聚合（与原型 aggregate() 等价） */
const prepRows = computed(() => {
  const dim = PREP_DIM.value
  const map = {}
  PREP_DETAIL.forEach((d) => {
    const k = dim === 'dept' ? d.dept : d.course
    if (!map[k]) {
      map[k] = { key: k, dept: dim === 'dept' ? k : d.dept, courses: {}, teachers: {}, prepW: 0, prepT: 0, expN: 0, expT: 0, children: [] }
    }
    const g = map[k]
    g.courses[d.course] = 1
    g.teachers[d.teacher] = 1
    g.prepW += d.prepW
    g.prepT += d.prepT
    g.expN += d.expN
    g.expT += d.expT
    g.children.push(d)
  })
  return Object.keys(map)
    .map((k) => {
      const g = map[k]
      const pp = pct(g.prepW, g.prepT)
      const ep = pct(g.expN, g.expT)
      return {
        ...g,
        courseCount: Object.keys(g.courses).length,
        teacherCount: Object.keys(g.teachers).length,
        prepPct: pp,
        expPct: ep,
        lagging: pp < 50 ? Object.keys(g.courses).length : 0,
        status: statusOf(pp)
      }
    })
    .filter((g) => {
      if (fDept.value && PREP_DIM.value === 'dept' && g.key !== fDept.value) return false
      if (fCourse.value && PREP_DIM.value === 'course' && g.key !== fCourse.value) return false
      return true
    })
})

/* ---------------- 当前上课课堂 ---------------- */
const liveClasses = [
  { course: '数据结构', teacher: '李老师', room: '明德楼 302', period: '3-4 节', online: '28/32' },
  { course: '高等数学 A', teacher: '张老师', room: '博雅楼 201', period: '3-4 节', online: '45/48' },
  { course: '大学英语 III', teacher: '陈老师', room: '语音室 4', period: '3-4 节', online: '30/32' },
  { course: '操作系统', teacher: '赵老师', room: '笃行楼 105', period: '3-4 节', online: '36/38' }
]

/** 成绩趋势（近 8 周） */
const trend = Array.from({ length: 8 }, (_, i) => ({ label: `W${i + 1}`, value: [74, 76, 75.5, 78, 77.6, 80.5, 82, 84][i] }))

/** 实验完成率 86.5% → 环形图 dashoffset（周长 2πr = 314） */
const EXP_RATE = 86.5
const CIRC = 2 * Math.PI * 50
const dashOffset = (CIRC * (1 - EXP_RATE / 100)).toFixed(1)

/* ---------------- 预警名单 ---------------- */
const alerts = [
  { name: '张同学', course: '高等数学 A', dept: '数学与统计学院', type: '连续未提交', score: 52, level: '高', tag: 'danger' },
  { name: '刘同学', course: '数据结构', dept: '计算机学院', type: '成绩退步', score: 61, level: '中', tag: 'warning' },
  { name: '陈同学', course: '大学英语 III', dept: '外国语学院', type: '低分预警', score: 58, level: '中', tag: 'warning' }
]
</script>

<template>
  <div>
    <PageHeader title="全校学情统计看板" desc="按学期 / 院系 / 课程三维统计">
      <template #actions>
        <el-button><BaseIcon name="download" :size="15" />导出报表</el-button>
      </template>
    </PageHeader>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb16"
      title="本页以演示数据为主（如实标注）"
      description="101 个冻结契约里没有「及格率 / 当前上课课堂 / 成绩分布 / 课程分类统计 / 备课与实验进度」这些接口（分属 M-B 备课、M-C 实验、M-E 实时课堂）。本页目前只有「预警名单」可接真实接口（表 4-18），其余等相应模块给出接口后再逐个接真。"
    />

    <!-- ① 三维筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filters">
        <span class="small muted">统计维度</span>
        <el-select v-model="fTerm" style="width: 200px">
          <el-option v-for="t in terms" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select v-model="fDept" placeholder="全部院系" clearable style="width: 190px">
          <el-option v-for="d in depts" :key="d" :label="d" :value="d" />
        </el-select>
        <el-select v-model="fCourse" placeholder="全部课程" clearable style="width: 170px">
          <el-option v-for="c in courses" :key="c" :label="c" :value="c" />
        </el-select>
        <el-tag type="info" effect="light" class="ml-auto">{{ dimBadge }}</el-tag>
      </div>
    </el-card>

    <!-- ② 总览 -->
    <div class="grid g4 mt16">
      <StatCard v-for="o in overview" :key="o.label" :label="o.label" :value="o.value" :trend="o.trend" :tone="o.tone" />
    </div>

    <!-- ③ 课程分类 + 成绩分布 -->
    <div class="grid g2 mt16">
      <el-card shadow="never" class="no-pad">
        <div class="card-pad-b"><div class="card-title no-margin">课程分类统计（按课程类别）</div></div>
        <el-table :data="courseTypes" style="width: 100%">
          <el-table-column label="课程类别">
            <template #default="{ row }">
              <el-tag :type="row.tag" size="small" effect="light">{{ row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="n" label="课程数" width="80" />
          <el-table-column prop="students" label="选课人数" width="90" />
          <el-table-column prop="avg" label="平均分" width="80" />
          <el-table-column prop="pass" label="及格率" width="80" />
        </el-table>
      </el-card>
      <el-card shadow="never">
        <div class="card-title">成绩分布（当前筛选维度）</div>
        <BarChart :bars="dist" :height="190" />
      </el-card>
    </div>

    <!-- ④ 备课与实验进度监控（可切换维度 + 下钻） -->
    <el-card shadow="never" class="mt16 no-pad">
      <div class="card-pad-b between">
        <div class="card-title no-margin">
          备课与实验进度监控（{{ PREP_DIM === 'dept' ? '按院系' : '按课程' }}）
        </div>
        <div class="row">
          <el-radio-group v-model="PREP_DIM" size="small">
            <el-radio-button value="dept">按院系</el-radio-button>
            <el-radio-button value="course">按课程</el-radio-button>
          </el-radio-group>
          <span class="small muted">展开行可查看教师明细</span>
        </div>
      </div>
      <el-table :data="prepRows" style="width: 100%">
        <el-table-column type="expand">
          <template #default="{ row }">
            <el-table :data="row.children" size="small" class="inner">
              <el-table-column prop="teacher" label="教师" width="120" />
              <el-table-column prop="course" label="课程" />
              <el-table-column label="备课进度" width="190">
                <template #default="{ row: c }">
                  <div class="row">
                    <el-progress
                      :percentage="pct(c.prepW, c.prepT)"
                      :stroke-width="6"
                      :show-text="false"
                      class="w110"
                    />
                    <span class="small">{{ c.prepW }}/{{ c.prepT }} 周</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="实验进度" width="190">
                <template #default="{ row: c }">
                  <div class="row">
                    <el-progress
                      :percentage="pct(c.expN, c.expT)"
                      :stroke-width="6"
                      :show-text="false"
                      class="w110"
                    />
                    <span class="small">{{ c.expN }}/{{ c.expT }} 次</span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </el-table-column>

        <el-table-column v-if="PREP_DIM === 'dept'" prop="key" label="院系" />
        <el-table-column v-else prop="key" label="课程" />
        <el-table-column v-if="PREP_DIM === 'course'" prop="dept" label="院系" />
        <el-table-column v-if="PREP_DIM === 'dept'" prop="courseCount" label="课程数" width="80" />
        <el-table-column v-if="PREP_DIM === 'dept'" prop="teacherCount" label="教师数" width="80" />
        <el-table-column label="备课进度" width="190">
          <template #default="{ row }">
            <div class="row">
              <el-progress :percentage="row.prepPct" :stroke-width="6" :show-text="false" class="w110" />
              <span class="small">{{ row.prepW }}/{{ row.prepT }} 周</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="实验进度" width="190">
          <template #default="{ row }">
            <div class="row">
              <el-progress :percentage="row.expPct" :stroke-width="6" :show-text="false" class="w110" />
              <span class="small">{{ row.expN }}/{{ row.expT }} 次</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="PREP_DIM === 'dept'" prop="lagging" label="滞后课程" width="90" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status.tag" size="small" effect="light">{{ row.status.text }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="between pad-f">
        <span class="small muted">共 {{ prepRows.length }} 行</span>
        <span class="small muted">进度数据实时汇总自各教师备课记录与实验任务</span>
      </div>
    </el-card>

    <!-- ⑤ 当前上课课堂 + 成绩趋势 + 实验完成率 -->
    <div class="two-col-21 mt16">
      <el-card shadow="never" class="no-pad">
        <div class="card-pad-b between">
          <div class="card-title no-margin">当前上课课堂（实时 · {{ liveClasses.length }} 个）</div>
          <el-tag type="success" size="small" effect="light">
            <BaseIcon name="radio" :size="12" /> 直播中
          </el-tag>
        </div>
        <el-table :data="liveClasses" style="width: 100%">
          <el-table-column prop="course" label="课程" />
          <el-table-column prop="teacher" label="教师" width="90" />
          <el-table-column prop="room" label="教室" width="110" />
          <el-table-column prop="period" label="节次" width="90" />
          <el-table-column prop="online" label="在线学生" width="100" />
        </el-table>
      </el-card>

      <el-card shadow="never">
        <div class="card-title">成绩趋势（近 8 周）</div>
        <LineChart :points="trend" :height="200" />
        <el-divider />
        <div class="card-title">实验完成率</div>
        <div class="center">
          <svg viewBox="0 0 120 120" style="width: 120px">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg-soft)" stroke-width="12" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="var(--brand-600)"
              stroke-width="12"
              stroke-linecap="round"
              :stroke-dasharray="CIRC.toFixed(1)"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="66" text-anchor="middle" font-size="20" font-weight="800" fill="var(--ink-900)">
              {{ EXP_RATE }}%
            </text>
          </svg>
        </div>
      </el-card>
    </div>

    <!-- ⑥ 预警名单 -->
    <el-card shadow="never" class="mt16 no-pad">
      <div class="card-pad-b"><div class="card-title no-margin">预警名单（低分 / 退步 / 未提交）</div></div>
      <el-table :data="alerts" style="width: 100%">
        <el-table-column prop="name" label="学生" width="100" />
        <el-table-column prop="course" label="课程" />
        <el-table-column prop="dept" label="院系" />
        <el-table-column prop="type" label="类型" width="120" />
        <el-table-column prop="score" label="当前分" width="90" />
        <el-table-column label="等级" width="80">
          <template #default="{ row }">
            <el-tag :type="row.tag" size="small" effect="light">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.filter-card :deep(.el-card__body) {
  padding: 14px 18px;
}
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.ml-auto {
  margin-left: auto;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 10px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.mt16 {
  margin-top: 16px;
}
.grid {
  display: grid;
  gap: 18px;
}
.g2 {
  grid-template-columns: 1fr 1fr;
}
.g4 {
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 1200px) {
  .g2,
  .g4 {
    grid-template-columns: 1fr 1fr;
  }
  .two-col-21 {
    grid-template-columns: 1fr;
  }
}
.two-col-21 {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  margin-top: 16px;
}
.no-pad :deep(.el-card__body) {
  padding: 0;
}
.card-pad-b {
  padding: 16px 16px 8px;
}
.pad-f {
  padding: 12px 16px;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.w110 {
  width: 110px;
  flex: none;
}
.inner {
  background: var(--bg-subtle);
}
.mb16 {
  margin-bottom: 16px;
}
</style>
