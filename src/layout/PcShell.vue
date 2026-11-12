<script setup>
/**
 * PC 端 App-Shell：顶栏 + 侧栏 + 内容区
 * 移植自 ui-prototype/assets/shell.js 的 pcShell（布局与视觉对齐原型）
 * 公共代码，只在 main 上改
 *
 * ★ 2026-10-15 学生端改版（学习通风格）：
 *   - student 角色 → 窄侧栏（默认 76px 图标+标签，可展开 176px）+ 顶栏搜索
 *     一级入口（课表/课程/我的任务/消息/AI答疑/个人中心），见 menus.js STUDENT_NAV
 *     （★ 2026-10-16 增补的「课堂」已于 2026-11-12 并入「课程」，
 *       改由课程卡「进入课堂」按 courseId 精确进入，侧栏不再单列）
 *   - teacher / admin → 保持原「宽侧栏 + 全量菜单」不动（后续另行改版）
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menusOf, ROLE_LABEL, STUDENT_NAV } from './menus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useUserStore } from '@/store/user'
import { useMessageStore } from '@/store/message'
import { notificationList } from '@/api/student/message'
import { resolveAvatarUrl, avatarFallbackUrl } from '@/utils/media'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const msgStore = useMessageStore()

/**
 * ★ 2026-10-16 顶栏「未登录」自愈：同标签内如果启动瞬间（如后端重启窗口期）
 * fetchInfo 失败被吞，info 会一直是空 → 顶栏显示「未登录」。
 * 这里在每次路由导航后补拉一次（store 内做了并发去重，info 已有则直接跳过）。
 *
 * ★ 2026-10-19 顶栏未读通知角标：原 el-badge 绑定的 userStore.unread 从没人赋值
 * （铃铛永不亮）。现在路由切换后拉一次通知列表统计未读，30 秒节流。
 */
let lastUnreadAt = 0
async function refreshUnread() {
  if (!userStore.isLogin) return
  if (Date.now() - lastUnreadAt < 30000) return
  lastUnreadAt = Date.now()
  try {
    const d = await notificationList()
    const list = d?.list || []
    userStore.setUnread(list.filter((n) => Number(n.isRead) === 0).length)
  } catch {
    // 未读统计失败不影响页面
  }
}

router.afterEach(() => {
  if (userStore.isLogin && !userStore.info) {
    userStore.fetchInfo().catch(() => {})
  }
  refreshUnread()
})

const role = computed(() => userStore.role || 'student')
const isStudent = computed(() => role.value === 'student')

/**
 * ★ 2026-10-20 顶栏搜索只在「课程」页显示（用户要求）：
 * 原实现所有学生页顶栏都显示"搜索课程"，与各页面内容无关；
 * 现在仅课程列表页（/student/courses）显示，其他页面顶栏留白更干净。
 */
const isCoursesPage = computed(
  () => route.path === '/student/courses' || route.path.startsWith('/student/course-detail')
)
const menus = computed(() => menusOf(role.value))
const activeId = computed(() => route.meta?.menuId || route.meta?.activeMenu || '')

/**
 * ★ 2026-11-12 侧栏「消息」总未读角标（全局）
 *
 * 此前侧栏完全拿不到未读数：未读只在 Messages.vue 内部拉、内部算，
 * 用户不在消息页时左侧「消息」永远没有任何提示，新消息到达也无从感知。
 * 现在由 store 统一持有，本组件只负责「在 shell 存活期间定期刷新」，
 * 这样无论停在哪个页面，角标都能亮、能减。
 *
 * 轮询口径：3 秒一次，页面不可见时跳过（后台标签页不浪费请求）。
 * 消息页内还有一个更快的定时器，两者通过 store 的 inflight/节流合并，不会打双份。
 */
let msgTimer = null
function startMsgPoll() {
  if (msgTimer || !isStudent.value || !userStore.isLogin) return
  msgStore.refresh(0)
  msgTimer = setInterval(() => {
    if (document.hidden) return
    msgStore.refresh(2500)
  }, 3000)
  // 从别的标签页/最小化切回来时立刻补一次：省得用户盯着一个过期角标等 3 秒
  document.addEventListener('visibilitychange', onVisible)
}
/** 页面重新可见 → 立即刷新未读（受 store 内部节流保护，不会连点爆请求） */
function onVisible() {
  if (!document.hidden) msgStore.refresh(1000)
}
function stopMsgPoll() {
  if (msgTimer) clearInterval(msgTimer)
  msgTimer = null
  document.removeEventListener('visibilitychange', onVisible)
}
watch(isStudent, (v) => (v ? startMsgPoll() : stopMsgPoll()), { immediate: true })
onUnmounted(stopMsgPoll)

/** 侧栏角标文案：超过 99 折叠成 99+，避免窄侧栏被撑开 */
const msgBadge = computed(() => (msgStore.total > 99 ? '99+' : String(msgStore.total)))

