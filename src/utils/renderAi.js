/**
 * AI 回答渲染（★ 2026-10-26 新增）
 *
 * 背景：模型（qwen2.5 等）会输出 Markdown（### / ** / - 列表）与 LaTeX（$\lim_{x \to a}\frac{f(x)}{g(x)}$），
 * 前端原先用 {{ text }} 纯文本渲染 → 学生看到满屏 ### 和反斜杠。
 *
 * 这里做三件事：
 * 1. **Markdown → HTML**（markdown-it，关闭原始 HTML 防 XSS）
 * 2. **LaTeX 公式 → KaTeX 渲染**（支持 $$...$$ 块级与 $...$ 行内）
 * 3. **兜底清洗**：KaTeX 渲染失败（语法不完整/模型写错）时，把常见 LaTeX 命令转成可读文本，
 *    例如 \frac{a}{b} → (a)/(b)、\to → →、\infty → ∞、\lim_{x \to a} → lim(x→a)
 */
import MarkdownIt from 'markdown-it'
import katex from 'katex'

const md = new MarkdownIt({
  html: false, // 不信任模型输出里的原始 HTML
  linkify: true,
  breaks: true, // 单个换行也换行，更符合聊天阅读
  typographer: false
})

/** 数学段落最多保留长度（防超长公式卡死渲染） */
const MAX_MATH_LEN = 400

/** 用 KaTeX 渲染单个公式；失败返回 null */
function tryMath(tex, displayMode) {
  const src = String(tex || '').trim()
  if (!src || src.length > MAX_MATH_LEN) {
    return null
  }
  try {
    return katex.renderToString(src, {
      displayMode,
      throwOnError: true,
      strict: false,
      output: 'html'
    })
  } catch {
    return null
  }
}

/** LaTeX 命令 → 可读文本（KaTeX 失败时的兜底） */
function latexToPlain(tex) {
  let s = String(tex || '')
  // 分式：\frac{a}{b} → (a)/(b)，最多迭代 3 层
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    if (next === s) break
    s = next
  }
  return s
    .replace(/\\lim_\s*\{([^{}]*)\}/g, 'lim($1)')
    .replace(/\\lim_([a-zA-Z0-9])/g, 'lim($1)')
    .replace(/\\int/g, '∫')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\pm/g, '±')
    .replace(/\\leq?|\\le/g, '≤')
    .replace(/\\geq?|\\ge/g, '≥')
    .replace(/\\neq|\\ne/g, '≠')
    .replace(/\\infty/g, '∞')
    .replace(/\\to|\\rightarrow/g, '→')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\theta/g, 'θ')
    .replace(/\\pi/g, 'π')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\[a-zA-Z]+/g, '') // 其他未知命令去掉反斜杠命令
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把 AI 回答渲染为 HTML。
 * @param {string} text 模型原始回答
 * @returns {string} 可直接 v-html 的 HTML
 */
export function renderAI(text) {
  if (!text) {
    return ''
  }
  let src = String(text)

  // ① 先把公式抽出来占位（避免 Markdown 把 _ ^ \ 当语法处理）
  const stash = []
  const keep = (html) => {
    stash.push(html)
    return `@@AI_MATH_${stash.length - 1}@@`
  }

  // ① 块级：\[...\]（qwen 等模型常用）与 $$...$$
  src = src.replace(/\\\[([\s\S]{1,400}?)\\\]/g, (_, tex) => {
    const html = tryMath(tex, true)
    return html ? `\n${keep(html)}\n` : `\n${latexToPlain(tex)}\n`
  })
  src = src.replace(/\$\$([\s\S]{1,400}?)\$\$/g, (_, tex) => {
    const html = tryMath(tex, true)
    return html ? `\n${keep(html)}\n` : `\n${latexToPlain(tex)}\n`
  })
  // ② 行内：\(...\)（模型最常见）与 $...$
  src = src.replace(/\\\(([\s\S]{1,400}?)\\\)/g, (_, tex) => {
    const html = tryMath(tex, false)
    return html ? keep(html) : latexToPlain(tex)
  })
  src = src.replace(/(?<!\$)\$(?!\$)([^$\n]{1,400}?)(?<!\$)\$(?!\$)/g, (_, tex) => {
    const html = tryMath(tex, false)
    return html ? keep(html) : latexToPlain(tex)
  })

  // ② Markdown 渲染
  let html = md.render(src)

  // ③ 还原公式
  html = html.replace(/@@AI_MATH_(\d+)@@/g, (_, i) => stash[Number(i)] || '')

  // ④ 兜底：清掉可能残留的 Markdown 标题/加粗符号（模型偶尔写出畸形语法）
  html = html.replace(/<p>\s*#{1,6}\s*/g, '<p>').replace(/\*\*/g, '')
  return html
}

export default renderAI
