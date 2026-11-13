<script setup>
/**
 * 我的作业（分支 stu-pc-homework）
 * 关联接口（接口设计文档表号）：表 3-5 作业列表查询 GET /api/v1/assignments
 *   表 3-7 作业申诉 POST /api/v1/submissions/{submissionId}/appeal
 *
 * ★ 2026-11-13 改造（申诉入口）：
 *   1. 后端 GET /api/v1/assignments 的学生视角已返回 mySubmissionId / myStatus / myScore /
 *      allowAppeal，此前映射时全部丢掉，导致「已批改」的作业只能点进去看，列表上看不出能不能申诉；
 *   2. 现在已批改（myStatus=finished）且 allowAppeal=true 的作业，卡片上直接给「申诉」按钮，
 *      点开走 AppealDialog（状态 / 7 天窗口校验在弹窗内），不必先进详情页；
 *   3. 顺带修两处：课程页签原先写死 math/ds/eng 且行数据 course 恒为 'all'（点了永远筛不出东西），
 *      改为按 courseId 动态生成；接口异常时不再塞 DEMO 假数据（会让学生以为真有作业）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import AppealDialog from '@/components/business/AppealDialog.vue'
import { homeworkList } from '@/api/student/homework'

const router = useRouter()

/** 后端 submission.status 8 值 → 展示文案 / 徽标色 / 卡片动作 */
const MY_STATE = {
  draft: { badge: 'warning', text: '草稿', action: 'continue' },
  submitted: { badge: 'primary', text: '待批改', action: 'view' },
  queued: { badge: 'primary', text: '排队批改中', action: 'view' },
  grading: { badge: 'primary', text: '批改中', action: 'view' },
  manual: { badge: 'warning', text: '待人工复核', action: 'view' },
  finished: { badge: 'success', text: '已批改', action: 'view' },
  appealing: { badge: 'danger', text: '申诉处理中', action: 'view' },
  returned: { badge: 'danger', text: '已退回', action: 'continue' }
}

const list = ref([])
const curCourse = ref('all')
const offline = ref(false)
const loading = ref(false)

/* ===== 申诉弹窗 ===== */
const appealVisible = ref(false)
const appealTarget = ref(null)

const courseTabs = computed(() => {
  const m = new Map()
  list.value.forEach((h) => {
    if (h.courseId && h.courseName) m.set(String(h.courseId), h.courseName)
  })
  return [{ k: 'all', l: '全部' }, ...[...m].map(([k, l]) => ({ k, l }))]
})

const rows = computed(() =>
  curCourse.value === 'all' ? list.value : list.value.filter((h) => String(h.courseId) === curCourse.value)
)

const pending = computed(() =>
  rows.value.filter((h) => ['warning'].includes(h.badge) && h.action === 'continue').length
)
const graded = computed(() => rows.value.filter((h) => h.myStatus === 'finished').length)
const appealing = computed(() => rows.value.filter((h) => h.myStatus === 'appealing').length)

/** 本周截止：7 天内到期且尚未批改完成 */
const dueThisWeek = computed(() => {
  const now = Date.now()
  const week = now + 7 * 86400000
  return rows.value.filter((h) => {
    if (!h.deadline) return false
    const t = new Date(String(h.deadline).replace(' ', 'T')).getTime()
    return !Number.isNaN(t) && t >= now && t <= week && h.myStatus !== 'finished'
  }).length
})

const badgeType = (s) =>
  ({ warning: 'warning', success: 'success', error: 'danger', danger: 'danger', primary: 'primary', info: 'info' })[s] ||
  'info'

