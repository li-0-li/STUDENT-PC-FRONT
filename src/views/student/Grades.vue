<script setup>
/**
 * 我的成绩（★ 2026-10-27 新增）
 *
 * 接口（stu-pc）：
 *   GET /api/v1/stu/grades            → 总览：overallPct / creditSum / 已批改 / 待提交 / courses[]
 *   GET /api/v1/stu/grades/{courseId} → 明细：作业 + 实验逐条（含班级平均）
 *
 * 口径（后端算，前端只展示，不编数据）：
 *   · 分数统一换算百分制（score / total_score * 100），不同满分才能比
 *   · 课程总评 = 作业 + 实验按「已批改条数」加权
 *   · 跨课程总评 = 按 course.credit 学分加权
 *   · 班级平均 = 同课程全部学生同口径均值（仅已批改）
 */
import { ref, onMounted } from 'vue'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { myGrades, gradeDetail } from '@/api/student/grade'

const loading = ref(false)
const offline = ref(false)
const data = ref(null)

/** courseId → 明细数组；展开时才请求（懒加载） */
const details = ref({})
const opening = ref(0)

async function load() {
  loading.value = true
  try {
    data.value = await myGrades()
    offline.value = false
  } catch {
    data.value = null
    offline.value = true
  } finally {
    loading.value = false
  }
}

async function toggle(c) {
  const id = c.courseId
  if (details.value[id]) {
    const next = { ...details.value }
    delete next[id]
    details.value = next
    return
  }
  opening.value = id
  try {
    const d = await gradeDetail(id)
    details.value = { ...details.value, [id]: d?.items || [] }
  } catch {
    // 拦截器已提示
  } finally {
    opening.value = 0
  }
}

