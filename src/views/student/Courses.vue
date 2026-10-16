<script setup>
/**
 * 我学的课（分支 stu-pc-course）
 * ★ 2026-10-15 数据源切换：GET /api/v1/stu/courses（stu-pc 模块自有接口，
 *   course_enrollment × course 直查本人已选课程；支持 keyword 搜索）。
 * 顶栏搜索框回车会带 ?keyword= 跳本页，页内 watch 重新拉取。
 * 视觉：ui-prototype/pc/student-courses.html（卡片网格 + 添加课程弹窗）
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { myCourses, searchCourses, enrollCourse } from '@/api/student/course'

const route = useRoute()
const router = useRouter()

const courses = ref([])
const offline = ref(false)
const loading = ref(false)

/** 课程图标：按课程名判定（与原型 sigma / languages / code-2 一致） */
function iconOf(name = '') {
  if (name.includes('数学')) return 'sigma'
  if (name.includes('英语')) return 'languages'
  if (name.includes('程序')) return 'code-2'
  if (name.includes('数据结构')) return 'layers'
  if (name.includes('物理')) return 'activity'
  return 'book-open'
}

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  try {
    const kw = route.query.keyword ? String(route.query.keyword) : ''
    const list = await myCourses(kw)
    const arr = Array.isArray(list) ? list : list?.list || []
    courses.value = arr.map((c) => ({
      courseId: c.courseId,
      courseName: c.courseName,
      courseCode: c.courseCode || '',
      teacherName: c.teacherName || '—',
      studentCount: c.studentCount ?? 0,
      enrollTime: c.enrollTime,
      status: c.status === 'active' || c.status === 'enrolled' || c.status === '进行中' ? '进行中' : '已结课',
      icon: iconOf(c.courseName)
    }))
    offline.value = false
  } catch {
    courses.value = []
    offline.value = true
  } finally {
    loading.value = false
  }
}

/* ---------------- 添加课程弹窗（真实接口） ----------------
 * 课程码加入：输入 6 位课程码（大写字母+数字组合，如 NK463D）→ 查询 → 课程卡 → 加入
 * 搜索课程：课程名 / 课程码模糊搜索（GET /api/v1/stu/courses/search，最多 10 条）→ 加入
 * 加入动作：POST /api/v1/courses/{courseId}/enroll {enrollType:'code', courseCode}（表 3-3）
 */
const addVisible = ref(false)
const addTab = ref('code')
const courseCode = ref('')
const kw = ref('')
const searching = ref(false)
const joining = ref(false)
/** 课程码精确命中的课程卡 */
const codeHit = ref(null)
/** 搜索 tab 结果列表 */
const searchList = ref([])

/** 课程码规则（2026-10-15 起）：6 位大写字母 + 数字组合，如 NK463D */
const CODE_RE = /^[A-Z0-9]{6}$/

function openAdd() {
  addTab.value = 'code'
  courseCode.value = ''
  kw.value = ''
  codeHit.value = null
  searchList.value = []
  addVisible.value = true
}

/** 课程码查询（精确命中课程码的排最前，取它） */
async function lookupCode() {
  const v = courseCode.value.trim().toUpperCase()
  courseCode.value = v
  if (!CODE_RE.test(v)) {
    ElMessage.warning('课程码格式不正确：应为 6 位大写字母/数字组合（如 NK463D）')
    return
  }
  searching.value = true
  codeHit.value = null
  try {
    const list = await searchCourses(v)
    const arr = Array.isArray(list) ? list : list?.list || []
    codeHit.value = arr.find((c) => (c.courseCode || '').toUpperCase() === v) || null
    if (!codeHit.value) ElMessage.warning('未找到该课程码对应的课程，请核对后重试')
  } catch {
    // 拦截器统一提示
  } finally {
    searching.value = false
  }
}

/** 关键词搜索（课程名 / 课程码） */
async function doSearch() {
  const v = kw.value.trim()
  if (!v) {
    ElMessage.warning('请输入课程名或课程码')
    return
  }
  searching.value = true
  try {
    const list = await searchCourses(v)
    searchList.value = Array.isArray(list) ? list : list?.list || []
  } catch {
    searchList.value = []
  } finally {
    searching.value = false
  }
}

