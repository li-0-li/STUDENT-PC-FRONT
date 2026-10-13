<script setup>
/**
 * AI 工作台（M-D · 教师 PC 端）
 *
 * 对应原型：ui-prototype/pc/ai-workbench.html（1:1 还原）
 * 路由：/teacher/ai-workbench（菜单 id = ai）
 *
 * 还原要点：
 *   1. 顶部提示「批改/查重结果供参考，最终成绩以教师确认为准」
 *   2. 两张卡：AI 批改 / AI 查重——拖拽或点击上传（有文件时虚线变实线 + 文件高亮）、
 *      进度条推进、结果面板（键值行 + 说明）
 *   3. 「最近任务」列表，每次任务完成后置顶插入
 *   4. 查重阈值与原型一致：告警 60%、标红 80%（对应 sys_config 配置）
 *
 * TODO(M-D) 接口：本页调用的后端能力分属两个域——
 *   · 表 4-11 作业/实验查重 POST /api/v1/plagiarism/check（M-C 提供）
 *   · AI 批改在 M-C 的批改接口里（POST /api/v1/submissions/{id}/grade 一类的教师侧能力）
 *   即：**本页是 M-D 的界面，但数据能力主要来自 M-C**，需与 M-C 对齐后再接真实接口。
 *   现用页面内演示结果（不真实上传）。
 */
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

/** 查重阈值（与原型注释一致：对应 sys_config） */
const DUP_THRESHOLD = 60
const DUP_RED = 80

/** 两类任务的状态 */
function makeTask(kind, title, desc, actionText) {
  return {
    kind,
    title,
    desc,
    actionText,
    file: null,
    progress: 0,
    running: false,
    result: null,
    dragging: false
  }
}
// 注意：这两张卡要放进数组后在 v-for 里使用，必须用 reactive 而非 ref
//（数组内的 ref 在模板中不会自动解包，t.file 会取不到值）
const gradeTask = reactive(makeTask('grade', 'AI 批改', '自动识别作业答案，生成评分与评语', '开始批改'))
const dupTask = reactive(makeTask('dup', 'AI 查重', '比对作业与网络资源，识别相似内容', '开始查重'))
const tasks = ref([
  { name: '高等数学作业批改', status: '已完成', tag: 'success' },
  { name: '大学英语论文查重', status: '进行中', tag: 'info' }
])

function pickFile(task) {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = () => setFile(task, input.files?.[0])
  input.click()
}

function setFile(task, file) {
  if (!file) return
  task.file = file
  task.result = null
  task.progress = 0
}

function onDrop(task, e) {
  task.dragging = false
  const f = e.dataTransfer?.files?.[0]
  if (f) setFile(task, f)
}

function start(task) {
  if (!task.file || task.running) return
  task.running = true
  task.progress = 0
  task.result = null
  const timer = setInterval(() => {
    task.progress = Math.min(100, task.progress + 8 + Math.random() * 14)
    if (task.progress >= 100) {
      clearInterval(timer)
      setTimeout(() => done(task), 220)
    }
  }, 130)
}

/** 生成结果（演示口径与原型一致） */
function done(task) {
  if (task.kind === 'grade') {
    task.result = {
      rows: [
        ['识别题目', '6 题（4 客观 + 2 主观）'],
        ['批改份数', '1 份'],
        ['自动得分', '86 / 100', 'brand'],
        ['主观题依据', '关键词命中 40% + 语义相似 40% + 结构完整 20%']
      ],
      note: '已生成 AI 评语，可直接采用或修改后发布；学生端会标注「AI 评分」并可发起申诉。'
    }
    addTask(`「${task.file.name}」批改`, '已完成', 'success')
  } else {
    const sim = 18 + Math.round(Math.random() * 60)
    const tone = sim >= DUP_RED ? 'error' : sim >= DUP_THRESHOLD ? 'warning' : 'brand'
    task.result = {
      rows: [
        ['相似度', `${sim}%`, tone],
        ['最高相似来源', sim > 50 ? '《数据结构实验报告（2023 级）》' : '公开网络文档'],
        ['比对库', '校内作业库 + 课程资源库']
      ],
      note:
        sim >= DUP_RED
          ? `超过标红阈值 ${DUP_RED}%，已自动标红并进入人工复核队列。`
          : sim >= DUP_THRESHOLD
            ? `超过告警阈值 ${DUP_THRESHOLD}%，建议人工复核。`
            : `低于告警阈值 ${DUP_THRESHOLD}%，可正常发布。`
    }
    addTask(`「${task.file.name}」查重`, `${sim}% 相似`, sim >= DUP_RED ? 'error' : 'success')
  }
  task.running = false
  ElMessage.success('处理完成')
}

