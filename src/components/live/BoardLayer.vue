<script setup>
/**
 * 白板渲染层（只读）★ 2026-11-09
 *
 * 学生端**只渲染、不绘制**。笔迹由教师端通过 WS `board_op` 下发，
 * 页面把 `ops` 交给本组件，组件负责按归一化坐标重绘。
 *
 * ★ 坐标约定（协议级，教师端必须一致）：
 *   `points` 为 **0~1 归一化坐标**，原点在舞台左上角，x 除以舞台宽、y 除以舞台高。
 *   原因是教师 1920 宽、学生 1366 宽时按像素传会整体错位；
 *   归一化后两端各自乘以自身像素尺寸即可对齐。
 *
 * ★ 线宽约定：`op.width` 同样是**相对舞台宽度的比例**（0.004 ≈ 1920 下约 7.7px），
 *   这样教师端粗细观感在学生端一致。
 *
 * ★ 透明画布：canvas 背景透明，`mode='overlay'` 时叠在课件上（只看到笔迹），
 *   `mode='blank'` 时由父容器铺白底，形成空白画盘。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  /** [{ opId, tool, color, width, points: [[x,y], ...] }] */
  ops: { type: Array, default: () => [] },
  /** overlay 叠在课件上 / blank 空白画盘 */
  mode: { type: String, default: 'blank' },
  /**
   * 内容版本号：老师一笔还没画完时，后续分片只是往同一条笔迹里追加点，
   * 数组长度不变，仅靠 `ops` 的引用监听发现不了。父组件每次收到分片就 +1，
   * 本组件据此整体重绘这一笔（笔数不多，重绘成本远低于维护「擦除上一帧」的逻辑）。
   */
  rev: { type: Number, default: 0 }
})

const canvasRef = ref(null)
let ctx = null
let boxW = 0
let boxH = 0
/** 已经画到第几条（增量绘制用） */
let drawn = 0
let ro = null

/** 默认红线，与教师端「批注」语义一致 */
const DEFAULT_COLOR = '#ff4d4f'
const DEFAULT_WIDTH = 0.004

function setupCanvas() {
  const el = canvasRef.value
  if (!el) return
  const host = el.parentElement
  const rect = host.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  boxW = Math.max(1, rect.width)
  boxH = Math.max(1, rect.height)
  el.width = Math.round(boxW * dpr)
  el.height = Math.round(boxH * dpr)
  el.style.width = `${boxW}px`
  el.style.height = `${boxH}px`
  ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  redraw()
}

function clearCanvas() {
  if (!ctx) return
  ctx.clearRect(0, 0, boxW, boxH)
  drawn = 0
}

function drawOp(op) {
  if (!ctx || !op) return
  const pts = Array.isArray(op.points) ? op.points : []
  if (!pts.length) return

  const w = Math.max(1, (op.width || DEFAULT_WIDTH) * boxW)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = op.color || DEFAULT_COLOR
  ctx.fillStyle = op.color || DEFAULT_COLOR
  ctx.lineWidth = w

  if (op.tool === 'highlighter') ctx.globalAlpha = 0.3
  if (op.tool === 'eraser') {
    // 透明画布上擦除 = 挖掉像素，不能用白色覆盖（会把课件也盖住）
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineWidth = w * 3
  }

  const P = (p) => [p[0] * boxW, p[1] * boxH]

  if (op.tool === 'line' || op.tool === 'arrow') {
    const a = P(pts[0])
    const b = P(pts[pts.length - 1])
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.stroke()
    if (op.tool === 'arrow') drawArrowHead(a, b, w)
  } else if (op.tool === 'rect') {
    const a = P(pts[0])
    const b = P(pts[pts.length - 1])
    ctx.beginPath()
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1])
  } else if (op.tool === 'circle') {
    const a = P(pts[0])
    const b = P(pts[pts.length - 1])
    const cx = (a[0] + b[0]) / 2
    const cy = (a[1] + b[1]) / 2
    const rx = Math.abs(b[0] - a[0]) / 2
    const ry = Math.abs(b[1] - a[1]) / 2
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    // pen / highlighter / eraser：折线，点数 > 2 时用二次贝塞尔平滑
    ctx.beginPath()
    const first = P(pts[0])
    ctx.moveTo(first[0], first[1])
    if (pts.length === 2) {
      const p1 = P(pts[1])
      ctx.lineTo(p1[0], p1[1])
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const c = P(pts[i])
        const n = P(pts[i + 1])
        ctx.quadraticCurveTo(c[0], c[1], (c[0] + n[0]) / 2, (c[1] + n[1]) / 2)
      }
      const last = P(pts[pts.length - 1])
      ctx.lineTo(last[0], last[1])
    }
    ctx.stroke()
  }

  ctx.restore()
}

function drawArrowHead(a, b, w) {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  const len = Math.max(w * 3, 8)
  ctx.beginPath()
  ctx.moveTo(b[0], b[1])
  ctx.lineTo(b[0] - len * Math.cos(angle - Math.PI / 7), b[1] - len * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(b[0] - len * Math.cos(angle + Math.PI / 7), b[1] - len * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

function redraw() {
  clearCanvas()
  const arr = props.ops || []
  for (let i = 0; i < arr.length; i++) drawOp(arr[i])
  drawn = arr.length
}

/**
 * 增量绘制：正常收到新笔迹时只画新增的那几条；
 * 撤销（数组变短）或清屏时退回全量重绘。
 */
watch(
  () => props.ops,
  (list) => {
    if (!ctx) return
    const arr = list || []
    if (arr.length < drawn) {
      redraw()
      return
    }
    if (arr.length === drawn) return
    for (let i = drawn; i < arr.length; i++) drawOp(arr[i])
    drawn = arr.length
  }
)

/** 同一条笔迹追加了点：长度没变，必须整体重绘 */
watch(
  () => props.rev,
  () => {
    if (ctx) redraw()
  }
)

onMounted(() => {
  setupCanvas()
  const host = canvasRef.value?.parentElement
  if (host && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      // 尺寸变化必须全量重绘：像素坐标全变了
      setupCanvas()
    })
    ro.observe(host)
  }
})

onUnmounted(() => {
  if (ro) {
    ro.disconnect()
    ro = null
  }
  ctx = null
})

defineExpose({ redraw })
</script>

<template>
  <canvas ref="canvasRef" class="board-layer" aria-label="课堂批注画布（只读）" />
</template>

<style scoped>
.board-layer {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 学生端只读，不能拦住下方课件的滚动/选择 */
  z-index: 2;
}
</style>