/** 加入课程（表 3-3：enrollType=code + courseCode，courseId 传课程实际 ID） */
async function doJoin(c) {
  if (!c || c.enrolled) return
  joining.value = true
  try {
    await enrollCourse(c.courseId, { enrollType: 'code', courseCode: c.courseCode })
    ElMessage.success('已加入课程：' + c.courseName)
    addVisible.value = false
    await load()
  } catch {
    // 409 已选 / 404 不存在 / 其他 —— 拦截器统一提示
  } finally {
    joining.value = false
  }
}

const goDetail = (c) => router.push({ name: 'StuCourseDetail', params: { courseId: c.courseId } })
/** 「作业」按钮 → 新 UI 任务页（带课程筛选上下文；作业+实验统一流） */
const goHomeworks = (c) => router.push({ name: 'StuTasks', query: { courseId: c.courseId } })

/** 统计条 + 搜索态 */
const activeCount = computed(() => courses.value.filter((c) => c.status === '进行中').length)
function clearKeyword() {
  router.push({ path: '/student/courses' })
}

/** 卡片「…」菜单 */
async function onCardCmd(cmd, c) {
  if (cmd === 'copy') {
    if (!c.courseCode) return
    try {
      await navigator.clipboard.writeText(c.courseCode)
      ElMessage.success('课程码已复制：' + c.courseCode)
    } catch {
      ElMessage.info('课程码：' + c.courseCode)
    }
  } else if (cmd === 'homeworks') {
    goHomeworks(c)
  } else if (cmd === 'detail') {
    goDetail(c)
  }
}

