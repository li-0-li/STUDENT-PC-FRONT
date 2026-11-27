<script setup>
/**
 * 课件渲染器（PPT 同步的展示端）★ 2026-11-09
 *
 * 支持四类：
 *   pdf   → pdf.js 渲染到 canvas，**唯一能按页精确定位的格式**
 *   image → 直接 <img>（单页）
 *   video → <video>，按 timeSec 对齐播放进度
 *   其他  → 明确提示「请老师上传 PDF 版课件」
 *
 * ★ 为什么不复用 `views/shared/ResourcePreview.vue`：
 *   它用 `<iframe src=pdf>` 预览，拿不到页码控制，无法跟随教师翻页，
 *   也无法保证「画布与页面严格同尺寸」。这里自绘 canvas 才能做到。
 *
 * ★ 尺寸约定：舞台与教师端演示屏同为 **7:5**（由 StageCanvas 保证）。
 *   PDF 按「宽度铺满、顶部对齐」渲染 —— 与教师端 iframe 的 `view=FitH` 完全一致，
 *   两端的页面矩形重合，笔迹才能逐点对齐（居中 contain 会引入上下留白差）。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

/**
 * pdf.js 体积约 400KB，**动态导入**：只有真正展示 PDF 时才加载，
 * 不把课堂页首屏拖到 1MB 以上。
 */
let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([mod, worker]) => {
      mod.GlobalWorkerOptions.workerSrc = worker.default
      return mod
    })
  }
  return pdfjsPromise
}

const props = defineProps({
  /** 预签名地址 */
  url: { type: String, default: '' },
  /** 原始文件名，用于判断格式 */
  fileName: { type: String, default: '' },
  /** 当前页（从 1 开始） */
  pageNo: { type: Number, default: 1 },
  /** 视频同步位置（秒） */
  timeSec: { type: Number, default: 0 },
  /** P1 播放同步：教师端状态、倍速、服务端时间戳与时钟偏移 */
  playing: { type: Boolean, default: false },
  playbackRate: { type: Number, default: 1 },
  serverTimeMs: { type: Number, default: 0 },
  clockOffset: { type: Number, default: 0 },
  /** P2 统一课堂时间轴（服务端 epoch ms）；有值时优先于 serverTimeMs */
  timelineMs: { type: Number, default: 0 },
  /** P2 视频漂移校正阈值（秒），来自 audio-thresholds.json sync.videoDriftMs */
  driftThresholdSec: { type: Number, default: 0.3 },
  /** P2 本地 seek 宽限（毫秒），避免刚拖动就被立刻拉回 */
  seekGraceMs: { type: Number, default: 300 },
  /**
   * 排版方式：
   *   width   —— 按宽铺满、顶部对齐（**舞台用**，与教师端 iframe 的 `view=FitH` 完全一致，
   *              两端页面矩形重合，笔迹才能逐点对齐）
   *   contain —— 整页可见、居中（**预览弹窗用**：学生自己看时不需要对齐笔迹，
   *              能看到完整一页比铺满更重要）
   */
  fit: { type: String, default: 'width' }
})

/** 文档加载完成时抛出总页数；load-error 供外层显示可诊断提示 */
const emit = defineEmits(['loaded', 'load-error'])

const wrapRef = ref(null)
const canvasRef = ref(null)
const videoRef = ref(null)
const loading = ref(false)
const errorText = ref('')

let doc = null
let loadingTask = null
let renderTask = null
let ro = null
let loadedUrl = ''
/** P1：播放中每 500ms 用服务器时钟推算目标位置，把漂移压到配置阈值内 */
let playSyncTimer = null
/** P2：本地拖动进度条后的宽限期，期间不覆盖用户操作 */
let seekGuardUntil = 0
/**
 * PDF 加载串行化：
 *   · docPromise 共享同一 URL 的并发加载，避免 watch(url)+watch(pageNo) 同时 destroy 造成 Loading aborted；
 *   · loadSeq / renderSeq 让旧结果失效；
 *   · retryUrl 对同 URL 的 AbortException 只自动重试一次。
 */
let docPromise = null
let loadingUrl = ''
let loadSeq = 0
let renderSeq = 0
let retryUrl = ''
let renderTimer = null

const ext = () => {
  const n = props.fileName || props.url || ''
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i + 1).toLowerCase() : ''
}