/**
 * ★ 2026-11-12 头像地址归一化 + 加载失败降级
 *
 * 运行库 `sys_user.avatar` 存在 4 种格式（/files/…、/profile/…、裸 /2026/…、
 * MinIO 预签名 http://localhost:9000/…），直接绑 :src 只有第一种能显示。
 * resolveAvatarUrl 统一收敛到同域 /files/，失败时回退「首字母」占位，不再出现裂图。
 */
const avatarPrimary = computed(() => resolveAvatarUrl(userStore.info?.avatar))
/**
 * 头像加载两步降级：0 首选 /files/… → 1 走 MinIO 只读代理 /api/v1/files/obj/… → 2 放弃（首字母）。
 * 第二步解决的是生产 MinIO 模式：文件在桶里、服务器磁盘上没有，/files/ 必然 404。
 */
const avatarStep = ref(0)
const avatarSrc = computed(() => {
  if (avatarStep.value === 2) return ''
  if (avatarStep.value === 1) return avatarFallbackUrl(avatarPrimary.value)
  return avatarPrimary.value
})
watch(avatarPrimary, () => {
  avatarStep.value = 0
})
function onAvatarError() {
  if (avatarStep.value === 0 && avatarFallbackUrl(avatarPrimary.value)) {
    avatarStep.value = 1
    return
  }
  avatarStep.value = 2
}

/** 学生端窄侧栏：默认收起（窄），可展开 */
const navOpen = ref(false)

/** 分组高亮：路由 menuId/activeMenu 命中组内 children，或路径前缀匹配 */
function isGroupActive(g) {
  return g.children.includes(activeId.value) || route.path.startsWith(g.path)
}

/** 顶栏搜索（学生端）：回车 → 课程页带 keyword */
const kw = ref('')
function onSearch() {
  const v = kw.value.trim()
  router.push({ path: '/student/courses', query: v ? { keyword: v } : {} })
}

function onCommand(cmd) {
  if (cmd === 'logout') userStore.logout().then(() => router.push('/login'))
  else if (cmd === 'profile') router.push(`/${role.value}/profile`)
}

/**
 * ★ 2026-11-10 铃铛「消息入口」：原来只跳系统通知，学生没有一条路能从顶栏进「我的对话」。
 * 现在下拉明确给出「我的对话 / 系统通知」两项；教师与管理员仍走原消息页。
 */
function onBellCommand(cmd) {
  if (!isStudent.value) {
    router.push(`/${role.value}/messages`)
    return
  }
  if (cmd === 'notice') router.push({ name: 'StuNotice' })
  else router.push({ name: 'StuMessages' })
}
</script>

