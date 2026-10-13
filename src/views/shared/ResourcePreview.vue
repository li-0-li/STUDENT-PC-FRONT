<script setup>
/**
 * 资源预览（分支 stu-pc-resource；跨端公共页）
 * 关联接口（接口设计文档表号）：表 3-4 资源列表、表 2-15 文件上传
 * 对应原型：ui-prototype/pc/resource-preview.html —— ★ 1:1 还原
 *   （粘性顶部条 + 按类型渲染：文档 / 视频 / 图片 / 表格 / 题库）
 *
 * 说明：契约里没有「资源预览内容」接口（资源属 M-B 域），预览内容按原型示意渲染。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'

const route = useRoute()
const router = useRouter()

const type = ref(String(route.query.type || 'doc'))
const title = ref(String(route.query.title || '未命名资源'))
const sub = ref(String(route.query.sub || ''))

const ICON = { doc: 'file-text', video: 'video', image: 'image', table: 'grid-3x3', quiz: 'list-checks' }
const LABEL = { doc: '文档', video: '视频', image: '图片', table: '表格', quiz: '题库' }

/** 文档占位行（照原型 14 条灰线，宽度伪随机） */
const lines = computed(() => Array.from({ length: 14 }, (_, i) => 52 + ((i * 53) % 44)))

/* ---------------- 视频播放（照原型：进度条推进） ---------------- */
const playing = ref(false)
const prog = ref(0)
let vtimer = null
function playV() {
  if (vtimer) {
    clearInterval(vtimer)
    vtimer = null
    playing.value = false
    return
  }
  playing.value = true
  vtimer = setInterval(() => {
    prog.value += 2
    if (prog.value >= 100) {
      prog.value = 100
      clearInterval(vtimer)
      vtimer = null
      playing.value = false
    }
  }, 200)
}
const totalMin = computed(() => {
  const m = sub.value.match(/(\d+)\s*分钟/)
  return m ? m[1] : '24'
})

/* ---------------- 表格数据（照原型 10 行） ---------------- */
const tableRows = Array.from({ length: 10 }, (_, i) => ({
  week: `第${i + 1}周`,
  chapter: `第 ${i + 1} 章 内容`,
  hours: 4,
  lab: '—'
}))

/* ---------------- 题库（照原型 3 题） ---------------- */
const quiz = [
  { q: '1.（单选）关于极限的下列叙述正确的是？', opts: ['A. 无穷大必为无界', 'B. 有界数列必收敛', 'C. 收敛数列必有界', 'D. 单调数列必收敛'] },
  { q: '2.（填空）lim(x→0) sin x / cos x = ____', opts: ['答案：0'] },
  { q: '3.（计算）求 lim(x→2) (x²−4)/(x−2)', opts: ['答案：4'] }
]

const page = ref(1)
const totalPages = 8

function download() {
  ElMessage.info('演示环境：资源为原型示意，无可下载文件')
}

onMounted(() => {
  document.title = title.value + ' · 资源预览'
})
</script>

