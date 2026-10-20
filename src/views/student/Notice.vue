<script setup>
/**
 * 系统通知（分支 stu-pc-message）
 * 关联接口（接口设计文档表号）：表 2-13 站内通知查询、表 2-17 消息已读标记
 * 对应原型：ui-prototype/pc/student-notice.html —— ★ 1:1 还原
 *
 * ★ 2026-10-16 去演示数据 + 修 bug：
 *   ① 原实现以 7 条原型假数据（NOTICES）兜底 —— 接口失败/为空时用户看到假通知，已删；
 *      现在空列表显示真实空态，接口失败如实报错。
 *   ② 单条已读参数错误：原传 {ids:[...]}，契约是 NotificationReadRequest.noticeIds —— 已修。
 *   ③ 时间格式化（今天 14:20 / 昨天 / 10-08）。
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { notificationList, markNoticesRead } from '@/api/student/message'

const TABS = [
  { k: 'all', l: '全部' },
  { k: 'ann', l: '平台公告' },
  { k: 'remind', l: '学习提醒' },
  { k: 'maint', l: '系统' }
]

/** 分类 → 图标 / 色调 */
const CAT_META = {
  ann: { ic: 'megaphone', tone: '' },
  remind: { ic: 'clock-alert', tone: 'warning' },
  maint: { ic: 'wrench', tone: 'sys' }
}

/** 后端 bizType → 页面分类（未知值归入学习提醒） */
function mapCat(bizType) {
  return bizType === 'ann' || bizType === 'maint' ? bizType : 'remind'
}

/** 通知时间：今天 14:20 / 昨天 / 10-08 */
function fmtTime(t) {
  if (!t) return ''
  const s = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s)
    : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s
  const now = new Date()
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return hm
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return '昨天'
  return String(d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0')
}

const notices = ref([])
const loading = ref(false)
const offline = ref(false)

const cur = ref('all')
const rows = computed(() => (cur.value === 'all' ? notices.value : notices.value.filter((n) => n.cat === cur.value)))
const unreadOf = (cat) => notices.value.filter((n) => n.unread && (cat === 'all' || n.cat === cat)).length
const unreadTip = computed(() => `未读 ${unreadOf('all')} 条 / 共 ${notices.value.length} 条`)

/* ---------------- 详情弹窗（打开即标已读） ---------------- */
const detailVisible = ref(false)
const curNotice = ref(null)
function openNotice(n) {
  curNotice.value = n
  detailVisible.value = true
  if (n.unread) {
    n.unread = false
    markNoticesRead({ noticeIds: [n.id] }).catch(() => {})
  }
}

async function readAll() {
  if (!unreadOf('all')) {
    ElMessage.info('没有未读通知')
    return
  }
  try {
    await markNoticesRead({ all: true })
    notices.value.forEach((n) => (n.unread = false))
    ElMessage.success('已全部标为已读')
  } catch {
    // 拦截器统一提示，不本地假装成功
  }
}

async function load() {
  loading.value = true
  try {
    const d = await notificationList()
    const list = d?.list || []
    notices.value = list.map((n) => {
      const cat = mapCat(n.bizType)
      return {
        id: n.noticeId || n.id,
        cat,
        ic: CAT_META[cat].ic,
        tone: CAT_META[cat].tone,
        t: n.title || '通知',
        time: fmtTime(n.createTime),
        unread: !n.isRead,
        d: n.content || '',
        more: n.content || ''
      }
    })
    offline.value = false
  } catch {
    notices.value = []
    offline.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="系统通知" desc="作业批改 / 课堂 / 调课等系统通知，支持标记已读" back back-to="/student/messages">
      <template #actions>
        <span class="small muted" style="margin-right: 10px">{{ unreadTip }}</span>
        <el-button @click="readAll"><BaseIcon name="check" :size="14" />全部标为已读</el-button>
      </template>
    </PageHeader>

    <div class="row" style="margin-bottom: 14px">
      <span class="ntabs">
        <span
          v-for="t in TABS"
          :key="t.k"
          class="pill"
          :class="{ active: cur === t.k }"
          @click="cur = t.k"
        >
          {{ t.l }}
          <span v-if="unreadOf(t.k)" class="cnt">{{ unreadOf(t.k) }}</span>
        </span>
      </span>
    </div>

    <div class="stack" style="gap: 10px">
      <div
        v-for="n in rows"
        :key="n.id"
        class="nitem"
        :class="{ unread: n.unread }"
        @click="openNotice(n)"
      >
        <span class="ic" :class="n.tone"><BaseIcon :name="n.ic" :size="18" /></span>
        <div style="flex: 1; min-width: 0">
          <div class="between">
            <span class="ttl">{{ n.t }}</span>
            <span class="small muted" style="flex: none; margin-left: 12px">{{ n.time }}</span>
          </div>
          <div class="body">{{ n.d }}</div>
        </div>
        <span v-if="n.unread" class="dot" />
      </div>
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!rows.length" class="empty">
        {{ offline ? '通知加载失败，请确认后端与 SSH 隧道已启动' : '该分类下暂无通知' }}
      </div>
    </div>

    <!-- 通知详情 -->
    <el-dialog v-model="detailVisible" :title="curNotice?.t" width="520px">
      <div class="small muted" style="margin-bottom: 10px">{{ curNotice?.time }}</div>
      <div class="nd-body">{{ curNotice?.more || curNotice?.d }}</div>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ntabs {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: var(--bg-soft);
  border-radius: 11px;
}
.ntabs .pill {
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-600);
  cursor: pointer;
  user-select: none;
}
.ntabs .pill.active {
  background: #fff;
  color: var(--brand-700);
  box-shadow: var(--sh-1);
}
.ntabs .pill .cnt {
  display: inline-block;
  min-width: 17px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: 99px;
  background: var(--error);
  color: #fff;
  font-size: 11px;
  line-height: 17px;
  text-align: center;
}
.nitem {
  display: flex;
  gap: 13px;
  padding: 15px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  transition: 0.15s;
  cursor: pointer;
}
.nitem:hover {
  border-color: var(--brand-300);
  box-shadow: 0 4px 14px rgba(13, 148, 136, 0.08);
}
.nitem.unread {
  border-color: var(--brand-300);
  background: var(--primary-softer);
}
.nitem .ic {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-100);
  color: var(--brand-700);
}
.nitem .ic.sys {
  background: var(--bg-soft);
  color: var(--ink-500);
}
.nitem .ic.success {
  background: var(--success-soft);
  color: var(--success);
}
.nitem .ic.warning {
  background: var(--warning-soft);
  color: var(--warning);
}
.nitem .ttl {
  font-weight: 600;
  font-size: 14px;
}
.nitem .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error);
  flex: none;
  margin-top: 7px;
}
.nitem .body {
  font-size: 13px;
  color: var(--ink-600);
  line-height: 1.75;
  margin-top: 5px;
}
.nd-body {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--ink-700);
  white-space: pre-line;
}
.empty {
  text-align: center;
  color: var(--ink-400);
  font-size: 13px;
  padding: 56px 0;
}
</style>
