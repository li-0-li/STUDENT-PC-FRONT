<script setup>
/**
 * 基础层组件：页面标题区（返回按钮 + 标题 + 说明 + 右侧操作插槽）
 * 三层组件规范见 PRD §6.6：base / business / page
 *
 * ★ 2026-10-15 新增 back 支持：详情类页面（作业作答/作业详情/课程详情/实验报告等）
 *   从列表进入后需要「返回上一页」；直接打开深链（无浏览历史）时回退到 backTo。
 */
import { useRouter } from 'vue-router'
import BaseIcon from './BaseIcon.vue'

const props = defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  /** 显示返回按钮 */
  back: { type: Boolean, default: false },
  /** 无浏览历史时的兜底路由（如 /student/tasks） */
  backTo: { type: String, default: '' }
})

const router = useRouter()
function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else if (props.backTo) {
    router.push(props.backTo)
  }
}
</script>

<template>
  <div class="page-head">
    <div class="left">
      <el-button v-if="back" text circle class="back-btn" title="返回上一页" @click="goBack">
        <BaseIcon name="arrow-left" :size="17" />
      </el-button>
      <div>
        <h1>{{ title }}</h1>
        <div v-if="desc" class="muted small mt8">{{ desc }}</div>
      </div>
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
.left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.back-btn {
  flex-shrink: 0;
  margin-left: -6px;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
