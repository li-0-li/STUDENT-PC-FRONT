<script setup>
/**
 * 课堂舞台 ★ 2026-11-09
 *
 * 结构（自下而上）：
 *   ① 课件层（SlideViewer，PDF 自绘 canvas / 图片 / 视频）
 *   ② 白板层（BoardLayer，透明 canvas，只读）
 *   ③ HUD（页码、模式、跟随提示）
 *
 * ★ 舞台比例固定 **7:5** —— 与教师端 `PptStage.vue` 的 `aspect-ratio: 7/5` 完全一致。
 *   这是「笔迹对齐」的物理前提：教师端把笔迹换算成相对自己演示区的 0~1 坐标，
 *   两端比例只要不一致，同一组坐标落点就一定不同（1920 与 1366 只是缩放，比例才是根因）。
 *   教师端若改比例，这里必须同步改。
 */
import { computed } from 'vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import SlideViewer from './SlideViewer.vue'
import BoardLayer from './BoardLayer.vue'

const props = defineProps({
  /** slide 展示课件 / blank 空白画盘 / none 未展示 */
  mode: { type: String, default: 'none' },
  url: { type: String, default: '' },
  fileName: { type: String, default: '' },
  pageNo: { type: Number, default: 1 },
  pageCount: { type: Number, default: 0 },
  timeSec: { type: Number, default: 0 },
  /** P1 播放同步 */
  playing: { type: Boolean, default: false },
  playbackRate: { type: Number, default: 1 },
  serverTimeMs: { type: Number, default: 0 },
  clockOffset: { type: Number, default: 0 },
  ops: { type: Array, default: () => [] },
  /** 笔迹版本号（同一条笔迹追加点时用于触发重绘） */
  rev: { type: Number, default: 0 },
  /** 是否显示页码等 HUD（全屏时隐藏） */
  showHud: { type: Boolean, default: true }
})

const hasSlide = computed(() => props.mode === 'slide' && !!props.url)
const modeLabel = computed(() => {
  if (props.mode === 'blank') return '白板'
  if (props.mode === 'slide') return '课件'
  return '未展示'
})
</script>

<template>
  <div class="stage-wrap">
    <div class="stage">
      <!-- ① 课件层 -->
      <SlideViewer
        v-if="hasSlide"
        :url="url"
        :file-name="fileName"
        :page-no="pageNo"
        :time-sec="timeSec"
        :playing="playing"
        :playback-rate="playbackRate"
        :server-time-ms="serverTimeMs"
        :clock-offset="clockOffset"
      />

      <!-- 空白画盘：白底，供老师板书 -->
      <div v-else-if="mode === 'blank'" class="stage-blank">
        <span class="blank-hint">白板模式 · 老师正在板书</span>
      </div>

      <!-- 未展示 -->
      <div v-else class="stage-empty">
        <BaseIcon name="presentation" :size="34" />
        <p class="se-title">老师暂未展示内容</p>
        <p class="se-desc">课件或白板出现时会自动同步到这里</p>
      </div>

      <!-- ② 白板层（透明，叠在最上面） -->
      <BoardLayer :ops="ops" :mode="mode" :rev="rev" />

      <!-- ③ HUD -->
      <div v-if="showHud" class="stage-hud">
        <span class="hud-chip">{{ modeLabel }}</span>
        <span v-if="mode === 'slide' && pageCount > 0" class="hud-chip">
          {{ pageNo }} / {{ pageCount }}
        </span>
        <span v-if="mode === 'slide'" class="hud-chip ghost">
          <i class="follow-dot" />跟随老师
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.stage {
  position: relative;
  width: 100%;
  /* ★ 2026-11-11 自适应缩放（等比，不裁切）：
   *   保持 7:5 比例（笔迹对齐的物理前提），但用 min() 双向约束宽高，
   *   让舞台在任意屏幕尺寸/宽高比下都完整落入可视区，溢出时整体等比缩小、居中显示。
   *   - 宽度：不超过容器（100%）
   *   - 高度：不超过「视口高度 - 页面其他区域」(用 dvh 消除地址栏误差)
   *   全屏时由父级 .stage-box:fullscreen 把 stage-wrap 撑满视口，
   *   这里的高度上限会自然换成整个屏幕，舞台即可铺满且不溢出。
   */
  max-width: min(100%, calc((100dvh - 250px) * 7 / 5));
  max-height: calc(100dvh - 250px);
  aspect-ratio: 7 / 5;
  border-radius: 14px;
  overflow: hidden;
  background: #eef1f6;
  box-shadow: 0 10px 30px rgba(20, 30, 60, 0.1);
}

.stage-blank {
  position: absolute;
  inset: 0;
  background: #fff;
  display: flex;
  align-items: flex-end;
  /* 右下角：左下角留给 HUD，避免两块文字重叠 */
  justify-content: flex-end;
  padding: 14px 18px;
}
.blank-hint {
  font-size: 12px;
  color: #9aa3b2;
  letter-spacing: 0.02em;
}

.stage-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #9aa3b2;
  background: linear-gradient(160deg, #f7f9fc 0%, #eef1f6 100%);
}
.se-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #6b7280;
}
.se-desc {
  margin: 0;
  font-size: 12.5px;
}

.stage-hud {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: flex;
  gap: 8px;
  z-index: 3;
  pointer-events: none;
}
.hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #374151;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 2px 10px rgba(20, 30, 60, 0.12);
  backdrop-filter: blur(6px);
}
.hud-chip.ghost {
  color: #2f6bff;
  background: rgba(47, 107, 255, 0.1);
  box-shadow: none;
}
.follow-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2f6bff;
  animation: follow-blink 1.6s infinite;
}
@keyframes follow-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
