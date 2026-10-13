<script setup>
import { onMounted } from 'vue'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()

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
