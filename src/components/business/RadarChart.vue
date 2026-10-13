<script setup>
/**
 * 业务层组件：知识点掌握度雷达图（五 / 六边形）
 *
 * 原型本身就用手写 SVG（pc/student-analytics.html、pc/teacher-analytics.html、mp/app-analytics.html），
 * 本组件保持同一视觉语言——三层网格 + 品牌色数据多边形 + 顶点圆点 + 轴标签——只是改为数据驱动。
 * 不引 ECharts：原型即 SVG，手算顶点可 1:1 还原且不增加包体积；若后续要 tooltip/动画再换。
 */
import { computed } from 'vue'

const props = defineProps({
  /** [{ name, percent }]，percent 为 0-100 */
  items: { type: Array, default: () => [] },
  size: { type: Number, default: 280 },
  /** 最多画几个轴，避免标签重叠 */
  maxAxes: { type: Number, default: 6 }
})

// 视口与几何中心：与原型 viewBox="0 0 220 200" 的取值一致
const W = 220
const H = 200
const CX = 110
const CY = 104
const R = 84

const axes = computed(() => (props.items || []).slice(0, props.maxAxes))

function vertex(i, ratio, total) {
  const angle = (-90 + (360 / total) * i) * (Math.PI / 180)
  return [CX + R * ratio * Math.cos(angle), CY + R * ratio * Math.sin(angle)]
}

function ring(ratio, total) {
  return Array.from({ length: total }, (_, i) =>
    vertex(i, ratio, total)
      .map((n) => n.toFixed(1))
      .join(',')
  ).join(' ')
}

const total = computed(() => axes.value.length)

const gridRings = computed(() =>
  total.value < 3 ? [] : [1, 0.66, 0.33].map((r) => ring(r, total.value))
)

const spokes = computed(() =>
  total.value < 3 ? [] : Array.from({ length: total.value }, (_, i) => vertex(i, 1, total.value))
)

const dataPolygon = computed(() => {
  if (total.value < 3) return ''
  return axes.value
    .map((k, i) =>
      vertex(i, Math.min(100, Math.max(0, Number(k.percent) || 0)) / 100, total.value)
        .map((n) => n.toFixed(1))
        .join(',')
    )
    .join(' ')
})

const dots = computed(() => {
  if (total.value < 3) return []
  return axes.value.map((k, i) => {
    const [x, y] = vertex(i, Math.min(100, Math.max(0, Number(k.percent) || 0)) / 100, total.value)
    return { x: x.toFixed(1), y: y.toFixed(1) }
  })
})

const labels = computed(() => {
  if (total.value < 3) return []
  return axes.value.map((k, i) => {
    const angle = (-90 + (360 / total.value) * i) * (Math.PI / 180)
    const x = CX + (R + 18) * Math.cos(angle)
    const y = CY + (R + 18) * Math.sin(angle) + 4
    return {
      x: x.toFixed(1),
      y: y.toFixed(1),
      text: k.name,
      anchor: x < CX - 6 ? 'end' : x > CX + 6 ? 'start' : 'middle'
    }
  })
})
</script>

<template>
  <div class="center">
    <svg v-if="total >= 3" :viewBox="`0 0 ${W} ${H}`" :style="{ width: size + 'px', maxWidth: '100%' }">
      <g stroke="var(--bg-soft)" fill="none">
        <polygon v-for="(p, i) in gridRings" :key="`g${i}`" :points="p" />
      </g>
      <g stroke="var(--border)">
        <line
          v-for="(sp, i) in spokes"
          :key="`s${i}`"
          :x1="CX"
          :y1="CY"
          :x2="sp[0].toFixed(1)"
          :y2="sp[1].toFixed(1)"
        />
      </g>
      <polygon :points="dataPolygon" fill="rgba(20,184,166,.18)" stroke="var(--brand-600)" stroke-width="2" />
      <g fill="var(--brand-600)">
        <circle v-for="(d, i) in dots" :key="`d${i}`" :cx="d.x" :cy="d.y" r="3.5" />
      </g>
      <g font-size="11" fill="var(--ink-500)">
        <text v-for="(l, i) in labels" :key="`t${i}`" :x="l.x" :y="l.y" :text-anchor="l.anchor">
          {{ l.text }}
        </text>
      </g>
    </svg>
    <el-empty v-else description="暂无掌握度数据" :image-size="72" />
  </div>
</template>