/** 分数色调：≥85 好 / ≥70 中 / 其余偏低 */
function tone(v) {
  if (v == null) return 'na'
  if (v >= 85) return 'great'
  if (v >= 70) return 'ok'
  return 'weak'
}
function diffText(d) {
  if (d == null) return '—'
  const s = d > 0 ? `+${d}` : String(d)
  return `${s} 分`
}
function diffTip(d) {
  if (d == null) return ''
  if (d >= 5) return '高于班级平均'
  if (d <= -5) return '低于班级平均'
  return '与班级平均接近'
}
function typeLabel(t) {
  return t === 'experiment' ? '实验' : '作业'
}
function statLine(s) {
  if (!s || !s.total) return '暂无'
  return `${s.scored}/${s.total} 已批改`
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="我的成绩" desc="作业与实验按百分制换算，课程总评按已批改条数加权">
      <template #actions>
        <el-button :loading="loading" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="成绩加载失败"
      description="请确认后端与 SSH 隧道已启动（接口 GET /api/v1/stu/grades）"
    />

    <div v-loading="loading">
      <template v-if="data">
        <!-- 概览 -->
        <el-card shadow="never">
          <div class="ov-grid">
            <div class="stat">
              <div class="stat-num" :class="tone(data.overallPct)">{{ data.overallPct ?? '—' }}</div>
              <div class="small muted">加权总评（百分制 · 按学分）</div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ data.creditSum }}</div>
              <div class="small muted">已出分课程学分</div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ data.gradedCount }}</div>
              <div class="small muted">已批改任务</div>
            </div>
            <div class="stat">
              <div class="stat-num">
                {{ data.pendingSubmit
                }}<span class="small muted" style="font-weight: 400"> / {{ data.pendingGrade }}</span>
              </div>
              <div class="small muted">待提交 / 待批改</div>
            </div>
          </div>
        </el-card>

        <!-- 课程列表 -->
        <div v-if="data.courses && data.courses.length" class="stack mt16" style="gap: 12px">
          <el-card v-for="c in data.courses" :key="c.courseId" shadow="never">
            <div class="between">
              <div>
                <div class="row" style="gap: 8px; align-items: center">
                  <b class="course-name">{{ c.courseName }}</b>
                  <el-tag v-if="c.credit" size="small" effect="plain">{{ c.credit }} 学分</el-tag>
                  <el-tag v-if="!c.graded" size="small" type="info" effect="light">暂无成绩</el-tag>
                </div>
                <div class="small muted mt6">
                  任务 {{ c.graded }}/{{ c.taskTotal }} 已批改 · 作业 {{ statLine(c.homework) }} · 实验
                  {{ statLine(c.experiment) }}
                </div>
              </div>
              <div class="row" style="gap: 16px; align-items: center">
                <div class="score-col">
                  <div class="score-num" :class="tone(c.myPct)">{{ c.myPct ?? '—' }}</div>
                  <div class="small muted">课程总评</div>
                </div>
                <div class="score-col">
                  <div class="class-num">{{ c.classPct ?? '—' }}</div>
                  <div class="small muted">班级平均</div>
                </div>
                <el-tag
                  v-if="c.diff != null"
                  size="small"
                  :type="c.diff >= 0 ? 'success' : 'warning'"
                  effect="light"
                  :title="diffTip(c.diff)"
                >
                  {{ diffText(c.diff) }}
                </el-tag>
                <el-button size="small" :loading="opening === c.courseId" @click="toggle(c)">
                  {{ details[c.courseId] ? '收起明细' : '查看明细' }}
                </el-button>
              </div>
            </div>

            <!-- 明细（展开才请求） -->
            <div v-if="details[c.courseId]" class="mt16">
              <el-table v-if="details[c.courseId].length" :data="details[c.courseId]" size="small">
                <el-table-column label="类型" width="70">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.itemType === 'experiment' ? 'warning' : ''" effect="plain">
                      {{ typeLabel(row.itemType) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="任务" min-width="200">
                  <template #default="{ row }">
                    <b class="small">{{ row.title }}</b>
                    <span v-if="row.weekNum" class="small muted"> · 第 {{ row.weekNum }} 周</span>
                  </template>
                </el-table-column>
                <el-table-column label="得分" width="110" align="right">
                  <template #default="{ row }">
                    <template v-if="row.myScore != null">
                      <b :class="tone(row.myPct)">{{ row.myScore }}</b>
                      <span class="small muted"> / {{ row.totalScore ?? '—' }}</span>
                    </template>
                    <span v-else class="small muted">{{ row.status === 'submitted' ? '待批改' : '未提交' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="百分制" width="90" align="right">
                  <template #default="{ row }">
                    <span :class="tone(row.myPct)">{{ row.myPct ?? '—' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="班级平均" width="100" align="right">
                  <template #default="{ row }">
                    <span class="small muted">{{ row.classPct ?? '—' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="批改时间" width="150">
                  <template #default="{ row }">
                    <span class="small muted">{{ row.gradedTime || '—' }}</span>
                  </template>
                </el-table-column>
              </el-table>
              <EmptyState v-else desc="这门课还没有已发布的作业或实验" />
            </div>
          </el-card>
        </div>

        <EmptyState v-else desc="还没有已选课程，先去「课程」选课" />
      </template>

      <EmptyState v-else-if="!loading && !offline" desc="暂无成绩数据" />
    </div>
  </div>
</template>

<style scoped>
/* 概览四格 */
.ov-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.stat {
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: 10px;
}
.stat-num {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--ink-900);
}
.course-name {
  font-size: 15px;
  color: var(--ink-900);
}
.score-col {
  text-align: right;
  min-width: 66px;
}
.score-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.15;
}
.class-num {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-500);
  line-height: 1.5;
}
/* 分数色调（成绩口径：高=绿，低=橙，仅作视觉提示） */
.great {
  color: var(--brand-700);
}
.ok {
  color: var(--ink-900);
}
.weak {
  color: #d97706;
}
.na {
  color: var(--ink-400);
}
@media (max-width: 900px) {
  .ov-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
