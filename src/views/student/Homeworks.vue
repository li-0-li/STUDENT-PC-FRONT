<script setup>
/**
 * 我的作业（分支 stu-pc-homework）
 * 关联接口（接口设计文档表号）：表 3-5 作业列表查询 GET /api/v1/assignments
 * 对应原型：ui-prototype/pc/student-homeworks.html —— ★ 1:1 还原
 *   （四张汇总卡 + 课程页签 + 作业卡片列表：标题/课程/剩余时间/状态徽标/截止/操作）
 *   与小程序端 mp/app-homework.html 种子数据保持一致（端间镜像）
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { homeworkList } from '@/api/student/homework'

const router = useRouter()

/** 原型种子数据（HOMEWORKS） */
const DEMO = [
  { id: 'hw1', title: '习题 2-1 导数定义', course: 'math', courseName: '高等数学 A', status: 'warning', statusText: '待提交', meta: '截止 09-05 23:59 · 张老师', extra: '剩余 1 天 8 小时', extraTone: 'warning', deadline: '2026-09-05 23:59' },
  { id: 'hw2', title: '习题 1-5 极限计算', course: 'math', courseName: '高等数学 A', status: 'success', statusText: '已批改 92', meta: '李老师', extra: 'AI 初判 92 · 教师复核 92 · 评语：思路清晰，注意边界条件', deadline: '2026-08-28 23:59' },
  { id: 'hw3', title: '栈与队列 编程题', course: 'ds', courseName: '数据结构', status: 'success', statusText: '已批改 92', meta: '李老师', extra: 'AI 初判 92 · 教师复核 92 · 评语：代码规范，复杂度分析可深入', deadline: '2026-08-30 23:59' },
  { id: 'hw4', title: 'Unit 3 阅读理解', course: 'eng', courseName: '大学英语 III', status: 'success', statusText: '已批改 88', meta: '王老师', extra: '客观题自动判分 · 已完成', deadline: '2026-08-25 23:59' },
  { id: 'hw5', title: '线性表 章节测验', course: 'ds', courseName: '数据结构', status: 'error', statusText: '申诉处理中', meta: '李老师', extra: '申诉提交于 09-05 · 预计 2 个工作日内反馈', deadline: '2026-09-04 23:59' }
]
const COURSE_TABS = [
  { k: 'all', l: '全部' },
  { k: 'math', l: '高等数学 A' },
  { k: 'ds', l: '数据结构' },
  { k: 'eng', l: '大学英语 III' }
]

const list = ref([])
const curCourse = ref('all')
const offline = ref(false)
const loading = ref(false)

const rows = computed(() => (curCourse.value === 'all' ? list.value : list.value.filter((h) => h.course === curCourse.value)))
const pending = computed(() => rows.value.filter((h) => h.status === 'warning').length)
const graded = computed(() => rows.value.filter((h) => h.status === 'success').length)
const appealing = computed(() => rows.value.filter((h) => h.status === 'error').length)

const badgeType = (s) => ({ warning: 'warning', success: 'success', error: 'danger', info: 'info' })[s] || 'info'

async function load() {
  loading.value = true
  try {
    const d = await homeworkList()
    const data = d?.list || []
    if (data.length) {
      list.value = data.map((h) => ({
        id: h.assignmentId,
        title: h.title,
        course: 'all',
        courseName: h.courseName || '',
        status: h.status === 'pending' || h.status === '进行中' ? 'warning' : h.status === 'appealing' ? 'error' : 'success',
        statusText: h.statusText || (h.status === 'pending' ? '待提交' : h.score ? '已批改 ' + h.score : '已提交'),
        meta: h.deadline ? '截止 ' + h.deadline : h.teacherName || '',
        extra: h.extra || '',
        deadline: h.deadline
      }))
      offline.value = false
    } else {
      list.value = []
      offline.value = true
    }
  } catch {
    list.value = DEMO
    offline.value = true
  } finally {
    loading.value = false
  }
}

