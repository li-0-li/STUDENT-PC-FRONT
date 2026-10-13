<script setup>
/**
 * PC 端 App-Shell：顶栏 + 侧栏 + 内容区
 * 移植自 ui-prototype/assets/shell.js 的 pcShell（布局与视觉对齐原型）
 * 公共代码，只在 main 上改
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menusOf, ROLE_LABEL } from './menus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const role = computed(() => userStore.role || 'student')
const menus = computed(() => menusOf(role.value))
const activeId = computed(() => route.meta?.menuId || route.meta?.activeMenu || '')

function onCommand(cmd) {
  if (cmd === 'logout') userStore.logout().then(() => router.push('/login'))
  else if (cmd === 'profile') router.push(`/${role.value}/profile`)
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="logo"><BaseIcon name="graduation-cap" :size="18" /></span>
        <span>智能教学辅助平台</span>
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

    <aside class="sidebar">
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
  margin-left: var(--sidebar-w);
  margin-top: var(--topbar-h);
  padding: 24px 28px;
  min-width: 0;
}
</style>