/** 顶栏搜索（同路由只改 query 时组件复用，必须 watch） */
watch(() => route.query.keyword, load)
onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="我学的课" desc="已选课程、章节进度与快捷入口">
      <template #actions>
        <el-button type="primary" @click="openAdd"><BaseIcon name="plus" :size="15" />添加课程</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      class="mb16"
      type="warning"
      :closable="false"
      show-icon
      title="未取到课程数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 接口 GET /api/v1/stu/courses 可用"
    />

    <div class="toolbar">
      <span class="small muted">
        共 <b>{{ courses.length }}</b> 门课程 · 进行中 <b>{{ activeCount }}</b> 门
        <template v-if="route.query.keyword">
          · 搜索「{{ route.query.keyword }}」
          <el-link type="primary" style="margin-left: 4px" @click="clearKeyword">清除</el-link>
        </template>
      </span>
      <el-button size="small" @click="load"><BaseIcon name="refresh-cw" :size="14" />刷新</el-button>
    </div>

    <div class="grid g3">
      <el-card v-for="c in courses" :key="c.courseId" shadow="never" class="course-card" @click="goDetail(c)">
        <div class="top">
          <span class="icon-box lg"><BaseIcon :name="c.icon" :size="22" /></span>
          <div class="row" style="gap: 4px">
            <el-tag type="info" effect="light" :class="{ 'tag-plain': c.status !== '进行中' }">
              {{ c.status }}
            </el-tag>
            <el-dropdown trigger="click" @command="(cmd) => onCardCmd(cmd, c)">
              <span class="more" title="更多操作" @click.stop><BaseIcon name="more-horizontal" :size="16" /></span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="copy" :disabled="!c.courseCode">复制课程码</el-dropdown-item>
                  <el-dropdown-item command="homeworks">该课作业</el-dropdown-item>
                  <el-dropdown-item command="detail">课程详情</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
        <div class="mt12">
          <div class="name">{{ c.courseName }}</div>
          <div class="small muted mt8">
            {{ c.teacherName }} · {{ c.studentCount }} 人在学
            <span v-if="c.courseCode"> · {{ c.courseCode }}</span>
          </div>
          <div class="small muted mt4">选课时间：{{ fmtDate(c.enrollTime) }}</div>
        </div>
        <div class="btn-row">
          <el-button class="flex1" @click.stop="goDetail(c)">查看详情</el-button>
          <el-button type="primary" class="flex1" @click.stop="goHomeworks(c)">作业</el-button>
        </div>
      </el-card>
      <el-empty v-if="!courses.length && !loading" description="还没有课程，点右上角「添加课程」" />
    </div>

    <!-- 添加课程弹窗（课程码加入 / 搜索课程，均接真实接口） -->
    <el-dialog v-model="addVisible" title="添加课程" width="500px">
      <div class="center">
        <el-radio-group v-model="addTab">
          <el-radio-button value="code">课程码加入</el-radio-button>
          <el-radio-button value="search">搜索课程</el-radio-button>
        </el-radio-group>
      </div>

      <!-- ① 课程码加入：查询 → 课程卡 → 加入 -->
      <div v-if="addTab === 'code'" class="mt16">
        <div class="field-label">课程码</div>
        <div class="row" style="gap: 10px">
          <el-input
            v-model="courseCode"
            placeholder="输入教师提供的 6 位课程码，如 NK463D"
            maxlength="6"
            style="text-transform: uppercase; letter-spacing: 2px"
            @keyup.enter="lookupCode"
          />
          <el-button type="primary" :loading="searching" @click="lookupCode">查询课程</el-button>
        </div>
        <div class="small muted mt8">课程码由任课教师在课程管理中生成（大写字母 + 数字，共 6 位）。</div>

        <div v-if="codeHit" class="hit-card">
          <div style="flex: 1">
            <b>{{ codeHit.courseName }}</b>
            <div class="small muted" style="margin-top: 2px">
              {{ codeHit.teacherName || '—' }} · {{ codeHit.studentCount || 0 }} 人在学 · 课程码 {{ codeHit.courseCode }}
            </div>
          </div>
          <el-button
            type="primary"
            size="small"
            :disabled="!!codeHit.enrolled"
            :loading="joining"
            @click="doJoin(codeHit)"
          >
            {{ codeHit.enrolled ? '已加入' : '加入课程' }}
          </el-button>
        </div>
      </div>

      <!-- ② 搜索课程：课程名/课程码模糊搜索 → 列表 → 加入 -->
      <div v-else class="mt16">
        <div class="field-label">搜索课程（课程名 / 课程码）</div>
        <div class="row" style="gap: 10px">
          <el-input v-model="kw" placeholder="如：数据结构 / NK463D" @keyup.enter="doSearch" />
          <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
        </div>
        <div class="stack mt12" style="gap: 10px">
          <div v-for="c in searchList" :key="c.courseId" class="search-item">
            <span class="icon-box"><BaseIcon name="book-open" :size="16" /></span>
            <div style="flex: 1">
              <b class="small">{{ c.courseName }}</b>
              <div class="small muted" style="margin-top: 2px">
                {{ c.teacherName || '—' }} · {{ c.studentCount || 0 }} 人在学 · {{ c.courseCode }}
              </div>
            </div>
            <el-button
              type="primary"
              size="small"
              :disabled="!!c.enrolled"
              :loading="joining"
              @click="doJoin(c)"
            >
              {{ c.enrolled ? '已加入' : '加入' }}
            </el-button>
          </div>
          <div v-if="!searchList.length" class="center muted small" style="padding: 16px 0">
            输入课程名或课程码后点「搜索」
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="addVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.course-card {
  cursor: pointer;
  transition: 0.15s;
}
.course-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--sh-1);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.icon-box {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-box.lg {
  width: 44px;
  height: 44px;
  border-radius: var(--r-lg);
}
.name {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink-900);
}
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.flex1 {
  flex: 1;
}
.tag-plain {
  background: var(--bg-soft);
  color: var(--ink-500);
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.search-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.hit-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--brand-200);
  background: var(--primary-softer);
  border-radius: var(--r-md);
}
.mb16 {
  margin-bottom: 16px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.more {
  width: 26px;
  height: 26px;
  border-radius: var(--r-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-500);
  cursor: pointer;
}
.more:hover {
  background: var(--bg-soft);
  color: var(--ink-900);
}
</style>