function go(h) {
  if (h.status === 'warning') {
    router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: h.id } })
  } else {
    router.push({ name: 'StuSubmission', params: { submissionId: h.id } })
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我的作业" desc="待提交 / 已批改 / 申诉，按状态与课程筛选">
      <template #actions>
        <el-button><BaseIcon name="filter" :size="15" />筛选</el-button>
        <el-button><BaseIcon name="history" :size="15" />历史记录</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="未取到作业数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 接口 GET /api/v1/assignments 可用"
    />

    <!-- 汇总 -->
    <div class="summary-row">
      <div class="sum">
        <span class="ic ic-warning"><BaseIcon name="clock" :size="18" /></span>
        <div><div class="num">{{ pending }}</div><div class="lbl">待提交</div></div>
      </div>
      <div class="sum">
        <span class="ic ic-success"><BaseIcon name="circle-check" :size="18" /></span>
        <div><div class="num">{{ graded }}</div><div class="lbl">已批改</div></div>
      </div>
      <div class="sum">
        <span class="ic ic-error"><BaseIcon name="alert-circle" :size="18" /></span>
        <div><div class="num">{{ appealing }}</div><div class="lbl">申诉处理中</div></div>
      </div>
      <div class="sum">
        <span class="ic ic-brand"><BaseIcon name="calendar-clock" :size="18" /></span>
        <div><div class="num">3 天</div><div class="lbl">本周截止</div></div>
      </div>
    </div>

    <!-- 课程切换 -->
    <div class="row mt16" style="margin-bottom: 14px">
      <span class="hw-tabs">
        <span
          v-for="t in COURSE_TABS"
          :key="t.k"
          class="pill"
          :class="{ active: curCourse === t.k }"
          @click="curCourse = t.k"
        >{{ t.l }}</span>
      </span>
    </div>

    <!-- 列表 -->
    <div class="hw-list">
      <div v-for="h in rows" :key="h.id" class="hw-card" @click="go(h)">
        <div class="hw-top">
          <div style="flex: 1; min-width: 0">
            <div class="hw-title">{{ h.title }}</div>
            <div class="hw-meta">{{ h.courseName }} · {{ h.meta }}</div>
            <div v-if="h.extra" class="hw-extra" :class="h.extraTone ? 'is-' + h.extraTone : ''">{{ h.extra }}</div>
          </div>
          <el-tag :type="badgeType(h.status)" effect="light">{{ h.statusText }}</el-tag>
        </div>
        <div class="hw-foot">
          <div class="small muted">截止：{{ h.deadline }}</div>
          <el-button :type="h.status === 'warning' ? 'primary' : 'default'" size="small" @click.stop="go(h)">
            <BaseIcon :name="h.status === 'warning' ? 'pencil' : h.status === 'error' ? 'refresh-cw' : 'eye'" :size="14" />
            {{ h.status === 'warning' ? '去作答' : h.status === 'error' ? '查看进度' : '查看' }}
          </el-button>
        </div>
      </div>

      <div v-if="!rows.length" class="hw-empty">
        <BaseIcon name="inbox" :size="34" />
        <div>该课程暂无作业</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.sum {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px 16px;
}
.sum .ic {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex: none;
}
.ic-warning {
  background: var(--warning);
}
.ic-success {
  background: var(--success);
}
.ic-error {
  background: var(--error);
}
.ic-brand {
  background: var(--brand-600);
}
.sum .num {
  font-size: 20px;
  font-weight: 800;
  color: var(--ink-900);
  line-height: 1.2;
}
.sum .lbl {
  font-size: 12px;
  color: var(--ink-500);
}
.hw-tabs {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: var(--bg-soft);
  border-radius: 11px;
}
.hw-tabs .pill {
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-600);
  cursor: pointer;
  user-select: none;
}
.hw-tabs .pill.active {
  background: #fff;
  color: var(--brand-700);
  box-shadow: var(--sh-1);
}
.hw-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hw-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  cursor: pointer;
  transition: 0.15s;
}
.hw-card:hover {
  border-color: var(--brand-300);
  box-shadow: 0 4px 14px rgba(13, 148, 136, 0.08);
}
.hw-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.hw-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink-900);
}
.hw-meta {
  font-size: 12.5px;
  color: var(--ink-500);
  margin-top: 4px;
}
.hw-extra {
  font-size: 12.5px;
  color: var(--ink-500);
  margin-top: 4px;
}
.hw-extra.is-warning {
  color: var(--warning);
}
.hw-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.hw-empty {
  text-align: center;
  color: var(--ink-400);
  font-size: 13px;
  padding: 56px 0;
}
.mb16 {
  margin-bottom: 16px;
}
@media (max-width: 900px) {
  .summary-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
