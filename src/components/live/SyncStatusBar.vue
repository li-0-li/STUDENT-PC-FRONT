<script setup>
/**
 * 学生端同步状态反馈：把课堂时间轴的状态、误差与手动微调暴露给用户。
 * 阈值来自 deploy/local-audio/audio-thresholds.json 的 sync 段（经 useAudioStageSync 下发）。
 */
import { ref, computed, watch } from 'vue'
import { useAudioStageSync } from '@/composables/useAudioStageSync'
import timeline from '@/utils/classroomTimeline'

const { state, lastMarker } = useAudioStageSync()
const manual = ref(state.value.manualOffsetMs)
watch(() => state.value.manualOffsetMs, (v) => { manual.value = v })

const stateText = computed(() => ({
  uncalibrated: '未校准', calibrating: '校准中', synced: '已同步',
  buffering: '缓冲中断', drifting: '漂移中', degraded: '降级中', offline: '未连接'
}[state.value.syncState] || state.value.syncState))

const stateClass = computed(() => ({
  synced: 'ok', drifting: 'warn', degraded: 'warn', buffering: 'warn', calibrating: 'info',
  uncalibrated: 'info', offline: 'info'
}[state.value.syncState] || 'info'))

function onTune(e) { timeline.setManualOffset(Number(e.target.value)) }
function reset() { timeline.resetManualOffset() }
function recalibrate() { timeline.recalibrate() }
</script>

<template>
  <div class="sync-bar">
    <div class="sync-head">
      <span class="sync-title">语音 / 课件同步</span>
      <span class="sync-state" :class="stateClass">{{ stateText }}</span>
    </div>

    <div class="sync-metrics">
      <span>偏差 <b :class="{ bad: Math.abs(state.driftMs) > state.thresholds.driftWarn }">{{ state.driftMs }}ms</b></span>
      <span>时钟 <b>{{ state.clockSkewMs == null ? '—' : state.clockSkewMs + 'ms' }}</b></span>
      <span>输出 <b>{{ state.audioLatencyMs }}ms</b></span>
      <span>待生效 <b>{{ state.pendingMarkers }}</b></span>
      <span>队列 <b>{{ state.audioFrozen ? '冻结' : state.pausedByPlayback ? '暂停' : '跟进' }}</b></span>
    </div>

    <div v-if="state.reason" class="sync-reason">{{ state.reason }}</div>
    <div v-else-if="state.syncState === 'buffering'" class="sync-reason">
      音频缓冲中断，画面暂停跟进；恢复后按原时间轴继续。
    </div>
    <div v-else-if="lastMarker" class="sync-last">
      最近标记：{{ lastMarker.action }} · 偏差 {{ lastMarker.driftMs }}ms
    </div>

    <div class="sync-tune">
      <label for="sync-offset">手动微调</label>
      <input
        id="sync-offset"
        type="range"
        :min="-500"
        :max="500"
        :step="10"
        :value="manual"
        @input="onTune"
      />
      <span class="sync-value">{{ state.manualOffsetMs }}ms</span>
    </div>

    <div class="sync-actions">
      <button type="button" @click="recalibrate">重新校准</button>
      <button type="button" @click="reset">重置微调</button>
      <span class="sync-tip">良好 ≤{{ state.thresholds.driftGood }}ms · 警告 ≤{{ state.thresholds.driftWarn }}ms</span>
    </div>
  </div>
</template>

<style scoped>
.sync-bar {
  margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border, #e3eaec);
  border-radius: 10px; background: #fff; font-size: 12px; color: var(--ink-500, #475569);
}
.sync-head { display: flex; align-items: center; justify-content: space-between; }
.sync-title { font-weight: 700; color: var(--ink-900, #0f172a); font-size: 13px; }
.sync-state { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.sync-state.ok { background: #dcfce7; color: #15803d; }
.sync-state.warn { background: #fef3c7; color: #b45309; }
.sync-state.info { background: #e2e8f0; color: #475569; }
.sync-metrics { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
.sync-metrics b { color: var(--ink-900, #0f172a); font-weight: 700; }
.sync-metrics b.bad { color: #dc2626; }
.sync-reason, .sync-last { margin-top: 6px; line-height: 1.5; color: #b45309; }
.sync-last { color: var(--ink-400, #94a3b8); }
.sync-tune { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.sync-tune input { flex: 1; accent-color: #0d9488; cursor: pointer; }
.sync-tune label { white-space: nowrap; }
.sync-value { min-width: 52px; text-align: right; font-variant-numeric: tabular-nums; }
.sync-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.sync-actions button {
  border: 1px solid var(--border, #e3eaec); background: #fff; color: #0f766e;
  border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; transition: .15s;
}
.sync-actions button:hover { border-color: #0d9488; background: #effefb; }
.sync-tip { margin-left: auto; color: var(--ink-400, #94a3b8); }
</style>
