<script setup>
/**
 * 学情热力图（M-D · 教师 PC 端）
 *
 * 对应原型：ui-prototype/pc/teacher-heatmap.html（1:1 还原）
 * 路由：/teacher/heatmap（菜单 id = heatmap，见 layout/menus.js）
 * 数据：GET /api/v1/analytics/heatmap?courseId=（Day 1 新增接口）
 *
 * 还原要点：
 *   1. 顶部标题 + 课程选择 + 导出
 *   2. 主卡：学生 × 知识点 掌握度热力表（5 级配色 + 图例 + 点击查看明细）
 *   3. 两栏：薄弱知识点 TOP5（进度条）/ 需要关注的学生（图标 + 薄弱点个数 + 建议）
 *
 * 容错：后端不可用（没开隧道/没起服务/库里没数据）时**退回原型同款演示数据**，
 *      并在页面顶部明确提示「当前显示演示数据」——不白屏，也不假装数据是真的。
 */
import { onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { classHeatmap } from '@/api/teacher/analytics'

/* ---------------- 5 级配色（与原型 color() 一致） ---------------- */
function cellColor(v) {
  if (v == null) return '#e5e7eb'
  if (v < 40) return '#f87171'
  if (v < 55) return '#fdba74'
  if (v < 70) return '#fde68a'
  if (v < 85) return '#5eead4'
  return '#0d9488'
}
const LEGEND = ['#fca5a5', '#fdba74', '#fde68a', '#5eead4', '#0d9488']

const CLASSES = [
  { value: 13, label: '数据结构 · 计算机 2301' },
  { value: 10, label: '高等数学 A · 软件 2201' }
]
const courseId = ref(13)
const loading = ref(false)
const offline = ref(false)

const kps = ref([])
const students = ref([])
/** matrix[i][j] = { kp, student, v, color } */
const matrix = ref([])
const weakKps = ref([])
const watchList = ref([])

/* ---------------- 演示数据兜底（原型同款确定性算法） ---------------- */
const DEMO_KPS = ['栈与队列', '链表', '二叉树遍历', '平衡树旋转', '哈希表', '图的遍历', '最短路径', '排序算法']
const DEMO_STUDENTS = ['陈同学', '张同学', '黎练', '王同学', '刘同学', '赵同学', '孙同学', '周同学']
const demoMastery = (si, ki) => 25 + ((si * 37 + ki * 53 + 29) % 100) % 75

function buildDemo() {
  kps.value = [...DEMO_KPS]
  students.value = [...DEMO_STUDENTS]
  matrix.value = DEMO_STUDENTS.map((s, si) =>
    DEMO_KPS.map((k, ki) => {
      const v = demoMastery(si, ki)
      return { kp: k, student: s, v, color: cellColor(v) }
    })
  )
  weakKps.value = DEMO_KPS.map((k, ki) => ({
    name: k,
    percent: Math.round(DEMO_STUDENTS.reduce((acc, _, si) => acc + demoMastery(si, ki), 0) / DEMO_STUDENTS.length)
  }))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 5)
  watchList.value = DEMO_STUDENTS.map((s, si) => ({
    studentName: s,
    weakCount: DEMO_KPS.filter((_, ki) => demoMastery(si, ki) < 60).length
  }))
    .filter((x) => x.weakCount > 0)
    .sort((a, b) => b.weakCount - a.weakCount)
    .slice(0, 3)
    .map((x) => ({
      ...x,
      level: x.weakCount >= 4 ? 'error' : 'warning',
      advice: x.weakCount >= 4 ? '约谈 + 推送基础巩固练习' : x.weakCount >= 3 ? '推送针对性作业' : '课堂多提问关注'
    }))
}

/* ---------------- 加载真实数据 ---------------- */
async function load() {
  loading.value = true
  offline.value = false
  try {
    const d = await classHeatmap(courseId.value)
    const kpList = d?.kps || []
    const stuList = d?.students || []
    if (!kpList.length || !stuList.length) {
      buildDemo()
      offline.value = true
      return
    }
    kps.value = kpList
    students.value = stuList
    matrix.value = (d.matrix || []).map((line, i) =>
      (line || []).map((v, j) => ({ kp: kpList[j], student: stuList[i], v, color: cellColor(v) }))
    )
    weakKps.value = d.weakKps || []
    watchList.value = d.watchList || []
  } catch (e) {
    buildDemo()
    offline.value = true
  } finally {
    loading.value = false
  }
}

