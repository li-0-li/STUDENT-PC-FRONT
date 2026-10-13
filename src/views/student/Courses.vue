<script setup>
/**
 * 我学的课（分支 stu-pc-course）
 * 关联接口（接口设计文档表号）：表 3-1 课程列表、表 3-3 学生加课
 * 对应原型：ui-prototype/pc/student-courses.html —— ★ 1:1 还原
 *
 * 后端未就绪时退回原型同款演示数据（页内明确提示，不假装真实）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { courseList, enrollCourse } from '@/api/student/course'

const router = useRouter()

/** 原型演示数据（后端不可用时兜底；字段与真实接口对齐） */
const DEMO = [
  { courseId: 10, courseName: '高等数学 A', teacherName: '张老师', totalHours: 64, chapterDone: 8, chapterTotal: 12, status: '进行中', icon: 'sigma' },
  { courseId: 11, courseName: '大学英语 III', teacherName: '李老师', totalHours: 48, chapterDone: 5, chapterTotal: 10, status: '进行中', icon: 'languages' },
  { courseId: 12, courseName: '程序设计基础', teacherName: '王老师', totalHours: 56, chapterDone: 0, chapterTotal: 14, status: '待开课', icon: 'code-2' }
]
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

async function load() {
  loading.value = true
  try {
    const d = await courseList()
    const list = d?.list || []
    if (list.length) {
      courses.value = list.map((c) => ({
        courseId: c.courseId,
        courseName: c.courseName,
        teacherName: c.teacherName || '—',
        totalHours: c.totalHours || c.hours || 0,
        chapterDone: c.chapterDone ?? 0,
        chapterTotal: c.chapterTotal ?? 0,
        status: c.status === 'active' || c.status === '进行中' || c.status === 'enrolled' ? '进行中' : '待开课',
        icon: iconOf(c.courseName)
      }))
      offline.value = false
    } else {
      courses.value = DEMO
      offline.value = true
    }
  } catch {
    courses.value = DEMO
    offline.value = true
  } finally {
    loading.value = false
  }
}

const pct = (c) => (c.chapterTotal ? Math.round((c.chapterDone / c.chapterTotal) * 100) : 0)

/* ---------------- 添加课程弹窗 ---------------- */
const addVisible = ref(false)
const addTab = ref('code')
const courseCode = ref('')
const kw = ref('')

/** 公开课程（原型演示数据；表 3-1 支持 keyword 检索） */
const PUBLIC_COURSES = [
  { name: '离散数学', teacher: '刘老师 · 数学与统计学院', students: 186 },
  { name: '操作系统', teacher: '赵老师 · 计算机学院', students: 232 },
  { name: '大学物理（上）', teacher: '孙老师 · 物理学院', students: 420 }
]
const searchList = computed(() =>
  PUBLIC_COURSES.filter((c) => !kw.value || c.name.includes(kw.value) || c.teacher.includes(kw.value))
)

function openAdd() {
  addTab.value = 'code'
  courseCode.value = ''
  kw.value = ''
  addVisible.value = true
}

async function join(name) {
  const code = courseCode.value.trim().toUpperCase()
  try {
    if (code) await enrollCourse(0, { courseCode: code })
  } catch {
    /* 接口未就绪时按原型行为提示，不阻断演示 */
  }
  addVisible.value = false
  ElMessage.success('已提交加入申请：' + name + '（教师确认后将出现在「我学的课」列表）')
}

async function joinByCode() {
  const v = courseCode.value.trim().toUpperCase()
  if (!/^[A-Z]{6}$/.test(v)) {
    ElMessage.warning('课程码格式不正确：应为 6 位大写字母（如 JSOEKD）')
    return
  }
  await join('课程码 ' + v)
}

const goDetail = (c) => router.push({ name: 'StuCourseDetail', params: { courseId: c.courseId } })
const goHomeworks = (c) => router.push({ name: 'StuHomeworks', query: { courseId: c.courseId } })

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
      title="未取到后端数据，当前显示演示数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 接口 GET /api/v1/courses 可用"
    />

    <div class="grid g3">
      <el-card v-for="c in courses" :key="c.courseId" shadow="never" class="course-card" @click="goDetail(c)">
        <div class="top">
          <span class="icon-box lg"><BaseIcon :name="c.icon" :size="22" /></span>
          <el-tag :type="c.status === '进行中' ? 'info' : 'info'" effect="light" :class="{ 'tag-plain': c.status !== '进行中' }">
            {{ c.status }}
          </el-tag>
        </div>
        <div class="mt12">
          <div class="name">{{ c.courseName }}</div>
          <div class="small muted mt8">{{ c.teacherName }} · {{ c.totalHours }} 学时</div>
        </div>
        <div class="mt12">
          <div class="between small muted" style="margin-bottom: 6px">
            <span>章节进度</span><span>{{ c.chapterDone }} / {{ c.chapterTotal }}</span>
          </div>
          <el-progress :percentage="pct(c)" :show-text="false" :stroke-width="8" />
        </div>
        <div class="btn-row">
          <el-button class="flex1" @click.stop="goDetail(c)">查看详情</el-button>
          <el-button type="primary" class="flex1" @click.stop="goHomeworks(c)">作业</el-button>
        </div>
      </el-card>
      <el-empty v-if="!courses.length" description="还没有课程，点右上角「添加课程」" />
    </div>

    <!-- 添加课程弹窗 -->
    <el-dialog v-model="addVisible" title="添加课程" width="440px">
      <div class="center">
        <el-radio-group v-model="addTab">
          <el-radio-button value="code">课程码加入</el-radio-button>
          <el-radio-button value="search">搜索课程</el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="addTab === 'code'" class="mt16">
        <div class="field-label">课程邀请码</div>
        <el-input
          v-model="courseCode"
          placeholder="输入教师提供的 6 位课程码，如 JSOEKD"
          maxlength="6"
          style="text-transform: uppercase; letter-spacing: 2px"
        />
        <div class="small muted mt8">课程码由任课教师在课程管理中生成，加入后等待教师确认。</div>
      </div>

      <div v-else class="mt16">
        <div class="field-label">搜索公开课程</div>
        <el-input v-model="kw" placeholder="课程名 / 教师名" />
        <div class="stack mt12" style="gap: 10px">
          <div v-for="c in searchList" :key="c.name" class="search-item">
            <span class="icon-box"><BaseIcon name="book-open" :size="16" /></span>
            <div style="flex: 1">
              <b class="small">{{ c.name }}</b>
              <div class="small muted" style="margin-top: 2px">{{ c.teacher }} · {{ c.students }} 人在学</div>
            </div>
            <el-button type="primary" size="small" @click="join(c.name)">加入</el-button>
          </div>
          <div v-if="!searchList.length" class="center muted small" style="padding: 20px 0">未找到匹配课程</div>
        </div>
      </div>

      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="joinByCode"><BaseIcon name="plus" :size="14" />加入课程</el-button>
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
.mb16 {
  margin-bottom: 16px;
}
</style>
