/**
 * 文件选择 + 上传（学生端统一入口）
 *
 * 为什么单独抽出来（2026-11-24）：
 *   作业作答页 / 实验列表页 / 实验详情页原先各自 new 一个 <input type=file>，
 *   三份代码完全复制，且都有两个共性问题：
 *     1. 没有校验 0 字节文件 —— 后端 FileController 对空文件返回「上传文件不能为空」，
 *        用户看到的是这句莫名其妙的文案，不知道是自己选了个空文件；
 *     2. catch 里写死「附件上传失败，请重试」，把后端真实原因（类型不支持 / 超出上限 /
 *        存储不可用）全部吞掉，出问题无法定位。
 *   另外部分浏览器对「未挂载到文档」的 input 在 change 时拿不到 FileList，
 *   这里统一挂到 body 再移除，规避该类兼容性问题。
 */
import { ElMessage } from 'element-plus'
import { uploadFile } from '@/api/auth'

/** 人类可读大小 */
export function readableSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 选一个文件（不做上传）。
 * @returns {Promise<File|null>} 取消选择返回 null
 */
export function pickFile({ accept = '', maxMB = 20 } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    if (accept) el.accept = accept
    // 必须挂进文档：未挂载的 input 在部分浏览器里 change 时 FileList 为空
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    el.style.opacity = '0'
    document.body.appendChild(el)

    let settled = false
    const done = (file) => {
      if (settled) return
      settled = true
      el.remove()
      resolve(file || null)
    }

    el.onchange = () => {
      const f = el.files && el.files[0]
      if (!f) return done(null)
      if (f.size === 0) {
        ElMessage.warning('所选文件是空文件（0 字节），请重新选择')
        return done(null)
      }
      if (maxMB && f.size > maxMB * 1024 * 1024) {
        ElMessage.warning(`文件不能超过 ${maxMB}MB（当前 ${readableSize(f.size)}）`)
        return done(null)
      }
      done(f)
    }

    // 用户点了取消时没有 change 事件，靠窗口重新获得焦点兜底清理
    const onFocus = () => {
      setTimeout(() => {
        if (!settled && (!el.files || el.files.length === 0)) {
          window.removeEventListener('focus', onFocus)
          done(null)
        }
      }, 800)
    }
    window.addEventListener('focus', onFocus, { once: true })

    el.click()
  })
}

/**
 * 选文件并上传，成功返回 { url, name }；失败已提示，返回 null。
 * @param {{ bizType?: string, maxMB?: number, accept?: string }} opts
 */
export async function pickAndUpload({ bizType = '', maxMB = 20, accept = '' } = {}) {
  const f = await pickFile({ accept, maxMB })
  if (!f) return null
  try {
    const up = await uploadFile(f, bizType)
    const url = up?.url || ''
    if (!url) throw new Error('服务端未返回文件地址')
    ElMessage.success('附件已添加')
    return { url, name: up?.fileName || f.name }
  } catch (e) {
    const msg = String(e?.message || '')
    if (/上传文件不能为空/.test(msg)) {
      ElMessage.error('上传失败：服务端没有收到文件内容（文件可能为空或被浏览器拦截），请重新选择文件')
    } else {
      ElMessage.error(msg ? `附件上传失败：${msg}` : '附件上传失败，请重试')
    }
    return null
  }
}
