/**
 * 学生 PC 端路由（stu-pc）
 * 「关联接口」标注接口设计文档表号，供实现与提测对照
 * 每条路由对应 `docs/学生PC端-页面接口表映射.md` 里的页面
 */
const S = 'stu-pc'
const v = (name) => () => import(`@/views/student/${name}.vue`)
// 跨端公共页面（骨架 README §一末尾列出的 13 个）放在 views/shared/，不属任何单端
const vs = (name) => () => import(`@/views/shared/${name}.vue`)

export default [
  {
    path: 'student/courses',
    name: 'StuCourses',
    component: v('Courses'),
    meta: { menuId: 'courses', title: '我学的课', branch: `${S}-course`, apis: ['3-1', '3-3'] }
  },
  {
    path: 'student/course-detail/:courseId?',
    name: 'StuCourseDetail',
    component: v('CourseDetail'),
    meta: { menuId: 'detail', title: '章节作业', branch: `${S}-course`, apis: ['3-2', '3-4'] }
  },
  {
    path: 'student/resource-preview/:resourceId?',
    name: 'StuResourcePreview',
    component: vs('ResourcePreview'),
    meta: { title: '资源预览', branch: `${S}-resource`, shared: true, apis: ['3-4', '2-15'] }
  },
  {
    path: 'student/schedule',
    name: 'StuSchedule',
    component: v('Schedule'),
    meta: { menuId: 'schedule', title: '我的课表', branch: `${S}-schedule`, apis: ['3-12'] }
  },
  {
    // 新 UI 侧栏③「我的任务」：作业 + 实验报告统一任务流（stu-pc 模块 GET /api/v1/stu/tasks）
    path: 'student/tasks',
    name: 'StuTasks',
    component: v('Tasks'),
    meta: { menuId: 'tasks', title: '我的任务', branch: `${S}-task`, apis: ['stu-pc:task:list'] }
  },
  {
    path: 'student/messages',
    name: 'StuMessages',
    component: v('Messages'),
    meta: {
      menuId: 'messages',
      title: '消息',
      branch: `${S}-message`,
      apis: ['2-10', '2-11', '2-12', '2-13', '2-17']
    }
  },
  {
    path: 'student/homeworks',
    name: 'StuHomeworks',
    component: v('Homeworks'),
    meta: { menuId: 'homework', title: '我的作业', branch: `${S}-homework`, apis: ['3-5'] }
  },
  {
    path: 'student/homework/:assignmentId?',
    name: 'StuHomeworkAnswer',
    component: v('HomeworkAnswer'),
    meta: {
      title: '作业作答',
      branch: `${S}-homework`,
      apis: ['3-5', '3-6', '2-15'],
      activeMenu: 'homework'
    }
  },
  {
    path: 'student/submission/:submissionId?',
    name: 'StuSubmission',
    component: v('Submission'),
    meta: {
      title: '作业详情',
      branch: `${S}-homework`,
      apis: ['3-6', '3-7', '3-21'],
      activeMenu: 'homework'
    }
  },
  {
    path: 'student/notice',
    name: 'StuNotice',
    component: v('Notice'),
    meta: {
      menuId: 'notice',
      title: '系统通知',
      branch: `${S}-message`,
      apis: ['2-13', '2-17']
    }
  },
  {
    path: 'student/ai',
    name: 'StuAiQa',
    component: v('AiQa'),
    meta: { menuId: 'ai', title: 'AI 答疑', branch: `${S}-ai-qa`, apis: ['3-9', '3-10'] }
  },
  {
    // ★ 2026-10-23 错题本（学习辅助，独立页面）
    path: 'student/wrong-book',
    name: 'StuWrongBook',
    component: v('WrongBook'),
    meta: {
      menuId: 'wrongbook',
      title: '错题本',
      branch: `${S}-wrongbook`,
      apis: ['stu/wrong-book', 'stu/wrong-book/{id}/master']
    }
  },
  {
    path: 'student/analytics',
    name: 'StuAnalytics',
    component: v('Analytics'),
    meta: {
      menuId: 'analytics',
      title: 'AI 学情',
      branch: `${S}-analytics`,
      apis: ['3-8', '3-11', '3-19', '3-26']
    }
  },
  {
    path: 'student/live',
    name: 'StuLive',
    component: v('Live'),
    meta: {
      menuId: 'live',
      title: '实时课堂',
      branch: `${S}-live`,
      apis: ['3-13', '3-15', '3-16', '6-1', '6-2']
    }
  },
  {
    path: 'student/attendance',
    name: 'StuAttendance',
    component: v('Attendance'),
    meta: { menuId: 'attendance', title: '课堂签到', branch: `${S}-live`, apis: ['3-14'] }
  },
  {
    path: 'student/lab',
    name: 'StuLab',
    component: v('Lab'),
    meta: { menuId: 'lab', title: '实验报告', branch: `${S}-lab`, apis: ['3-17', '3-18', '3-22'] }
  },
  {
    path: 'student/support',
    name: 'StuSupport',
    component: vs('Support'),
    meta: {
      menuId: 'support',
      title: '客服',
      branch: `${S}-support`,
      shared: true,
      apis: ['3-20', '3-23', '3-24', '3-25']
    }
  },
  {
    // ★ 2026-10-23 练习中心（抽题 → 作答 → 交卷判分 → 错题入库）
    path: 'student/practice',
    name: 'StuPractice',
    component: v('Practice'),
    meta: {
      menuId: 'practice',
      title: '练习',
      branch: `${S}-practice`,
      apis: ['stu/practice/questions', 'stu/practice/submit']
    }
  },
  {
    path: 'student/profile',
    name: 'StuProfile',
    component: v('Profile'),
    meta: {
      title: '个人资料',
      branch: `${S}-profile`,
      apis: ['2-5', '2-6', '2-7', '2-8', '2-9', '2-14', '2-16']
    }
  }
]
