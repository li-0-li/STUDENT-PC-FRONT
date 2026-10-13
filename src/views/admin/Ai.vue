<script setup>
/**
 * AI 工作台（M-D · 管理端）
 *
 * 对应原型：ui-prototype/pc/admin-ai.html（1:1 还原）
 * 路由：/admin/ai（菜单 id = ai）
 *
 * 数据接入（M-D 提供）：
 *   · 表 5-17 GET /api/v1/admin/ai-usage      → 「今日 AI 调用」+「AI 调用趋势」**真实数据**
 *   · 表 5-18 GET /api/v1/admin/ai-call-logs  → （备用，逐次审计）
 *
 * 仍为演示值的部分（**无接口，非 M-D 域**，页面上已用「演示」标注，不假装真实）：
 *   · 知识库命中率 / 已索引课程 —— 需要按课程聚合的索引统计接口
 *   · 敏感词拦截 —— `sensitive_word` 属 **M-A** 域（MD §8.10 只做聚合展示）
 *   · 模型与配额配置 —— 读写属 **M-A** 的 `biz_config`
 */
import { computed, onMounted, ref } from 'vue'
import PageHeader from '@/components/base/PageHeader.vue'
import StatCard from '@/components/base/StatCard.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import LineChart from '@/components/business/LineChart.vue'
import { aiUsage } from '@/api/admin/ai'

const loading = ref(false)
const offline = ref(false)

/** 表 5-17 的原始聚合行 */
const usageRows = ref([])

/** 演示兜底（后端不可用时用，数值取自原型） */
const DEMO_TREND = [
  { label: '周一', value: 9800 }, { label: '周二', value: 10400 }, { label: '周三', value: 10100 },
  { label: '周四', value: 11200 }, { label: '周五', value: 11000 }, { label: '周六', value: 12100 },
  { label: '周日', value: 11900 }
]
const DEMO_GRADE = [
  { label: '周一', value: 2600 }, { label: '周二', value: 2750 }, { label: '周三', value: 2900 },
  { label: '周四', value: 3050 }, { label: '周五', value: 3100 }, { label: '周六', value: 3350 },
  { label: '周日', value: 3400 }
]

const today = new Date().toISOString().slice(0, 10)

/** 今日总调用量（真实） */
const todayCalls = ref(null)
/** 今日按业务类型拆分，如「答疑 12 · 批改 0」 */
const todayBreakdown = ref('')
/** 近 7 日趋势（按业务类型分序列） */
const trendQa = ref([])
const trendGrade = ref([])

const qaName = 'AI 答疑'
const gradeName = 'AI 批改'

const hasReal = computed(() => usageRows.value.length > 0)

function buildDemo() {
  todayCalls.value = 12847
  todayBreakdown.value = '答疑 8,210 · 批改 3,102 · 查重 1,535（演示值）'
  trendQa.value = DEMO_TREND
  trendGrade.value = DEMO_GRADE
}

/** 把聚合行整理成「按日期」的序列 */
function buildFromRows(rows) {
  const byDate = new Map()
  const todayBiz = new Map()
  for (const r of rows) {
    const d = String(r.usageDate || '').slice(0, 10)
    const biz = r.bizType || 'other'
    const n = Number(r.callCount || 0)
    if (!byDate.has(d)) byDate.set(d, {})
    const slot = byDate.get(d)
    slot[biz] = (slot[biz] || 0) + n
    if (d === today) todayBiz.set(biz, (todayBiz.get(biz) || 0) + n)
  }
  const dates = [...byDate.keys()].sort().slice(-7)
  trendQa.value = dates.map((d) => ({ label: d.slice(5), value: (byDate.get(d) || {}).qa || 0 }))
  trendGrade.value = dates.map((d) => ({ label: d.slice(5), value: (byDate.get(d) || {}).grading || 0 }))

  let sum = 0
  const parts = []
  for (const [biz, n] of todayBiz.entries()) {
    sum += n
    const cn = biz === 'qa' ? '答疑' : biz === 'grading' ? '批改' : biz === 'plagiarism' ? '查重' : biz
    parts.push(`${cn} ${n}`)
  }
  todayCalls.value = sum
  todayBreakdown.value = parts.length ? parts.join(' · ') : '今日暂无调用'
}

async function load() {
  loading.value = true
  offline.value = false
  try {
    const rows = await aiUsage(7)
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) {
      usageRows.value = []
      buildDemo()
      offline.value = true
      return
    }
    usageRows.value = list
    buildFromRows(list)
  } catch (e) {
    usageRows.value = []
    buildDemo()
    offline.value = true
  } finally {
    loading.value = false
  }
}

