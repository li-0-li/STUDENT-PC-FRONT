<script setup>
/**
 * 课堂音频条（学生端，LiveKit 纯音频）
 *
 * 只负责展示与交互，音频连接由 `useLiveAudioRoom` 负责：
 *   · 连接状态 / 说话人 / 在线人数；
 *   · 浏览器拦截自动播放时给出「点击开启声音」；
 *   · 允许发言时提供开麦 / 闭麦按钮；
 *   · 音量滑杆只调输出音量，不改采集端 AGC。
 */
import { ref, computed } from 'vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

const props = defineProps({
  /** idle | connecting | connected | reconnecting | disabled | error */
  state: { type: String, default: 'idle' },
  micEnabled: { type: Boolean, default: false },
  canPublish: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false },
  speaking: { type: Boolean, default: false },
  participants: { type: Array, default: () => [] },
  network: { type: Object, default: () => ({ level: 'good' }) },
  errorText: { type: String, default: '' },
  volume: { type: Number, default: 80 }
})

defineEmits(['resume', 'toggle-mic', 'retry', 'update:volume'])

const expanded = ref(false)

const participantCount = computed(() => props.participants.filter((p) => !p.isLocal).length)

const iconName = computed(() => {
  if (props.state === 'disabled') return 'volume-x'
  if (props.state === 'error') return 'alert-triangle'
  if (props.speaking) return props.micEnabled ? 'mic' : 'mic'
  if (props.micEnabled) return 'mic'
  return 'mic-off'
})

const tone = computed(() => {
  if (props.state === 'disabled' || props.state === 'error') return 'muted'
  if (props.speaking) return 'live'
  if (props.state === 'connected') return 'on'
  return ''
})

const statusText = computed(() => {
  if (props.state === 'disabled') return props.errorText || '课堂音频未启用'
  if (props.state === 'error') return props.errorText || '课堂音频连接失败'
  if (props.state === 'connecting') return '音频连接中…'
  if (props.state === 'reconnecting') return '网络波动，正在重连音频…'
  if (props.blocked) return '浏览器已拦截自动播放'
  if (props.speaking) return props.micEnabled ? '正在发言' : '有人正在讲话'
  if (props.state === 'connected') return props.micEnabled ? '麦克风已开启' : '课堂音频已连接'
  return '等待音频连接'
})
</script>

<template>
  <div class="audio-bar" :class="tone">
    <div class="ab-left">
      <span class="ab-icon" :class="{ pulse: speaking }">
        <BaseIcon :name="iconName" :size="15" />
      </span>
      <span class="ab-text">{{ statusText }}</span>

      <!-- 声波：仅在真正有声时显示，纯装饰 -->
      <span v-if="speaking" class="ab-wave"><i /><i /><i /></span>
      <span v-if="participantCount > 0" class="ab-meta">
        <BaseIcon name="users" :size="12" />{{ participantCount }}
      </span>
      <span
        v-if="network && network.level && network.level !== 'good'"
        class="ab-net"
        :class="network.level"
        :title="`抖动 ${network.jitterMs || 0}ms · 丢包 ${Math.round((network.lossRate || 0) * 100)}%`"
      >
        {{ network.level === 'poor' ? '网络较差' : '网络一般' }}
      </span>
    </div>

    <div class="ab-right">
      <button v-if="blocked" class="ab-action primary" @click="$emit('resume')">
        <BaseIcon name="volume-2" :size="14" />点击开启声音
      </button>

      <button
        v-if="canPublish && state === 'connected'"
        class="ab-action"
        :class="{ 'mic-on': micEnabled }"
        @click="$emit('toggle-mic')"
      >
        <BaseIcon :name="micEnabled ? 'mic-off' : 'mic'" :size="14" />
        {{ micEnabled ? '闭麦' : '开麦' }}
      </button>

      <button v-if="state === 'error'" class="ab-action" @click="$emit('retry')">
        <BaseIcon name="refresh-cw" :size="14" />重试
      </button>

      <button class="ab-vol-btn" :title="expanded ? '收起音量' : '调节音量'" @click="expanded = !expanded">
        <BaseIcon name="volume-2" :size="15" />
      </button>

      <div v-if="expanded" class="ab-vol">
        <input
          :value="volume"
          type="range"
          min="0"
          max="100"
          step="1"
          @input="$emit('update:volume', Number($event.target.value))"
        />
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

.audio-bar.on {
  border-color: rgba(47, 107, 255, 0.22);
}

.audio-bar.live {
  border-color: rgba(13, 148, 136, 0.35);
  background: linear-gradient(90deg, rgba(13, 148, 136, 0.08), #fff 55%);
}

.audio-bar.muted {
  background: #f8fafc;
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
.audio-bar.on .ab-icon,
.audio-bar.live .ab-icon {
  color: #0d9488;
  background: rgba(13, 148, 136, 0.12);
}
.audio-bar.muted .ab-icon {
  color: #b6bec9;
}
.ab-icon.pulse {
  animation: ab-pulse 1.8s infinite;
}
@keyframes ab-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(13, 148, 136, 0.3);
  }
  60% {
    box-shadow: 0 0 0 7px rgba(13, 148, 136, 0);
  }
}
.ab-text {
  font-size: 13px;
  color: #4b5563;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ab-meta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 11.5px;
  color: #9aa3b2;
}
.ab-net {
  flex: none;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
}
.ab-net.poor {
  background: #fee2e2;
  color: #b91c1c;
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
  background: #0d9488;
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
.ab-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid #dbe1ea;
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
}
.ab-action:hover {
  border-color: #0d9488;
  color: #0d9488;
}
.ab-action.primary {
  border-color: transparent;
  background: #0d9488;
  color: #fff;
}
.ab-action.primary:hover {
  background: #0f766e;
  color: #fff;
}
.ab-action.mic-on {
  border-color: rgba(13, 148, 136, 0.4);
  background: rgba(13, 148, 136, 0.1);
  color: #0d9488;
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
  accent-color: #0d9488;
}
.ab-vol-num {
  width: 22px;
  font-size: 12px;
  color: #9aa3b2;
  text-align: right;
}
</style>
