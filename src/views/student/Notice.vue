<script setup>
/**
 * 系统通知（分支 stu-pc-message）
 * 关联接口（接口设计文档表号）：表 2-13 站内通知查询、表 2-17 消息已读标记
 * 对应原型：ui-prototype/pc/student-notice.html —— ★ 1:1 还原
 *   （四个分类页签带未读数、通知卡片列表、详情弹窗、全部标为已读）
 *   与小程序端 mp/app-notice.html 四类内容保持一致（端间镜像）
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

/** 原型演示数据（NOTICES） */
const notices = ref([
  {
    id: 1, cat: 'ann', ic: 'megaphone', tone: '', t: '平台公告 · 新版本 v1.2.0 发布', time: '2 小时前', unread: true,
    d: '本次更新：①课堂支持多样化签到（扫码 / 定位 / 拍照等）；②作业 AI 评语更细致；③修复若干已知问题。',
    more: '完整更新日志：\n1. 课堂签到支持 5 种方式：手动、数字口令、二维码、定位、拍照；\n2. 作业批改的主观题评语更加细致，可按知识点给出改进建议；\n3. 学情分析新增薄弱知识点排行；\n4. 修复若干已知问题，优化移动端加载速度。'
  },
  {
    id: 2, cat: 'remind', ic: 'clock-alert', tone: 'warning', t: '学习提醒 · 作业即将截止', time: '今天 09:00', unread: true,
    d: '「习题 2-1 导数定义」将于今晚 23:59 截止，剩余 6 小时 11 分钟，请尽快提交。',
    more: '作业：习题 2-1 导数定义（高等数学 A）\n截止时间：今晚 23:59\n当前状态：未提交\n\n温馨提示：逾期提交将按平台规则扣分，可在截止前多次暂存草稿。'
  },
  {
    id: 3, cat: 'remind', ic: 'circle-check', tone: 'success', t: '学习提醒 · 课程已掌握', time: '昨天', unread: false,
    d: '恭喜！你已在《数据结构》中掌握「栈的实现」全部知识点，能力值 +5。',
    more: '掌握度评估依据：最近 5 次相关练习正确率 92%，课堂互动参与 3 次。\n建议继续学习：第 3 章「队列的实现」。'
  },
  {
    id: 4, cat: 'ann', ic: 'megaphone', tone: '', t: '平台公告 · 开学季活动', time: '09-01', unread: false,
    d: '完成首次课程评价即可领取 30 天 AI 答疑体验会员。',
    more: '活动时间：9 月 1 日 — 9 月 30 日\n参与方式：在「我的课程」中完成任意一门课程的评价即可。'
  },
  {
    id: 5, cat: 'maint', ic: 'wrench', tone: 'sys', t: '系统维护通知', time: '09-05', unread: false,
    d: '9 月 10 日 02:00–04:00 进行例行维护，期间 AI 答疑与作业批改服务不可用。',
    more: '影响范围：AI 答疑、作业 AI 批改、学情分析报表。\n课程资源浏览与作业提交不受影响。'
  },
  {
    id: 6, cat: 'maint', ic: 'wrench', tone: 'sys', t: '系统升级完成', time: '08-20', unread: false,
    d: 'AI 答疑引擎已升级至 DeepSeek-V3，响应速度提升约 40%。',
    more: '本次升级后，AI 答疑的回答将更严格地基于课程知识库检索，并附引用来源。'
  },
  {
    id: 7, cat: 'remind', ic: 'calendar-clock', tone: 'warning', t: '学习提醒 · 课程提醒', time: '09-04', unread: false,
    d: '明天 10:00《高等数学 A》第 5 节开课，地点教 A-301，请提前 5 分钟进入课堂。',
    more: '课程：高等数学 A\n时间：明天 10:00 — 11:40\n地点：教 A-301\n授课教师：张老师'
  }
])

const cur = ref('all')
const rows = computed(() => (cur.value === 'all' ? notices.value : notices.value.filter((n) => n.cat === cur.value)))
const unreadOf = (cat) => notices.value.filter((n) => n.unread && (cat === 'all' || n.cat === cat)).length
const unreadTip = computed(() => `未读 ${unreadOf('all')} 条 / 共 ${notices.value.length} 条`)

/* ---------------- 详情弹窗 ---------------- */
const detailVisible = ref(false)
const curNotice = ref(null)
function openNotice(n) {
  curNotice.value = n
  n.unread = false
  detailVisible.value = true
  if (n.id) {
    markNoticesRead({ ids: [n.id] }).catch(() => {})
  }
}
async function readAll() {
  if (!unreadOf('all')) {
    ElMessage.info('没有未读通知')
    return
  }
  notices.value.forEach((n) => (n.unread = false))
  try {
    await markNoticesRead({ all: true })
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  ElMessage.success('已全部标为已读')
}

async function load() {
  try {
    const d = await notificationList()
    const list = d?.list || []
    if (list.length) {
      notices.value = list.map((n) => ({
        id: n.noticeId || n.id,
        cat: n.bizType === 'ann' ? 'ann' : n.bizType === 'maint' ? 'maint' : 'remind',
        ic: 'megaphone',
        tone: '',
        t: n.title,
        time: n.createTime || '',
        unread: !n.isRead,
        d: n.content,
        more: n.content
      }))
    }
  } catch {
    /* 接口未就绪时用原型演示数据 */
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="系统通知" desc="作业批改 / 课堂 / 调课等系统通知，支持标记已读">
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
      <div v-if="!rows.length" class="empty">该分类下暂无通知</div>
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
