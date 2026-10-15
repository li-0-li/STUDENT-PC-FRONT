<script setup>
/**
 * 章节作业（分支 stu-pc-course）
 * 关联接口（接口设计文档表号）：表 3-2 课程详情、表 3-4 资源列表
 * 对应原型：ui-prototype/pc/student-course-detail.html —— ★ 1:1 还原
 *   （课程头部卡+退出课程、四个 pilltab 面板：章节 / 作业 / 资源 / 实验、右栏「课程导学」）
 *
 * 说明：章节与实验列表在 101 个契约里没有对应接口（属 M-B / M-C 域），暂用原型同款演示数据。
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { courseDetail, resourceList } from '@/api/student/course'

const route = useRoute()
const router = useRouter()

/** 返回上一页（无历史时回课程列表） */
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/student/courses')
}
const courseId = ref(Number(route.params.courseId) || 10)
const tab = ref('chapter')
const TABS = [
  { k: 'chapter', l: '章节' },
  { k: 'homework', l: '作业' },
  { k: 'resource', l: '资源' },
  { k: 'lab', l: '实验' }
]

/** 课程头部（原型：高等数学 A） */
const info = ref({
  courseName: '高等数学 A',
  teacherName: '张老师',
  totalHours: 64,
  className: '软件 2201',
  chapterDone: 8,
  chapterTotal: 12,
  status: '进行中',
  icon: 'sigma'
})
const pct = ref(67)

/** 章节（原型 4 行：已完成 / 进行中 / 未解锁） */
const chapters = ref([
  { title: '第 1 章 函数与极限', sub: '课件 · 教案 · 随堂练习', state: 'done' },
  { title: '第 2 章 导数与微分', sub: '课件 · 作业 2-1 · 微课视频', state: 'done' },
  { title: '第 3 章 微分中值定理', sub: '课件 · 实验材料 · 题库', state: 'current' },
  { title: '第 4 章 不定积分', sub: '未解锁（按教学周开放）', state: 'locked' }
])

/** 作业（原型 2 行） */
const homeworks = ref([
  { title: '习题 2-1 导数定义', due: '2026-09-05 23:59', status: '待提交' },
  { title: '习题 1-5 极限计算', due: '2026-08-28 23:59', status: '已批改 · 92' }
])

/** 资源（原型 4 条） */
const resources = ref([
  { name: '教学大纲.pdf', sub: '2.4 MB · 课程总纲', icon: 'file-text', act: '下载' },
  { name: '第1-3章 课件 PPT', sub: '18.6 MB · 含例题动画', icon: 'presentation', act: '下载' },
  { name: '微课视频 · 导数概念', sub: '24 分钟 · 限校内观看', icon: 'video', act: '播放' },
  { name: '习题题库', sub: '120 题 · 含解析', icon: 'book-open', act: '预览' }
])

/** 实验（原型 2 条） */
const labs = ref([
  { name: '实验一 极限的数值逼近', sub: '截止 2026-09-12 · 提交率 26/32', status: '待提交' },
  { name: '实验二 导数的几何意义', sub: '截止 2026-09-19 · 未开放', status: '未开始' }
])

async function load() {
  try {
    const d = await courseDetail(courseId.value)
    if (d && d.courseName) {
      info.value.courseName = d.courseName
      info.value.teacherName = d.teacherName || info.value.teacherName
      info.value.totalHours = d.totalHours || info.value.totalHours
      info.value.icon = d.courseName.includes('数学') ? 'sigma' : d.courseName.includes('英语') ? 'languages' : 'book-open'
      if (d.chapterTotal) {
        info.value.chapterTotal = d.chapterTotal
        info.value.chapterDone = d.chapterDone ?? 0
        pct.value = Math.round((info.value.chapterDone / info.value.chapterTotal) * 100)
      }
    }
    const r = await resourceList(courseId.value)
    if (r?.list?.length) {
      resources.value = r.list.map((x) => ({
        name: x.fileName || x.name,
        sub: x.sizeText || x.sub || '课程资源',
        icon: (x.resourceType || '').includes('video') ? 'video' : 'file-text',
        act: '下载'
      }))
    }
  } catch {
    /* 接口未就绪时用原型演示数据 */
  }
}

function preview(r) {
  router.push({ name: 'StuResourcePreview', query: { type: r.icon === 'video' ? 'video' : 'doc', title: r.name, sub: r.sub } })
}
function download() {
  ElMessage.info('演示环境：资源为原型示意，无可下载文件')
}
function goAnswer() {
  router.push({ name: 'StuHomeworkAnswer' })
}
function viewSubmission() {
  router.push({ name: 'StuSubmission' })
}
async function quitCourse() {
  try {
    await ElMessageBox.confirm(
      `确定退出《${info.value.courseName}》吗？退出后将无法查看课程内容，学习记录保留 30 天，重新加入可恢复。`,
      '退出课程',
      { confirmButtonText: '确定退出', cancelButtonText: '取消', type: 'warning' }
    )
    ElMessage.success('已提交退课申请，教师确认后生效。')
    router.push({ name: 'StuCourses' })
  } catch {
    /* 取消 */
  }
}

onMounted(load)
</script>

