<script setup>
/**
 * PC 端 App-Shell：顶栏 + 侧栏 + 内容区
 * 移植自 ui-prototype/assets/shell.js 的 pcShell（布局与视觉对齐原型）
 * 公共代码，只在 main 上改
 *
 * ★ 2026-10-15 学生端改版（学习通风格）：
 *   - student 角色 → 窄侧栏（默认 76px 图标+标签，可展开 176px）+ 顶栏搜索
 *     一级入口（课表/课程/课堂/我的任务/消息/AI答疑/个人中心），见 menus.js STUDENT_NAV
 *     （★ 2026-10-16 增补「课堂」：实时课堂 + 课堂签到）
 *   - teacher / admin → 保持原「宽侧栏 + 全量菜单」不动（后续另行改版）
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menusOf, ROLE_LABEL, STUDENT_NAV } from './menus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * ★ 2026-10-16 顶栏「未登录」自愈：同标签内如果启动瞬间（如后端重启窗口期）
 * fetchInfo 失败被吞，info 会一直是空 → 顶栏显示「未登录」。
 * 这里在每次路由导航后补拉一次（store 内做了并发去重，info 已有则直接跳过）。
 */
router.afterEach(() => {
  if (userStore.isLogin && !userStore.info) {
    userStore.fetchInfo().catch(() => {})
  }
})

const role = computed(() => userStore.role || 'student')
const isStudent = computed(() => role.value === 'student')
const menus = computed(() => menusOf(role.value))
const activeId = computed(() => route.meta?.menuId || route.meta?.activeMenu || '')

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
</script>

<template>
  <div class="shell" :class="{ xxt: isStudent, navopen: navOpen }">
    <header class="topbar">
      <div class="brand">
        <span class="logo"><BaseIcon name="graduation-cap" :size="18" /></span>
        <span>智课平台</span>
      </div>

      <!-- 学生端：顶栏搜索（课程/作业聚合入口，当前先接课程搜索） -->
      <div v-if="isStudent" class="search">
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
      <el-badge :is-dot="userStore.unread > 0" class="bell">
        <el-button text circle @click="router.push(`/${role}/messages`)">
          <BaseIcon name="bell" :size="18" />
        </el-button>
      </el-badge>
      <el-dropdown @command="onCommand">
        <span class="user">
          <span class="avatar">{{ (userStore.name || '学')[0] }}</span>
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
        <span class="avatar lg">{{ (userStore.name || '学')[0] }}</span>
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
          <BaseIcon :name="g.icon" :size="20" />
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
