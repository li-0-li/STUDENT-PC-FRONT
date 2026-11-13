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
import {
  courseDetail,
  resourceList,
  myCourses,
  kbSearch,
  announcementList,
  withdrawCourse,
  weekLessons
} from '@/api/student/course'
import { myTasks } from '@/api/student/task'
import { resolveMediaUrl } from '@/utils/media'

const route = useRoute()
const router = useRouter()

/* ---------------- ★ 2026-10-22 课件内容搜索（本地知识库检索） ---------------- */
const kbKw = ref('')
const kbLoading = ref(false)
const kbResults = ref(null) // null=未搜索
const kbSearched = ref('')

async function searchKb() {
  const kw = kbKw.value.trim()
  if (!kw) {
    kbResults.value = null
    kbSearched.value = ''
    return
  }
  if (kbLoading.value) return
  kbLoading.value = true
  try {
    kbResults.value = await kbSearch(courseId.value, kw)
    kbSearched.value = kw
  } catch {
    kbResults.value = []
  } finally {
    kbLoading.value = false
  }
}
function clearKb() {
  kbKw.value = ''
  kbResults.value = null
  kbSearched.value = ''
}
/** 安全高亮：把文本按关键词切成 [{text, hit}]，模板逐段渲染（不用 v-html） */
function hlParts(text, kw) {
  const t = String(text || '')
  const k = String(kw || '')
  if (!k) return [{ text: t, hit: false }]
  const parts = []
  let i = 0
  while (i < t.length) {
    const j = t.indexOf(k, i)
    if (j < 0) {
      parts.push({ text: t.slice(i), hit: false })
      break
    }
    if (j > i) parts.push({ text: t.slice(i, j), hit: false })
    parts.push({ text: k, hit: true })
    i = j + k.length
  }
  return parts
}
/** 命中的片段打开原资源（种子数据无 resourceId 时如实提示） */
function openKbHit(hit) {
  if (!hit?.resourceId) {
    ElMessage.info('该片段来自课程讲义（演示种子），暂无对应文件；可在资源列表中查看课件')
    return
  }
  const r = resources.value.find((x) => String(x.resourceId) === String(hit.resourceId))
  if (r) preview(r)
  else ElMessage.info('原文件不在当前资源列表中（可能已删除）')
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/student/courses')
}

const courseId = ref(Number(route.params.courseId) || 0)
const hasCourse = computed(() => courseId.value > 0)
const tab = ref('chapter')
const TABS = [
  { k: 'chapter', l: '章节' },
  { k: 'announce', l: '公告' },
  { k: 'homework', l: '作业' },
  { k: 'resource', l: '资源' },
  { k: 'lab', l: '实验' }
]

const loading = ref(false)
/** 退课请求进行中（防重复点击） */
const quitting = ref(false)
/** 未选课：后端返回 enrolled=false 时拦截课程内容 */
const notEnrolled = ref(false)
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

/** 课程大纲（course_week）：只用来给章配名字，不再当章节骨架 */
const weeks = ref([])
/** 作业 / 实验（来自我的任务按课程过滤） */
const homeworks = ref([])
const labs = ref([])
/** 资源（fileUrl 经 /files 代理可下载） */
const resources = ref([])

/**
 * ★ 2026-11-13 章节目录改为「老师传了什么资料，就有什么章」
 *
 * 口径（按用户 2026-11-13 反馈重做）：
 *   · 章 = 老师上传资料时挂的章号（resource_file.week_num），**不再以教学周为骨架**；
 *   · 只列「真的有资料」的章；章名取课程大纲里同章号的标题（老师没排大纲就只有章号）；
 *   · 大纲里排了、但一份资料都没有的章不再逐条占版面，收成底部一行
 *     「第 X、Y 章老师还没有上传」——这就是「没有就说老师没上传」；
 *   · week_num 为 NULL 的资料（教师端直接上传没挂章）→ 单独一块「未归章资料」。
 */
const openChapters = ref({})

