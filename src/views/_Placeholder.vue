<script setup>
/**
 * 占位页：给尚未实现的端/页面用，保证骨架期不 404
 * 真实页面实现后请把路由指向真实组件，不要留着这个当成品
 */
defineProps({
  title: { type: String, default: '页面待实现' },
  owner: { type: String, default: '' }
})
</script>

<template>
  <div>
    <div class="page-head">
      <h1>{{ title }}</h1>
    </div>
    <el-empty :description="`本页为骨架占位${owner ? '，由 ' + owner + ' 负责实现' : ''}`" />
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
</style>
