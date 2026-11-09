<script setup>
/**
 * 课件「本地预览」弹窗 ★ 2026-11-09
 *
 * 需求：右栏「本节课件」里的课件学生能点开看，但**主舞台必须继续跟随老师**。
 * 所以做成覆盖层：只在弹窗内渲染学生自己点的那一份，完全不动 Live.vue 的 stage。
 *
 * 复用 SlideViewer，但用 `fit="contain"`（整页可见）——
 * 主舞台按宽铺满是为了和老师笔迹逐点对位；学生自己翻看时，一眼看全一页更重要。
 */
import { ref, computed, watch } from 'vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import SlideViewer from '@/components/live/SlideViewer.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 课件对象：{ resourceId, fileName, fileType, previewUrl, pageCount } */
  slide: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const pageNo = ref(1)
const totalPages = ref(0)

const fileName = computed(() => props.slide?.fileName || '课件预览')
const previewUrl = computed(() => props.slide?.previewUrl || '')

/** 每次打开都回到第 1 页；pageCount 有就用，没有等 PDF 真正加载完再从文档读 */
watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    pageNo.value = 1
    totalPages.value = Number(props.slide?.pageCount) || 0
  }
)

function onLoaded({ totalPages: n }) {
  totalPages.value = Number(n) || 0
}

/** 真·新页面：部分浏览器对 PDF 内嵌预览更好（也能直接下载） */
function openInNewTab() {
  if (!previewUrl.value) return
  window.open(previewUrl.value, '_blank', 'noopener')
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="min(1000px, 86%)"
    top="4vh"
    append-to-body
    destroy-on-close
    class="peek-dialog"
  >
    <template #header>
      <div class="peek-head">
        <div class="peek-title" :title="fileName">{{ fileName }}</div>
        <span class="peek-badge">仅本机预览 · 主屏仍跟随老师</span>
      </div>
    </template>

    <div class="peek-stage">
      <SlideViewer
        v-if="visible && previewUrl"
        :url="previewUrl"
        :file-name="fileName"
        :page-no="pageNo"
        fit="contain"
        @loaded="onLoaded"
      />
      <div v-else class="peek-empty">该课件暂无预览地址</div>
    </div>

    <template #footer>
      <div class="peek-foot">
        <div v-if="totalPages > 1" class="peek-pager">
          <el-button size="small" :disabled="pageNo <= 1" @click="pageNo -= 1">
            <BaseIcon name="chevron-left" :size="14" />上一页
          </el-button>
          <span class="peek-page-no">{{ pageNo }} / {{ totalPages }}</span>
          <el-button size="small" :disabled="pageNo >= totalPages" @click="pageNo += 1">
            下一页<BaseIcon name="chevron-right" :size="14" />
          </el-button>
        </div>
        <span v-else class="peek-hint">预览不影响主屏，老师切换课件时主屏照常同步</span>

        <div class="peek-acts">
          <el-button size="small" :disabled="!previewUrl" @click="openInNewTab">
            <BaseIcon name="external-link" :size="13" />新标签页打开
          </el-button>
          <el-button size="small" type="primary" @click="visible = false">关闭</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* el-dialog 被 teleport 到 body，根节点不带 scope id，只能用 :global 微调留白 */
:global(.peek-dialog .el-dialog__body) {
  padding: 6px 18px 8px;
}
:global(.peek-dialog .el-dialog__header) {
  padding-bottom: 6px;
}
:global(.peek-dialog .el-dialog__footer) {
  padding-top: 8px;
}

.peek-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.peek-title {
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peek-badge {
  flex: none;
  font-size: 11.5px;
  color: #6b7280;
  background: #f3f5f9;
  border-radius: 999px;
  padding: 3px 10px;
}

.peek-stage {
  position: relative;
  /* 跟着视口走，比固定 vh 能多榨出高度：竖版 PDF 在 contain 模式下受高度限制，
     多 70px 高度就意味着页面宽 50px，看小字差别明显 */
  height: calc(100vh - 250px);
  border-radius: 10px;
  overflow: hidden;
  background: #eef0f4;
}
.peek-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #9ca3af;
}

.peek-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.peek-pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
.peek-page-no {
  font-size: 12.5px;
  color: #4b5563;
  min-width: 62px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.peek-hint {
  font-size: 12px;
  color: #9ca3af;
}
.peek-acts {
  display: flex;
  align-items: center;
  gap: 8px;
}
.peek-acts :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.peek-pager :deep(.el-button) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
