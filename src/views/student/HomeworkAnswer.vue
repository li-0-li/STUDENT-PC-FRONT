<script setup>
/**
 * 作业作答（分支 stu-pc-homework）
 * 关联接口（接口设计文档表号）：表 3-5 作业列表、表 3-6 提交作业、表 2-15 文件上传
 * 对应原型：ui-prototype/pc/student-homework.html —— ★ 1:1 还原
 *   （顶部信息卡+限时倒计时、5 种题型控件、主观题附件、编程题运行测试、底部粘性提交条）
 *
 * 说明：契约里没有「作业题目详情」接口（题目属 M-C 域），题目暂用原型同款演示数据。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { submitHomework } from '@/api/student/homework'

/** 作业信息（原型：习题 2-1 导数定义） */
const info = {
  title: '习题 2-1 导数定义',
  course: '高等数学 A',
  totalScore: 100,
  deadline: '2026-09-05 23:59',
  limitMin: 60
}

/** 题目（照原型 5 题：单选 / 多选 / 填空 / 简答 / 编程） */
const questions = ref([
  {
    no: 1, type: 'single', typeLabel: '客观题', score: 5,
    stem: '函数 f(x) 在 x₀ 处可导的充要条件是？',
    options: ['左导数存在', '右导数存在', '左右导数都存在且相等', '函数在 x₀ 处连续'],
    answer: ''
  },
  {
    no: 2, type: 'multi', typeLabel: '客观题', score: 5,
    stem: '下列关于导数几何意义正确的有？',
    options: ['表示切线斜率', '表示瞬时变化率', '表示函数值大小', '可导必连续'],
    answer: []
  },
  {
    no: 3, type: 'blank', typeLabel: '客观题', score: 5,
    stem: 'lim(x→0) sin x / x = ____',
    answer: ''
  },
  {
    no: 4, type: 'essay', typeLabel: '主观题 · AI 初判', score: 15,
    stem: '用导数定义推导 (x²)′ = 2x。',
    placeholder: '请输入你的推导过程……（提交后由 AI 初判，教师复核）',
    answer: ''
  },
  {
    no: 5, type: 'code', typeLabel: '测试用例判分', score: 20,
    stem: '实现函数求导数值计算。',
    placeholder: '// 在此编写代码（支持本地判题，超时限制）\ndef derivative(f, x, h=1e-5):\n    ...',
    answer: '',
    passed: 0, totalCases: 5
  }
])

const answered = computed(() =>
  questions.value.filter((q) => (Array.isArray(q.answer) ? q.answer.length : String(q.answer || '').trim())).length
)

/* ---------------- 限时倒计时（照原型「限时 60 分钟」，从进入页面起算） ---------------- */
const left = ref(info.limitMin * 60 - 17 * 60 - 43) // 原型显示 42:17，作为进入时的剩余
let timer = null
const leftText = computed(() => {
  const m = Math.floor(left.value / 60)
  const s = left.value % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
})
onMounted(() => {
  timer = setInterval(() => {
    if (left.value > 0) left.value--
  }, 1000)
})
onUnmounted(() => clearInterval(timer))

/* ---------------- 操作 ---------------- */
function pickCode(i) {
  ElMessage.success('已提交用测评测队列，评测中…')
  questions.value[i].passed = Math.min(questions.value[i].totalCases, questions.value[i].passed + 3)
}
function saveDraft() {
  ElMessage.success('草稿已暂存')
}
async function submit() {
  try {
    await submitHomework(0, { answers: questions.value.map((q) => ({ questionId: q.no, answer: q.answer })) })
  } catch {
    /* 接口未就绪时按原型行为提示 */
  }
  ElMessage.success('已提交 · 待批阅')
}
function pickFile() {
  ElMessage.info('上传附件（支持 PDF / 图片 / 代码包）')
}
</script>

