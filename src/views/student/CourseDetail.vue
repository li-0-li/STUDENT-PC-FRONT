<script setup>
/**
 * 章节作业（分支 stu-pc-course）
 * 关联接口：表 3-2 课程详情（GET /api/v1/courses/{id}：course + weeks + enrolled）、
 *           表 3-4 资源列表（GET /api/v1/courses/{id}/resources，fileUrl 经 /files 代理可下载）
 *           我的任务（GET /api/v1/stu/tasks，本题页「作业 / 实验」两个 tab 的真数据源）
 *
 * ★ 2026-10-16 重大修复 & 去演示数据：
 *   ① **修「点任何课都显示高等数学 A」**：原代码读 d.courseName（实际响应层级是
 *      data.course.courseName）→ 恒为 undefined → 页面永远显示原型写死的高等数学。
 *   ② 章节 / 作业 / 实验 / 资源全部改真接口：weeks 作章节、myTasks 过滤课程作作业与实验、
 *      resourceList 作资源；空即空态，不再有「教学大纲.pdf」等假文件。
 *   ③ 无 courseId 进入（侧栏「章节作业」直链）→ 显示选课列表，不再默认套某门课。
 *   ④ 退出课程：后端暂无退课接口 → 如实提示（不再假装提交申请）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { courseDetail, resourceList, myCourses } from '@/api/student/course'
import { myTasks } from '@/api/student/task'

const route = useRoute()
const router = useRouter()

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/student/courses')
}

const courseId = ref(Number(route.params.courseId) || 0)
const hasCourse = computed(() => courseId.value > 0)
const tab = ref('chapter')
const TABS = [
  { k: 'chapter', l: '章节' },
  { k: 'homework', l: '作业' },
  { k: 'resource', l: '资源' },
  { k: 'lab', l: '实验' }
]

const loading = ref(false)
const offline = ref(false)

/** 无 courseId 时的选课列表 */
const pickerList = ref([])

/** 课程信息（全部来自接口） */
const info = ref({
  courseName: '',
  courseCode: '',
  credit: null,
  hours: null,
  semester: '',
  studentCount: 0,
  status: '',
  icon: 'book-open'
})

/** 教学周目录（章节） */
const weeks = ref([])
/** 作业 / 实验（来自我的任务按课程过滤） */
const homeworks = ref([])
const labs = ref([])
/** 资源（fileUrl 经 /files 代理可下载） */
const resources = ref([])

const doneWeeks = computed(() => weeks.value.filter((w) => w.state === 'done').length)
const pct = computed(() =>
  weeks.value.length ? Math.round((doneWeeks.value / weeks.value.length) * 100) : 0
)

function iconOf(name = '') {
  if (name.includes('数学')) return 'sigma'
  if (name.includes('英语')) return 'languages'
  if (name.includes('程序')) return 'code-2'
  if (name.includes('数据结构')) return 'layers'
  if (name.includes('物理')) return 'activity'
  return 'book-open'
}