function openCell(cell) {
  if (cell.v == null) {
    ElMessageBox.alert('该生在此知识点上还没有作答记录。', `${cell.student} · ${cell.kp}`, {
      confirmButtonText: '知道了',
      type: 'info'
    })
    return
  }
  ElMessageBox.alert(
    `掌握度 ${cell.v}%（历史正确率口径）`,
    `${cell.student} · ${cell.kp}`,
    { confirmButtonText: '知道了', type: cell.v < 60 ? 'warning' : 'info' }
  )
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="知识点掌握热力图" desc="颜色越红掌握越弱，建议优先安排复习与针对性作业">
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
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 库里已灌 db/seed_md.sql"
    />

    <el-card shadow="never">
      <div class="between">
        <div class="card-title no-margin">学生 × 知识点 掌握度（%）</div>
        <div class="legend">
          <span>低</span>
          <i v-for="(c, i) in LEGEND" :key="i" :style="{ background: c }" />
          <span>高</span>
        </div>
      </div>
      <div class="hm-wrap mt16">
        <table class="hm">
          <thead>
            <tr>
              <th class="rowh">学生 \ 知识点</th>
              <th v-for="k in kps" :key="k">{{ k }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in matrix" :key="i">
              <th class="rowh">{{ students[i] }}</th>
              <td
                v-for="(c, j) in row"
                :key="j"
                :style="{ background: c.color }"
                :title="`${c.student} · ${c.kp}：${c.v == null ? '无数据' : c.v + '%'}`"
                @click="openCell(c)"
              >
                {{ c.v == null ? '—' : c.v }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="small muted mt16">点击单元格可查看该生该知识点的作答明细。</div>
    </el-card>

    <div class="grid g2 mt16">
      <el-card shadow="never">
        <div class="card-title">薄弱知识点 TOP 5（班级平均掌握度最低）</div>
        <div v-for="w in weakKps" :key="w.name" class="weak">
          <div class="between small">
            <b>{{ w.name }}</b>
            <span :class="w.percent < 50 ? 'danger' : w.percent < 60 ? 'warn' : 'muted'">{{ w.percent }}%</span>
          </div>
          <div class="bar mt8">
            <i
              :style="{
                width: Math.max(0, Math.min(100, w.percent)) + '%',
                background: w.percent < 50 ? 'var(--error)' : w.percent < 60 ? 'var(--warning)' : 'var(--brand-600)'
              }"
            />
          </div>
        </div>
        <el-empty v-if="!weakKps.length" description="暂无掌握度数据" :image-size="60" />
      </el-card>

      <el-card shadow="never">
        <div class="card-title">需要关注的学生（多知识点薄弱）</div>
        <div v-for="s in watchList" :key="s.studentName" class="watch">
          <span class="mi-ic" :class="s.level">
            <BaseIcon :name="s.level === 'error' ? 'alert-triangle' : 'alert-circle'" :size="16" />
          </span>
          <div class="flex1">
            <div class="between">
              <b class="small">{{ s.studentName }}</b>
              <el-tag :type="s.level === 'error' ? 'danger' : 'warning'" size="small" effect="light">
                {{ s.weakCount }} 个薄弱点
              </el-tag>
            </div>
            <div class="small muted mt8">建议：{{ s.advice }}</div>
          </div>
        </div>
        <el-empty v-if="!watchList.length" description="暂无需关注的学生" :image-size="60" />
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
.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-500);
}
.legend i {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: inline-block;
}
.hm-wrap {
  overflow-x: auto;
}
.hm {
  border-collapse: separate;
  border-spacing: 3px;
}
.hm th {
  font-size: 11.5px;
  color: var(--ink-500);
  font-weight: 600;
  padding: 6px 8px;
  white-space: nowrap;
}
.hm th.rowh {
  text-align: left;
  min-width: 110px;
}
.hm td {
  width: 34px;
  height: 30px;
  border-radius: 6px;
  text-align: center;
  font-size: 10.5px;
  color: #fff;
  cursor: pointer;
}
.hm td:hover {
  outline: 2px solid var(--brand-700);
  outline-offset: -2px;
}
.weak + .weak {
  margin-top: 14px;
}
.bar {
  height: 7px;
  border-radius: 99px;
  background: var(--bg-soft);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
}
.watch {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.watch + .watch {
  margin-top: 14px;
}
.mi-ic {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mi-ic.error {
  background: #fef2f2;
  color: var(--error);
}
.mi-ic.warning {
  background: #fffbeb;
  color: var(--warning);
}
.flex1 {
  flex: 1;
}
.danger {
  color: var(--error);
}
.warn {
  color: var(--warning);
}
.mb16 {
  margin-bottom: 16px;
}
</style>
