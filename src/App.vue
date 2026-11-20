<script setup>
import { onMounted } from 'vue'
import { useUserStore } from '@/store/user'
import { useIdleTimeout } from '@/composables/useIdleTimeout'
import { useStudyTimer } from '@/composables/useStudyTimer'

const userStore = useUserStore()

// 会话闲置超时自动跳转登录（三级功能清单 · 登录安全控制）
useIdleTimeout()

// 学习时长采集（★ 2026-11-20）：只在课程/作业/资源/直播/AI 页计时，30 秒一次心跳上报
useStudyTimer()

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
