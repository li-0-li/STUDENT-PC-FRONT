<script setup>
/**
 * 基础层组件：页面标题区（标题 + 说明 + 右侧操作插槽）
 * 三层组件规范见 PRD §6.6：base / business / page
 */
defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' }
})
</script>

<template>
  <div class="page-head">
    <div>
      <h1>{{ title }}</h1>
      <div v-if="desc" class="muted small mt8">{{ desc }}</div>
    </div>
    <div class="actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.page-head h1 {
  font-size: 20px;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
