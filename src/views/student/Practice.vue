<template>
  <div>
    <PageHeader
      :title="title || '练习'"
      desc="按薄弱知识点抽题 · 交卷自动判分 · 错题自动进入错题本"
      back
      back-to="/student/analytics"
    />

    <!-- 作答中 -->
    <template v-if="!result">
      <el-card v-loading="loading" shadow="never">
        <div v-if="questions.length" class="between">
          <div class="small muted">
            第 <b class="brand">{{ current + 1 }}</b> / {{ questions.length }} 题
            <el-tag size="small" effect="plain" class="ml8">{{ typeLabel(q.qType) }}</el-tag>
          </div>
          <el-button size="small" text @click="quit">退出练习</el-button>
        </div>

        <template v-if="q">
          <div class="q-content">{{ q.content }}</div>

          <!-- 单选 -->
          <el-radio-group
            v-if="q.qType === 'single'"
            v-model="answers[q.questionId]"
            class="opt-group"
          >
            <el-radio v-for="o in opts(q)" :key="o.key" :value="o.key" class="opt">
              <b>{{ o.key }}.</b> {{ o.text }}
            </el-radio>
          </el-radio-group>

          <!-- 多选 -->
          <el-checkbox-group
            v-else-if="q.qType === 'multi'"
            v-model="multiAnswers[q.questionId]"
            class="opt-group"
          >
            <el-checkbox v-for="o in opts(q)" :key="o.key" :value="o.key" class="opt">
              <b>{{ o.key }}.</b> {{ o.text }}
            </el-checkbox>
          </el-checkbox-group>

          <!-- 判断 -->
          <el-radio-group
            v-else-if="q.qType === 'judge'"
            v-model="answers[q.questionId]"
            class="opt-group"
          >
            <el-radio v-for="o in judgeOpts(q)" :key="o.key" :value="o.key" class="opt">
              {{ o.text }}
            </el-radio>
          </el-radio-group>

          <!-- 填空 -->
          <el-input
            v-else
            v-model="answers[q.questionId]"
            placeholder="请输入答案"
            class="mt16"
            style="max-width: 420px"
          />
        </template>

        <div class="between mt24">
          <el-button :disabled="current === 0" @click="current--">上一题</el-button>
          <div class="row" style="gap: 8px">
            <el-button v-if="current < questions.length - 1" type="primary" @click="current++">下一题</el-button>
            <el-button v-else type="primary" :loading="submitting" @click="submit">交卷</el-button>
          </div>
        </div>
      </el-card>

      <div v-if="!loading && !questions.length" class="mt16">
        <EmptyState desc="该课程暂无可练习的客观题（单选/多选/判断/填空），换门课程试试" />
      </div>
    </template>

    <!-- 结果 -->
    <template v-else>
      <el-card shadow="never" class="result-card">
        <div class="between">
          <div>
            <div class="big-score">{{ result.score }}<span class="unit">/ {{ result.fullScore }} 分</span></div>
            <div class="small muted mt6">
              答对 {{ result.correct }} / {{ result.total }} 题 · 正确率 {{ result.accuracy }}%
              <template v-if="result.wrongAdded"> · {{ result.wrongAdded }} 题已进错题本</template>
            </div>
          </div>
          <div class="row" style="gap: 8px">
            <el-button size="small" @click="retry">再练一组</el-button>
            <el-button size="small" type="primary" @click="goWrongBook">去错题本</el-button>
          </div>
        </div>
      </el-card>

      <div class="stack mt16" style="gap: 10px">
        <el-card v-for="(d, i) in result.details" :key="d.questionId" shadow="never">
          <div class="between">
            <div class="row" style="gap: 8px">
              <el-tag size="small" :type="d.correct ? 'success' : 'danger'" effect="light">
                {{ d.correct ? '正确' : '错误' }}
              </el-tag>
              <span class="small muted">第 {{ i + 1 }} 题</span>
            </div>
          </div>
          <div class="subj small mt8">{{ findContent(d.questionId) }}</div>
          <div class="small mt8">
            <span class="muted">我的答案：</span>
            <span :class="d.correct ? 'ok' : 'bad'">{{ d.userAnswer || '（未作答）' }}</span>
            <span class="muted" style="margin-left: 16px">标准答案：</span>
            <span class="ok">{{ d.answer }}</span>
          </div>
          <div v-if="d.analysis" class="analysis small mt8">{{ d.analysis }}</div>
        </el-card>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import EmptyState from '@/components/base/EmptyState.vue'
import PageHeader from '@/components/base/PageHeader.vue'
import { practiceQuestions, submitPractice } from '@/api/student/learning'

