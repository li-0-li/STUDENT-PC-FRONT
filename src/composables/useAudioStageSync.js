/**
 * 学生端同步状态共享（Vue 响应式封装），供 Live.vue / SyncStatusBar 共用同一份状态。
 * 底层实现见 utils/classroomTimeline.js（框架无关）。
 */
import { ref } from 'vue'
import timeline from '@/utils/classroomTimeline'

const state = ref(timeline.getState())
const pulse = ref(0)
const lastMarker = ref(null)
let inited = false

function init() {
  if (inited) return
  inited = true
  timeline.subscribe((s) => { state.value = s })
  timeline.onPulse(({ marker, driftMs }) => {
    pulse.value += 1
    lastMarker.value = {
      action: marker?.action || '',
      driftMs: Math.round(driftMs || 0),
      timeSec: Number(marker?.timeSec) || 0
    }
  })
}

export function useAudioStageSync() {
  init()
  return { state, pulse, lastMarker }
}

export default useAudioStageSync
