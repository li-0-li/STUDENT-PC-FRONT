/**
 * 三端菜单定义（公共代码，只在 main 上改）
 *
 * ★ 权威来源：`ui-prototype/assets/shell.js` 的 `MENUS`（原型即基准，PRD §3.4）
 *   本文件与它保持**逐项一致**：顺序、id、label、icon 名、href 都照抄。
 *   icon 用原型同款 Lucide 名（kebab-case），由 components/base/BaseIcon.vue 渲染。
 *   改菜单 = 改这里 + 同步 shell.js，两边必须一起动（走 chore/ 分支）。
 *
 * 2026-09-21 按「智能教学辅助平台-仓库骨架」的 shell.js 对齐：
 *   admin   13 项（新增 support 客服工单，位于 review 之后）
 *   teacher 16 项（新增 labpublish 发布实验、support 客服；labreview 图标 flask-conical → file-check）
 *   student 12 项（新增 notice 系统通知；lab 从 detail 之后提到之前；support 标签为「客服」）
 */
export const MENUS = {
  admin: [
    { id: 'dashboard', label: '后台管理', icon: 'layout-dashboard', href: 'admin-dashboard.html', path: '/admin/dashboard' },
    { id: 'accounts', label: '账号管理', icon: 'users', href: 'admin-accounts.html', path: '/admin/accounts' },
    { id: 'review', label: '课程审核', icon: 'badge-check', href: 'admin-review.html', path: '/admin/review' },
    { id: 'support', label: '客服工单', icon: 'headphones', href: 'admin-support.html', path: '/admin/support' },
    { id: 'schedule', label: '智能排课', icon: 'calendar-days', href: 'admin-schedule.html', path: '/admin/schedule' },
    { id: 'analytics', label: '全校学情', icon: 'bar-chart-3', href: 'admin-analytics.html', path: '/admin/analytics' },
    { id: 'patrol', label: '课堂巡查', icon: 'list-checks', href: 'admin-patrol.html', path: '/admin/patrol' },
    { id: 'ai', label: 'AI 工作台', icon: 'sparkles', href: 'admin-ai.html', path: '/admin/ai' },
    { id: 'basicdata', label: '基础数据', icon: 'database', href: 'admin-basicdata.html', path: '/admin/basicdata' },
    { id: 'dtupload', label: '师生资料上传', icon: 'upload-cloud', href: 'admin-data-upload.html', path: '/admin/data-upload' },
    { id: 'monitor', label: '系统监控', icon: 'activity', href: 'admin-monitor.html', path: '/admin/monitor' },
    { id: 'logs', label: '系统日志', icon: 'history', href: 'admin-logs.html', path: '/admin/logs' },
    { id: 'config', label: '系统配置', icon: 'settings', href: 'admin-config.html', path: '/admin/config' }
  ],
  teacher: [
    { id: 'courses', label: '我教的课', icon: 'book-open', href: 'teacher-courses.html', path: '/teacher/courses' },
    { id: 'schedule', label: '我的课表', icon: 'calendar-days', href: 'teacher-schedule.html', path: '/teacher/schedule' },
    { id: 'prepare', label: '备课管理', icon: 'layers', href: 'teacher-course-manage.html', path: '/teacher/course-manage' },
    { id: 'template', label: '上课模板', icon: 'git-branch', href: 'teacher-template.html', path: '/teacher/template' },
    { id: 'publish', label: '发布作业', icon: 'send', href: 'teacher-homework-publish.html', path: '/teacher/homework-publish' },
    { id: 'grading', label: '批改作业', icon: 'clipboard-list', href: 'teacher-grading.html', path: '/teacher/grading' },
    { id: 'labpublish', label: '发布实验', icon: 'flask-conical', href: 'teacher-lab-publish.html', path: '/teacher/lab-publish' },
    { id: 'labreview', label: '审阅实验', icon: 'file-check', href: 'teacher-lab-review.html', path: '/teacher/lab-review' },
    { id: 'roster', label: '花名册', icon: 'contact', href: 'teacher-roster.html', path: '/teacher/roster' },
    { id: 'heatmap', label: '学情热力图', icon: 'grid-3x3', href: 'teacher-heatmap.html', path: '/teacher/heatmap' },
    { id: 'analytics', label: '班级学情', icon: 'bar-chart-3', href: 'teacher-analytics.html', path: '/teacher/analytics' },
    { id: 'live', label: '实时课堂', icon: 'monitor-play', href: 'teacher-live.html', path: '/teacher/live' },
    { id: 'attendance', label: '课堂签到', icon: 'qr-code', href: 'teacher-attendance.html', path: '/teacher/attendance' },
    { id: 'messages', label: '消息', icon: 'message-circle', href: 'teacher-messages.html', path: '/teacher/messages' },
    { id: 'ai', label: 'AI 工作台', icon: 'sparkles', href: 'ai-workbench.html', path: '/teacher/ai-workbench' },
    { id: 'support', label: '客服', icon: 'headphones', href: 'support.html?r=teacher', path: '/teacher/support' }
  ],
  student: [
    { id: 'courses', label: '我学的课', icon: 'book-open', href: 'student-courses.html', path: '/student/courses' },
    { id: 'schedule', label: '我的课表', icon: 'calendar-days', href: 'student-schedule.html', path: '/student/schedule' },
    { id: 'homework', label: '我的作业', icon: 'clipboard-list', href: 'student-homeworks.html', path: '/student/homeworks' },
    { id: 'lab', label: '实验报告', icon: 'flask-conical', href: 'student-lab.html', path: '/student/lab' },
    { id: 'detail', label: '章节作业', icon: 'file-text', href: 'student-course-detail.html', path: '/student/course-detail' },
    { id: 'analytics', label: 'AI 学情', icon: 'bar-chart-3', href: 'student-analytics.html', path: '/student/analytics' },
    { id: 'live', label: '实时课堂', icon: 'monitor-play', href: 'student-live.html', path: '/student/live' },
    { id: 'attendance', label: '课堂签到', icon: 'qr-code', href: 'student-attendance.html', path: '/student/attendance' },
    { id: 'messages', label: '消息', icon: 'message-circle', href: 'student-messages.html', path: '/student/messages' },
    { id: 'notice', label: '系统通知', icon: 'bell', href: 'student-notice.html', path: '/student/notice' },
    { id: 'ai', label: 'AI 答疑', icon: 'sparkles', href: 'student-ai.html', path: '/student/ai' },
    { id: 'support', label: '客服', icon: 'headphones', href: 'support.html', path: '/student/support' }
  ]
}

