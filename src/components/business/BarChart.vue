<script setup>
/**
 * 业务层组件：柱状图（可显示柱顶数值）
 *
 * 视觉对齐原型 pc/teacher-analytics.html「成绩分布」、pc/teacher-class-scores.html「分数段分布 / 各次作业班级均分对比」、
 * pc/admin-analytics.html「成绩分布」、mp/t-analytics.html「分数段分布」：
 * 坐标轴 + 圆角柱 + 横轴标签；teacher-class-scores 与 admin-analytics 还带柱顶数值。
 * 柱色默认取品牌 teal 色阶（由浅到深），与原型一致。
 */
import { computed } from 'vue'

const props = defineProps({
  /** [{ label, value, color? }] */
  bars: { type: Array, default: () => [] },
  /** 是否显示柱顶数值 */
  showValues: { type: Boolean, default: false },
  height: { type: Number, default: 170 },
  /** 纵轴上限；不传则按最大值 ×1.15 自适应 */
  max: { type: Number, default: 0 }
})

/** 原型用的 teal 色阶（由浅到深） */
const RAMP = ['#b2f6ea', '#7ceadd', '#46d6ca', '#14b8a6', '#0d9488']

const W = 380
const PL = 30
const PR = 10
const PT = 22
const PB = 30

const H = computed(() => props.height)
const plotW = W - PL - PR
const plotH = computed(() => H.value - PT - PB)

const yMax = computed(() => {
  if (props.max) return props.max
  const vs = (props.bars || []).map((b) => Number(b.value) || 0)
  return vs.length ? Math.max(...vs) * 1.15 : 1
})

/** 柱宽：按可用宽度平分，留 35% 间隙 */
const slotW = computed(() => ((props.bars || []).length ? plotW / props.bars.length : plotW))
const barW = computed(() => Math.min(56, slotW.value * 0.65))

const items = computed(() =>
  (props.bars || []).map((b, i) => {
    const v = Number(b.value) || 0
    const h = yMax.value ? (plotH.value * v) / yMax.value : 0
    const cx = PL + slotW.value * i + slotW.value / 2
    return {
      x: (cx - barW.value / 2).toFixed(1),
      y: (PT + plotH.value - h).toFixed(1),
      w: barW.value.toFixed(1),
      h: Math.max(h, 0).toFixed(1),
      fill: b.color || RAMP[i % RAMP.length],
      label: b.label,
      value: b.value,
      lx: cx.toFixed(1),
      vy: (PT + plotH.value - h - 6).toFixed(1)
    }
  })
)

const gridYs = computed(() => [0, 1, 2].map((k) => (PT + (plotH.value * k) / 3).toFixed(1)))
const axisY = computed(() => (PT + plotH.value).toFixed(1))
</script>

<template>
  <div>
    <svg v-if="items.length" :viewBox="`0 0 ${W} ${H}`" style="width: 100%; height: auto">
      <line :x1="PL" :y1="PT" :x2="PL" :y2="axisY" stroke="var(--border)" />
      <line :x1="PL" :y1="axisY" :x2="W - PR" :y2="axisY" stroke="var(--border)" />
      <g stroke="var(--bg-soft)">
        <line v-for="(gy, i) in gridYs" :key="`gy${i}`" :x1="PL" :y1="gy" :x2="W - PR" :y2="gy" />
      </g>

      <rect
        v-for="(b, i) in items"
        :key="`b${i}`"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
        rx="4"
        :fill="b.fill"
      />

      <g v-if="showValues" font-size="11" fill="var(--ink-700)" text-anchor="middle">
        <text v-for="(b, i) in items" :key="`v${i}`" :x="b.lx" :y="b.vy">{{ b.value }}</text>
      </g>

      <g font-size="10" fill="var(--ink-400)" text-anchor="middle">
        <text v-for="(b, i) in items" :key="`l${i}`" :x="b.lx" :y="(H - 10).toFixed(1)">
          {{ b.label }}
        </text>
      </g>
    </svg>
    <el-empty v-else description="暂无分布数据" :image-size="60" />
  </div>
</template>
