/**
 * 文档类资源的浏览器内解析（学生 PC 端「资源预览」与「消息附件」共用）
 *
 * ★ 2026-11-20 新增：原先 docx/xlsx/pptx 一律提示「格式不支持，请下载」，
 *   与教师端已经具备的统一预览能力不对等。此处抽出四个解析器：
 *   · renderDocx  —— docx-preview 渲染 OOXML 到指定 DOM（仅 .docx，老 .doc 仍下载）
 *   · parseSheet  —— xlsx 读 xlsx/xls/csv，返回每个工作表的二维数组（截断保护）
 *   · parseSlides —— jszip + DOMParser 抽 pptx 每页文字（不渲染版式，媒体计数另给）
 *   · parseArchive—— jszip 列 zip 条目（消息附件里的压缩包可直接看目录）
 * 解析失败由调用方兜底提示下载，这里只抛错。
 */
import { renderAsync } from 'docx-preview'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

/** 单个文档渲染/解析的体积上限（超过就直接劝下载，避免把浏览器内存打满） */
export const DOC_SIZE_LIMIT = 20 * 1024 * 1024

/** Word（.docx）：把 OOXML 渲染进 host，返回 { rendered: true } */
export async function renderDocx(buffer, host) {
  if (!host) throw new Error('渲染容器缺失')
  host.innerHTML = ''
  await renderAsync(buffer, host, null, {
    className: 'stu-docx',
    inWrapper: false,
    ignoreWidth: true,
    ignoreHeight: true,
    ignoreFonts: true,
    breakPages: false
  })
  return { rendered: true }
}

/** Excel（.xlsx/.xls/.csv）：返回 [{ name, rows: string[][], total }] */
export function parseSheet(buffer, maxRows = 300) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: ''
    })
    return { name, rows: rows.slice(0, maxRows), total: rows.length }
  })
  return { sheets, truncated: sheets.some((s) => s.total > maxRows) }
}

/** PowerPoint（.pptx）：返回 { slides:[{no,texts[]}], total, mediaCount, truncated } */
export async function parseSlides(buffer, maxSlides = 60) {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
  const paths = names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNo(a) - slideNo(b))
  const mediaCount = names.filter((name) => name.indexOf('ppt/media/') === 0).length
  const selected = paths.slice(0, maxSlides)
  const slides = []
  for (let i = 0; i < selected.length; i += 1) {
    const xml = await zip.file(selected[i]).async('string')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const texts = Array.from(doc.getElementsByTagNameNS('*', 't'))
      .map((node) => String(node.textContent || '').trim())
      .filter(Boolean)
    slides.push({ no: slideNo(selected[i]), texts: texts.slice(0, 40) })
  }
  return { slides, total: paths.length, mediaCount, truncated: paths.length > selected.length }
}

/** 压缩包（.zip）：返回 { entries:[{name,dir,size}], total, truncated } */
export async function parseArchive(buffer, maxEntries = 300) {
  const zip = await JSZip.loadAsync(buffer)
  const all = Object.keys(zip.files).map((name) => {
    const f = zip.files[name]
    return { name, dir: !!f.dir, size: Number((f._data && f._data.uncompressedSize) || 0) }
  })
  const sorted = all.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return {
    entries: sorted.slice(0, maxEntries),
    total: sorted.length,
    truncated: sorted.length > maxEntries
  }
}

function slideNo(name) {
  const m = /slide(\d+)\.xml$/i.exec(name)
  return m ? Number(m[1]) : 0
}