<template>
  <div class="shell" :class="{ xxt: isStudent, navopen: navOpen }">
    <header class="topbar">
      <div class="brand">
        <span class="logo"><BaseIcon name="graduation-cap" :size="18" /></span>
        <span>智课平台</span>
      </div>

      <!-- 学生端：顶栏搜索（课程/作业聚合入口，当前先接课程搜索） -->
      <div v-if="isStudent && isCoursesPage" class="search">
        <el-input
          v-model="kw"
          placeholder="搜索课程…"
          clearable
          @keyup.enter="onSearch"
        >
          <template #prefix><BaseIcon name="search" :size="15" /></template>
        </el-input>
      </div>

      <div class="spacer" />
      <el-dropdown trigger="click" @command="onBellCommand">
        <el-badge :value="userStore.unread" :max="99" :hidden="userStore.unread === 0" class="bell">
          <el-button
            text
            circle
            :title="userStore.unread ? `${userStore.unread} 条未读通知` : '消息'"
          >
            <BaseIcon name="bell" :size="18" />
          </el-button>
        </el-badge>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="chat">
              <BaseIcon name="message-circle" :size="14" />我的对话
            </el-dropdown-item>
            <el-dropdown-item command="notice">
              <BaseIcon name="bell" :size="14" />系统通知
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown @command="onCommand">
        <span class="user">
          <span class="avatar">
            <img
              v-if="avatarSrc"
              :src="avatarSrc"
              class="av-img"
              alt="头像"
              @error="onAvatarError"
            />
            <template v-else>{{ (userStore.name || '学')[0] }}</template>
          </span>
          <span>{{ userStore.name || '未登录' }}</span>
          <span class="muted small">（{{ ROLE_LABEL[role] }}）</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人资料</el-dropdown-item>
            <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <!-- 学习通风格窄侧栏（学生端） -->
    <aside v-if="isStudent" class="sbar">
      <div class="s-user">
        <span class="avatar lg">
          <img
            v-if="avatarSrc"
            :src="avatarSrc"
            class="av-img"
            alt="头像"
            @error="onAvatarError"
          />
          <template v-else>{{ (userStore.name || '学')[0] }}</template>
        </span>
        <span v-show="navOpen" class="s-name">{{ userStore.name || '未登录' }}</span>
      </div>
      <nav class="s-menu">
        <router-link
          v-for="g in STUDENT_NAV"
          :key="g.id"
          class="s-item"
          :class="{ active: isGroupActive(g) }"
          :to="g.path"
        >
          <!-- icon 包一层 relative 容器：展开/收起侧栏时角标始终贴图标右上，不随文字漂移 -->
          <span class="s-ic">
            <BaseIcon :name="g.icon" :size="20" />
            <!-- ★ 2026-11-12 总未读角标：只挂在「消息」上，点开会话后由 store 减少 -->
            <span v-if="g.id === 'messages' && msgStore.total > 0" class="s-badge">{{ msgBadge }}</span>
          </span>
          <span class="s-label">{{ g.label }}</span>
        </router-link>
      </nav>
      <div class="s-toggle" @click="navOpen = !navOpen">
        <BaseIcon :name="navOpen ? 'chevron-left' : 'chevron-right'" :size="16" />
        <span v-show="navOpen" class="s-label2">收起</span>
      </div>
    </aside>

    <!-- 原宽侧栏（教师/管理员） -->
    <aside v-else class="sidebar">
      <nav class="menu">
        <router-link
          v-for="m in menus"
          :key="m.id"
          class="menu-item"
          :class="{ active: activeId === m.id }"
          :to="m.path"
        >
          <BaseIcon :name="m.icon" :size="18" />
          <span>{{ m.label }}</span>
        </router-link>
      </nav>
      <div class="foot">
        <a class="menu-item" @click="onCommand('logout')">
          <BaseIcon name="log-out" :size="18" /><span>退出登录</span>
        </a>
      </div>
    </aside>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  --sbw: var(--sidebar-w);
}
/* 学生端：窄侧栏宽度切换（收起 76 / 展开 176） */
.shell.xxt {
  --sbw: 76px;
}
.shell.xxt.navopen {
  --sbw: 176px;
}
.shell.xxt .main {
  transition: margin-left 0.18s;
}
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--topbar-h);
  z-index: 30;
  background: #fff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 15px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: var(--r-md);
  background: var(--brand-600);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search {
  width: 340px;
  margin-left: 16px;
}
.search :deep(.el-input__wrapper) {
  background: var(--bg-soft);
  box-shadow: none;
  border-radius: var(--r-full);
}
.spacer {
  flex: 1;
}
.user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  color: var(--ink-700);
  cursor: pointer;
  outline: none;
}
.av-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--r-full);
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
}
.avatar.lg {
  width: 44px;
  height: 44px;
  font-size: 16px;
  flex-shrink: 0;
}

/* ---------- 学习通窄侧栏 ---------- */
.sbar {
  position: fixed;
  top: var(--topbar-h);
  left: 0;
  bottom: 0;
  width: var(--sbw);
  z-index: 20;
  background: #fff;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 10px 0;
  transition: width 0.18s;
  overflow: hidden;
}
.s-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 14px;
  justify-content: center;
}
.shell.navopen .s-user {
  justify-content: flex-start;
  padding: 6px 18px 14px;
}
.s-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  white-space: nowrap;
}
.s-menu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.s-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 11px 0;
  margin: 2px 8px;
  border-radius: var(--r-md);
  color: var(--ink-600);
  cursor: pointer;
  white-space: nowrap;
}
/* ★ 2026-11-12 未读角标的定位容器：相对图标，不相对菜单项，
   这样窄侧栏（上下排列）与展开侧栏（左右排列）下角标位置一致 */
.s-ic {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.s-badge {
  position: absolute;
  top: -6px;
  left: 13px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--error, #ef4444);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
.shell.navopen .s-item {
  flex-direction: row;
  gap: 12px;
  padding: 11px 18px;
  justify-content: flex-start;
}
.s-item .s-label {
  font-size: 12px;
}
.shell.navopen .s-item .s-label {
  font-size: 14px;
}
.s-item:hover {
  background: var(--bg-soft);
  color: var(--ink-900);
}
.s-item.active {
  background: var(--primary-soft);
  color: var(--brand-700);
  font-weight: 600;
}
.s-toggle {
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding: 10px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ink-400);
  cursor: pointer;
  font-size: 12px;
}
.s-toggle:hover {
  color: var(--brand-700);
}

/* ---------- 原宽侧栏（teacher/admin） ---------- */
.sidebar {
  position: fixed;
  top: var(--topbar-h);
  left: 0;
  bottom: 0;
  width: var(--sidebar-w);
  z-index: 20;
  background: #fff;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
}
.menu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--r-md);
  color: var(--ink-600);
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--bg-soft);
  color: var(--ink-900);
}
.menu-item.active {
  background: var(--primary-soft);
  color: var(--brand-700);
  font-weight: 600;
}
.foot {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.main {
  margin-left: var(--sbw);
  margin-top: var(--topbar-h);
  padding: 24px 28px;
  min-width: 0;
}
</style>
