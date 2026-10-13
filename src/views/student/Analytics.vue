<script setup>
/**
 * AI 学情（分支 stu-pc-analytics）
 *
 * 关联接口（接口设计文档表号）：
 *   表 3-11 学情画像查询      GET  /api/v1/profiles/me?courseId=
 *   表 3-19 薄弱点练习推荐    GET  /api/v1/practice/recommend
 *   （表 3-8 错题本、表 3-26 提交练习作答 也在本页路由 meta 中，但原型页未体现，见文件末尾说明）
 * 对应原型：ui-prototype/pc/student-analytics.html（1:1 还原）
 *
 * 还原要点：
 *   1. 顶部标题 + 课程选择器
 *   2. 四个指标卡：我的平均分 / 已掌握知识点 / 薄弱知识点 / 本周学习时长
 *   3. 左：知识点掌握度**五边形雷达图**（原型是手写 SVG，这里保持 SVG 并改为数据驱动）
 *      右：薄弱知识点列表（警告色图标 + 掌握度百分比 + 进度条）
 *   4. 自适应推荐：基础巩固题 / 能力提高题 / 推荐资料 三张卡
 *
 * 雷达图为什么不用 ECharts：原型本身就是手写 SVG 的三层网格 + 数据多边形，
 * 用 SVG 计算顶点可以 1:1 还原且不增加包体积；若后续需要 tooltip/动画再换 ECharts。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { practiceRecommend, profileDashboard } from '@/api/student/analytics'

/** 掌握度阈值：>= MASTERED 视为已掌握；< WEAK 视为薄弱（与原型 24/30、3 个薄弱点的比例相符） */
const MASTERED = 80
const WEAK = 60

const router = useRouter()

/** 课程下拉（与课程列表一致） */
const COURSES = [
  { courseId: 10, courseName: '高等数学 A' },
  { courseId: 13, courseName: '数据结构' },
  { courseId: 11, courseName: '大学英语 III' }
]
const courseId = ref(10)
const loading = ref(false)

const profile = ref(null)
const recommends = ref([])

/** 知识点列表：优先用后端返回的 kpList（含名称），否则回退契约的 kpMastery({kpId: 百分比}) */
const kps = computed(() => {
  const p = profile.value
  if (!p) return []
  if (Array.isArray(p.kpList) && p.kpList.length) {
    return p.kpList.map((x) => ({
      name: x.kpName || x.name || `知识点 ${x.kpId}`,
      percent: Number(x.percent ?? 0)
    }))
  }
  const m = p.kpMastery || {}
  return Object.keys(m).map((k) => ({ name: k, percent: Number(m[k] ?? 0) }))
})

const masteredCount = computed(() => kps.value.filter((k) => k.percent >= MASTERED).length)
const weakList = computed(() =>
  kps.value.filter((k) => k.percent < WEAK).sort((a, b) => a.percent - b.percent)
)

const avgScore = computed(() => profile.value?.homeworkAvg ?? profile.value?.masteryAvg ?? null)
const weekHours = computed(() => {
  const s = profile.value?.learningTimeSec
  return s == null ? null : (s / 3600).toFixed(1)
})

/* ---------------- 雷达图（SVG，纯计算，无第三方图表库） ---------------- */
const VIEW_W = 220
const VIEW_H = 200
const CX = 110
const CY = 104
const R = 84
/** 最多画 6 个轴，避免标签重叠 */
const MAX_AXES = 6

const axes = computed(() => kps.value.slice(0, MAX_AXES))

function vertex(i, ratio, total) {
  const angle = (-90 + (360 / total) * i) * (Math.PI / 180)
  return [CX + R * ratio * Math.cos(angle), CY + R * ratio * Math.sin(angle)]
}

function ringPoints(ratio, total) {
  return Array.from({ length: total }, (_, i) =>
    vertex(i, ratio, total)
      .map((n) => n.toFixed(1))
      .join(',')
  ).join(' ')
}

const gridRings = computed(() => {
  const t = axes.value.length
  return t < 3 ? [] : [1, 0.66, 0.33].map((r) => ringPoints(r, t))
})

const spokes = computed(() => {
  const t = axes.value.length
  return t < 3 ? [] : Array.from({ length: t }, (_, i) => vertex(i, 1, t))
})

const dataPolygon = computed(() => {
  const t = axes.value.length
  if (t < 3) return ''
  return axes.value
    .map((k, i) =>
      vertex(i, Math.min(100, Math.max(0, k.percent)) / 100, t)
        .map((n) => n.toFixed(1))
        .join(',')
    )
    .join(' ')
})

const dataDots = computed(() => {
  const t = axes.value.length
  if (t < 3) return []
  return axes.value.map((k, i) => {
    const [x, y] = vertex(i, Math.min(100, Math.max(0, k.percent)) / 100, t)
    return { x: x.toFixed(1), y: y.toFixed(1) }
  })
})

const axisLabels = computed(() => {
  const t = axes.value.length
  if (t < 3) return []
  return axes.value.map((k, i) => {
    const angle = (-90 + (360 / t) * i) * (Math.PI / 180)
    const x = CX + (R + 18) * Math.cos(angle)
    const y = CY + (R + 18) * Math.sin(angle) + 4
    return {
      x: x.toFixed(1),
      y: y.toFixed(1),
      text: k.name,
      anchor: x < CX - 6 ? 'end' : x > CX + 6 ? 'start' : 'middle'
    }
  })
})

/* ---------------- 加载 ---------------- */
async function load() {
  loading.value = true
  try {
    const [p, rec] = await Promise.all([
      profileDashboard(courseId.value),
      practiceRecommend(courseId.value).catch(() => null)
    ])
    profile.value = p || null
    recommends.value = Array.isArray(rec?.list) ? rec.list : []
  } finally {
    loading.value = false
  }
}

