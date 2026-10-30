<script setup>
/**
 * 头像裁剪与压缩
 *
 * 对应《三级功能清单》· 用户空间 → 更换头像 → **头像裁剪与压缩**。
 * 此前 Profile.vue 选了图就直接上传原图（最大 5MB），既没裁剪也没压缩。
 *
 * 实现说明：不引入 cropper 类库（项目未安装，且一个头像框不值得增加依赖），
 * 用原生 canvas 完成：预览区 240×240 固定方框，图片按 cover 铺满，
 * 支持拖拽平移 + 滑块缩放，确认时按可视区域裁成 512×512 JPEG 输出。
 *
 * 用法：
 *   <AvatarCropper v-model="cropVisible" :file="pickedFile" @confirm="onCropped" />
 */
import { ref, watch, computed, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 用户选中的原始图片文件 */
  file: { type: File, default: null }
})
const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

/** 预览框边长（CSS px） */
const BOX = 240
/** 输出边长 */
const OUT = 512
/** 缩放范围 */
const MIN_SCALE = 1
const MAX_SCALE = 3

const imgEl = ref(null)
const objectUrl = ref('')
const naturalW = ref(0)
const naturalH = ref(0)
const userScale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const processing = ref(false)

let dragStart = null

/** cover 基准缩放：短边铺满预览框 */
const baseScale = computed(() => {
  if (!naturalW.value || !naturalH.value) return 1
  return Math.max(BOX / naturalW.value, BOX / naturalH.value)
})

/** 实际显示缩放 */
const displayScale = computed(() => baseScale.value * userScale.value)

/** 图片显示尺寸 */
const drawW = computed(() => naturalW.value * displayScale.value)
const drawH = computed(() => naturalH.value * displayScale.value)

/** 左上角位置 = 居中 + 偏移 */
const left = computed(() => (BOX - drawW.value) / 2 + offsetX.value)
const top = computed(() => (BOX - drawH.value) / 2 + offsetY.value)

/** 把偏移限制在「图片始终盖满预览框」的范围内 */
function clampOffset() {
  const maxX = Math.max(0, (drawW.value - BOX) / 2)
  const maxY = Math.max(0, (drawH.value - BOX) / 2)
  offsetX.value = Math.min(maxX, Math.max(-maxX, offsetX.value))
  offsetY.value = Math.min(maxY, Math.max(-maxY, offsetY.value))
}

function revoke() {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = ''
  }
}

/** 文件变化 → 生成预览 */
watch(
  () => props.file,
  async (f) => {
    revoke()
    userScale.value = 1
    offsetX.value = 0
    offsetY.value = 0
    naturalW.value = 0
    naturalH.value = 0
    if (!f) return
    objectUrl.value = URL.createObjectURL(f)
    await nextTick()
    const img = imgEl.value
    if (img) {
      // 已缓存时 complete 直接为 true
      const onLoad = () => {
        naturalW.value = img.naturalWidth || 0
        naturalH.value = img.naturalHeight || 0
      }
      if (img.complete && img.naturalWidth) onLoad()
      else img.addEventListener('load', onLoad, { once: true })
    }
  },
  { immediate: true }
)

/** 缩放变化后重新夹紧偏移 */
watch(userScale, () => clampOffset())

/* ---------------- 拖拽平移 ---------------- */
function onPointerDown(e) {
  if (!naturalW.value) return
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value }
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)
  e.preventDefault()
}

function onPointerMove(e) {
  if (!dragging.value || !dragStart) return
  offsetX.value = dragStart.ox + (e.clientX - dragStart.x)
  offsetY.value = dragStart.oy + (e.clientY - dragStart.y)
  clampOffset()
}

function onPointerUp() {
  dragging.value = false
  dragStart = null
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
}

onUnmounted(() => {
  onPointerUp()
  revoke()
})

/* ---------------- 输出 ---------------- */
function close() {
  emit('update:modelValue', false)
}

function cancel() {
  emit('cancel')
  close()
}

/** 按可视区域裁 512×512 并压缩为 JPEG */
async function confirm() {
  const img = imgEl.value
  if (!img || !naturalW.value) return
  processing.value = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT, OUT)

    // 预览框左上角对应原图坐标
    const sx = (0 - left.value) / displayScale.value
    const sy = (0 - top.value) / displayScale.value
    const sw = BOX / displayScale.value
    const sh = BOX / displayScale.value

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT, OUT)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) {
      processing.value = false
      return
    }
    const name = (props.file?.name || 'avatar').replace(/\.[^.]+$/, '') + '-512.jpg'
    const out = new File([blob], name, { type: 'image/jpeg' })
    emit('confirm', out)
    close()
  } finally {
    processing.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="裁剪头像"
    width="360px"
    :close-on-click-modal="false"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="crop-wrap">
      <div
        class="crop-box"
        :style="{ width: BOX + 'px', height: BOX + 'px' }"
        @mousedown="onPointerDown"
      >
        <img
          v-if="objectUrl"
          ref="imgEl"
          :src="objectUrl"
          class="crop-img"
          :style="{
            width: drawW + 'px',
            height: drawH + 'px',
            left: left + 'px',
            top: top + 'px',
            cursor: dragging ? 'grabbing' : 'grab'
          }"
          draggable="false"
          alt="待裁剪头像"
        />
        <div v-else class="crop-empty">加载中…</div>
        <!-- 圆形遮罩，直观看到最终头像形状 -->
        <div class="crop-mask" />
      </div>

      <div class="crop-tip">拖动图片调整位置，滑动缩放</div>
      <el-slider
        v-model="userScale"
        :min="MIN_SCALE"
        :max="MAX_SCALE"
        :step="0.05"
        :show-tooltip="false"
        size="small"
      />
      <div class="crop-meta">
        原始 {{ naturalW }}×{{ naturalH }} → 输出 {{ OUT }}×{{ OUT }} JPEG
      </div>
    </div>

    <template #footer>
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" :loading="processing" @click="confirm">确认使用</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.crop-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.crop-box {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: #f3f4f6;
  user-select: none;
}
.crop-img {
  position: absolute;
  max-width: none;
  pointer-events: none;
}
.crop-mask {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  box-shadow: inset 0 0 0 9999px rgba(17, 24, 39, 0.28);
  border: 2px solid #fff;
  pointer-events: none;
}
.crop-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 13px;
}
.crop-tip {
  font-size: 12px;
  color: var(--ink-500, #6b7280);
}
.crop-meta {
  font-size: 11px;
  color: var(--ink-400, #9ca3af);
}
:deep(.el-slider) {
  padding: 0 6px;
  width: 240px;
}
</style>
