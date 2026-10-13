<script setup>
/**
 * 业务层组件：折线图（可双序列，第二序列为橙色虚线）
 *
 * 视觉对齐原型 pc/teacher-analytics.html「成绩趋势」、pc/admin-analytics.html「AI 调用趋势 / 成绩趋势」、
 * mp/app-analytics.html「近 6 次作业成绩」：只有坐标轴 + 3 条网格线 + 折线 + 圆点 + 横轴标签，
 * **没有纵轴数值标签**（原型即如此）。
 */
import { computed } from 'vue'

const props = defineProps({
  /** 主序列 [{ label, value }]，品牌色实线 */
  points: { type: Array, default: () => [] },
  /** 副序列 [{ label, value }]，橙色虚线（可选） */
  series2: { type: Array, default: () => [] },
  /** 主/副序列图例名，两者都传且 series2 非空时显示图例 */
  name: { type: String, default: '' },
  series2Name: { type: String, default: '' },
  height: { type: Number, default: 180 },
  showDots: { type: Boolean, default: true }
})

const W = 400
const PL = 30
const PR = 10
const PT = 10
const PB = 30

const H = computed(() => props.height)
const plotW = W - PL - PR
const plotH = computed(() => H.value - PT - PB)

const all = computed(() => [...(props.points || []), ...(props.series2 || [])].map((p) => Number(p.value) || 0))

/** 纵轴范围：数据上下各留 8% 余量；全等值时给一个兜底区间 */
const bounds = computed(() => {
  const vs = all.value
  if (!vs.length) return { lo: 0, hi: 1 }
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (hi === lo) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.08
  return { lo: lo - pad, hi: hi + pad }
})

function xAt(i, n) {
  if (n <= 1) return PL + plotW / 2
  return PL + (plotW * i) / (n - 1)
}
function yAt(v) {
  const { lo, hi } = bounds.value
  return PT + plotH.value * (1 - (Number(v) - lo) / (hi - lo))
}

function polyline(list) {
  return (list || [])
    .map((p, i) => `${xAt(i, list.length).toFixed(1)},${yAt(p.value).toFixed(1)}`)
    .join(' ')
}

const gridYs = computed(() =>
  [0, 1, 2].map((k) => (PT + (plotH.value * k) / 3).toFixed(1))
)
const axisY = computed(() => (PT + plotH.value).toFixed(1))
const primaryLine = computed(() => polyline(props.points))
const secondLine = computed(() => polyline(props.series2))
const dots = computed(() =>
  (props.points || []).map((p, i) => ({
    x: xAt(i, props.points.length).toFixed(1),
    y: yAt(p.value).toFixed(1)
  }))
)
const xLabels = computed(() =>
  (props.points || []).map((p, i) => ({
    x: xAt(i, props.points.length).toFixed(1),
    y: (PT + plotH.value + 16).toFixed(1),
    text: p.label
  }))
)
const showLegend = computed(() => !!props.name && !!props.series2Name && (props.series2 || []).length > 0)
</script>

<template>
  <div>
    <svg
      v-if="(points || []).length"
      :viewBox="`0 0 ${W} ${H}`"
      style="width: 100%; height: auto"
    >
      <line :x1="PL" :y1="PT" :x2="PL" :y2="axisY" stroke="var(--border)" />
      <line :x1="PL" :y1="axisY" :x2="W - PR" :y2="axisY" stroke="var(--border)" />
      <g stroke="var(--bg-soft)">
        <line v-for="(gy, i) in gridYs" :key="`gy${i}`" :x1="PL" :y1="gy" :x2="W - PR" :y2="gy" />
      </g>

      <polyline
        v-if="secondLine"
        :points="secondLine"
        fill="none"
        stroke="#f59e0b"
        stroke-width="2"
        stroke-dasharray="5 4"
      />
      <polyline
        :points="primaryLine"
        fill="none"
        stroke="var(--brand-600)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <g v-if="showDots" fill="var(--brand-600)">
        <circle v-for="(d, i) in dots" :key="`d${i}`" :cx="d.x" :cy="d.y" r="3.5" />
      </g>

      <g font-size="10" fill="var(--ink-400)">
        <text v-for="(l, i) in xLabels" :key="`x${i}`" :x="l.x" :y="l.y" text-anchor="middle">
          {{ l.text }}
        </text>
      </g>
    </svg>
    <el-empty v-else description="暂无趋势数据" :image-size="60" />

    <div v-if="showLegend" class="legend">
      <span class="lg on"><i class="solid" />{{ name }}</span>
      <span class="lg"><i class="dash" />{{ series2Name }}</span>
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-600);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg i {
  width: 16px;
  height: 0;
  border-top-width: 2.5px;
  border-top-style: solid;
  display: inline-block;
}
.lg i.solid {
  border-color: var(--brand-600);
}
.lg i.dash {
  border-color: #f59e0b;
  border-top-style: dashed;
}
</style>
