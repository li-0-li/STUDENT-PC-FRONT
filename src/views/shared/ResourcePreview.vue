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
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { DOC_SIZE_LIMIT, parseSheet, parseSlides, renderDocx } from '@/utils/docPreview'

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

const label = computed(() => {
  const map = { docx: 'Word 文档', sheet: '表格', slides: '演示文稿', text: '文本' }
  if (map[officeKind.value]) return map[officeKind.value]
  return ({ image: '图片', video: '视频', pdf: 'PDF', other: LABEL[typeQ] || '文件' })[kind.value]
})
const icon = computed(
  () =>
    ({ image: 'image', video: 'video', pdf: 'file-text', other: ICON[typeQ] || 'file-text' })[
      kind.value
    ]
)

/** 可内嵌预览（浏览器原生支持） */
const embeddable = computed(() => hasUrl.value && ['image', 'video', 'pdf'].includes(kind.value))

/**
 * 需要前端解析才能预览的办公文档类型（★ 2026-11-20 新增）
 * · docx  —— docx-preview 渲染；老 .doc 二进制格式解析不了，仍走下载
 * · sheet —— xlsx 读 xlsx/xls/csv
 * · slides—— 只抽 pptx 文字（版式与图片需下载）
 * · text  —— 纯文本直接铺开
 */
const officeKind = computed(() => {
  if (!hasUrl.value) return ''
  const e = ext.value
  if (e === 'docx') return 'docx'
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'sheet'
  if (e === 'pptx') return 'slides'
  if (['txt', 'md', 'log', 'json'].includes(e)) return 'text'
  return ''
})

const loading = ref(false)
const failed = ref('')
const docxHost = ref(null)
const sheetData = ref([])
const slideData = ref({ slides: [], total: 0, mediaCount: 0, truncated: false })
const textData = ref('')

/** 拉取并解析文档（失败一律落到 failed，由模板给出下载兜底） */
async function loadOffice() {
  if (!officeKind.value) return
  loading.value = true
  failed.value = ''
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    if (officeKind.value === 'text') {
      textData.value = (await resp.text()).slice(0, 200000)
    } else {
      const buf = await resp.arrayBuffer()
      if (buf.byteLength > DOC_SIZE_LIMIT) throw new Error('文件超过 20MB')
      if (officeKind.value === 'docx') {
        await renderDocx(buf, docxHost.value)
      } else if (officeKind.value === 'sheet') {
        sheetData.value = parseSheet(buf, 300).sheets
      } else {
        slideData.value = await parseSlides(buf, 60)
      }
    }
  } catch (e) {
    failed.value = e && e.message ? e.message : '解析失败'
  } finally {
    loading.value = false
  }
}

function download() {
  if (!hasUrl.value) {
    ElMessage.info('该资源没有有效下载地址')
    return
  }
  window.open(url, '_blank')
}

onMounted(() => {
  document.title = title + ' · 资源预览'
  loadOffice()
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

      <!-- Word（docx）：docx-preview 渲染，host 常驻以避免加载态切换丢容器 -->
      <div v-else-if="officeKind === 'docx'" class="rp-doc">
        <div ref="docxHost" class="rp-docx"></div>
        <div v-if="loading" class="rp-tip">正在加载文档…</div>
        <div v-else-if="failed" class="rp-tip err">文档解析失败（{{ failed }}），请下载后查看</div>
      </div>

      <!-- 表格（xlsx/xls/csv） -->
      <div v-else-if="officeKind === 'sheet'" class="rp-doc">
        <div v-if="loading" class="rp-tip">正在加载表格…</div>
        <div v-else-if="failed" class="rp-box">
          <EmptyState :desc="'表格解析失败（' + failed + '），请下载后查看'">
            <el-button v-if="hasUrl" type="primary" @click="download">下载文件</el-button>
          </EmptyState>
        </div>
        <div v-else class="rp-sheet">
          <div v-for="s in sheetData" :key="s.name" class="rp-sheet-block">
            <div class="rp-sheet-name">
              {{ s.name }}
              <span class="rp-sheet-meta">
                {{ s.total }} 行{{ s.rows.length < s.total ? '，仅显示前 ' + s.rows.length + ' 行' : '' }}
              </span>
            </div>
            <table class="rp-table">
              <tbody>
                <tr v-for="(row, ri) in s.rows" :key="ri">
                  <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 演示文稿（pptx）：只抽文字，版式与图片需下载 -->
      <div v-else-if="officeKind === 'slides'" class="rp-doc">
        <div v-if="loading" class="rp-tip">正在加载演示文稿…</div>
        <div v-else-if="failed" class="rp-box">
          <EmptyState :desc="'演示文稿解析失败（' + failed + '），请下载后查看'">
            <el-button v-if="hasUrl" type="primary" @click="download">下载文件</el-button>
          </EmptyState>
        </div>
        <div v-else class="rp-slides">
          <div v-for="sl in slideData.slides" :key="sl.no" class="rp-slide">
            <div class="rp-slide-no">第 {{ sl.no }} 页</div>
            <ul class="rp-slide-texts">
              <li v-for="(t, i) in sl.texts" :key="i">{{ t }}</li>
            </ul>
          </div>
          <p class="rp-tip inline">
            共 {{ slideData.total }} 页{{ slideData.mediaCount ? '，含 ' + slideData.mediaCount + ' 个内嵌媒体' : '' }}{{
              slideData.truncated ? '（仅显示前 ' + slideData.slides.length + ' 页）' : ''
            }}；图片与版式请下载原文件查看
          </p>
        </div>
      </div>

      <!-- 纯文本 -->
      <div v-else-if="officeKind === 'text'" class="rp-doc">
        <div v-if="loading" class="rp-tip">正在加载…</div>
        <pre v-else class="rp-text">{{ textData }}</pre>
      </div>

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
/* ---------- 办公文档预览（2026-11-20 新增） ---------- */
.rp-doc {
  position: relative;
  width: min(980px, 96%);
}
.rp-docx {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 28px 32px;
  max-height: 78vh;
  overflow: auto;
}
.rp-docx :deep(.stu-docx) {
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink-900);
}
.rp-sheet {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  max-height: 78vh;
  overflow: auto;
  padding: 8px 12px 16px;
}
.rp-sheet-block + .rp-sheet-block {
  margin-top: 16px;
  border-top: 1px dashed var(--border);
  padding-top: 12px;
}
.rp-sheet-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-900);
  padding: 6px 4px;
}
.rp-sheet-meta {
  margin-left: 8px;
  font-weight: 400;
  font-size: 12px;
  color: var(--ink-500);
}
.rp-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}
.rp-table td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  color: var(--ink-700);
  white-space: pre-wrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-slides {
  display: grid;
  gap: 12px;
  max-height: 78vh;
  overflow: auto;
}
.rp-slide {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px 16px;
}
.rp-slide-no {
  font-size: 12px;
  font-weight: 700;
  color: var(--brand-600);
  margin-bottom: 6px;
}
.rp-slide-texts {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-800);
}
.rp-text {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 20px 24px;
  max-height: 78vh;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-800);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.rp-tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.86);
  border-radius: var(--r-md);
  font-size: 13px;
  color: var(--ink-600);
}
.rp-tip.err {
  color: #c45656;
}
.rp-tip.inline {
  position: static;
  background: none;
  font-size: 12px;
  color: var(--ink-500);
  justify-content: flex-start;
  padding: 4px 2px 0;
}
.rp-box {
  width: min(720px, 96%);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 12px;
}
</style>
