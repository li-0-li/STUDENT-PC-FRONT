<script setup>
/**
 * 基础层组件：指标卡（对齐原型 .stat）
 */
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '—' },
  trend: { type: String, default: '' },
  tone: { type: String, default: '' } // '' | 'success' | 'warning' | 'error'
})
</script>

<template>
  <el-card shadow="never" class="stat">
    <div class="label">{{ label }}</div>
    <div class="num" :class="tone">{{ value }}</div>
    <div v-if="trend" class="trend muted">{{ trend }}</div>
  </el-card>
</template>

<style scoped>
.stat {
  border-radius: var(--r-lg);
}
.label {
  font-size: 13px;
  color: var(--ink-500);
}
.num {
  font-size: 28px;
  font-weight: 800;
  color: var(--ink-900);
  margin-top: 6px;
}
.num.success {
  color: var(--success);
}
.num.warning {
  color: var(--warning);
}
.num.error {
  color: var(--error);
}
.trend {
  font-size: 12px;
  margin-top: 6px;
}
</style>