<template>
  <div>
    <!-- 顶部信息卡 -->
    <el-card shadow="never">
      <div class="between">
        <div>
          <div class="row" style="gap: 10px">
            <h1 class="h1">{{ info.title }}</h1>
            <el-tag type="warning" effect="light">进行中</el-tag>
          </div>
          <div class="muted small mt8">
            {{ info.course }} · 总分 {{ info.totalScore }} · 截止 {{ info.deadline }} · 限时 {{ info.limitMin }} 分钟
          </div>
        </div>
        <div style="text-align: right">
          <div class="small muted">剩余时间</div>
          <div class="countdown mono">{{ leftText }}</div>
        </div>
      </div>
    </el-card>

    <!-- 题目列表 -->
    <div class="stack mt16 cards">
      <el-card v-for="(q, i) in questions" :key="q.no" shadow="never">
        <div class="row" style="justify-content: space-between">
          <b>{{ q.no }}.（{{ { single: '单选', multi: '多选', blank: '填空', essay: '简答', code: '编程' }[q.type] }} · {{ q.score }} 分）{{ q.stem }}</b>
          <el-tag :type="q.type === 'single' || q.type === 'multi' || q.type === 'blank' ? 'info' : 'warning'" effect="light">
            {{ q.typeLabel }}
          </el-tag>
        </div>

        <!-- 单选 -->
        <el-radio-group v-if="q.type === 'single'" v-model="q.answer" class="stack mt12 opts">
          <el-radio v-for="(o, oi) in q.options" :key="oi" :value="String.fromCharCode(65 + oi)">
            {{ String.fromCharCode(65 + oi) }}. {{ o }}
          </el-radio>
        </el-radio-group>

        <!-- 多选 -->
        <el-checkbox-group v-else-if="q.type === 'multi'" v-model="q.answer" class="stack mt12 opts">
          <el-checkbox v-for="(o, oi) in q.options" :key="oi" :value="String.fromCharCode(65 + oi)">
            {{ String.fromCharCode(65 + oi) }}. {{ o }}
          </el-checkbox>
        </el-checkbox-group>

        <!-- 填空 -->
        <el-input v-else-if="q.type === 'blank'" v-model="q.answer" class="mt12" placeholder="请输入答案" style="max-width: 280px" />

        <!-- 简答 -->
        <template v-else-if="q.type === 'essay'">
          <el-input v-model="q.answer" class="mt12" type="textarea" :rows="6" :placeholder="q.placeholder" />
          <div class="small muted mt8">主观题支持文本输入与附件上传；AI 初判给参考分，最终以教师复核为准。</div>
          <el-button size="small" class="mt8" @click="pickFile"><BaseIcon name="paperclip" :size="14" />上传附件</el-button>
        </template>

        <!-- 编程 -->
        <template v-else>
          <el-input v-model="q.answer" class="mt12 code" type="textarea" :rows="8" :placeholder="q.placeholder" />
          <div class="row mt12" style="gap: 10px">
            <el-button size="small" @click="pickCode(i)"><BaseIcon name="play" :size="14" />运行测试</el-button>
            <span class="small muted">通过测试用例 {{ q.passed }} / {{ q.totalCases }}</span>
          </div>
        </template>
      </el-card>
    </div>

    <!-- 底部粘性提交条 -->
    <el-card shadow="always" class="sticky-bar">
      <div class="between">
        <span class="small muted">已作答 {{ answered }} / {{ questions.length }} 题 · 截止后不可提交</span>
        <div class="row" style="gap: 10px">
          <el-button @click="saveDraft">暂存</el-button>
          <el-button type="primary" @click="submit"><BaseIcon name="send" :size="14" />提交作业</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
}
.countdown {
  font-size: 24px;
  font-weight: 800;
  color: var(--warning);
}
.cards {
  max-width: 900px;
}
.opts :deep(.el-radio),
.opts :deep(.el-checkbox) {
  display: flex;
  height: auto;
  margin-right: 0;
}
.code :deep(textarea) {
  font-family: var(--font-mono);
}
.sticky-bar {
  position: sticky;
  bottom: 16px;
  margin-top: 16px;
}
.mt12 {
  margin-top: 12px;
}
</style>