<template>
  <div class="rp-wrap">
    <!-- 粘性顶部条 -->
    <div class="rp-top">
      <span class="rp-back" @click="router.back()"><BaseIcon name="chevron-left" :size="15" />返回</span>
      <el-tag type="info" effect="light"><BaseIcon :name="ICON[type] || 'file-text'" :size="13" />{{ LABEL[type] || '资源' }}</el-tag>
      <span class="rp-title">{{ title }}</span>
      <span v-if="sub" class="rp-sub">{{ sub }}</span>
      <div style="margin-left: auto">
        <el-button size="small" @click="download"><BaseIcon name="download" :size="14" />下载</el-button>
      </div>
    </div>

    <div class="rp-stage">
      <!-- 视频 -->
      <template v-if="type === 'video'">
        <div class="rp-video">
          <div class="play" @click="playV">
            <BaseIcon :name="playing ? 'radio' : 'play'" :size="30" class="ic-dark" />
          </div>
        </div>
        <div class="rp-controls">
          <span @click="playV"><BaseIcon name="play" :size="16" /></span>
          <span class="rp-time">00:{{ String(Math.floor((prog / 100) * Number(totalMin) * 60 / 60)).padStart(2, '0') }} / {{ totalMin }}:00</span>
          <div class="bar"><i :style="{ width: prog + '%' }" /></div>
          <span class="ptr" @click="ElMessage.info('已切换清晰度 720P')"><BaseIcon name="settings" :size="16" /></span>
          <span class="ptr" @click="ElMessage.info('已全屏')"><BaseIcon name="settings-2" :size="16" /></span>
        </div>
      </template>

      <!-- 图片 -->
      <template v-else-if="type === 'image'">
        <div class="rp-imgbox"><BaseIcon name="image" :size="66" /></div>
        <div class="center muted small mt12">{{ sub }}</div>
      </template>

      <!-- 表格 -->
      <template v-else-if="type === 'table'">
        <div class="rp-grid">
          <table>
            <thead>
              <tr><th>周次</th><th>教学章节</th><th>课时</th><th>实验</th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in tableRows" :key="i">
                <td>{{ r.week }}</td><td>{{ r.chapter }}</td><td>{{ r.hours }}</td><td>{{ r.lab }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 题库 -->
      <template v-else-if="type === 'quiz'">
        <div v-for="(q, i) in quiz" :key="i" class="q">
          <b>{{ q.q }}</b>
          <div v-for="(o, oi) in q.opts" :key="oi" class="opt"><span class="d" />{{ o }}</div>
        </div>
      </template>

      <!-- 文档（默认） -->
      <template v-else>
        <div class="rp-paper">
          <h2>{{ title }}</h2>
          <div class="meta">{{ sub || '原型示意文档' }}</div>
          <div v-for="(w, i) in lines" :key="i" class="rp-line" :style="{ width: w + '%' }" />
          <div class="rp-pagenav">
            <el-button size="small" :disabled="page <= 1" @click="page--"><BaseIcon name="chevron-left" :size="14" /></el-button>
            第 {{ page }} / {{ totalPages }} 页
            <el-button size="small" :disabled="page >= totalPages" @click="page++"><BaseIcon name="chevron-right" :size="14" /></el-button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rp-wrap {
  background: var(--bg-subtle);
  min-height: 100vh;
  margin: -16px;
  padding-bottom: 30px;
}
.rp-top {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 22px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.rp-back {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-600);
  font-weight: 600;
  font-size: 14px;
}
.rp-back:hover {
  color: var(--brand-700);
}
.rp-title {
  font-weight: 700;
  font-size: 16px;
}
.rp-sub {
  color: var(--ink-400);
  font-size: 12.5px;
}
.rp-stage {
  max-width: 920px;
  margin: 26px auto;
  padding: 0 16px;
}
.rp-paper {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--sh-1);
  padding: 44px 52px;
  min-height: 520px;
}
.rp-paper h2 {
  margin: 0 0 6px;
  font-size: 22px;
}
.rp-paper .meta {
  color: var(--ink-400);
  font-size: 13px;
  margin-bottom: 26px;
}
.rp-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-subtle);
  margin: 15px 0;
}
.rp-pagenav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 18px;
  color: var(--ink-500);
  font-size: 13px;
}
.rp-video {
  position: relative;
  background: #0f172a;
  border-radius: 14px;
  overflow: hidden;
  aspect-ratio: 16/9;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rp-video .play {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s;
}
.rp-video .play:hover {
  transform: scale(1.06);
}
.ic-dark {
  color: #0f172a;
}
.rp-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 13px;
  border-radius: 0 0 14px 14px;
}
.rp-controls .bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: #334155;
  position: relative;
  overflow: hidden;
}
.rp-controls .bar i {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--brand-500);
  border-radius: 3px;
}
.ptr {
  cursor: pointer;
}
.rp-imgbox {
  background: linear-gradient(135deg, #0d9488, #0ea5e9);
  border-radius: 14px;
  aspect-ratio: 4/3;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.rp-grid {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  max-height: 560px;
}
.rp-grid table {
  border-collapse: collapse;
  width: 100%;
}
.rp-grid th,
.rp-grid td {
  border: 1px solid var(--border);
  padding: 9px 13px;
  font-size: 13px;
  text-align: left;
}
.rp-grid th {
  background: var(--brand-50);
  color: var(--brand-700);
  position: sticky;
  top: 0;
}
.q {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 12px;
  background: #fff;
}
.q b {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
}
.opt {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 7px 0;
  color: var(--ink-600);
  font-size: 14px;
}
.opt .d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand-200);
  flex: none;
}
.mt12 {
  margin-top: 12px;
}
</style>
