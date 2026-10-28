<script setup>
/**
 * 投屏链路自测页（联调工具，非正式功能）
 *
 * 为什么需要它：
 *   教师端还没接入时，无法验证「服务端转发 → WebRTC 协商 → 学生端播放」这条链路是否通畅。
 *   本页用 canvas.captureStream() 生成一路视频流代替 getDisplayMedia() 抓屏 ——
 *   canvas 抓流不受「必须 HTTPS / localhost」的安全上下文限制，http 下也能用，
 *   因此可以在任意环境模拟「共享端」，把教师端的责任缩小到「只差真正抓屏」。
 *
 * 用法（同一台机器开两个标签页）：
 *   标签页 A：打开本页 /student/cast-selftest，填课堂 ID，点「开始模拟共享」
 *   标签页 B：打开 /student/live，投屏区应当出现本页的动画画面
 *   → B 出画面 = 信令转发 + 协商 + 播放全通；教师端只需把 canvas 流换成 getDisplayMedia
 *
 * ★ 本页使用 role='sharer'，是唯一允许发起共享的地方；正式学生页面 Live.vue 恒为 viewer。
 * ★ 演示前若不希望暴露，删掉本文件与 src/router/routes/student.js 中对应路由即可。
 */
import { ref, onUnmounted, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useCastSignaling } from '@/composables/useCastSignaling'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { currentLive } from '@/api/student/live'

const sessionId = ref('')
const previewRef = ref()
const canvasRef = ref()
let timer = null
let stream = null

const {
  localStream,
  sharing,
  castState,
  errorText,
  wsConnected,
  viewers,
  connectedCount,
  selfId,
  startShare,
  stopShare
} = useCastSignaling(() => Number(sessionId.value) || 0, {
  role: 'sharer',
  onEvent(type, payload) {
    if (type === 'answer') ElMessage.success('收到学生端应答，协商完成')
    if (type === 'viewer_connected') {
      ElMessage.success(`学生 ${payload.userId} 已连通（当前 ${connectedCount.value} 人观看）`)
    }
    if (type === 'viewer_lost') ElMessage.warning(`学生 ${payload.userId} 连接断开`)
  }
})

const stateText = computed(() => {
  if (sharing.value && castState.value === 'live') return '共享中 · 已与接收端连通'
  if (sharing.value) return '共享中 · 等待接收端应答…'
  if (!sessionId.value) return '请先填写课堂 ID'
  if (!wsConnected.value) return '投屏通道连接中…'
  return '通道已连接 · 未开始共享'
})

/** 生成一路带时间戳的动画画面，便于肉眼确认是「实时」而非静态图 */
function buildCanvasStream() {
  const c = canvasRef.value
  c.width = 960
  c.height = 540
  const ctx = c.getContext('2d')
  let n = 0
  const draw = () => {
    n += 1
    const g = ctx.createLinearGradient(0, 0, 960, 540)
    g.addColorStop(0, '#0f766e')
    g.addColorStop(1, '#164e63')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 960, 540)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 44px system-ui, sans-serif'
    ctx.fillText('投屏链路自测', 60, 150)
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText(`课堂 ID：${sessionId.value}`, 60, 230)
    ctx.fillText(new Date().toLocaleTimeString('zh-CN', { hour12: false }), 60, 300)
    ctx.fillText(`帧序号：${n}`, 60, 360)
    ctx.font = '22px system-ui, sans-serif'
    ctx.fillText('看到这段画面在动 = 整条链路已通', 60, 440)
    // 一个移动的小球，用来确认不是静态帧
    ctx.beginPath()
    ctx.arc(60 + (n * 6) % 840, 500, 14, 0, Math.PI * 2)
    ctx.fillStyle = '#fbbf24'
    ctx.fill()
  }
  draw()
  timer = setInterval(draw, 1000 / 15)
  stream = c.captureStream(15)
  return stream
}

async function start() {
  if (!Number(sessionId.value)) {
    ElMessage.warning('请填写课堂 ID')
    return
  }
  const s = buildCanvasStream()
  const ok = await startShare('screen', s)
  if (ok) {
    ElMessage.success('已开始模拟共享，去课堂页看画面')
  }
}

function stop() {
  stopShare()
  clearInterval(timer)
  timer = null
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
}