function addTask(name, status, tag) {
  tasks.value.unshift({ name, status, tag })
}

const cards = [gradeTask, dupTask]
</script>

<template>
  <div>
    <PageHeader title="AI 工作台" desc="批改 / 查重结果供参考，最终成绩以教师确认为准" />

    <div class="grid g2">
      <el-card v-for="t in cards" :key="t.kind" shadow="never">
        <h3 class="ai-title">
          <span class="icon-box">
            <BaseIcon :name="t.kind === 'grade' ? 'file-check-2' : 'search'" :size="16" />
          </span>
          {{ t.title }}
        </h3>
        <div class="desc small muted">{{ t.desc }}</div>

        <div
          class="upl"
          :class="{ hasfile: !!t.file, dragging: t.dragging }"
          @click="pickFile(t)"
          @dragover.prevent="t.dragging = true"
          @dragenter.prevent="t.dragging = true"
          @dragleave.prevent="t.dragging = false"
          @drop.prevent="onDrop(t, $event)"
        >
          <BaseIcon name="upload-cloud" :size="26" class="upl-ic" />
          <div class="mt8">
            <span v-if="t.file" class="fname">{{ t.file.name }}</span>
            <span v-else class="muted small">
              {{ t.kind === 'grade' ? '拖拽或点击上传学生作业' : '拖拽或点击上传待查重文件' }}
            </span>
          </div>
          <el-button
            class="mt12"
            type="primary"
            :disabled="!t.file || t.running"
            @click.stop="start(t)"
          >
            {{ t.running ? '处理中…' : t.actionText }}
          </el-button>

          <div v-if="t.running || t.progress > 0" class="bar mt12">
            <i :style="{ width: t.progress + '%' }" />
          </div>
        </div>

        <div v-if="t.result" class="result mt12">
          <div v-for="(r, i) in t.result.rows" :key="i" class="kv">
            <span>{{ r[0] }}</span>
            <b :class="r[2] === 'error' ? 't-error' : r[2] === 'warning' ? 't-warning' : r[2] === 'brand' ? 't-brand' : ''">
              {{ r[1] }}
            </b>
          </div>
          <div class="small muted mt8">{{ t.result.note }}</div>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="mt16">
      <div class="card-title">最近任务</div>
      <div v-for="(k, i) in tasks" :key="i" class="rowline">
        <span>{{ k.name }}</span>
        <el-tag :type="k.tag" size="small" effect="light">{{ k.status }}</el-tag>
      </div>
      <el-empty v-if="!tasks.length" description="暂无任务" :image-size="60" />
    </el-card>
  </div>
</template>

<style scoped>
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  margin-bottom: 6px;
}
.icon-box {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--brand-50);
  color: var(--brand-600);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.desc {
  margin-bottom: 12px;
}
.upl {
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-lg);
  padding: 22px 16px;
  text-align: center;
  cursor: pointer;
  transition: 0.15s;
}
.upl:hover,
.upl.dragging {
  border-color: var(--brand-300);
  background: var(--bg-subtle);
}
.upl.hasfile {
  border-style: solid;
  border-color: var(--brand-300);
  background: var(--primary-soft);
}
.upl-ic {
  color: var(--ink-400);
}
.upl.hasfile .upl-ic {
  color: var(--brand-600);
}
.fname {
  font-size: 12.5px;
  color: var(--brand-700);
  font-weight: 600;
  word-break: break-all;
}
.bar {
  height: 7px;
  border-radius: 99px;
  background: var(--bg-soft);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--brand-600);
  border-radius: 99px;
  transition: width 0.25s;
}
.result {
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--bg-soft);
  font-size: 12.5px;
  line-height: 1.75;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.kv + .kv {
  margin-top: 4px;
}
.kv span:first-child {
  color: var(--ink-500);
}
.t-error {
  color: var(--error);
}
.t-warning {
  color: var(--warning);
}
.t-brand {
  color: var(--brand-700);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 10px;
}
.rowline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.rowline:last-child {
  border-bottom: none;
}
</style>