/** 单行映射：把后端学生视角字段翻成卡片展示 + 动作 */
function mapRow(h) {
  const my = h.myStatus || ''
  const st = MY_STATE[my] || { badge: 'warning', text: '待提交', action: 'continue' }

  // 已批改：带上分数
  let statusText = st.text
  if (my === 'finished' && h.myScore != null) statusText = `已批改 ${h.myScore}`

  // 动作按钮
  const act = st.action
  const actionMap = {
    continue: { text: '去作答', icon: 'pencil', type: 'primary' },
    view: { text: '查看', icon: 'eye', type: 'default' }
  }
  const action = { ...actionMap[act] }
  if (my === 'appealing') {
    action.text = '查看进度'
    action.icon = 'refresh-cw'
  }

  return {
    id: h.assignmentId,
    title: h.title,
    courseId: h.courseId,
    courseName: h.courseName || '',
    deadline: h.deadline ? String(h.deadline).replace('T', ' ').slice(0, 16) : '—',
    myStatus: my,
    myScore: h.myScore,
    mySubmissionId: h.mySubmissionId,
    statusBadge: st.badge,
    statusText,
    actionText: action.text,
    actionIcon: action.icon,
    actionType: action.type,
    // 申诉入口：已批改 + 教师开启申诉（7 天窗口由弹窗按期校验，列表接口没有 gradedTime）
    canAppeal: my === 'finished' && h.allowAppeal === true,
    extra: h.myScore != null ? `本次得分 ${h.myScore} 分` : ''
  }
}

async function load() {
  loading.value = true
  try {
    const d = await homeworkList()
    const data = d?.list || []
    list.value = data.map(mapRow)
    offline.value = false
  } catch {
    // 接口失败：清空并提示，绝不落假数据
    list.value = []
    offline.value = true
  } finally {
    loading.value = false
  }
}

function go(h) {
  if (h.actionText === '去作答') {
    router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: h.id } })
    return
  }
  // 详情页的 assignmentId 参数（Submission.vue 优先读 query.assignmentId）
  router.push({ name: 'StuSubmission', params: { submissionId: h.id }, query: { assignmentId: h.id } })
}

function openAppeal(h) {
  appealTarget.value = h
  appealVisible.value = true
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我的作业" desc="待提交 / 已批改 / 申诉，按状态与课程筛选">
      <template #actions>
        <el-button @click="load"><BaseIcon name="refresh-cw" :size="15" />刷新</el-button>
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
        <div><div class="num">{{ dueThisWeek }}</div><div class="lbl">本周截止</div></div>
      </div>
    </div>

    <!-- 课程切换 -->
    <div class="row mt16" style="margin-bottom: 14px">
      <span class="hw-tabs">
        <span
          v-for="t in courseTabs"
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
            <div class="hw-meta">{{ h.courseName || '—' }}</div>
            <div v-if="h.extra" class="hw-extra">{{ h.extra }}</div>
          </div>
          <el-tag :type="badgeType(h.statusBadge)" effect="light">{{ h.statusText }}</el-tag>
        </div>
        <div class="hw-foot">
          <div class="small muted">截止：{{ h.deadline }}</div>
          <div class="row" style="gap: 8px">
            <el-tooltip
              v-if="h.myStatus === 'finished' && !h.canAppeal"
              content="教师未对本作业开启成绩申诉"
              placement="top"
            >
              <el-button size="small" disabled><BaseIcon name="flag" :size="14" />申诉</el-button>
            </el-tooltip>
            <el-button v-else-if="h.canAppeal" size="small" @click.stop="openAppeal(h)">
              <BaseIcon name="flag" :size="14" />申诉
            </el-button>
            <el-button :type="h.actionType" size="small" @click.stop="go(h)">
              <BaseIcon :name="h.actionIcon" :size="14" />{{ h.actionText }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="!rows.length" class="hw-empty">
        <BaseIcon name="inbox" :size="34" />
        <div>{{ offline ? '数据加载失败' : '暂无作业' }}</div>
      </div>
    </div>

    <!-- 申诉弹窗：列表接口没有 gradedTime，弹窗按 assignmentId 自行拉最新提交 -->
    <AppealDialog
      v-model="appealVisible"
      :assignment-id="appealTarget?.id || 0"
      :title="appealTarget?.title || ''"
      @success="load"
    />
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
  flex-wrap: wrap;
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
