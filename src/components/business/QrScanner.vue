<script setup>
/**
 * 二维码扫描（摄像头）
 *
 * 对应《三级功能清单》· 我学的课 → 添加/退出课程 → 课程代码 / **二维码**加入课程。
 * 此前只有手输 6 位课程码，没有扫码入口。
 *
 * 实现：getUserMedia 取摄像头 → 逐帧交给 jsQR 解码 → 命中后回调并关闭。
 * 注意：摄像头属 secure-context 能力，必须 https 或 localhost 才可用
 * （生产部署走 HTTPS，见 `交付文档/同域部署-*.md`）。
 */
import { ref, watch, onUnmounted, nextTick } from 'vue'
import jsQR from 'jsqr'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'detected'])

const videoRef = ref(null)
const canvasRef = ref(null)
const errorText = ref('')
const starting = ref(false)
const hint = ref('将摄像头对准课程二维码')

let stream = null
let rafId = 0
let stopped = false

function stopCamera() {
  stopped = true
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
}

function close() {
  stopCamera()
  emit('update:modelValue', false)
}

/** 从扫码结果里取出课程码：支持纯文本码，也支持带参数的链接 */
function extractCode(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  // 6 位大写字母+数字（与手输规则一致）
  const direct = text.match(/^[A-Z0-9]{6}$/)
  if (direct) return direct[0]
  // 形如 https://xxx/courses?code=NK463D 或 student/#/courses/add?code=NK463D
  const byQuery = text.match(/[?&](?:code|courseCode|c)=([A-Za-z0-9]{6})/)
  if (byQuery) return byQuery[1].toUpperCase()
  // 兜底：文本中任意独立的 6 位大写码
  const loose = text.match(/\b([A-Z0-9]{6})\b/)
  return loose ? loose[1] : ''
}

function tick() {
  if (stopped) return
  const video = videoRef.value
  const canvas = canvasRef.value
  if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
    const w = video.videoWidth
    const h = video.videoHeight
    if (w && h) {
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)
      const image = ctx.getImageData(0, 0, w, h)
      try {
        const result = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
        if (result?.data) {
          const code = extractCode(result.data)
          if (code) {
            hint.value = `识别到课程码：${code}`
            emit('detected', code)
            close()
            return
          }
          hint.value = '二维码内容不是有效课程码，请对准课程二维码'
        }
      } catch {
        // 单帧解码失败忽略，继续下一帧
      }
    }
  }
  rafId = requestAnimationFrame(tick)
}

async function startCamera() {
  errorText.value = ''
  hint.value = '正在启动摄像头…'
  if (!navigator.mediaDevices?.getUserMedia) {
    errorText.value = '当前环境不支持摄像头（需 HTTPS 或 localhost）'
    return
  }
  starting.value = true
  stopped = false
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })
    await nextTick()
    const video = videoRef.value
    if (!video) return
    video.srcObject = stream
    await video.play().catch(() => {})
    hint.value = '将摄像头对准课程二维码'
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(tick)
  } catch (e) {
    const name = e?.name || ''
    errorText.value =
      name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请在浏览器地址栏允许后重试'
        : name === 'NotFoundError'
          ? '未检测到可用摄像头'
          : `摄像头启动失败：${e?.message || e}`
  } finally {
    starting.value = false
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) startCamera()
    else stopCamera()
  }
)

onUnmounted(stopCamera)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="扫码加入课程"
    width="420px"
    :close-on-click-modal="false"
    @update:model-value="(v) => (v ? null : close())"
  >
    <div class="scan-wrap">
      <div class="scan-box">
        <video ref="videoRef" class="scan-video" muted playsinline />
        <div class="scan-frame" />
        <canvas ref="canvasRef" class="scan-canvas" />
      </div>
      <div v-if="errorText" class="scan-err">{{ errorText }}</div>
      <div v-else class="scan-hint">{{ hint }}</div>
      <div class="scan-tip">
        课程码也可手动输入。摄像头需在 HTTPS 或 localhost 下可用。
      </div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
      <el-button type="primary" :loading="starting" @click="startCamera">重新识别</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.scan-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.scan-box {
  position: relative;
  width: 320px;
  height: 240px;
  border-radius: 10px;
  overflow: hidden;
  background: #111827;
}
.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scan-canvas {
  display: none;
}
.scan-frame {
  position: absolute;
  inset: 24px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(17, 24, 39, 0.35);
  pointer-events: none;
}
.scan-hint {
  font-size: 13px;
  color: var(--ink-600, #4b5563);
}
.scan-err {
  font-size: 13px;
  color: var(--error, #dc2626);
}
.scan-tip {
  font-size: 11px;
  color: var(--ink-400, #9ca3af);
  text-align: center;
}
</style>