const chapterList = computed(() => {
  const byWeek = new Map()
  const loose = []
  resources.value.forEach((f) => {
    if (f.weekNum == null || Number.isNaN(f.weekNum)) {
      loose.push(f)
      return
    }
    if (!byWeek.has(f.weekNum)) byWeek.set(f.weekNum, [])
    byWeek.get(f.weekNum).push(f)
  })

  const outline = new Map(weeks.value.map((w) => [w.week, w]))
  const list = []
  byWeek.forEach((files, no) => {
    const w = outline.get(no)
    list.push({ no, name: w?.title || '', desc: w?.sub || '', files })
  })
  list.sort((a, b) => a.no - b.no)

  // 大纲排了、但老师没传资料的章（只留章号，底部一行提示）
  const missing = weeks.value
    .filter((w) => !byWeek.has(w.week))
    .map((w) => w.week)
    .sort((a, b) => a - b)

  return { list, loose, missing }
})

/** 有资料的章数 / 文件数 / 未上传章数 */
const chapterStat = computed(() => ({
  total: chapterList.value.list.length,
  files: resources.value.length,
  missing: chapterList.value.missing.length
}))

/** 章默认展开：有资料的展开、空章收起 */
function isChapterOpen(no) {
  const v = openChapters.value[no]
  if (v != null) return v
  const c = chapterList.value.list.find((x) => x.no === no)
  return !!(c && c.files.length)
}
function toggleChapter(no) {
  openChapters.value = { ...openChapters.value, [no]: !isChapterOpen(no) }
}

/* ------------------------------------------------------------------
 * ★ 2026-11-13 资源页改为「周 → 课次」分类
 *
 * 口径（与小程序「全部排课」、教师端同一套）：
 *   · 周块骨架 = GET /courses/{id}/week-lessons（周次按学期起始日推导，不用 week_ref）；
 *   · 每次课（schedule）下挂 resource_file.schedule_id 指向它的资料 —— 这是老师
 *     上传时明确选的「这次课的资料」，最准；
 *   · schedule_id 为空、只填了周次的资料 → 「本周共用」，挂在对应周块；
 *   · 挂了课次但排课表里查不到（课次被删/换班）或周次不在排课范围 → 兜底单列，
 *     不能让学生看不到文件。
 * ------------------------------------------------------------------ */
const lessonWeeks = ref([])
const termInfo = ref(null)
const openWeeks = ref({})

/** classTime "2026-10-26T14:30:00" → "10-26 14:30" */
function fmtClassTime(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(t || '')
}

const currentWeekNo = computed(() => termInfo.value?.currentWeek ?? null)

const resourceWeeks = computed(() => {
  const bySchedule = new Map()
  const byWeek = new Map()
  const orphan = []
  resources.value.forEach((f) => {
    if (f.scheduleId) {
      const id = Number(f.scheduleId)
      if (!bySchedule.has(id)) bySchedule.set(id, [])
      bySchedule.get(id).push(f)
    } else if (f.weekNum != null) {
      if (!byWeek.has(f.weekNum)) byWeek.set(f.weekNum, [])
      byWeek.get(f.weekNum).push(f)
    } else {
      orphan.push(f)
    }
  })

  const scheduled = new Set()
  const blocks = []
  const weekMap = new Map()
  lessonWeeks.value.forEach((w) => {
    const block = {
      weekNum: w.weekNum == null ? null : Number(w.weekNum),
      groups: (w.lessons || []).map((l) => {
        const id = Number(l.scheduleId)
        scheduled.add(id)
        return {
          key: 'ls-' + id,
          title: l.periodNo ? l.periodNo + '节' : '课次',
          sub: [fmtClassTime(l.classTime), l.classroomName].filter(Boolean).join(' · '),
          files: bySchedule.get(id) || []
        }
      }),
      commonFiles: []
    }
    blocks.push(block)
    if (block.weekNum != null) weekMap.set(block.weekNum, block)
  })

  // 只标了周次、没挂课次的资料 → 本周共用；周次不在排课里则补一个只有资料的周块
  byWeek.forEach((files, wk) => {
    const hit = weekMap.get(wk)
    if (hit) {
      hit.commonFiles.push(...files)
    } else {
      const block = { weekNum: wk, groups: [], commonFiles: [...files] }
      blocks.push(block)
      weekMap.set(wk, block)
    }
  })

  // 挂了课次但排课里查不到 → 兜底，不丢文件
  const stray = []
  bySchedule.forEach((files, id) => {
    if (!scheduled.has(id)) stray.push(...files)
  })

  blocks.sort((a, b) => (a.weekNum ?? 9999) - (b.weekNum ?? 9999))
  blocks.forEach((b) => {
    if (b.commonFiles.length) {
      b.groups.push({
        key: 'common-' + (b.weekNum ?? 'x'),
        title: '本周共用',
        sub: '老师没有指定具体课次',
        files: b.commonFiles
      })
    }
    b.fileCount = b.groups.reduce((n, g) => n + g.files.length, 0)
    b.lessonCount = b.groups.filter((g) => !g.key.startsWith('common-')).length
  })
  return { blocks, stray, orphan }
})

