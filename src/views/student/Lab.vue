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
 * ⚠️ 两处后端尚未实现，页面**如实提示、不假装成功**：
 *   · 表 3-17 提交实验报告 `POST /api/v1/experiments/{taskId}/submissions` —— 后端无此路由
 *   · 表 3-18 实验报告详情 `GET /api/v1/experiment-submissions/{id}` —— 实测返回 500
 *   因此「上传报告」按钮点了只做提示，「查看评语」列不渲染。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import { experimentList } from '@/api/student/lab'

const labs = ref([])
const loading = ref(false)
const courseSel = ref('')

/** 课程下拉：由真实数据去重得到（不再写死课程名） */
const COURSES = computed(() => [...new Set(labs.value.map((r) => r.course).filter(Boolean))])

const rows = computed(() => (courseSel.value ? labs.value.filter((r) => r.course === courseSel.value) : labs.value))
const todoCount = computed(() => rows.value.filter((r) => r.status === '待提交' || r.status === '未开始').length)
const subCount = computed(() => rows.value.filter((r) => r.status === '待批阅').length)
const doneCount = computed(() => rows.value.filter((r) => r.status === '已批阅').length)

const tagType = (s) => ({ 待提交: 'warning', 待批阅: 'info', 已批阅: 'success', 未开始: 'info' })[s] || 'info'

/** 后端 deadline（ISO 'yyyy-MM-ddTHH:mm:ss'）→ 原型同款 'MM-DD HH:mm' */
function fmtDue(t) {
  if (!t) return '—'
  const s = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s)
    : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 后端实验任务 → 页面行（状态由 sub_status 推导，不再写死） */
function mapLab(e) {
  let status = '待提交'
  if (e.sub_id != null) status = e.sub_status === 'GRADED' ? '已批阅' : '待批阅'
  else if (e.status && e.status !== 'published') status = '未开始'
  return {
    taskId: e.task_id,
    subId: e.sub_id ?? null,
    name: e.title,
    course: e.course_name,
    due: fmtDue(e.deadline),
    status,
    score: e.sub_score != null ? String(e.sub_score) : null,
    // 评语来自表 3-18，该接口当前 500 → 不展示，也不编造
    note: '',
    guide: e.guide || '',
    dupRate: e.duplicate_rate ?? null
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

function upload(row) {
  // 表 3-17 后端未实现 —— 如实告知，不做假的成功提示
  ElMessage.warning(`「${row.name}」的上传接口（表 3-17）后端尚未实现，暂不能提交`)
}
function showNote(row) {
  ElMessage.info(row.note)
}
function viewGuide(row) {
  ElMessage.info('指导书：' + (row.guide || '—') + '（文件下载接口未接入）')
}

onMounted(load)
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

    <div class="grid g4">
      <StatCard label="应交实验" :value="rows.length" />
      <StatCard label="待提交" :value="todoCount" tone="warning" />
      <StatCard label="已提交待批阅" :value="subCount" />
      <StatCard label="已批阅" :value="doneCount" tone="success" />
    </div>

    <el-card shadow="never" class="mt16">
      <div class="between">
        <div class="card-title no-margin">实验列表</div>
        <span class="small muted">按截止时间排序 · 逾期按每天 5 分扣减</span>
      </div>
      <el-table v-loading="loading" :data="rows" class="mt12">
        <el-table-column prop="name" label="实验名称" min-width="260">
          <template #default="{ row }"><b>{{ row.name }}</b></template>
        </el-table-column>
        <el-table-column prop="course" label="课程" width="110">
          <template #default="{ row }"><span class="small muted">{{ row.course }}</span></template>
        </el-table-column>
        <el-table-column prop="due" label="截止时间" width="130">
          <template #default="{ row }"><span class="small muted">{{ row.due }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag :type="tagType(row.status)" effect="light">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="成绩" width="90">
          <template #default="{ row }">
            <b v-if="row.score" class="score">{{ row.score }}</b>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="200">
          <template #default="{ row }">
            <span class="links">
              <el-link v-if="row.guide" type="primary" :underline="false" @click="viewGuide(row)">查看指导书</el-link>
              <el-link v-if="row.status === '待提交'" type="primary" :underline="false" @click="upload(row)">上传报告</el-link>
              <span v-if="row.status === '待批阅'" class="muted small">已提交</span>
              <el-link v-if="row.note" type="primary" :underline="false" @click="showNote(row)">查看评语</el-link>
              <span v-if="!row.guide && !row.note && row.status === '未开始'" class="muted">—</span>
            </span>
          </template>
        </el-table-column>
        <template #empty>{{ courseSel ? '该课程暂无实验' : '暂无实验任务（接口未返回数据）' }}</template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
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
</style>