/** 文件大小：29 B / 18.6 KB / 2.4 MB；0 / null（上传未记录）显示 — */
function fmtSize(n) {
  if (n == null || n === 0) return '大小未记录'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

const fmtTime = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')
const isOverdue = (t) => !!t.deadline && new Date(t.deadline).getTime() < Date.now()

/** 任务状态文案（与「我的任务」页口径一致） */
function taskStatus(t) {
  if (t.score != null) return { text: '已批改 ' + t.score + ' 分', cls: 'success' }
  const st = (t.submitStatus || '').toLowerCase()
  if (st === 'graded') return { text: '已批改', cls: 'success' }
  if (st === 'submitted') return { text: '已提交', cls: 'success' }
  if (isOverdue(t)) return { text: '已截止', cls: 'info' }
  return { text: '待提交', cls: 'warning' }
}

/** 无 courseId：拉我的课程供选择 */
async function loadPicker() {
  try {
    const list = await myCourses()
    const arr = Array.isArray(list) ? list : list?.list || []
    pickerList.value = arr
  } catch {
    pickerList.value = []
  }
}

async function loadDetail() {
  loading.value = true
  offline.value = false
  try {
    const d = await courseDetail(courseId.value)
    const c = d?.course || {}
    info.value = {
      courseName: c.courseName || '课程详情',
      courseCode: c.courseCode || '',
      credit: c.credit,
      hours: c.hours,
      semester: c.semester || '',
      studentCount: c.studentCount ?? 0,
      status: c.status || '',
      icon: iconOf(c.courseName)
    }

    // 章节 = 教学周目录
    weeks.value = (d?.weeks || []).map((w) => ({
      title: `第 ${w.weekNum} 周${w.title ? ' · ' + w.title : ''}`,
      sub: w.description || w.title || '教学周',
      state: w.status === 'done' ? 'done' : 'current'
    }))

    // 作业 / 实验 = 我的任务按课程过滤
    const t = await myTasks().catch(() => [])
    const tasks = Array.isArray(t) ? t : t?.list || []
    const ofCourse = tasks.filter((x) => Number(x.courseId) === courseId.value)
    homeworks.value = ofCourse
      .filter((x) => x.taskType === 'homework')
      .map((x) => ({ ...x, st: taskStatus(x) }))
    labs.value = ofCourse
      .filter((x) => x.taskType === 'experiment')
      .map((x) => ({ ...x, st: taskStatus(x) }))

    // 资源
    const r = await resourceList(courseId.value).catch(() => null)
    resources.value = (r?.list || []).map((x) => ({
      name: x.fileName || '未命名文件',
      sub: fmtSize(x.fileSize) + (x.fileType ? ' · ' + String(x.fileType).toUpperCase() : ''),
      icon: String(x.fileType || '').includes('video') ? 'video' : 'file-text',
      fileUrl: x.fileUrl || ''
    }))
  } catch {
    offline.value = true
  } finally {
    loading.value = false
  }
}

/** 无参模式下选择课程 */
async function pickCourse(c) {
  router.replace({ name: 'StuCourseDetail', params: { courseId: c.courseId } })
  courseId.value = Number(c.courseId)
  tab.value = 'chapter'
  await loadDetail()
}

/** 任务行点击（与「我的任务」页同款跳转） */
function openTask(t) {
  if (t.taskType === 'experiment') router.push({ name: 'StuLab' })
  else router.push({ name: 'StuHomeworkAnswer', params: { assignmentId: t.taskRefId } })
}

/** 资源预览（跳共享预览页） */
function preview(r) {
  router.push({
    name: 'StuResourcePreview',
    query: { type: r.icon === 'video' ? 'video' : 'doc', title: r.name, sub: r.sub }
  })
}

/** 资源下载：仅 http(s) 地址可下载；local:// 等伪协议（教师端本地直传测试数据）如实提示 */
function download(r) {
  const u = r?.fileUrl || ''
  if (/^https?:\/\//i.test(u)) {
    window.open(u, '_blank')
  } else {
    ElMessage.info('该资源暂无有效下载地址（教师端上传记录异常，请联系教师重新上传）')
  }
}

async function quitCourse() {
  try {
    await ElMessageBox.confirm(
      `确定退出《${info.value.courseName}》吗？退出后将无法查看课程内容，学习记录保留 30 天，重新加入可恢复。`,
      '退出课程',
      { confirmButtonText: '确定退出', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  // 后端暂未提供退课接口（查无 unenroll 路由）→ 如实提示，不假装成功
  ElMessage.info('退课功能暂未开放（后端接口未提供），请联系任课教师处理')
}

onMounted(() => {
  if (hasCourse.value) loadDetail()
  else loadPicker()
})
</script>

<template>
  <div v-loading="loading">
    <!-- 无 courseId：选择课程（侧栏「章节作业」直链入口） -->
    <template v-if="!hasCourse">
      <div class="between mb16">
        <div>
          <h1 class="h1">章节作业</h1>
          <div class="small muted mt6">选择一门课程查看章节、作业与资源</div>
        </div>
      </div>
      <el-card shadow="never">
        <EmptyState v-if="!pickerList.length" desc="暂无已选课程，先去「我的课程」添加一门吧">
          <el-button type="primary" @click="router.push({ name: 'StuCourses' })">去我的课程</el-button>
        </EmptyState>
        <div v-else class="stack" style="gap: 10px">
          <div v-for="c in pickerList" :key="c.courseId" class="rowline pick" @click="pickCourse(c)">
            <div class="row">
              <span class="icon-box"><BaseIcon :name="iconOf(c.courseName)" :size="18" /></span>
              <div>
                <b class="small">{{ c.courseName }}</b>
                <div class="small muted">{{ c.teacherName }} · {{ c.courseCode || '—' }}</div>
              </div>
            </div>
            <BaseIcon name="chevron-right" :size="16" class="muted" />
          </div>
        </div>
      </el-card>
    </template>

    <template v-else>
      <!-- 课程头部 -->
      <el-card shadow="never">
        <div class="between">
          <div class="row">
            <el-button text circle title="返回上一页" @click="goBack">
              <BaseIcon name="arrow-left" :size="17" />
            </el-button>
            <span class="icon-box lg"><BaseIcon :name="info.icon" :size="22" /></span>
            <div>
              <div class="row" style="gap: 10px">
                <h1 class="h1">{{ info.courseName }}</h1>
                <el-tag v-if="info.status" type="info" effect="light">{{ info.status }}</el-tag>
              </div>
              <div class="muted small mt8">
                课程码 {{ info.courseCode || '—' }}<template v-if="info.credit"> · {{ info.credit }} 学分</template>
                <template v-if="info.hours"> · {{ info.hours }} 学时</template>
                <template v-if="info.semester"> · {{ info.semester }}</template>
              </div>
            </div>
          </div>
          <div style="text-align: right">
            <template v-if="weeks.length">
              <div class="small muted">章节进度 {{ doneWeeks }} / {{ weeks.length }}</div>
              <el-progress :percentage="pct" :show-text="false" :stroke-width="8" style="width: 180px; margin: 8px 0" />
            </template>
            <div v-else class="small muted" style="margin-bottom: 8px">教学周待教师发布</div>
            <el-button size="small" class="quit" @click="quitCourse"><BaseIcon name="log-out" :size="14" />退出课程</el-button>
          </div>
        </div>
      </el-card>

      <el-alert
        v-if="offline"
        class="mt16"
        type="warning"
        :closable="false"
        show-icon
        title="课程数据加载失败"
        description="请确认后端与 SSH 隧道已启动，稍后重试"
      />

      <!-- 面板切换 -->
      <div class="mt16">
        <el-radio-group v-model="tab">
          <el-radio-button v-for="t in TABS" :key="t.k" :value="t.k">{{ t.l }}</el-radio-button>
        </el-radio-group>
      </div>

      <div class="two-col mt16">
        <div class="stack">
          <!-- 章节 -->
          <el-card v-show="tab === 'chapter'" shadow="never">
            <div class="card-title">章节（教学周）</div>
            <el-table v-if="weeks.length" :data="weeks">
              <el-table-column label="章节" min-width="300">
                <template #default="{ row }">
                  <div class="row">
                    <BaseIcon
                      :name="row.state === 'done' ? 'circle-check' : 'play'"
                      :size="18"
                      :class="row.state === 'done' ? 'ic-done' : 'ic-cur'"
                    />
                    <b>{{ row.title }}</b>
                  </div>
                  <div class="small muted mt8">{{ row.sub }}</div>
                </template>
              </el-table-column>
              <el-table-column width="120" align="right">
                <template #default="{ row }">
                  <el-tag :type="row.state === 'done' ? 'success' : 'primary'" effect="light">
                    {{ row.state === 'done' ? '已完成' : '进行中' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
            <div v-else class="empty-wrap">
              <EmptyState desc="教师尚未发布教学章节，发布后会在这里按周显示" />
            </div>
          </el-card>

          <!-- 作业 -->
          <el-card v-show="tab === 'homework'" shadow="never">
            <div class="card-title">作业</div>
            <el-table v-if="homeworks.length" :data="homeworks">
              <el-table-column label="作业" min-width="220">
                <template #default="{ row }">
                  <b>{{ row.title }}</b>
                  <div v-if="row.weekNum" class="small muted mt8">第 {{ row.weekNum }} 周</div>
                </template>
              </el-table-column>
              <el-table-column label="截止时间" width="160">
                <template #default="{ row }">{{ fmtTime(row.deadline) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="130">
                <template #default="{ row }">
                  <el-tag :type="row.st.cls" effect="light">{{ row.st.text }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110" align="right">
                <template #default="{ row }">
                  <el-button size="small" :type="row.st.text === '待提交' ? 'primary' : ''" @click="openTask(row)">
                    {{ row.st.text === '待提交' ? '去作答' : '查看' }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <div v-else class="empty-wrap">
              <EmptyState desc="老师还没有布置作业，先看看课程资源或教学章节吧">
                <el-button size="small" @click="tab = 'chapter'">去看章节</el-button>
                <el-button size="small" @click="tab = 'resource'">看课程资源</el-button>
              </EmptyState>
            </div>
          </el-card>

          <!-- 资源 -->
          <el-card v-show="tab === 'resource'" shadow="never">
            <div class="card-title">课程资源</div>
            <div v-if="resources.length" class="stack" style="gap: 10px">
              <div v-for="(r, i) in resources" :key="i" class="rowline">
                <div class="row">
                  <BaseIcon :name="r.icon" :size="18" class="ic-brand" />
                  <div>
                    <b class="small">{{ r.name }}</b>
                    <div class="small muted">{{ r.sub }}</div>
                  </div>
                </div>
                <div class="row" style="gap: 8px">
                  <el-button size="small" @click="preview(r)">
                    <BaseIcon name="eye" :size="13" />预览
                  </el-button>
                  <el-button size="small" @click="download(r)">
                    <BaseIcon name="download" :size="13" />下载
                  </el-button>
                </div>
              </div>
            </div>
            <div v-else class="empty-wrap">
              <EmptyState desc="该课程暂无资源，等教师上传后会在这里显示（支持在线预览与下载）" />
            </div>
          </el-card>

          <!-- 实验 -->
          <el-card v-show="tab === 'lab'" shadow="never">
            <div class="card-title">实验</div>
            <div v-if="labs.length" class="stack" style="gap: 12px">
              <div v-for="l in labs" :key="l.taskRefId" class="rowline">
                <div>
                  <div class="lab-name">{{ l.title }}</div>
                  <div class="small muted">
                    截止 {{ fmtTime(l.deadline) }}<template v-if="l.weekNum"> · 第 {{ l.weekNum }} 周</template>
                  </div>
                </div>
                <div class="row" style="gap: 8px">
                  <el-tag :type="l.st.cls" effect="light">{{ l.st.text }}</el-tag>
                  <el-button size="small" :type="l.st.text === '待提交' ? 'primary' : ''" @click="openTask(l)">
                    {{ l.st.text === '待提交' ? '去完成' : '查看' }}
                  </el-button>
                </div>
              </div>
            </div>
            <div v-else class="empty-wrap">
              <EmptyState desc="老师还没有布置实验任务，布置后会在这里显示并支持上传实验报告">
                <el-button size="small" @click="router.push({ name: 'StuTasks', query: { courseId, taskType: 'experiment' } })">
                  去「我的任务」看看
                </el-button>
              </EmptyState>
            </div>
          </el-card>
        </div>

        <!-- 右栏：课程信息 -->
        <div class="stack">
          <el-card shadow="never">
            <div class="card-title">课程信息</div>
            <div class="pf-row"><span class="k">课程码</span><span class="small mono">{{ info.courseCode || '—' }}</span></div>
            <div class="pf-row"><span class="k">学分 / 学时</span><span class="small">{{ info.credit ?? '—' }} / {{ info.hours ?? '—' }}</span></div>
            <div class="pf-row"><span class="k">学期</span><span class="small">{{ info.semester || '—' }}</span></div>
            <div class="pf-row"><span class="k">在学人数</span><span class="small">{{ info.studentCount }} 人</span></div>
            <div class="pf-row"><span class="k">教学周</span><span class="small">{{ weeks.length ? weeks.length + ' 周（已完成 ' + doneWeeks + '）' : '待发布' }}</span></div>
            <div class="pf-row"><span class="k">我的任务</span><span class="small">{{ homeworks.length }} 作业 · {{ labs.length }} 实验</span></div>
            <div class="row mt12" style="gap: 10px">
              <el-button size="small" @click="router.push({ name: 'StuTasks', query: { courseId } })">
                <BaseIcon name="clipboard-list" :size="14" />全部任务
              </el-button>
              <el-button size="small" @click="tab = 'resource'">
                <BaseIcon name="folder-open" :size="14" />课程资源
              </el-button>
            </div>
          </el-card>
        </div>
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
.icon-box {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.icon-box.lg {
  width: 48px;
  height: 48px;
  border-radius: var(--r-lg);
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.two-col {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  align-items: start;
}
.rowline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.rowline:last-child {
  border-bottom: none;
}
.pick {
  cursor: pointer;
  border-radius: var(--r-md);
  padding: 12px 10px;
  transition: 0.15s;
}
.pick:hover {
  background: var(--primary-softer);
}
.ic-done {
  color: var(--success);
  flex: none;
}
.ic-cur {
  color: var(--brand-600);
  flex: none;
}
.ic-brand {
  color: var(--brand-600);
  flex: none;
}
.quit {
  color: var(--error);
  border-color: #fca5a5;
}
.lab-name {
  font-weight: 600;
  font-size: 13px;
}
.empty-wrap {
  padding: 6px 0;
}
.empty-wrap :deep(.el-empty) {
  padding: 26px 0;
}
.pf-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 13.5px;
}
.pf-row:last-of-type {
  border-bottom: none;
}
.pf-row .k {
  color: var(--ink-500);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mt12 {
  margin-top: 12px;
}
.mb16 {
  margin-bottom: 16px;
}
.mt6 {
  margin-top: 6px;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
