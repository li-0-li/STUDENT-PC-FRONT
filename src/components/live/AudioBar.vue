<script setup>
/**
 * 课堂音频条 ★ 2026-11-09
 *
 * 只负责「出声」这一件事：
 *   · 绑定 LiveKit 音频流到 <audio>；
 *   · 浏览器拦截自动播放时，给一个明确的「点击开启声音」按钮；
 *   · 显示老师是否开麦 / 是否静音，避免学生把"没声音"误判成功能坏了。
 */
import { ref, watch, onMounted } from 'vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

const props = defineProps({
  stream: { type: Object, default: null },
  /** idle | connecting | live */
  state: { type: String, default: 'idle' },
  teacherMuted: { type: Boolean, default: false },
  /** 被浏览器拦下自动播放 */
  blocked: { type: Boolean, default: false },
  errorText: { type: String, default: '' }
})

const emit = defineEmits(['resume'])

const audioRef = ref(null)
const volume = ref(80)
const expanded = ref(false)

function bindStream(s) {
  const el = audioRef.value
  if (!el) return
  el.srcObject = s || null
  if (s) {
    el.play().catch(() => {
      // 被拦截由父组件 blocked 状态驱动提示
    })
  }
}

watch(() => props.stream, bindStream)

watch(volume, (v) => {
  if (audioRef.value) audioRef.value.volume = Math.max(0, Math.min(1, v / 100))
})

onMounted(() => {
  if (audioRef.value) audioRef.value.volume = volume.value / 100
  bindStream(props.stream)
})

const statusText = () => {
  if (props.errorText) return '音频不可用'
  if (props.state === 'connecting') return '音频连接中…'
  if (props.state === 'live' && props.teacherMuted) return '老师已静音'
  if (props.state === 'live') return '正在听老师讲课'
  return '等待老师开麦'
}
</script>

<template>
  <div class="audio-bar" :class="{ live: state === 'live' && !teacherMuted }">
    <audio ref="audioRef" playsinline />

    <div class="ab-left">
      <span class="ab-icon" :class="{ pulse: state === 'live' && !teacherMuted }">
        <BaseIcon :name="teacherMuted || state !== 'live' ? 'mic-off' : 'mic'" :size="15" />
      </span>
      <span class="ab-text">{{ statusText() }}</span>

      <!-- 声波：仅在真正有声时显示，纯装饰 -->
      <span v-if="state === 'live' && !teacherMuted" class="ab-wave">
        <i /><i /><i />
      </span>
    </div>

    <div class="ab-right">
      <button v-if="blocked" class="ab-resume" @click="emit('resume')">
        <BaseIcon name="volume-2" :size="14" />点击开启声音
      </button>

      <button
        v-if="!blocked"
        class="ab-vol-btn"
        :title="expanded ? '收起音量' : '调节音量'"
        @click="expanded = !expanded"
      >
        <BaseIcon name="volume-2" :size="15" />
      </button>

      <div v-if="expanded && !blocked" class="ab-vol">
        <input v-model.number="volume" type="range" min="0" max="100" step="1" />
        <span class="ab-vol-num">{{ volume }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audio-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e8ecf2;
}

.audio-bar.live {
  border-color: rgba(47, 107, 255, 0.28);
  background: linear-gradient(90deg, rgba(47, 107, 255, 0.06), #fff 55%);
}

.ab-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #9aa3b2;
  background: #f2f4f8;
  flex: none;
}
.audio-bar.live .ab-icon {
  color: #2f6bff;
  background: rgba(47, 107, 255, 0.1);
}
.ab-icon.pulse {
  animation: ab-pulse 2s infinite;
}
@keyframes ab-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(47, 107, 255, 0.28);
  }
  60% {
    box-shadow: 0 0 0 7px rgba(47, 107, 255, 0);
  }
}
.ab-text {
  font-size: 13px;
  color: #4b5563;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ab-wave {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}
.ab-wave i {
  width: 2px;
  border-radius: 2px;
  background: #2f6bff;
  animation: ab-wave 900ms infinite ease-in-out;
}
.ab-wave i:nth-child(1) {
  height: 6px;
  animation-delay: 0ms;
}
.ab-wave i:nth-child(2) {
  height: 12px;
  animation-delay: 150ms;
}
.ab-wave i:nth-child(3) {
  height: 8px;
  animation-delay: 300ms;
}
@keyframes ab-wave {
  0%,
  100% {
    transform: scaleY(0.5);
  }
  50% {
    transform: scaleY(1);
  }
}

.ab-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.ab-resume {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  background: #2f6bff;
  cursor: pointer;
}
.ab-resume:hover {
  background: #2559d8;
}
.ab-vol-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  color: #6b7280;
  background: transparent;
  cursor: pointer;
}
.ab-vol-btn:hover {
  background: #f2f4f8;
}
.ab-vol {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ab-vol input[type='range'] {
  width: 88px;
  accent-color: #2f6bff;
}
.ab-vol-num {
  width: 22px;
  font-size: 12px;
  color: #9aa3b2;
  text-align: right;
}
</style>