/* ---------------- 以下为无接口、按原型展示的静态内容 ---------------- */
const indexRows = ref([
  { course: '数据结构', resources: 48, state: '已索引', tag: 'success', hit: '91.2%', action: '重建' },
  { course: '高等数学 A', resources: 36, state: '已索引', tag: 'success', hit: '88.5%', action: '重建' },
  { course: '操作系统', resources: 29, state: '索引过期', tag: 'warning', hit: '76.3%', action: '重建' },
  { course: '软件工程导论', resources: 12, state: '构建失败', tag: 'danger', hit: '—', action: '查看日志' }
])
const wordGroups = [
  { label: '政治敏感 ×12', tag: 'danger' },
  { label: '辱骂攻击 ×35', tag: 'warning' },
  { label: '广告引流 ×18', tag: 'warning' },
  { label: '自定义 ×26', tag: 'info' }
]
const intercepts = [
  { icon: 'message-circle', where: '课堂弹幕 · 计算机 2301', type: '辱骂攻击', tag: 'warning' },
  { icon: 'mail', where: '站内消息 · 用户 u2088', type: '广告引流', tag: 'danger' }
]
const configs = [
  ['当前引擎', '本地算法引擎（TF-IDF + 规则）'],
  ['大模型适配器', '未启用（DeepSeek / 通义 预留）'],
  ['主观题评分权重', '关键词 40% · 语义 40% · 结构 20%'],
  ['答疑降级阈值', '知识库命中率 < 60% → 建议咨询教师'],
  ['AI 查重阈值', '相似度 ≥ 80% 标红预警']
]

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <PageHeader title="AI 工作台（管理端）" desc="AI 调用量、知识库索引与模型配额">
      <template #actions>
        <el-tag type="success" effect="light">AI 服务运行正常</el-tag>
        <el-button><BaseIcon name="settings-2" :size="15" />模型配置</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="offline"
      type="warning"
      :closable="false"
      show-icon
      class="mb16"
      title="未取到后端数据，当前显示演示数据"
      description="请确认：① SSH 隧道已开 ② 后端已启动 ③ 库里已灌 db/seed_md.sql"
    />

    <!-- ① 指标卡：第一张是真实数据，其余为演示值（页面上已标注） -->
    <div class="grid g4">
      <StatCard
        label="今日 AI 调用"
        :value="todayCalls == null ? '—' : todayCalls.toLocaleString()"
        :trend="todayBreakdown"
      />
      <StatCard label="知识库命中率" value="87.4%" trend="演示值 · 需索引统计接口" />
      <StatCard label="已索引课程" value="126 / 132" trend="演示值 · 需索引统计接口" />
      <StatCard label="敏感词拦截（今日）" value="37" tone="warning" trend="演示值 · 属 M-A 域" />
    </div>

    <!-- ② 索引状态 + 敏感词 -->
    <div class="grid g2 mt16">
      <el-card shadow="never">
        <div class="between">
          <div class="card-title no-margin">知识库索引状态</div>
          <el-button size="small"><BaseIcon name="refresh-cw" :size="14" />全量重建</el-button>
        </div>
        <el-table :data="indexRows" class="mt12" style="width: 100%">
          <el-table-column prop="course" label="课程" />
          <el-table-column prop="resources" label="资源数" width="76" />
          <el-table-column label="索引状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.tag" size="small" effect="light">{{ row.state }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="hit" label="命中率" width="80" />
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small">{{ row.action }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="small muted mt8">本区块为演示值（按课程聚合的索引统计接口尚未提供）</div>
      </el-card>

      <el-card shadow="never">
        <div class="between">
          <div class="card-title no-margin">敏感词库管理</div>
          <el-button type="primary" size="small"><BaseIcon name="plus" :size="14" />新增词条</el-button>
        </div>
        <div class="tags mt12">
          <el-tag v-for="g in wordGroups" :key="g.label" :type="g.tag" size="small" effect="light">
            {{ g.label }}
          </el-tag>
        </div>
        <div class="policy mt12">
          <div class="small muted">拦截策略</div>
          <div class="small mt8">命中即屏蔽并记录 <code>audit_log</code>；同一用户 3 次命中自动告警至管理员。</div>
        </div>
        <div class="card-title mt16">最近拦截</div>
        <div v-for="(it, i) in intercepts" :key="i" class="rowline">
          <span class="row small">
            <BaseIcon :name="it.icon" :size="15" class="brand" />{{ it.where }}
          </span>
          <el-tag :type="it.tag" size="small" effect="light">{{ it.type }}</el-tag>
        </div>
        <div class="small muted mt8">敏感词数据属 M-A 域，本页仅做聚合展示</div>
      </el-card>
    </div>

    <!-- ③ 调用趋势（真实数据）+ 配置 -->
    <div class="grid g2 mt16">
      <el-card shadow="never">
        <div class="card-title">AI 调用趋势（近 7 日）</div>
        <LineChart
          :points="trendQa"
          :series2="trendGrade"
          :name="qaName"
          :series2-name="gradeName"
          :height="180"
        />
        <div class="small muted mt8">
          数据来自 ai_usage（表 5-17）{{ hasReal ? '· 真实数据' : '· 当前为演示值' }}
        </div>
      </el-card>

      <el-card shadow="never">
        <div class="card-title">模型与配额配置</div>
        <div v-for="(c, i) in configs" :key="i" class="pf-row">
          <span class="k muted small">{{ c[0] }}</span>
          <span class="small">{{ c[1] }}</span>
        </div>
        <div class="between mt16">
          <span class="small muted">配置读写属 M-A 的 biz_config</span>
          <el-button type="primary" size="small"><BaseIcon name="save" :size="14" />保存配置</el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 10px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.mt16 {
  margin-top: 16px;
}
.tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.policy {
  background: var(--bg-subtle);
  border-radius: var(--r-md);
  padding: 10px 12px;
}
.rowline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.rowline:last-child {
  border-bottom: none;
}
.brand {
  color: var(--brand-600);
}
.pf-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
}
.pf-row:last-of-type {
  border-bottom: none;
}
.mb16 {
  margin-bottom: 16px;
}
</style>
