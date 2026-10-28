<script setup>
/**
 * 学习周报 / 月报（★ 2026-10-28 新增）
 *
 * 接口（stu-pc）：GET /api/v1/stu/study-report?type=week|month&offset=0
 *   → { type, startDate, endDate, prevStartDate, prevEndDate,
 *       summary{}, prevSummary{}, daily[], byCourse[], bySource[] }
 *
 * 口径（全部由后端 SQL 聚合，前端只展示、不重算、不编数据）：
 *   · 时长来自 learning_time_daily（按 user_id 归集，不是 student_id）
 *   · 练习来自 practice_record（按 create_time 归期）
 *   · 错题来自 wrong_record（按 last_wrong_time 归期），未掌握总数不受区间限制
 *   · 环比 = 本周期 vs 上一周期，上一周期无数据时只显示本周期值
 */
import { ref, computed, onMounted, watch } from 'vue'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { studyReport } from '@/api/student/learning'

const loading = ref(false)
const offline = ref(false)
const data = ref(null)

/** week | month */
const type = ref('week')
/** 0 = 本周期，1 = 上一周期… */
const offset = ref(0)

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日']

const s = computed(() => data.value?.summary || {})
const ps = computed(() => data.value?.prevSummary || {})
const daily = computed(() => data.value?.daily || [])
const byCourse = computed(() => data.value?.byCourse || [])
const bySource = computed(() => data.value?.bySource || [])

/** 柱状图最大高度基准：用区间内单日最大值，避免全为 0 时除零 */
const maxSec = computed(() => {
  const m = Math.max(0, ...daily.value.map((d) => Number(d.sec) || 0))
  return m > 0 ? m : 1
})

const rangeText = computed(() => {
  if (!data.value) return ''
  return `${data.value.startDate} ~ ${data.value.endDate}`
})

/** 一句话总结：用真实数据拼，不做任何预测或编造 */
const conclusion = computed(() => {
  const cur = s.value
  if (!data.value) return ''
  const hours = cur.totalHours ?? 0
  const rate = cur.correctRate
  const un = cur.unmasteredTotal ?? 0
  const parts = []
  parts.push(`本${type.value === 'week' ? '周' : '月'}学习 ${hours} 小时`)
  parts.push(`覆盖 ${cur.activeDays ?? 0}/${cur.expectDays ?? 0} 天`)
  if (cur.practiceCount) {
    parts.push(`练习 ${cur.practiceCount} 题，正确率 ${rate ?? '—'}%`)
  } else {
    parts.push('暂无练习记录')
  }
  let tail = ''
  if (un > 0) {
    tail = `；还有 ${un} 道错题未掌握，建议优先攻克`
  } else if (cur.newWrongCount) {
    tail = '；错题已全部掌握，保持'
  }
  return parts.join('，') + tail
})

async function load() {
  loading.value = true
  try {
    data.value = await studyReport({ type: type.value, offset: offset.value })
    offline.value = false
  } catch {
    data.value = null
    offline.value = true
  } finally {
    loading.value = false
  }
}

function switchType(t) {
  if (type.value === t) return
  type.value = t
  offset.value = 0
  load()
}

function shift(d) {
  const next = offset.value + d
  if (next < 0) return
  offset.value = next
  load()
}

function backCurrent() {
  if (offset.value === 0) return
  offset.value = 0
  load()
}

/** 环比：返回 { text, dir }；上期为 0 或缺失时给 null（前端显示「—」而不是编一个百分比） */
function delta(cur, prev, unit = '') {
  const c = Number(cur) || 0
  const p = Number(prev) || 0
  if (p === 0) return null
  const d = c - p
  if (d === 0) return { text: '持平', dir: 'flat' }
  const sign = d > 0 ? '+' : ''
  const val = unit === '%' ? `${sign}${Math.round(d * 10) / 10}%` : `${sign}${Math.round(d * 100) / 100}${unit}`
  return { text: val, dir: d > 0 ? 'up' : 'down' }
}