const route = useRoute()
const router = useRouter()

const courseId = computed(() => Number(route.query.courseId) || null)
const kpId = computed(() => (route.query.kpId ? Number(route.query.kpId) : null))
const title = computed(() => String(route.query.title || ''))

const loading = ref(false)
const submitting = ref(false)
const questions = ref([])
const current = ref(0)
const answers = ref({})
const multiAnswers = ref({})
const result = ref(null)
const startedAt = ref(0)

const q = computed(() => questions.value[current.value] || null)

function typeLabel(t) {
  return { single: '单选', multi: '多选', judge: '判断', blank: '填空' }[t] || t
}
/** 安全解析 options（后端已保证为 '[]' 而非 null） */
function opts(item) {
  try {
    const arr = JSON.parse(item?.options || '[]')
    return Array.isArray(arr) ? arr.filter((o) => o && o.key) : []
  } catch {
    return []
  }
}
/** 判断题：有 options 用 options；无 options 时给「正确 / 错误」 */
function judgeOpts(item) {
  const o = opts(item)
  return o.length ? o : [{ key: '正确', text: '正确' }, { key: '错误', text: '错误' }]
}

function findContent(qid) {
  return questions.value.find((x) => String(x.questionId) === String(qid))?.content || ''
}

async function load() {
  if (!courseId.value) {
    ElMessage.warning('缺少课程参数')
    return
  }
  loading.value = true
  result.value = null
  current.value = 0
  answers.value = {}
  multiAnswers.value = {}
  try {
    const d = await practiceQuestions({ courseId: courseId.value, kpId: kpId.value || undefined, count: 5 })
    questions.value = d?.list || []
    // 初始化多选数组
    const m = {}
    questions.value.forEach((x) => {
      if (x.qType === 'multi') m[x.questionId] = []
    })
    multiAnswers.value = m
    startedAt.value = Date.now()
  } catch {
    questions.value = []
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (submitting.value) return
  const list = questions.value.map((x) => {
    const ans =
      x.qType === 'multi'
        ? (multiAnswers.value[x.questionId] || []).slice().sort().join(',')
        : answers.value[x.questionId] || ''
    return { questionId: x.questionId, answer: String(ans).trim() }
  })
  const blankCnt = list.filter((x) => !x.answer).length
  if (blankCnt === list.length) {
    ElMessage.warning('还没有作答，先选一下再交卷')
    return
  }
  try {
    await ElMessageBox.confirm(
      blankCnt ? `还有 ${blankCnt} 题未作答，确定交卷？` : '确定交卷？交卷后自动判分',
      '交卷确认',
      { confirmButtonText: '交卷', cancelButtonText: '继续作答', type: 'warning' }
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    const durationSec = Math.max(1, Math.round((Date.now() - startedAt.value) / 1000))
    result.value = await submitPractice({ courseId: courseId.value, durationSec, answers: list })
    ElMessage.success(`已交卷：${result.value.correct}/${result.value.total} 题`)
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false
  }
}

function retry() {
  load()
}
function goWrongBook() {
  router.push({ name: 'StuWrongBook' })
}
async function quit() {
  try {
    await ElMessageBox.confirm('退出后本次作答不会保存，确定退出？', '退出练习', {
      confirmButtonText: '退出',
      cancelButtonText: '继续练习',
      type: 'warning'
    })
  } catch {
    return
  }
  router.back()
}

onMounted(load)
</script>

<style scoped>
.brand {
  color: var(--brand-700);
}
.ml8 {
  margin-left: 8px;
}
.q-content {
  margin: 14px 0 16px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--ink-800, var(--ink-700));
  white-space: pre-wrap;
}
.opt-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.opt {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-right: 0;
  width: 100%;
  height: auto;
}
.opt.is-checked {
  border-color: var(--brand-400);
  background: var(--primary-softer);
}
.mt24 {
  margin-top: 24px;
}
.result-card {
  padding: 6px 2px;
}
.big-score {
  font-size: 32px;
  font-weight: 700;
  color: var(--brand-700);
  line-height: 1.1;
}
.big-score .unit {
  font-size: 14px;
  font-weight: 500;
  margin-left: 6px;
  color: var(--ink-500);
}
.subj {
  color: var(--ink-700);
  line-height: 1.7;
  white-space: pre-wrap;
}
.ok {
  color: #0f766e;
  font-weight: 600;
}
.bad {
  color: #b91c1c;
  font-weight: 600;
}
.analysis {
  padding: 8px 10px;
  background: var(--bg-subtle);
  border-radius: 8px;
  color: var(--ink-600);
  line-height: 1.8;
}
</style>
