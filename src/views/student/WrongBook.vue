<template>
  <div>
    <PageHeader title="错题本" desc="按课程整理错题，支持标记「已掌握」" back back-to="/student/analytics">
      <template #actions>
        <el-button size="small" :loading="loading" @click="load">
          <BaseIcon name="refresh-cw" :size="14" />刷新
        </el-button>
      </template>
    </PageHeader>

    <!-- 统计 + 筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="between">
        <div class="row" style="gap: 18px">
          <div class="stat">
            <div class="stat-num">{{ unmastered }}</div>
            <div class="small muted">待掌握</div>
          </div>
          <div class="stat">
            <div class="stat-num">{{ total }}</div>
            <div class="small muted">错题总数</div>
          </div>
        </div>
        <div class="row" style="gap: 12px">
          <el-select v-model="courseId" placeholder="全部课程" clearable style="width: 180px" @change="load">
            <el-option v-for="c in courses" :key="c.courseId" :label="c.courseName" :value="c.courseId" />
          </el-select>
          <el-checkbox v-model="onlyUnmastered" @change="load">只看未掌握</el-checkbox>
        </div>
      </div>
    </el-card>

    <!-- 列表 -->
    <div v-loading="loading" class="mt16">
      <div v-if="list.length" class="stack" style="gap: 12px">
        <el-card v-for="w in list" :key="w.errorId" shadow="never" class="wrong-card">
          <div class="between">
            <div class="row" style="gap: 8px">
              <el-tag size="small" effect="light">{{ w.courseName || '课程' }}</el-tag>
              <el-tag size="small" :type="typeTag(w.qType)" effect="plain">{{ typeLabel(w.qType) }}</el-tag>
              <el-tag v-if="w.kpName" size="small" type="info" effect="plain">{{ w.kpName }}</el-tag>
              <span class="small muted">错 {{ w.wrongCount }} 次</span>
              <el-tag v-if="w.mastered" size="small" type="success" effect="light">已掌握</el-tag>
            </div>
            <div class="row" style="gap: 8px">
              <el-button size="small" text @click="toggle(w)">{{ expanded.has(w.errorId) ? '收起' : '答案与解析' }}</el-button>
              <el-button size="small" text type="primary" @click="retry(w)">
                {{ w.kpId ? '重练该知识点' : '重练本课程' }}
              </el-button>
              <el-button
                size="small"
                :type="w.mastered ? 'default' : 'primary'"
                :loading="marking === w.errorId"
                @click="toggleMastered(w)"
              >
                {{ w.mastered ? '取消已掌握' : '标记已掌握' }}
              </el-button>
            </div>
          </div>

          <div class="q-content">{{ w.content }}</div>

          <div v-if="w.lastWrongAnswer" class="small wrong-ans">
            我的错误答案：{{ w.lastWrongAnswer }}
          </div>

          <div v-if="expanded.has(w.errorId)" class="answer-box">
            <div class="small"><b>正确答案：</b>{{ w.answer }}</div>
            <div v-if="w.analysis" class="small mt8"><b>解析：</b>{{ w.analysis }}</div>
          </div>
        </el-card>
      </div>
      <EmptyState
        v-else-if="!loading"
        :desc="onlyUnmastered ? '没有待掌握的错题，继续保持！' : '还没有错题记录，做题时会自动收集'"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import PageHeader from '@/components/base/PageHeader.vue'
import { wrongBook, markWrongMastered } from '@/api/student/learning'

const router = useRouter()
import { myCourses } from '@/api/student/course'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const unmastered = ref(0)
const courses = ref([])
const courseId = ref(null)
const onlyUnmastered = ref(true)
const expanded = ref(new Set())
const marking = ref(null)

function typeLabel(t) {
  return { single: '单选', multi: '多选', judge: '判断', fill: '填空', short: '简答' }[t] || t || '题目'
}
function typeTag(t) {
  return { single: 'primary', multi: 'warning', judge: 'info', fill: 'success', short: 'danger' }[t] || 'info'
}

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    const d = await wrongBook({
      courseId: courseId.value || undefined,
      onlyUnmastered: onlyUnmastered.value
    })
    list.value = d?.list || []
    total.value = Number(d?.total || 0)
    unmastered.value = Number(d?.unmastered || 0)
    expanded.value = new Set()
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

function toggle(w) {
  const s = new Set(expanded.value)
  if (s.has(w.errorId)) s.delete(w.errorId)
  else s.add(w.errorId)
  expanded.value = s
}

/**
 * ★ 2026-10-27 错题 → 练习闭环：按错题所属知识点抽题（无 kpId 时退化为按课程）
 */
function retry(w) {
  router.push({
    name: 'StuPractice',
    query: {
      courseId: w.courseId,
      kpId: w.kpId || undefined,
      title: w.kpName ? `${w.kpName} · 错题重练` : '错题重练'
    }
  })
}

async function toggleMastered(w) {
  marking.value = w.errorId
  try {
    const next = !w.mastered
    await markWrongMastered(w.errorId, next)
    w.mastered = next
    unmastered.value = Math.max(0, unmastered.value + (next ? -1 : 1))
    ElMessage.success(next ? '已标记为掌握' : '已恢复为待掌握')
    // 只看未掌握时，标记后从列表移除
    if (next && onlyUnmastered.value) {
      list.value = list.value.filter((x) => x.errorId !== w.errorId)
    }
  } catch {
    // 拦截器已提示
  } finally {
    marking.value = null
  }
}

onMounted(async () => {
  courses.value = (await myCourses().catch(() => [])) || []
  await load()
})
</script>

<style scoped>
.filter-card {
  padding: 4px 0;
}
.stat {
  min-width: 64px;
}
.stat-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--brand-700);
  line-height: 1.2;
}
.wrong-card {
  padding: 2px 4px;
}
.q-content {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink-800, var(--ink-700));
  white-space: pre-wrap;
}
.wrong-ans {
  margin-top: 6px;
  color: var(--error);
}
.answer-box {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: 8px;
  line-height: 1.8;
  color: var(--ink-700);
}
</style>