/** 一键进入练习：原型里两个按钮只弹提示（无练习作答页），此处保持同样行为 */
function startPractice(item, oneClick) {
  ElMessage.success(
    `已生成 ${item?.count ?? ''} 道${item?.title || '针对性练习'}${item?.kpName ? `（${item.kpName}）` : ''}`
  )
  if (oneClick) ElMessage.info('练习作答页尚未在原型中定义，落地方式待 PM 确认')
}

function openResource() {
  router.push({ name: 'StuResourcePreview' })
}

watch(courseId, load)
onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="AI 学情看板" desc="掌握度雷达、薄弱知识点与自适应练习推荐">
      <template #actions>
        <el-select v-model="courseId" style="width: 180px">
          <el-option v-for="c in COURSES" :key="c.courseId" :label="c.courseName" :value="c.courseId" />
        </el-select>
      </template>
    </PageHeader>

    <!-- ① 指标卡 -->
    <div class="grid g4">
      <StatCard
        label="我的平均分"
        :value="avgScore == null ? '—' : Number(avgScore).toFixed(1)"
        :trend="profile?.rankText || ''"
      />
      <StatCard label="已掌握知识点" :value="kps.length ? `${masteredCount}/${kps.length}` : '—'" />
      <StatCard label="薄弱知识点" :value="weakList.length" tone="warning" />
      <StatCard label="本周学习时长" :value="weekHours == null ? '—' : `${weekHours}h`" />
    </div>

    <!-- ② 雷达图 + 薄弱知识点 -->
    <div class="two-col mt16">
      <el-card shadow="never">
        <div class="card-title">知识点掌握度</div>
        <div class="center">
          <svg v-if="axes.length >= 3" :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" class="radar">
            <g stroke="var(--bg-soft)" fill="none">
              <polygon v-for="(p, i) in gridRings" :key="`g${i}`" :points="p" />
            </g>
            <g stroke="var(--border)">
              <line
                v-for="(sp, i) in spokes"
                :key="`s${i}`"
                :x1="CX"
                :y1="CY"
                :x2="sp[0].toFixed(1)"
                :y2="sp[1].toFixed(1)"
              />
            </g>
            <polygon
              :points="dataPolygon"
              fill="rgba(20,184,166,.18)"
              stroke="var(--brand-600)"
              stroke-width="2"
            />
            <g fill="var(--brand-600)">
              <circle v-for="(d, i) in dataDots" :key="`d${i}`" :cx="d.x" :cy="d.y" r="3.5" />
            </g>
            <g font-size="11" fill="var(--ink-500)">
              <text
                v-for="(l, i) in axisLabels"
                :key="`t${i}`"
                :x="l.x"
                :y="l.y"
                :text-anchor="l.anchor"
              >
                {{ l.text }}
              </text>
            </g>
          </svg>
          <el-empty v-else description="暂无知识点掌握度数据" :image-size="80" />
        </div>
      </el-card>

      <el-card shadow="never">
        <div class="card-title">薄弱知识点</div>
        <el-empty v-if="!weakList.length" description="暂无薄弱知识点" :image-size="80" />
        <div v-for="w in weakList" :key="w.name" class="rowline">
          <div class="row">
            <span class="icon-box warn"><BaseIcon name="alert-triangle" :size="16" /></span>
            <div>
              <div class="strong small">{{ w.name }}</div>
              <div class="small muted">掌握度 {{ w.percent }}%</div>
            </div>
          </div>
          <el-progress
            :percentage="w.percent"
            :stroke-width="6"
            :show-text="false"
            color="var(--warning)"
            class="w110"
          />
        </div>
      </el-card>
    </div>

    <!-- ③ 自适应推荐 -->
    <el-card shadow="never" class="mt16">
      <div class="between">
        <div class="card-title no-margin">自适应推荐</div>
        <el-tag type="info" effect="light">基于薄弱点智能生成</el-tag>
      </div>
      <div class="grid g3 mt16">
        <div v-for="(r, i) in recommends" :key="i" class="rec">
          <div class="row">
            <span class="icon-box"><BaseIcon :name="r.icon || 'target'" :size="16" /></span>
            <b class="small">{{ r.title }}</b>
          </div>
          <div class="small muted mt8">{{ r.desc }}</div>
          <el-button v-if="r.type === 'material'" class="mt12 btn-block" @click="openResource">
            查看资料
          </el-button>
          <el-button
            v-else
            class="mt12 btn-block"
            :type="r.type === 'basic' ? 'primary' : 'default'"
            @click="startPractice(r, r.type === 'basic')"
          >
            {{ r.type === 'basic' ? '一键进入练习' : '进入练习' }}
          </el-button>
        </div>
        <el-empty v-if="!recommends.length" description="暂无推荐" :image-size="60" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 14px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
@media (max-width: 1100px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
.radar {
  width: 280px;
  max-width: 100%;
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
.icon-box {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--brand-50);
  color: var(--brand-600);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-box.warn {
  background: var(--warning-soft);
  color: var(--warning);
}
.strong {
  font-weight: 600;
  color: var(--ink-800);
}
.rec {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px;
}
.btn-block {
  width: 100%;
}
.w110 {
  width: 110px;
  flex: none;
}
</style>

<!--
  原型中未体现、但本页路由 meta 声明的接口（实现前需确认落点）：
  · 表 3-8  错题本查询   —— 契约「对应页面」写的是「学生端错题本（个人中心）」，宜落在 Profile 页
  · 表 3-26 提交练习作答 —— 需要「练习作答页」，而原型里两个按钮只弹提示、并无该页面
  两个接口函数已在 api/student/analytics.js 中就绪。
-->
