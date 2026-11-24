/**
 * 统一文件预览 / 下载工具（学生端，2026-11-24）
 *
 * 解决的历史问题：同一个「已提交文件」在不同页面有 5 种点击行为——
 *   · 课程资源：router.push 共享预览页（正确，但地址判定过窄）
 *   · 实验附件 / 指导书：window.open 裸地址（相对路径打不开，doc/xlsx 被浏览器直接下载）
 *   · 作业提交附件：纯文本 span，根本没有点击事件
 *   · 提交详情附件：<a :href="数据库原值">，未归一化
 *   · 聊天文件卡片：点整卡直接下载，doc 走 window.open 也是下载
 *   · 学情「查看资料」：router.push 不带任何参数，必然落到「无文件」
 *
 * 本工具把「地址归一化 → 类型判断 → 跳统一预览页 → 下载 → 失败提示」收敛到一处，
 * 所有入口统一调用，新增入口只需遵守同一套约定。
 */
import { ElMessage } from 'element-plus'
import router from '@/router'
import { resolveMediaUrl, mediaFallbackUrl } from '@/utils/media'

/** 占位形态：教师端 local:// 伪协议、种子 /demo/、误补前缀的 /files/local://，桶里没有实体文件 */
const PLACEHOLDER_RE = /^(local:|\/demo\/|\/files\/local:)/i
/** 无意义值：库里历史脏数据 */
const MEANINGLESS_RE = /^(null|undefined|false|0)$/i

/**
 * 归一化任何来源的文件地址为浏览器可访问的 URL。
 * 无效（空 / 占位 / 脏值）返回 ''，调用方据此给出清晰提示，不再静默失败。
 */
export function normalizeFileUrl(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s || MEANINGLESS_RE.test(s) || PLACEHOLDER_RE.test(s)) return ''
  return resolveMediaUrl(s)
}

/** 判断归一化后的地址是否为占位形态（供预览页复用） */
export function isPlaceholder(raw) {
  const s = String(raw == null ? '' : raw).trim()
  return !s || MEANINGLESS_RE.test(s) || PLACEHOLDER_RE.test(s)
}

/** 从 URL / 文件名取小写扩展名（去 query、hash） */
export function extOf(url, name = '') {
  const s = String(url || name || '').split('?')[0].split('#')[0]
  const fromUrl = s.lastIndexOf('.') >= 0 ? s.slice(s.lastIndexOf('.') + 1) : ''
  if (/^[a-z0-9]{1,8}$/i.test(fromUrl)) return fromUrl.toLowerCase()
  const n = String(name || '')
  return n.lastIndexOf('.') >= 0 ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : ''
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']
const VIDEO_EXT = ['mp4', 'webm', 'ogg', 'mov', 'm4v']
const DOCX_EXT = ['docx']
const SHEET_EXT = ['xlsx', 'xls', 'csv']
const SLIDE_EXT = ['pptx']
const TEXT_EXT = ['txt', 'md', 'log', 'json']
const ARCHIVE_EXT = ['zip']

/** 统一类型判定：预览页与各入口共用，避免同一文件在不同页面被判成不同类型 */
export function fileKind(url, name = '', typeHint = '') {
  const e = extOf(url, name)
  if (IMAGE_EXT.includes(e)) return 'image'
  if (VIDEO_EXT.includes(e)) return 'video'
  if (e === 'pdf') return 'pdf'
  if (DOCX_EXT.includes(e)) return 'docx'
  if (SHEET_EXT.includes(e)) return 'sheet'
  if (SLIDE_EXT.includes(e)) return 'slides'
  if (TEXT_EXT.includes(e)) return 'text'
  if (ARCHIVE_EXT.includes(e)) return 'archive'
  // 扩展名缺失时按业务 type 兜底（资源表 icon 字段）
  if (typeHint === 'image') return 'image'
  if (typeHint === 'video') return 'video'
  if (typeHint === 'doc') return 'docx'
  return 'other'
}

/**
 * 统一预览入口：所有「已提交文件」点击后都进同一个共享预览页。
 * @param {string} raw 原始文件地址（数据库值 / 接口返回值均可）
 * @param {object} opts { title, sub, type, courseId, tip }
 * @returns {boolean} 是否成功发起预览
 */
export function previewFile(raw, opts = {}) {
  const url = normalizeFileUrl(raw)
  if (!url) {
    ElMessage.warning(opts.tip || '该文件没有可用的实体地址（演示占位或上传未完成），无法预览')
    return false
  }
  router.push({
    name: 'StuResourcePreview',
    query: {
      url,
      title: opts.title || '',
      sub: opts.sub || '',
      type: opts.type || '',
      courseId: Number(opts.courseId) || 0
    }
  })
  return true
}

/**
 * 统一下载：同源地址用 a[download] 指定文件名；跨域外链 a[download] 不生效，退化为新标签打开。
 * @returns {boolean} 是否成功发起下载
 */
export function downloadFile(raw, name = '', opts = {}) {
  const url = normalizeFileUrl(raw)
  if (!url) {
    ElMessage.warning(opts.tip || '该文件没有可用的实体地址，无法下载')
    return false
  }
  const fileName = String(name || 'download').split('/').pop() || 'download'
  // data:/blob: 本地预览地址直接触发下载
  if (/^(data:|blob:)/i.test(url)) {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  }
  const isCross = /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin + '/')
  if (isCross) {
    const win = window.open(url, '_blank', 'noopener')
    if (!win) ElMessage.warning('浏览器拦截了新窗口，请允许弹出后重试')
    return !!win
  }
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}

/**
 * 预览页专用：拉取文件二进制，失败时自动走第二跳（/files/ → /api/v1/files/obj/）。
 *
 * 为什么必须检查 content-type：后端 NoResourceFoundException 被全局异常处理器包成
 * Result.fail 后 HTTP 仍是 200 + application/json，resp.ok 为真，直接 arrayBuffer 会拿到
 * JSON 字节，docx/xlsx 解析必然报「格式错误」，用户只看到「解析失败」而不知道文件根本不存在。
 */
export async function fetchFileBuffer(url) {
  const urls = [url]
  const fb = mediaFallbackUrl(url)
  if (fb && fb !== url) urls.push(fb)
  let lastErr = null
  for (const u of urls) {
    try {
      const resp = await fetch(u, { credentials: 'same-origin' })
      const ct = String(resp.headers.get('content-type') || '')
      if (/application\/json/i.test(ct)) {
        throw new Error('文件不存在或已被清理（服务端返回错误）')
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return { buffer: await resp.arrayBuffer(), url: u }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('文件读取失败')
}

/** 预览页错误文案：按失败原因给出可操作的提示，不再只有「解析失败」 */
export function previewErrorText(err) {
  const msg = String(err?.message || err || '未知错误')
  if (/不存在|已被清理|JSON/i.test(msg)) return '文件不存在或已被清理（服务端返回错误）'
  if (/HTTP 403|401/i.test(msg)) return '没有权限访问该文件，请确认登录状态或联系上传者'
  if (/HTTP 404/i.test(msg)) return '文件地址无效（404），可能已被移动或删除'
  if (/超过 20MB|超过\s*20/i.test(msg)) return '文件超过 20MB，浏览器内预览已跳过'
  if (/Failed to fetch|NetworkError|网络/i.test(msg)) return '网络异常，无法读取文件，请检查后端服务后重试'
  return `文件预览失败：${msg}`
}