function barHeight(sec) {
  const v = Number(sec) || 0
  return `${Math.max(2, Math.round((v / maxSec.value) * 100))}%`
}

function weekdayLabel(d) {
  const idx = Number(d.weekday) || 1
  return WEEKDAY_CN[idx - 1] || String(idx)
}

function fmtDate(d) {
  return String(d?.date || '').slice(5)
}

function sourceLabel(src) {
  return { video: '看课视频', practice: '练习', resource: '资料阅读', other: '其他' }[src] || src || '其他'
}

function coursePercent(sec) {
  const total = byCourse.value.reduce((a, b) => a + (Number(b.sec) || 0), 0)
  if (!total) return 0
  return Math.round(((Number(sec) || 0) / total) * 1000) / 10
}

onMounted(load)
watch([type, offset], () => {})
</script>

<template>
  <div>
    <PageHeader title="学习周报" :desc="rangeText" back back-to="/student/analytics" />

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="周报加载失败"
      description="请确认后端与 SSH 隧道已启动（接口 GET /api/v1/stu/study-report）"
    />

    <!-- 周期切换 -->
    <el-card shadow="never" class="mb16">
      <div class="between">
        <div class="row" style="gap: 8px">
          <el-radio-group v-model="type" size="small" @change="switchType">
            <el-radio-button value="week">周报</el-radio-button>
            <el-radio-button value="month">月报</el-radio-button>
          </el-radio-group>
          <el-tag v-if="offset === 0" size="small" type="success" effect="light">本{{ type === 'week' ? '周' : '月' }}</el-tag>
          <el-tag v-else size="small" type="info" effect="light">{{ offset }} 个{{ type === 'week' ? '周' : '月' }}前</el-tag>
        </div>
        <div class="row" style="gap: 6px">
          <el-button size="small" @click="shift(1)">
            <BaseIcon name="chevron-left" :size="14" />上一{{ type === 'week' ? '周' : '月' }}
          </el-button>
          <el-button
            size="small"
            :disabled="offset === 0"
            @click="shift(-1)"
          >
            下一{{ type === 'week' ? '周' : '月' }}<BaseIcon name="chevron-right" :size="14" />
          </el-button>
          <el-button size="small" :disabled="offset === 0" @click="backCurrent">回到本{{ type === 'week' ? '周' : '月' }}</el-button>
          <el-button size="small" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
        </div>
      </div>
    </el-card>

    <div v-loading="loading">
      <template v-if="data">
        <!-- 概览 -->
        <el-card shadow="never" class="mb16">
          <div class="ov-grid">
            <div class="stat">
              <div class="stat-num">{{ s.totalHours ?? '—' }}<span class="unit">h</span></div>
              <div class="small muted">学习时长</div>
              <div v-if="delta(s.totalHours, ps.totalHours, 'h')" class="delta" :class="delta(s.totalHours, ps.totalHours, 'h').dir">
                {{ delta(s.totalHours, ps.totalHours, 'h').text }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ s.practiceCount ?? '—' }}<span class="unit">题</span></div>
              <div class="small muted">练习量</div>
              <div v-if="delta(s.practiceCount, ps.practiceCount)" class="delta" :class="delta(s.practiceCount, ps.practiceCount).dir">
                {{ delta(s.practiceCount, ps.practiceCount).text }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ s.correctRate ?? '—' }}<span class="unit">%</span></div>
              <div class="small muted">练习正确率</div>
              <div v-if="delta(s.correctRate, ps.correctRate, '%')" class="delta" :class="delta(s.correctRate, ps.correctRate, '%').dir">
                {{ delta(s.correctRate, ps.correctRate, '%').text }}
              </div>
            </div>
            <div class="stat">
              <div class="stat-num">{{ s.newWrongCount ?? '—' }}<span class="unit">道</span></div>
              <div class="small muted">新增错题</div>
              <div class="small muted mt6">待攻克 {{ s.unmasteredTotal ?? 0 }} 道</div>
            </div>
          </div>
        </el-card>

        <!-- 结论 -->
        <el-card shadow="never" class="mb16">
          <div class="row" style="gap: 8px; align-items: flex-start">
            <BaseIcon name="sparkles" :size="16" />
            <div class="small">{{ conclusion }}</div>
          </div>
        </el-card>

        <!-- 每日时长柱状图 -->
        <el-card shadow="never" class="mb16">
          <template #header>
            <div class="between">
              <b>每日学习时长</b>
              <span class="small muted">高效日 {{ s.productiveDays ?? 0 }} 天（≥1 小时）</span>
            </div>
          </template>
          <div v-if="daily.length" class="chart">
            <div v-for="d in daily" :key="d.date" class="bar-col">
              <div class="bar-wrap">
                <div class="bar" :style="{ height: barHeight(d.sec) }" :title="`${d.date} ${d.hours}h`" />
              </div>
              <div class="bar-x small muted">{{ weekdayLabel(d) }}</div>
              <div class="bar-x small muted">{{ fmtDate(d) }}</div>
            </div>
          </div>
          <EmptyState v-else desc="本周期没有学习时长记录" />
        </el-card>

        <div class="two-col">
          <!-- 按课程 -->
          <el-card shadow="never">
            <template #header><b>时长按课程分布</b></template>
            <div v-if="byCourse.length" class="dist">
              <div v-for="c in byCourse" :key="c.courseId" class="dist-row">
                <div class="between small">
                  <span class="dist-name">{{ c.courseName }}</span>
                  <span class="muted">{{ Math.round((c.sec || 0) / 36) / 100 }}h · {{ coursePercent(c.sec) }}%</span>
                </div>
                <div class="track">
                  <div class="fill" :style="{ width: `${coursePercent(c.sec)}%` }" />
                </div>
              </div>
            </div>
            <EmptyState v-else desc="本周期没有课程时长记录" />
          </el-card>

          <!-- 按来源 -->
          <el-card shadow="never">
            <template #header><b>时长按来源分布</b></template>
            <div v-if="bySource.length" class="dist">
              <div v-for="x in bySource" :key="x.source" class="dist-row">
                <div class="between small">
                  <span class="dist-name">{{ sourceLabel(x.source) }}</span>
                  <span class="muted">{{ Math.round((x.sec || 0) / 36) / 100 }}h</span>
                </div>
                <div class="track">
                  <div
                    class="fill alt"
                    :style="{ width: `${Math.round(((x.sec || 0) / (bySource.reduce((a, b) => a + (Number(b.sec) || 0), 0) || 1)) * 1000) / 10}%` }"
                  />
                </div>
              </div>
            </div>
            <EmptyState v-else desc="本周期没有来源记录" />
          </el-card>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mb16 {
  margin-bottom: 16px;
}
.mt6 {
  margin-top: 6px;
}
.ov-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.stat {
  text-align: center;
}
.stat-num {
  font-size: 26px;
  font-weight: 600;
  color: #0d9488;
  line-height: 1.2;
}
.unit {
  font-size: 13px;
  font-weight: 400;
  margin-left: 2px;
  color: #64748b;
}
.delta {
  margin-top: 4px;
  font-size: 12px;
}
.delta.up {
  color: #16a34a;
}
.delta.down {
  color: #dc2626;
}
.delta.flat {
  color: #94a3b8;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 180px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar {
  width: 60%;
  min-height: 2px;
  background: #0d9488;
  border-radius: 3px 3px 0 0;
  transition: height 0.25s ease;
}
.bar-x {
  margin-top: 2px;
  white-space: nowrap;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.dist-row {
  margin-bottom: 12px;
}
.dist-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}
.track {
  margin-top: 4px;
  height: 6px;
  background: #f1f5f9;
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #0d9488;
  border-radius: 3px;
}
.fill.alt {
  background: #38bdf8;
}
@media (max-width: 900px) {
  .ov-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
