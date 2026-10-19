<script setup>
/**
 * 资源预览（分支 stu-pc-resource；跨端公共页）
 * 关联接口（接口设计文档表号）：表 3-4 资源列表（fileUrl 经 /files 代理伺服）
 * 对应原型：ui-prototype/pc/resource-preview.html（粘性顶部条 + 按类型渲染）
 *
 * ★ 2026-10-19 重写：**原页面整页是原型示意**（写死 10 行教学周表格、3 道假题、假播放条、
 *   下载只弹「演示环境」提示）。现改为真文件预览：
 *   · 入参 query.url = 资源真实 fileUrl（由课程详情「资源」页传入，/files 代理可达）；
 *   · 图片 / 视频 / PDF 内嵌渲染；doc/xls/ppt 等浏览器不能内嵌的格式引导下载；
 *   · 无有效地址时如实提示（教师端 local:// 伪协议记录会命中此分支）。
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'

const route = useRoute()
const router = useRouter()

const url = String(route.query.url || '')
const title = String(route.query.title || '未命名资源')
const sub = String(route.query.sub || '')
const typeQ = String(route.query.type || '')

const ICON = { doc: 'file-text', video: 'video', image: 'image' }
const LABEL = { doc: '文档', video: '视频', image: '图片' }

/** 有效地址：http(s) 或站内绝对路径（/files/... 走代理） */
const hasUrl = computed(() => /^(https?:)?\/\//i.test(url) || url.startsWith('/'))

/** 扩展名（去掉 query/hash） */
const ext = computed(() => {
  const clean = url.split('?')[0].split('#')[0]
  const i = clean.lastIndexOf('.')
  return i >= 0 ? clean.slice(i + 1).toLowerCase() : ''
})

/** 预览类型：扩展名优先，其次 query.type */
const kind = computed(() => {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext.value)) return 'image'
  if (['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(ext.value)) return 'video'
  if (ext.value === 'pdf') return 'pdf'
  if (typeQ === 'video') return 'video'
  if (typeQ === 'image') return 'image'
  return 'other'
})

const label = computed(
  () => ({ image: '图片', video: '视频', pdf: 'PDF', other: LABEL[typeQ] || '文件' })[kind.value]
)
const icon = computed(
  () =>
    ({ image: 'image', video: 'video', pdf: 'file-text', other: ICON[typeQ] || 'file-text' })[
      kind.value
    ]
)

/** 可内嵌预览（浏览器原生支持） */
const embeddable = computed(() => hasUrl.value && ['image', 'video', 'pdf'].includes(kind.value))

function download() {
  if (!hasUrl.value) {
    ElMessage.info('该资源没有有效下载地址')
    return
  }
  window.open(url, '_blank')
}

onMounted(() => {
  document.title = title + ' · 资源预览'
})
</script>

<template>
  <div class="rp-wrap">
    <!-- 粘性顶部条 -->
    <div class="rp-top">
      <span class="rp-back" @click="router.back()"><BaseIcon name="chevron-left" :size="15" />返回</span>
      <el-tag type="info" effect="light">
        <BaseIcon :name="icon" :size="13" />{{ label }}
      </el-tag>
      <span class="rp-title">{{ title }}</span>
      <span v-if="sub" class="rp-sub">{{ sub }}</span>
      <div style="margin-left: auto">
        <el-button size="small" :disabled="!hasUrl" @click="download">
          <BaseIcon name="download" :size="14" />下载
        </el-button>
      </div>
    </div>

    <div class="rp-stage">
      <!-- 图片 -->
      <img v-if="kind === 'image' && embeddable" :src="url" :alt="title" class="rp-media" />

      <!-- 视频 -->
      <video v-else-if="kind === 'video' && embeddable" :src="url" controls class="rp-media" />

      <!-- PDF 内嵌 -->
      <iframe v-else-if="kind === 'pdf' && embeddable" :src="url" class="rp-frame" title="PDF 预览" />

      <!-- 其他格式 / 无有效地址 -->
      <div v-else class="rp-box">
        <EmptyState
          :desc="
            !hasUrl
              ? '该资源没有可预览的文件（教师端上传记录异常，请联系教师重新上传）'
              : label + '格式不支持在线预览，请下载后查看'
          "
        >
          <el-button v-if="hasUrl" type="primary" @click="download">下载文件</el-button>
        </EmptyState>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp-wrap {
  background: var(--bg-subtle);
  min-height: 100vh;
  margin: -16px;
  padding-bottom: 30px;
}
.rp-top {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 22px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.rp-back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--ink-600);
  cursor: pointer;
}
.rp-back:hover {
  color: var(--brand-600);
}
.rp-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink-900);
  max-width: 46vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-sub {
  font-size: 12px;
  color: var(--ink-500);
}
.rp-stage {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px;
  min-height: 62vh;
}
.rp-media {
  max-width: min(980px, 96%);
  max-height: 78vh;
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
  background: #000;
}
.rp-frame {
  width: min(980px, 96%);
  height: 78vh;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: #fff;
}
.rp-box {
  width: min(720px, 96%);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 12px;
}
</style>