/** 周默认展开：有资料的展开、没资料的收起（一门课几十次课，全展开太长） */
function isWeekOpen(no) {
  const v = openWeeks.value[no]
  if (v != null) return v
  const b = visibleWeeks.value.find((x) => x.weekNum === no)
  return !!(b && b.fileCount)
}
function toggleWeek(no) {
  openWeeks.value = { ...openWeeks.value, [no]: !isWeekOpen(no) }
}

/**
 * ★ 2026-11-13 二次调整：整学期的周按序号 1…N 全部铺出来。
 *
 * 后端 week-lessons 只返回「有课次安排」的周（如 course 13 只有 7、10…27，
 * 缺 1~6、8、9），直接渲染会跳号，学生顺着往下找会以为漏数据。
 * 这里按「1 ~ max(学期总周数, 排课最大周号)」补齐缺号的空周，
 * 没资料/没排课的周只留一行标题、默认收起，点开可看（多为「本周无排课」）。
 */
const visibleWeeks = computed(() => {
  const blocks = resourceWeeks.value.blocks
  const nums = blocks.map((b) => b.weekNum).filter((n) => n != null && !Number.isNaN(n))
  const maxNo = Math.max(termInfo.value?.totalWeeks || 0, ...nums, 0)
  const byNo = new Map(blocks.filter((b) => b.weekNum != null).map((b) => [b.weekNum, b]))
  const list = []
  for (let i = 1; i <= maxNo; i++) {
    list.push(byNo.get(i) || { weekNum: i, groups: [], commonFiles: [], fileCount: 0, lessonCount: 0 })
  }
  // 未分周 / 超出学期范围的兜底块排最后
  blocks.filter((b) => b.weekNum == null || b.weekNum > maxNo).forEach((b) => list.push(b))
  return list
})

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

/* ---------------- ★ 2026-10-27 课程公告（stu-pc /announcements） ---------------- */
const anns = ref([])
const annLoading = ref(false)
const annKeyword = ref('')
const annExpanded = ref({})

async function loadAnnouncements() {
  annLoading.value = true
  try {
    const d = await announcementList({
      courseId: courseId.value,
      keyword: annKeyword.value || undefined,
      pageSize: 20
    })
    anns.value = d?.list || []
  } catch {
    anns.value = [] // 拦截器已提示，空态兜底
  } finally {
    annLoading.value = false
  }
}
function toggleAnn(id) {
  annExpanded.value = { ...annExpanded.value, [id]: !annExpanded.value[id] }
}

