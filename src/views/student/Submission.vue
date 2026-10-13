<script setup>
/**
 * 作业详情（分支 stu-pc-homework）
 * 关联接口（接口设计文档表号）：表 3-6 提交作业、表 3-7 作业申诉、表 3-21 作业退回重交
 * 对应原型：ui-prototype/pc/student-submission.html —— ★ 1:1 还原
 *   （顶部成绩卡、逐题「我的作答 + 得分」、教师/AI 评语、申诉进度时间线 / 发起申诉）
 *
 * 说明：契约里没有「提交详情查询」接口（题目与判分属 M-C 域），暂用原型同款演示数据。
 *      待提交状态沿用「作业作答」页作答，本页只做查看与申诉。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { appealSubmission, resubmitHomework } from '@/api/student/homework'

const route = useRoute()
const router = useRouter()

/** 原型演示数据（SUB） */
const SUB = {
  hw1: {
    title: '习题 2-1 导数定义', course: '高等数学 A', totalScore: 50, status: 'warning', statusText: '待提交',
    deadline: '2026-09-05 23:59', pending: true
  },
  hw2: {
    title: '习题 1-5 极限计算', course: '高等数学 A', totalScore: 30, status: 'success', statusText: '已批改 · 92',
    score: '92', deadline: '2026-08-28 23:59',
    questions: [
      { q: '1.（填空 · 5 分）lim(x→0) sin x / x = ____', a: '1', score: '5 / 5' },
      { q: '2.（计算 · 10 分）求 lim(x→0) (x²−1)/(x−1)', a: '2', score: '10 / 10' },
      { q: '3.（简答 · 15 分）用导数定义推导 (x²)′ = 2x。', a: '由定义 f′(x)=lim(h→0)[(x+h)²−x²]/h = lim(2xh+h²)/h = 2x。', score: '77 / 90' }
    ],
    comment: 'AI 初判 92 · 教师复核 92。整体思路清晰，推导严谨；简答部分步骤略简，注意书写规范。'
  },
  hw3: {
    title: '栈与队列 编程题', course: '数据结构', totalScore: 30, status: 'success', statusText: '已批改 · 92',
    score: '92', deadline: '2026-09-02 23:59',
    questions: [
      { q: '1.（编程 · 20 分）实现入栈 / 出栈操作', a: '已提交 .py 文件，本地判题通过测试用例 5/5。', score: '100 / 100' },
      { q: '2.（简答 · 10 分）分析出栈序列的可能性', a: 'n 个元素出栈序列数为卡特兰数 C_n。', score: '80 / 100' }
    ],
    comment: 'AI 初判 92 · 教师复核 92。代码规范，测试结果完整；复杂度分析部分可再深入。',
    appealable: true
  },
  hw4: {
    title: 'Unit 3 阅读理解', course: '大学英语 III', totalScore: 100, status: 'success', statusText: '已批改 · 88',
    score: '88', deadline: '2026-09-01 23:59',
    questions: [
      { q: '客观题自动判分（20 题）', a: '客观题已自动判分，完形填空全对，阅读选择题错 2 题。', score: '88 / 100' }
    ],
    comment: '客观题自动判分 · 已完成。阅读速度有待提升，建议多做精读训练。'
  },
  hw5: {
    title: '线性表 章节测验', course: '数据结构', totalScore: 20, status: 'error', statusText: '申诉处理中',
    deadline: '2026-08-25 23:59',
    questions: [
      { q: '1.（填空 · 5 分）线性表的顺序存储称为 ____', a: '顺序表', score: '5 / 5' },
      { q: '2.（简答 · 10 分）比较顺序表与链表的插入效率', a: '顺序表随机访问 O(1)，插入 O(n)；链表插入 O(1)（已知位置）。', score: '已提交 · 待复核' }
    ],
    comment: '原判 78 分；你对第 2 题评分发起申诉，理由：比较维度应包含空间开销。',
    appealing: true
  }
}

const key = ref(String(route.params.submissionId || 'hw2'))
const s = computed(() => SUB[key.value] || SUB.hw2)
const badgeType = (st) => ({ warning: 'warning', success: 'success', error: 'danger' })[st] || 'info'

