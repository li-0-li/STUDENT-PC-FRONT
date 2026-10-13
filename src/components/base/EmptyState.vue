<script setup>
/**
 * 基础层组件：空态（统一空数据文案，避免页面各写一套）
 */
defineProps({
  desc: { type: String, default: '暂无数据' },
  loading: { type: Boolean, default: false }
})
</script>

<template>
  <el-card v-if="loading" shadow="never">
    <el-skeleton :rows="4" animated />
  </el-card>
  <el-empty v-else :description="desc">
    <slot />
  </el-empty>
</template>