const kind = () => {
  const e = ext()
  if (e === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(e)) return 'image'
  if (['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(e)) return 'video'
  return 'other'
}

/* ---------------- PDF ---------------- */

async function destroyDoc() {
  loadSeq++
  loadingUrl = ''
  retryUrl = ''
  if (renderTask) {
    try {
      renderTask.cancel()
    } catch {
      /* 忽略 */
    }
    renderTask = null
  }
  if (doc) {
    try {
      await doc.destroy()
    } catch {
      /* 忽略 */
    }
    doc = null
  }
  if (loadingTask) {
    try {
      await loadingTask.destroy()
    } catch {
      /* 忽略 */
    }
    loadingTask = null
  }
  docPromise = null
  loadedUrl = ''
}

async function ensureDoc() {
  const url = props.url
  if (!url) return null
  if (doc && loadedUrl === url) return doc
  if (docPromise && loadingUrl === url) return docPromise
  if (loadedUrl && loadedUrl !== url) {
    await destroyDoc()
  }
  if (doc) return doc

  const seq = ++loadSeq
  loadingUrl = url
  const p = (async () => {
    const pdfjsLib = await loadPdfjs()
    if (seq !== loadSeq) return null
    loadingTask = pdfjsLib.getDocument({ url, withCredentials: false })
    const d = await loadingTask.promise
    if (seq !== loadSeq) {
      try { await d.destroy() } catch { /* 已被新加载取代 */ }
      return null
    }
    doc = d
    loadedUrl = url
    emit('loaded', { totalPages: d.numPages || 1 })
    return d
  })()
  docPromise = p
  try {
    return await p
  } finally {
    if (docPromise === p) { docPromise = null }
    if (loadingUrl === url) { loadingUrl = '' }
  }
}

async function renderPdf() {
  const wrap = wrapRef.value
  const canvas = canvasRef.value
  if (!wrap || !canvas || !props.url || kind() !== 'pdf') return

  const seq = ++renderSeq
  loading.value = true
  errorText.value = ''
  try {
    if (loadedUrl !== props.url) {
      await ensureDoc()
      if (seq !== renderSeq) return
    }
    if (!doc) return

    const total = doc.numPages || 1
    const n = Math.min(Math.max(1, props.pageNo || 1), total)
    const page = await doc.getPage(n)
    if (seq !== renderSeq) return

    const rect = wrap.getBoundingClientRect()
    const boxW = Math.max(1, rect.width)
    const boxH = Math.max(1, rect.height)
    const base = page.getViewport({ scale: 1 })
    // 舞台：按宽度铺满（FitH），页面从左上角开始，不做垂直居中
    // 预览：整页装进容器（contain），四面居中
    const scale =
      props.fit === 'contain'
        ? Math.min(boxW / base.width, boxH / base.height)
        : boxW / base.width
    const vp = page.getViewport({ scale })

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(vp.width * dpr)
    canvas.height = Math.round(vp.height * dpr)
    canvas.style.width = `${Math.round(vp.width)}px`
    canvas.style.height = `${Math.round(vp.height)}px`

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vp.width, vp.height)

    if (renderTask) {
      try {
        renderTask.cancel()
      } catch {
        /* 忽略 */
      }
    }
    const task = page.render({ canvasContext: ctx, viewport: vp })
    renderTask = task
    await task.promise
    if (renderTask === task) { renderTask = null }
    if (seq !== renderSeq) return
    retryUrl = ''
  } catch (e) {
    // 渲染被取消（快速翻页）属正常流程，不提示
    if (e?.name === 'RenderingCancelledException') return
    const aborted = e?.name === 'AbortException' || /Loading aborted/i.test(e?.message || '')
    // 同 URL 的加载被并发取消：自动重试一次，避免页面永久停在“加载失败”
    if (aborted && props.url && retryUrl !== props.url && seq === renderSeq) {
      retryUrl = props.url
      setTimeout(() => { if (props.url) renderPdf() }, 150)
      return
    }
    if (seq !== renderSeq) return
    errorText.value = `课件加载失败：${e?.message || e}`
    emit('load-error', errorText.value)
  } finally {
    if (seq === renderSeq) loading.value = false
  }
}

/** url/pageNo 连续变化时合并成一次渲染，避免 watch(url) 与 watch(pageNo) 并发销毁文档 */
function scheduleRender(delay = 40) {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderPdf()
  }, delay)
}

/* ---------------- 视频对齐 ---------------- */

function syncVideo() {
  const v = videoRef.value
  if (!v || kind() !== 'video') return
  const base = Math.max(0, Number(props.timeSec) || 0)
  const rate = Number(props.playbackRate) || 1
  const serverTime = Number(props.timelineMs || props.serverTimeMs) || 0
  const offset = Number(props.clockOffset) || 0
  if (Date.now() < seekGuardUntil) return
  // 播放中按服务端时钟推算当前应在的位置；暂停时直接对齐到教师端位置
  const target = props.playing && serverTime > 0
    ? base + ((Date.now() + offset - serverTime) / 1000) * rate
    : base
  const dest = Math.max(0, target)
  const threshold = Number(props.driftThresholdSec) || 0.3
  if (Math.abs(v.currentTime - dest) > threshold) {
    try { v.currentTime = dest } catch { /* 元数据未就绪 */ }
  }
  if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate
  if (props.playing && v.paused) {
    v.play().catch(() => { /* 浏览器自动播放策略限制，等待用户交互 */ })
  } else if (!props.playing && !v.paused) {
    v.pause()
  }
}