async function loadDetail() {
  loading.value = true
  offline.value = false
  notEnrolled.value = false
  try {
    const d = await courseDetail(courseId.value)

    /**
     * ★ 2026-10-30 补「未选课访问权限控制」（三级功能清单 · 浏览章节资源）
     * 后端 GET /api/v1/courses/{id} 会按角色返回 enrolled 标志，但**不拒绝**访问，
     * 此前前端也没用这个字段 —— 未选课的学生直接拼 URL 就能看到课程内容。
     * 这里按 enrolled===false 拦一层（教师/管理员后端已算成 true，不受影响）。
     */
    if (d && d.enrolled === false) {
      notEnrolled.value = true
      loading.value = false
      return
    }

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

    // 章节：老师上传资料挂的章（不再用教学周当骨架）
    // ★ 2026-11-13 移除 course-progress 请求：章节页不再展示「按教学周」的学习进度，
    //   避免周次（1~8 教学周）与章号（老师上传时选的章）两套口径混在一起。
    weeks.value = (d?.weeks || []).map((w) => ({
      week: w.weekNum,
      title: w.title || '',
      sub: w.description || '',
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

    // 资源 + ★ 2026-11-13 「周 → 课次」骨架（并行；任一失败都不影响另一项）
    const [r, wl] = await Promise.all([
      resourceList(courseId.value, null, null, null, null, { page: 1, pageSize: 200 }).catch(() => null),
      weekLessons(courseId.value).catch(() => null)
    ])
    termInfo.value = wl || null
    lessonWeeks.value = wl?.weeks || []
    resources.value = (r?.list || []).map((x) => ({
      id: x.resourceId,
      name: x.fileName || '未命名文件',
      sub: fmtSize(x.fileSize) + (x.fileType ? ' · ' + String(x.fileType).toUpperCase() : ''),
      icon: String(x.fileType || '').includes('video') ? 'video' : 'file-text',
      fileUrl: x.fileUrl || '',
      /** 挂载周次；NULL 表示老师上传时没挂章 */
      weekNum: x.weekNum == null ? null : Number(x.weekNum),
      /** ★ 挂载课次：教师端上传时选的「这次课」，后端对历史数据会按上传时间就近补 */
      scheduleId: x.scheduleId == null ? null : Number(x.scheduleId),
      rtype: x.resourceType || ''
    }))

    // ★ 2026-10-27 公告（独立请求，失败不影响主流程）
    loadAnnouncements()
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

/**
 * 资源地址归一（★ 2026-11-12）：后端 file_url 在库里/响应里有 4 种形态
 *   · `https://...`              外链或 MinIO 预签名（原样用）
 *   · `/files/RESOURCE/...`      后端 normalizeFileUrl 补过前缀的现行主形态
 *   · `/RESOURCE/...`、`RESOURCE/...`  历史未补前缀的裸对象名
 *   · `/demo/*`、`local://*`     种子演示数据 / 教师端本地直传占位 —— 桶里从来没有实体文件
 * 前三种统一成同域可访问地址；占位形态返回 ''，由调用方提示「无实体文件」。
 *
 * 背景：2026-11-12 运维把 Nginx `/files/` 从「转发后端（必 404）」改为「直连 MinIO」，
 * 寻址已通，但下载按钮原来只认 http(s) 绝对地址，反而把可用的 `/files/...` 挡掉了。
 */
function resourceUrlOf(raw) {
  const u = String(raw || '').trim()
  if (!u) return ''
  // 占位形态：伪协议 / 演示种子 / 后端给 local:// 误补前缀后的 /files/local://
  if (/^(local:|\/demo\/|\/files\/local:)/i.test(u)) return ''
  return resolveMediaUrl(u)
}

/** 资源预览（跳共享预览页；带上真实 fileUrl，预览页按扩展名内嵌渲染） */
function preview(r) {
  router.push({
    name: 'StuResourcePreview',
    query: {
      type: r.icon === 'video' ? 'video' : 'doc',
      title: r.name,
      sub: r.sub,
      url: resourceUrlOf(r.fileUrl)
    }
  })
}

/** 资源下载：同域 `/files/...` 与 http(s) 外链都能直接打开；占位记录如实提示 */
function download(r) {
  const u = resourceUrlOf(r?.fileUrl)
  if (u) {
    window.open(u, '_blank')
  } else {
    ElMessage.info('该资源暂无实体文件（演示占位或上传未完成），请联系教师重新上传')
  }
}

async function quitCourse() {
  if (quitting.value) return
  try {
    await ElMessageBox.confirm(
      `确定退出《${info.value.courseName}》吗？退出后该课程将从「我的课」移除，历史作业与成绩记录仍会保留。`,
      '退出课程',
      { confirmButtonText: '确定退出', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  quitting.value = true
  try {
    await withdrawCourse(info.value.courseId)
    ElMessage.success('已退出课程')
    router.push({ name: 'StuCourses' })
  } catch {
    // 404/409 等由拦截器统一提示
  } finally {
    quitting.value = false
  }
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

    <!-- 未选课拦截：后端只返回 enrolled=false 不拒绝，前端在此挡住课程内容 -->
    <template v-else-if="notEnrolled">
      <el-card shadow="never">
        <EmptyState desc="你不在该课程的选课名单内，无法查看课程内容">
          <el-button type="primary" @click="router.push({ name: 'StuCourses' })">去我的课程</el-button>
        </EmptyState>
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
              <div class="small muted">教学周进度 {{ doneWeeks }} / {{ weeks.length }}</div>
              <el-progress :percentage="pct" :show-text="false" :stroke-width="8" style="width: 180px; margin: 8px 0" />
            </template>
            <div v-else class="small muted" style="margin-bottom: 8px">教学周待教师发布</div>
            <div class="row" style="gap: 8px; justify-content: flex-end">
              <el-button
                size="small"
                type="primary"
                @click="router.push({ name: 'StuLive', query: { courseId, courseName: info.courseName || '' } })"
              >
                <BaseIcon name="presentation" :size="14" />进入课堂
              </el-button>
              <el-button size="small" class="quit" @click="quitCourse"><BaseIcon name="log-out" :size="14" />退出课程</el-button>
            </div>
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
          <!-- 章节（★ 2026-11-13 老师传了什么资料，就有什么章） -->
          <el-card v-show="tab === 'chapter'" shadow="never">
            <div class="between" style="margin-bottom: 4px">
              <div class="card-title" style="margin-bottom: 0">课程章节</div>
              <div class="small muted">
                {{ chapterStat.total }} 章有资料 · {{ chapterStat.files }} 份文件
              </div>
            </div>
            <div class="small muted" style="margin-bottom: 14px">
              按老师上传的课程资料归章，老师传到第几章就显示第几章
            </div>

            <template v-if="chapterList.list.length || chapterList.loose.length">
              <div class="ch-list">
                <div v-for="c in chapterList.list" :key="'ch-' + c.no" class="ch-item">
                  <div class="ch-head" @click="toggleChapter(c.no)">
                    <div class="row ch-head-main">
                      <span class="ch-no">第 {{ c.no }} 章</span>
                      <b v-if="c.name" class="ch-name">{{ c.name }}</b>
                      <el-tag size="small" type="success" effect="light">
                        {{ c.files.length }} 份资料
                      </el-tag>
                    </div>
                    <BaseIcon :name="isChapterOpen(c.no) ? 'chevron-down' : 'chevron-right'" :size="16" />
                  </div>

                  <div v-show="isChapterOpen(c.no)" class="ch-body">
                    <div class="stack" style="gap: 6px">
                      <div v-for="f in c.files" :key="'f-' + f.id" class="file-row">
                        <BaseIcon :name="f.icon" :size="18" class="file-ic" />
                        <div class="file-main">
                          <div class="file-name">{{ f.name }}</div>
                          <div class="small muted">{{ f.sub }}</div>
                        </div>
                        <el-button size="small" text type="primary" @click.stop="preview(f)">预览</el-button>
                        <el-button size="small" text @click.stop="download(f)">下载</el-button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 大纲排了、但老师还没传资料的章：一行说清，不逐条占版面 -->
              <div v-if="chapterList.missing.length" class="ch-missing small muted">
                <BaseIcon name="info" :size="13" />
                第 {{ chapterList.missing.join('、') }} 章老师还没有上传资料
              </div>

              <!-- 老师上传时没挂章的资料：不能因为没归章就不给学生看 -->
              <div v-if="chapterList.loose.length" class="ch-loose">
                <div class="small muted" style="margin-bottom: 8px">
                  未归到章节的资料（{{ chapterList.loose.length }} 份）
                </div>
                <div class="stack" style="gap: 6px">
                  <div v-for="f in chapterList.loose" :key="'lf-' + f.id" class="file-row">
                    <BaseIcon :name="f.icon" :size="18" class="file-ic" />
                    <div class="file-main">
                      <div class="file-name">{{ f.name }}</div>
                      <div class="small muted">{{ f.sub }}</div>
                    </div>
                    <el-button size="small" text type="primary" @click="preview(f)">预览</el-button>
                    <el-button size="small" text @click="download(f)">下载</el-button>
                  </div>
                </div>
              </div>
            </template>

            <div v-else class="empty-wrap">
              <EmptyState desc="老师还没有上传课程章节与资料，上传后会按章显示在这里" />
            </div>
          </el-card>

          <!-- ★ 2026-10-27 公告 -->
          <el-card v-show="tab === 'announce'" shadow="never">
            <div class="between" style="margin-bottom: 12px">
              <div class="card-title" style="margin-bottom: 0">
                课程公告
                <span class="small muted" style="font-weight: 400">（{{ anns.length }} 条）</span>
              </div>
              <div class="row" style="gap: 8px">
                <el-input
                  v-model="annKeyword"
                  size="small"
                  placeholder="搜标题或正文"
                  clearable
                  style="width: 180px"
                  @keyup.enter="loadAnnouncements"
                  @clear="loadAnnouncements"
                />
                <el-button size="small" :loading="annLoading" @click="loadAnnouncements">搜索</el-button>
              </div>
            </div>

            <div v-loading="annLoading">
              <div v-if="anns.length" class="stack" style="gap: 10px">
                <div v-for="a in anns" :key="a.announcementId" class="ann-item">
                  <div class="row" style="gap: 8px; align-items: center; flex-wrap: wrap">
                    <el-tag v-if="a.pinned" size="small" type="danger" effect="light">置顶</el-tag>
                    <b class="ann-title">{{ a.title }}</b>
                  </div>
                  <div class="small muted mt6">{{ a.teacherName || '任课教师' }} · {{ a.publishAt }}</div>
                  <div class="ann-body small" :class="{ clamp: !annExpanded[a.announcementId] }">{{ a.content }}</div>
                  <el-button
                    size="small"
                    text
                    type="primary"
                    style="padding: 0; margin-top: 2px"
                    @click="toggleAnn(a.announcementId)"
                  >
                    {{ annExpanded[a.announcementId] ? '收起' : '展开全文' }}
                  </el-button>
                </div>
              </div>
              <div v-else-if="!annLoading" class="empty-wrap">
                <EmptyState desc="这门课还没有公告，老师发布后会出现在这里" />
              </div>
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
            <div class="between" style="margin-bottom: 12px">
              <div class="card-title" style="margin-bottom: 0">课程资源</div>
              <div class="row" style="gap: 8px">
                <el-input
                  v-model="kbKw"
                  placeholder="搜索课件内容，如：栈和队列"
                  clearable
                  style="width: 220px"
                  @keyup.enter="searchKb"
                  @clear="clearKb"
                >
                  <template #prefix><BaseIcon name="search" :size="14" /></template>
                </el-input>
                <el-button size="small" type="primary" :loading="kbLoading" @click="searchKb">搜索</el-button>
              </div>
            </div>

            <!-- 搜索结果（本地知识库片段） -->
            <div v-if="kbResults" class="kb-panel">
              <div class="small muted" style="margin-bottom: 8px">
                在课程讲义中搜索「{{ kbSearched }}」，命中 {{ kbResults.length }} 个片段
              </div>
              <div v-if="kbResults.length" class="stack" style="gap: 8px">
                <div
                  v-for="h in kbResults"
                  :key="h.chunkId"
                  class="kb-hit"
                  @click="openKbHit(h)"
                >
                  <div class="small kb-hit-meta">
                    <BaseIcon name="file-text" :size="12" />
                    {{ h.sourceFile }} · 第 {{ Number(h.chunkIndex) + 1 }} 段
                  </div>
                  <div class="small kb-hit-text">
                    <template v-for="(pt, pi) in hlParts(h.snippet, kbSearched)" :key="pi">
                      <mark v-if="pt.hit">{{ pt.text }}</mark>
                      <span v-else>{{ pt.text }}</span>
                    </template>
                  </div>
                </div>
              </div>
              <EmptyState v-else desc="没有命中片段：该课程可能还没建索引，或换一个关键词试试" />
            </div>

            <!-- ★ 2026-11-13 按「周 → 课次」分类（同小程序「全部排课」） -->
            <div v-if="visibleWeeks.length" class="wk-list">
              <div
                v-for="w in visibleWeeks"
                :key="'rw-' + (w.weekNum ?? 'x')"
                class="wk-block"
                :class="{ 'is-empty': !w.fileCount }"
              >
                <div class="wk-head" @click="toggleWeek(w.weekNum)">
                  <div class="row wk-head-main">
                    <span class="wk-no">{{ w.weekNum == null ? '未分周' : '第 ' + w.weekNum + ' 周' }}</span>
                    <el-tag v-if="w.weekNum === currentWeekNo" size="small" type="success" effect="light">
                      本周
                    </el-tag>
                    <span class="small muted">
                      <template v-if="!w.lessonCount">本周没有排课</template>
                      <template v-else>
                        {{ w.lessonCount }} 次课 · {{ w.fileCount ? w.fileCount + ' 份资料' : '暂无资料' }}
                      </template>
                    </span>
                  </div>
                  <BaseIcon :name="isWeekOpen(w.weekNum) ? 'chevron-down' : 'chevron-right'" :size="16" />
                </div>

                <div v-show="isWeekOpen(w.weekNum)" class="wk-body">
                  <div v-for="g in w.groups" :key="g.key" class="ls-card" :class="{ 'is-empty': !g.files.length }">
                    <div class="ls-head">
                      <div class="row ls-meta">
                        <b class="ls-period">{{ g.title }}</b>
                        <span class="small muted ellip">{{ g.sub }}</span>
                      </div>
                      <el-tag
                        v-if="g.files.length"
                        size="small"
                        type="success"
                        effect="light"
                      >
                        {{ g.files.length }} 份资料
                      </el-tag>
                      <span v-else class="ls-none">老师未上传</span>
                    </div>
                    <div v-if="g.files.length" class="stack ls-files">
                      <div v-for="f in g.files" :key="'rf-' + f.id" class="file-row">
                        <BaseIcon :name="f.icon" :size="18" class="file-ic" />
                        <div class="file-main">
                          <div class="file-name">{{ f.name }}</div>
                          <div class="small muted">{{ f.sub }}</div>
                        </div>
                        <el-button size="small" text type="primary" @click.stop="preview(f)">预览</el-button>
                        <el-button size="small" text @click.stop="download(f)">下载</el-button>
                      </div>
                    </div>
                  </div>

                  <div v-if="!w.groups.length" class="ch-empty">本周没有排课，也没有资料</div>
                </div>
              </div>
            </div>

            <!-- 兜底：课次已被删除 / 没填周次的历史资料 -->
            <div
              v-if="resourceWeeks.stray.length || resourceWeeks.orphan.length"
              class="ch-loose"
            >
              <div class="small muted" style="margin-bottom: 8px">
                未排到课次的资料（{{ resourceWeeks.stray.length + resourceWeeks.orphan.length }} 份）
              </div>
              <div class="stack" style="gap: 6px">
                <div
                  v-for="f in [...resourceWeeks.stray, ...resourceWeeks.orphan]"
                  :key="'sf-' + f.id"
                  class="file-row"
                >
                  <BaseIcon :name="f.icon" :size="18" class="file-ic" />
                  <div class="file-main">
                    <div class="file-name">{{ f.name }}</div>
                    <div class="small muted">{{ f.sub }}</div>
                  </div>
                  <el-button size="small" text type="primary" @click="preview(f)">预览</el-button>
                  <el-button size="small" text @click="download(f)">下载</el-button>
                </div>
              </div>
            </div>

            <div
              v-if="!resourceWeeks.blocks.length && !resourceWeeks.stray.length && !resourceWeeks.orphan.length"
              class="empty-wrap"
            >
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
/* ★ 2026-10-22 课件内容搜索 */
.kb-panel {
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: 10px;
  margin-bottom: 14px;
}
.kb-hit {
  padding: 8px 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.kb-hit:hover {
  border-color: var(--brand-300);
}
.kb-hit-meta {
  color: var(--brand-700);
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}
.kb-hit-text {
  color: var(--ink-600);
  line-height: 1.7;
}
.kb-hit-text mark {
  background: #fff3cd;
  color: inherit;
  padding: 0 2px;
  border-radius: 3px;
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
/* ★ 2026-10-27 课程公告 */
.ann-item {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-subtle);
}
.ann-title {
  font-size: 14px;
  color: var(--ink-900);
}
.ann-body {
  margin-top: 8px;
  color: var(--ink-700);
  line-height: 1.72;
  white-space: pre-line;
}
.ann-body.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ★ 2026-11-13 章节目录（按老师上传的资料归章） */
.ch-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ch-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.ch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  background: var(--bg-subtle);
}
.ch-head:hover {
  background: var(--primary-softer);
}
.ch-head-main {
  gap: 10px;
  min-width: 0;
}
.ch-no {
  flex: none;
  font-size: 12px;
  font-weight: 700;
  color: var(--brand-700);
  background: var(--primary-soft);
  border-radius: 6px;
  padding: 2px 8px;
}
.ch-name {
  font-size: 14px;
  color: var(--ink-900);
}
.ch-body {
  padding: 10px 14px 12px;
  border-top: 1px dashed var(--border);
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.file-row:hover {
  border-color: var(--brand-300);
  background: var(--primary-softer);
}
.file-ic {
  color: var(--brand-600);
  flex: none;
}
.file-main {
  min-width: 0;
  flex: 1;
}
.file-name {
  font-size: 13.5px;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ch-empty {
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--ink-500);
  font-size: 13px;
  background: var(--bg-subtle);
}
/* 大纲有、资料没有的章：一句提示 */
.ch-missing {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
}
.ch-loose {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}

/* ★ 2026-11-13 资源页：周 → 课次 */
.wk-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wk-block {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.wk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  background: var(--bg-subtle);
}
.wk-head:hover {
  background: var(--primary-softer);
}
.wk-head-main {
  gap: 10px;
  min-width: 0;
}
.wk-no {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  color: var(--brand-700);
}
.wk-block.is-empty {
  border-style: dashed;
  border-color: var(--border);
}
/* 没资料的周：只留一行标题，视觉上比有资料的周轻一档 */
.wk-block.is-empty .wk-head {
  padding: 9px 14px;
  background: #fff;
}
.wk-block.is-empty .wk-no {
  font-weight: 600;
  color: var(--ink-500);
}
.wk-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 12px;
  border-top: 1px dashed var(--border);
}
.ls-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}
.ls-card:hover {
  border-color: var(--brand-300);
}
/* 老师没给这次课传资料：压成一行，不占版面 */
.ls-card.is-empty {
  border-color: transparent;
  background: transparent;
  padding: 4px 10px 4px 11px;
}
.ls-card.is-empty:hover {
  border-color: var(--border);
  background: var(--bg-subtle);
}
.ls-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ls-meta {
  gap: 8px;
  min-width: 0;
}
.ls-period {
  flex: none;
  font-size: 13px;
  color: var(--ink-900);
}
.is-empty .ls-period {
  font-weight: 500;
  color: var(--ink-600);
}
.ls-none {
  flex: none;
  font-size: 12px;
  color: var(--ink-400);
}
.ellip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ls-files {
  gap: 6px;
  margin-top: 8px;
}
</style>