<template>
  <div>
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
              <el-tag type="info" effect="light">{{ info.status }}</el-tag>
            </div>
            <div class="muted small mt8">{{ info.teacherName }} · {{ info.totalHours }} 学时 · {{ info.className }}</div>
          </div>
        </div>
        <div style="text-align: right">
          <div class="small muted">章节进度 {{ info.chapterDone }} / {{ info.chapterTotal }}</div>
          <el-progress :percentage="pct" :show-text="false" :stroke-width="8" style="width: 180px; margin: 8px 0" />
          <el-button size="small" class="quit" @click="quitCourse"><BaseIcon name="log-out" :size="14" />退出课程</el-button>
        </div>
      </div>
    </el-card>

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
          <div class="card-title">章节（教学周 1–16）</div>
          <el-table :data="chapters">
            <el-table-column label="章节" min-width="300">
              <template #default="{ row }">
                <div class="row">
                  <BaseIcon
                    :name="row.state === 'done' ? 'circle-check' : row.state === 'current' ? 'play' : 'lock'"
                    :size="18"
                    :class="row.state === 'done' ? 'ic-done' : row.state === 'current' ? 'ic-cur' : 'ic-lock'"
                  />
                  <b :class="{ 'is-locked': row.state === 'locked' }">{{ row.title }}</b>
                </div>
                <div class="small muted mt8">{{ row.sub }}</div>
              </template>
            </el-table-column>
            <el-table-column width="200" align="right">
              <template #default="{ row }">
                <template v-if="row.state !== 'locked'">
                  <el-button size="small" @click="preview({ name: row.title, sub: row.sub })">
                    <BaseIcon name="eye" :size="13" />预览
                  </el-button>
                  <el-button size="small" @click="download"><BaseIcon name="download" :size="13" />下载</el-button>
                </template>
                <el-tag v-else type="info" effect="light">未开始</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 作业 -->
        <el-card v-show="tab === 'homework'" shadow="never">
          <div class="card-title">作业</div>
          <el-table :data="homeworks">
            <el-table-column prop="title" label="作业" min-width="200">
              <template #default="{ row }"><b>{{ row.title }}</b></template>
            </el-table-column>
            <el-table-column prop="due" label="截止时间" width="170" />
            <el-table-column label="状态" width="140">
              <template #default="{ row }">
                <el-tag :type="row.status === '待提交' ? 'warning' : 'success'" effect="light">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110" align="right">
              <template #default="{ row }">
                <el-button v-if="row.status === '待提交'" type="primary" size="small" @click="goAnswer">去作答</el-button>
                <el-button v-else size="small" @click="viewSubmission">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 资源 -->
        <el-card v-show="tab === 'resource'" shadow="never">
          <div class="card-title">课程资源</div>
          <div class="stack" style="gap: 10px">
            <div v-for="(r, i) in resources" :key="i" class="rowline">
              <div class="row">
                <BaseIcon :name="r.icon" :size="18" class="ic-brand" />
                <div>
                  <b class="small">{{ r.name }}</b>
                  <div class="small muted">{{ r.sub }}</div>
                </div>
              </div>
              <el-button size="small" @click="preview(r)">
                <BaseIcon :name="r.act === '播放' ? 'play' : r.act === '预览' ? 'eye' : 'download'" :size="13" />{{ r.act }}
              </el-button>
            </div>
          </div>
        </el-card>

        <!-- 实验 -->
        <el-card v-show="tab === 'lab'" shadow="never">
          <div class="card-title">实验</div>
          <div class="stack" style="gap: 12px">
            <div class="rowline">
              <div>
                <div class="lab-name">{{ labs[0].name }}</div>
                <div class="small muted">{{ labs[0].sub }}</div>
              </div>
              <el-tag type="warning" effect="light">{{ labs[0].status }}</el-tag>
            </div>
            <el-button class="w100" @click="ElMessage.success('已提交实验报告')">
              <BaseIcon name="upload-cloud" :size="15" />提交实验报告
            </el-button>
            <div class="rowline">
              <div>
                <div class="lab-name">{{ labs[1].name }}</div>
                <div class="small muted">{{ labs[1].sub }}</div>
              </div>
              <el-tag type="info" effect="light">{{ labs[1].status }}</el-tag>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 右栏：课程导学 -->
      <div class="stack">
        <el-card shadow="never">
          <div class="card-title">课程导学</div>
          <div class="upl">
            <BaseIcon name="video" :size="26" />
            <div class="mt8 small">说课视频 · 24 分钟</div>
            <el-button
              type="primary"
              size="small"
              class="mt12"
              @click="router.push({ name: 'StuResourcePreview', query: { type: 'video', title: '说课视频 · 导数概念', sub: '24 分钟' } })"
            >
              播放
            </el-button>
          </div>
          <div class="rowline mt12">
            <span class="row small"><BaseIcon name="file-text" :size="16" class="ic-brand" />教学大纲</span>
            <el-link type="primary" :underline="false" class="small" @click="download">查看</el-link>
          </div>
        </el-card>
      </div>
    </div>
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
.ic-done {
  color: var(--success);
}
.ic-cur {
  color: var(--brand-600);
}
.ic-lock {
  color: var(--ink-400);
}
.ic-brand {
  color: var(--brand-600);
}
.is-locked {
  color: var(--ink-400);
}
.quit {
  color: var(--error);
  border-color: #fca5a5;
}
.upl {
  background: var(--bg-subtle);
  border-radius: var(--r-md);
  padding: 20px;
  text-align: center;
}
.lab-name {
  font-weight: 600;
  font-size: 13px;
}
.w100 {
  width: 100%;
}
.mt12 {
  margin-top: 12px;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
