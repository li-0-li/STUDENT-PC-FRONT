/**
 * 通用格式化工具（公共代码，只在 main 上改）
 */

/** 时间：2026-09-20 14:05 */
export function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 日期：2026-09-20 */
export function fmtDate(v) {
  const s = fmtDateTime(v)
  return s === '—' ? s : s.slice(0, 10)
}

/** 秒 → 1 小时 20 分 */
export function fmtDuration(sec) {
  if (!sec && sec !== 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} 小时 ${m} 分` : `${m} 分`
}

/** 文件大小 */
export function fmtFileSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

/** 百分比（0.86 → 86%） */
export function fmtPercent(v, digits = 0) {
  if (v === null || v === undefined) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

/** 状态码 → Element Plus 标签类型 */
export function statusTone(status) {
  const map = {
    pending: 'warning',
    draft: 'info',
    submitted: 'info',
    graded: 'success',
    appealing: 'warning',
    returned: 'danger',
    open: 'warning',
    processing: 'info',
    closed: 'success'
  }
  return map[status] || 'info'
}