/** 端前缀 —— 与 PRD §8.12 / 仓库 README §一 的分支前缀一致 */
export const END_PREFIX = {
  admin: 'admin',
  teacher: 'tch-pc',
  student: 'stu-pc'
}

/** 角色显示名 */
export const ROLE_LABEL = {
  admin: '管理员',
  teacher: '教师',
  student: '学生'
}

/**
 * 跨端公共页面（仓库 README §一末尾列出，**不属于任何单一端，需单独指派负责人**）
 * 它们会出现在多个端的菜单里，但实现归属要单独指认。
 */
export const SHARED_PAGES = [
  'pc/login.html',
  'pc/register.html',
  'pc/forgot-password.html',
  'pc/support.html',
  'pc/resource-preview.html',
  'mp/app-login.html',
  'mp/register.html',
  'mp/forgot-password.html',
  'mp/app-support.html',
  'mp/resource-view.html',
  'mp/app-change-phone.html',
  'mp/app-change-pwd.html',
  'ui-prototype/index.html'
]

export function menusOf(role) {
  return MENUS[role] || MENUS.student
}

/**
 * ★ 2026-10-15 学生 PC 端新导航（学习通风格窄侧栏，6 个一级入口）
 *
 * 背景：评审要求「简洁但功能不缩水」——功能不再平铺到左边（旧版 12 项），
 * 改为 6 个一级分组，组内功能下沉到页面内部（Tab / 区块 / 「…」菜单）。
 * 归组方案见 `交付文档/学生PC端-新UI功能清单-按钮级-20261014.md`：
 *   课表 / 课程 / 我的任务 / 消息 / AI 答疑 / 个人中心
 *
 * children = 该组覆盖的路由 meta.menuId（含 activeMenu 兜底），用于侧栏高亮匹配。
 * 仅 student 角色使用本导航；teacher/admin 仍走上面的 MENUS（后续另行改版）。
 */
export const STUDENT_NAV = [
  { id: 'schedule', label: '课表', icon: 'calendar-days', path: '/student/schedule', children: ['schedule'] },
  { id: 'courses', label: '课程', icon: 'book-open', path: '/student/courses', children: ['courses', 'detail'] },
  {
    id: 'tasks',
    label: '我的任务',
    icon: 'clipboard-list',
    path: '/student/tasks',
    children: ['tasks', 'homework', 'lab']
  },
  {
    id: 'messages',
    label: '消息',
    icon: 'message-circle',
    path: '/student/messages',
    children: ['messages', 'notice', 'support']
  },
  { id: 'ai', label: 'AI 答疑', icon: 'sparkles', path: '/student/ai', children: ['ai', 'analytics'] },
  { id: 'profile', label: '个人中心', icon: 'user', path: '/student/profile', children: ['profile'] }
]
