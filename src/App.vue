<script setup>
import { onMounted } from 'vue'
import { useUserStore } from '@/store/user'
import { useIdleTimeout } from '@/composables/useIdleTimeout'

const userStore = useUserStore()

// 会话闲置超时自动跳转登录（三级功能清单 · 登录安全控制）
useIdleTimeout()

// 已登录但刷新页面时，补拉当前用户信息（表 2-14）
onMounted(() => {
  if (userStore.isLogin && !userStore.info) {
    userStore.fetchInfo().catch(() => {})
  }
})
</script>

<template>
  <router-view />
</template>