/** 自动填入当前正在进行的课堂 ID */
async function fillCurrent() {
  try {
    const res = await currentLive(15)
    const d = res?.data ?? res
    const id = d?.session?.sessionId || d?.session?.id || d?.schedule?.sessionId
    if (id) {
      sessionId.value = String(id)
      ElMessage.success(`已填入当前课堂 ${id}`)
    } else {
      ElMessage.warning('当前没有进行中的课堂，请手动填写（如 9006）')
    }
  } catch {
    ElMessage.warning('获取当前课堂失败，请手动填写（如 9006）')
  }
}

/** MediaStream 不能写在模板属性里，流到达后手动绑定 */
watch(localStream, (s) => {
  if (previewRef.value) previewRef.value.srcObject = s || null
})

onUnmounted(() => stop())
</script>

<template>
  <div class="cast-test">
    <div class="head">
      <div>
        <h2>投屏链路自测</h2>
        <p class="tip">
          用 canvas 动画流代替屏幕抓取，验证「服务端信令转发 → WebRTC 协商 → 学生端播放」是否通畅。
          <b>教师端接入前的临时联调工具，非正式功能。</b>
        </p>
      </div>
      <el-tag :type="sharing ? 'success' : 'info'" size="small">{{ stateText }}</el-tag>
    </div>

    <el-card shadow="never" class="card">
      <div class="row">
        <span class="label">课堂 ID</span>
        <el-input v-model="sessionId" size="small" placeholder="如 9006" style="width: 140px" />
        <el-button size="small" @click="fillCurrent">
          <BaseIcon name="refresh-cw" :size="13" />自动填当前课堂
        </el-button>
        <el-button v-if="!sharing" size="small" type="primary" @click="start">
          <BaseIcon name="monitor-play" :size="13" />开始模拟共享
        </el-button>
        <el-button v-else size="small" type="danger" @click="stop">
          <BaseIcon name="monitor-play" :size="13" />停止共享
        </el-button>
      </div>

      <div class="row meta">
        <span>通道：{{ wsConnected ? '已连接' : '连接中…' }}</span>
        <span>协商：{{ castState }}</span>
        <span>我是：{{ selfId || '（未知）' }}</span>
        <span>房间成员：{{ viewers.length }} 人</span>
        <span class="ok">已连通：{{ connectedCount }} 人</span>
      </div>
      <div v-if="viewers.length" class="row meta">
        <span>成员：{{ viewers.join('、') }}</span>
      </div>

      <p v-if="errorText" class="err">{{ errorText }}</p>

      <div class="row" style="margin-top: 12px">
        <div class="pane">
          <div class="pane-title">本地预览（发送端）</div>
          <canvas ref="canvasRef" class="canvas" />
        </div>
        <div class="pane">
          <div class="pane-title">本端流（绑定 video 校验）</div>
          <video
            v-if="localStream"
            ref="previewRef"
            class="canvas"
            autoplay
            muted
            playsinline
          />
          <div v-else class="empty">未开始</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="card">
      <div class="pane-title">自测步骤</div>
      <ol class="steps">
        <li>本页填好课堂 ID，点「开始模拟共享」。</li>
        <li>另开一个标签页打开 <code>/student/live</code>（学生端课堂页）。</li>
        <li>
          课堂页投屏区出现<b>会动的彩色画面</b>（含当前时间与帧序号）→
          说明信令转发、ICE 协商、接收播放<b>全部正常</b>。
        </li>
        <li>
          若课堂页无画面：看本页「对端」是否显示学生 userId ——
          为空说明接收端没进同一个房间（sessionId 不一致 / 没连上）；
          有值但无画面则是 ICE 不通，检查两端是否同网段、STUN 是否可达。
        </li>
      </ol>
    </el-card>
  </div>
</template>

<style scoped>
.cast-test {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
h2 {
  margin: 0 0 4px;
  font-size: 17px;
}
.tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  max-width: 720px;
  line-height: 1.6;
}
.card {
  border-radius: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.meta {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.meta span {
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
}
.meta span.ok {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.err {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
.pane {
  flex: 1;
  min-width: 280px;
}
.pane-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.canvas {
  width: 100%;
  max-width: 480px;
  aspect-ratio: 16 / 9;
  background: #0f172a;
  border-radius: 6px;
  display: block;
}
.empty {
  width: 100%;
  max-width: 480px;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.steps {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--el-text-color-regular);
}
code {
  background: var(--el-fill-color-light);
  padding: 1px 5px;
  border-radius: 3px;
}
</style>
