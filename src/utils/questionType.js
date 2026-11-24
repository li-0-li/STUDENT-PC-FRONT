/**
 * 题型口径统一（学生端）
 *
 * 后端 qType 白名单只有 6 个值：single / multi / judge / blank / short / program。
 * 但后端部分视图的 typeText 用了另一套旧枚举（multiple / fill / code / essay），
 * 且历史页面曾把填空写成 fill —— 直接展示 typeText 会出现英文或错标签。
 *
 * 这里提供唯一权威映射，凡学生端需要「题型中文」的地方一律走本文件，
 * 不再信任后端 typeText，也不再各页各写一份。
 *
 * 与教师端 TEACHER-PC-FRONT/src/api/teaching/homework.js 的 TYPE_MAP 保持一致：
 *   单选 single / 多选 multi / 判断 judge / 填空 blank / 简答 short / 编程 program
 */

/** 后端 qType → 中文短标签（用于徽标 / 列） */
export const QTYPE_LABEL = {
  single: '单选',
  multi: '多选',
  judge: '判断',
  blank: '填空',
  short: '简答',
  program: '编程'
}

/** 兼容旧枚举 / 别名 → 标准 qType（后端 typeText 的 multiple/fill/code/essay 等） */
export const QTYPE_ALIAS = {
  single: 'single',
  choice: 'single',
  multiple: 'multi',
  multi: 'multi',
  judge: 'judge',
  bool: 'judge',
  truefalse: 'judge',
  blank: 'blank',
  fill: 'blank',
  short: 'short',
  essay: 'short',
  program: 'program',
  code: 'program'
}

/** 客观题（后端可自动判分）：single / multi / judge / blank */
export const OBJECTIVE_TYPES = ['single', 'multi', 'judge', 'blank']

/** 归一化任意题型字符串为标准 qType；未知值原样返回（便于排查脏数据） */
export function normalizeQType(v) {
  if (v == null) return ''
  const key = String(v).trim().toLowerCase()
  return QTYPE_ALIAS[key] || String(v).trim()
}

/** 取题型中文标签；未知值回退为原始值，不吞数据 */
export function qTypeLabel(v) {
  const q = normalizeQType(v)
  return QTYPE_LABEL[q] || q || '—'
}

/** 是否客观题 */
export function isObjectiveType(v) {
  return OBJECTIVE_TYPES.includes(normalizeQType(v))
}

/** 作业题型构成 assignType → 中文（教师端同为 objective/subjective/mixed） */
export const ASSIGN_TYPE_LABEL = {
  objective: '客观题',
  subjective: '主观题',
  mixed: '混合题'
}
export function assignTypeLabel(v) {
  return ASSIGN_TYPE_LABEL[v] || v || '—'
}