const timeline = [
  { t: '提交申诉', d: '09-05 14:20 · 你发起成绩申诉', done: true },
  { t: '教师受理', d: '09-05 16:40 · 李老师已受理', done: true },
  { t: '复核中', d: '预计 2 个工作日内反馈', done: false }
]

function goAnswer() {
  router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: key.value } })
}
async function doAppeal() {
  try {
    await ElMessageBox.confirm('确定对本次成绩发起申诉？教师将在 2 个工作日内复核。', '成绩申诉', {
      confirmButtonText: '提交申诉',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await appealSubmission(key.value, { reason: '对评分标准有疑问' })
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  ElMessage.success('已发起成绩申诉，教师将在 2 个工作日内复核')
}
async function doResubmit() {
  try {
    await resubmitHomework(key.value, {})
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  ElMessage.success('已提交重交申请')
}

onMounted(() => {
  const q = String(route.query.id || '')
  if (q && SUB[q]) key.value = q
})
</script>

<template>
  <div>
    <!-- 顶部卡 -->
    <el-card shadow="never">
      <div class="between">
        <div>
          <div class="row" style="gap: 10px">
            <h1 class="h1">{{ s.title }}</h1>
            <el-tag :type="badgeType(s.status)" effect="light">{{ s.statusText }}</el-tag>
          </div>
          <div class="muted small mt8">
            {{ s.course }} · 截止 {{ s.deadline }} · 限时 60 分钟 · 共 5 题 · 总分 {{ s.totalScore || '—' }}
          </div>
        </div>
        <div v-if="s.score" style="text-align: right">
          <div class="small muted">我的成绩</div>
          <div class="big-score">{{ s.score }}</div>
        </div>
      </div>
    </el-card>

    <!-- 待提交：引导去作答 -->
    <el-card v-if="s.pending" shadow="never" class="mt16">
      <div class="between">
        <span class="small muted">该作业尚未提交，请前往作答页完成。</span>
        <el-button type="primary" @click="goAnswer"><BaseIcon name="pencil" :size="14" />去作答</el-button>
      </div>
    </el-card>

    <!-- 已批改：逐题 + 评语 + 申诉 -->
    <template v-else>
      <div class="stack mt16 cards">
        <el-card v-for="(q, i) in s.questions" :key="i" shadow="never">
          <div class="between">
            <b>{{ q.q }}</b>
            <el-tag v-if="q.score" type="success" effect="light">{{ q.score }}</el-tag>
          </div>
          <div class="ans mt12"><b>我的作答：</b>{{ q.a }}</div>
        </el-card>

        <el-card v-if="s.comment" shadow="never" class="comment">
          <b>教师 / AI 评语</b>
          <div class="mt8">{{ s.comment }}</div>
        </el-card>

        <!-- 申诉进度时间线 -->
        <el-card v-if="s.appealing" shadow="never">
          <div class="card-title">申诉进度</div>
          <div class="timeline">
            <div v-for="(t, i) in timeline" :key="i" class="tl-item" :class="{ done: t.done }">
              <span class="dot" />
              <div>
                <div class="t">{{ t.t }}</div>
                <div class="d">{{ t.d }}</div>
              </div>
            </div>
          </div>
        </el-card>

        <el-card v-else-if="s.appealable" shadow="never">
          <div class="right-actions">
            <el-button @click="doResubmit"><BaseIcon name="refresh-cw" :size="14" />退回重交</el-button>
            <el-button @click="doAppeal"><BaseIcon name="scale" :size="14" />对成绩申诉</el-button>
          </div>
        </el-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
}
.big-score {
  font-size: 28px;
  font-weight: 800;
  color: var(--success);
}
.cards {
  max-width: 900px;
}
.ans {
  background: var(--bg-subtle);
  border-radius: var(--r-md);
  padding: 12px 14px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--ink-700);
}
.comment {
  border-left: 3px solid var(--brand-600);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tl-item {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  position: relative;
}
.tl-item .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ink-300, #cbd5e1);
  margin-top: 5px;
  flex: none;
}
.tl-item.done .dot {
  background: var(--brand-600);
}
.tl-item .t {
  font-weight: 600;
  font-size: 13.5px;
}
.tl-item .d {
  font-size: 12.5px;
  color: var(--ink-500);
}
.right-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.mt12 {
  margin-top: 12px;
}
</style>
