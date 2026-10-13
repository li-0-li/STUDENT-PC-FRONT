/**
 * 教师 PC 端 / 管理端路由
 *
 * ⚠️ M0 骨架期本文件只保证「菜单可点、不 404」。现按模块制推进：
 *   - **M-D（AI 问答与学情）**负责的页面已在此登记为**真实组件**（见 MD_PAGES）
 *   - 其余仍是占位组件，由各自负责人补齐：
 *       教师 PC 端（tch-pc）= 张栎；管理端（admin）= 孟政凯
 *
 * 说明：M0 骨架原注释要求「两位负责人先在 main 上把本文件拆成 teacher.js / admin.js」。
 *      本次只做了**最小改动**——新增一个覆盖表，让 M-D 的页面走真实组件，
 *      其余行为与位置不变（占位组件、props、meta）。若后续要拆文件，按 MD_PAGES 迁移即可。
 */
import { MENUS } from '@/layout/menus'

const Placeholder = () => import('@/views/_Placeholder.vue')

/**
 * M-D 已实现页面：key = `${role}:${menuId}`
 * 菜单 id 取自 layout/menus.js（权威来源 ui-prototype/assets/shell.js 的 MENUS）
 */
const MD_PAGES = {
  // 管理端
  'admin:analytics': () => import('@/views/admin/Analytics.vue'),
  'admin:ai': () => import('@/views/admin/Ai.vue'),
  // 教师 PC 端
  'teacher:analytics': () => import('@/views/teacher/Analytics.vue'),
  'teacher:heatmap': () => import('@/views/teacher/Heatmap.vue'),
  'teacher:ai': () => import('@/views/teacher/AiWorkbench.vue')
}

function build(role) {
  return MENUS[role].map((m) => {
    const real = MD_PAGES[`${role}:${m.id}`]
    return {
      path: m.path.replace(/^\//, ''),
      name: `${role}_${m.id}`,
      component: real || Placeholder,
      props: real
        ? undefined
        : { title: m.label, owner: role === 'teacher' ? '张栎（tch-pc）' : '孟政凯（admin）' },
      meta: {
        role,
        menuId: m.id,
        title: m.label,
        placeholder: !real,
        // 归属模块，便于按模块检索（M-D = AI 问答与学情）
        module: real ? 'M-D' : undefined
      }
    }
  })
}

/**
 * 不在菜单内的下钻页
 * 班级成绩明细由「班级学情」页点击统计卡进入，原型 pc/teacher-class-scores.html
 */
const DETAIL_ROUTES = [
  {
    path: 'teacher/class-scores',
    name: 'teacher_classScores',
    component: () => import('@/views/teacher/ClassScores.vue'),
    meta: {
      role: 'teacher',
      title: '班级成绩明细',
      activeMenu: 'analytics',
      module: 'M-D'
    }
  }
]

export default [...build('teacher'), ...build('admin'), ...DETAIL_ROUTES]