/** 本地拖动进度条：给一个短暂宽限，之后仍回到教师权威进度（学生端等效只读） */
function onLocalSeek() {
  seekGuardUntil = Date.now() + (Number(props.seekGraceMs) || 300)
}

function startPlaySync() {
  if (playSyncTimer) return
  playSyncTimer = setInterval(syncVideo, 500)
}

function stopPlaySync() {
  if (playSyncTimer) {
    clearInterval(playSyncTimer)
    playSyncTimer = null
  }
}

/* ---------------- 生命周期 ---------------- */

watch(() => props.url, () => {
  errorText.value = ''
  retryUrl = ''
  scheduleRender(0)
})

watch(() => props.pageNo, () => {
  if (kind() === 'pdf') scheduleRender(30)
})

watch(
  () => [props.timeSec, props.playing, props.playbackRate, props.serverTimeMs],
  () => { if (kind() === 'video') syncVideo() }
)

watch(() => props.playing, (v) => {
  if (v) startPlaySync()
  else stopPlaySync()
}, { immediate: true })

onMounted(() => {
  if (kind() === 'pdf') scheduleRender(0)
  if (props.playing) startPlaySync()
  const wrap = wrapRef.value
  if (wrap && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (kind() === 'pdf') scheduleRender(120)
    })
    ro.observe(wrap)
  }
})

onUnmounted(async () => {
  stopPlaySync()
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  if (ro) {
    ro.disconnect()
    ro = null
  }
  await destroyDoc()
})
</script>

<template>
  <div ref="wrapRef" class="slide-viewer">
    <!-- PDF：自绘 canvas，可按页定位 -->
    <canvas
      v-show="kind() === 'pdf' && !errorText"
      ref="canvasRef"
      class="sv-canvas"
      :class="{ 'sv-canvas--contain': fit === 'contain' }"
    />

    <!-- 图片：单页 -->
    <img
      v-if="kind() === 'image' && !errorText"
      :src="url"
      :alt="fileName || '课件图片'"
      class="sv-media"
      @error="errorText = '图片加载失败，可能链接已过期'"
    />

    <!-- 视频：按教师进度对齐 -->
    <video
      v-if="kind() === 'video' && !errorText"
      ref="videoRef"
      :src="url"
      class="sv-media"
      controls
      controlslist="nodownload noremoteplayback"
      playsinline
      @loadedmetadata="syncVideo"
      @play="syncVideo"
      @pause="syncVideo"
      @seeked="onLocalSeek"
      @error="errorText = '视频加载失败，可能链接已过期'"
    />

    <!-- 不支持的格式 -->
    <div v-if="kind() === 'other' || errorText" class="sv-fallback">
      <BaseIcon name="file-warning" :size="28" />
      <p class="sv-fb-title">{{ errorText || '该格式暂不支持在线展示' }}</p>
      <p class="sv-fb-desc">
        {{ ext().toUpperCase() || '未知格式' }} 无法在浏览器内按页渲染，
        请老师上传 <b>PDF 版课件</b> 后重新展示。
      </p>
    </div>

    <div v-if="loading" class="sv-loading"><span class="dot" />课件加载中…</div>
  </div>
</template>

<style scoped>
.slide-viewer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f6f8;
  overflow: hidden;
}
.sv-canvas,
.sv-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  box-shadow: 0 2px 16px rgba(20, 30, 60, 0.12);
  background: #fff;
}
.sv-canvas {
  /* 顶部左对齐、按宽铺满：与教师端 PptStage 的 FitH 观感一致 */
  position: absolute;
  left: 0;
  top: 0;
  object-fit: unset;
}
/* 预览弹窗：整页居中（contain 由 JS 计算的 scale 保证不溢出） */
.sv-canvas--contain {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
.sv-fallback {
  text-align: center;
  color: #6b7280;
  padding: 0 40px;
}
.sv-fb-title {
  margin: 12px 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: #374151;
}
.sv-fb-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}
.sv-loading {
  position: absolute;
  right: 14px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 999px;
  padding: 5px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.sv-loading .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand, #2f6bff);
  animation: sv-blink 1s infinite;
}
@keyframes sv-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
