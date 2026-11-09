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
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
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
  /**
   * 排版方式：
   *   width   —— 按宽铺满、顶部对齐（**舞台用**，与教师端 iframe 的 `view=FitH` 完全一致，
   *              两端页面矩形重合，笔迹才能逐点对齐）
   *   contain —— 整页可见、居中（**预览弹窗用**：学生自己看时不需要对齐笔迹，
   *              能看到完整一页比铺满更重要）
   */
  fit: { type: String, default: 'width' }
})

/** 文档加载完成时抛出总页数，供外层（预览弹窗）翻页；其它格式不发 */
const emit = defineEmits(['loaded'])

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
  loadedUrl = ''
}

async function renderPdf() {
  const wrap = wrapRef.value
  const canvas = canvasRef.value
  if (!wrap || !canvas || !props.url) return

  loading.value = true
  errorText.value = ''
  try {
    if (loadedUrl !== props.url) {
      await destroyDoc()
      const pdfjsLib = await loadPdfjs()
      loadingTask = pdfjsLib.getDocument({ url: props.url, withCredentials: false })
      doc = await loadingTask.promise
      loadedUrl = props.url
      emit('loaded', { totalPages: doc.numPages || 1 })
    }
    if (!doc) return

    const total = doc.numPages || 1
    const n = Math.min(Math.max(1, props.pageNo || 1), total)
    const page = await doc.getPage(n)

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
    renderTask = page.render({ canvasContext: ctx, viewport: vp })
    await renderTask.promise
    renderTask = null
  } catch (e) {
    // 渲染被取消（快速翻页）属正常流程，不提示
    if (e?.name === 'RenderingCancelledException') return
    errorText.value = `课件加载失败：${e?.message || e}`
  } finally {
    loading.value = false
  }
}

/* ---------------- 视频对齐 ---------------- */

function syncVideo() {
  const v = videoRef.value
  if (!v || !Number.isFinite(props.timeSec)) return
  const target = Math.max(0, props.timeSec)
  // 差值超过 2 秒才 seek，避免每次广播都打断播放
  if (Math.abs(v.currentTime - target) > 2) v.currentTime = target
}

/* ---------------- 生命周期 ---------------- */

async function refresh() {
  if (kind() === 'pdf') {
    await nextTick()
    await renderPdf()
  }
}

watch(() => props.url, async () => {
  errorText.value = ''
  await destroyDoc()
  await refresh()
})

watch(() => props.pageNo, async () => {
  if (kind() === 'pdf') await renderPdf()
})

watch(() => props.timeSec, () => {
  if (kind() === 'video') syncVideo()
})

onMounted(async () => {
  await refresh()
  const wrap = wrapRef.value
  if (wrap && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (kind() === 'pdf') renderPdf()
    })
    ro.observe(wrap)
  }
})

onUnmounted(async () => {
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
      playsinline
      @loadedmetadata="syncVideo"
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
