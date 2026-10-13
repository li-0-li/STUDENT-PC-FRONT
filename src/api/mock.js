/**
 * 接口 Mock（开发期使用，公共代码，只在 main 上改）
 *
 * 目的：后端骨架还没搭好之前，前端能独立跑通并自测。
 * 开启方式（见 request.js）：
 *   - 开发环境默认开启
 *   - 想连真实后端：在 .env.development 里写 VITE_USE_MOCK=0
 *   - 生产环境默认关闭
 *
 * 响应体严格按 PRD/骨架约定：{ code, message, data }，code=0 成功；
 * 失败码沿用与 HTTP 状态码一致的数值（401/403/404/409/422/429/500/503）。
 *
 * ⚠️ 这里只是让页面能跑起来的假数据，不代表接口实现。后端接通后应尽早关掉。
 */

/** 当前登录角色（mock 用的简化状态） */
let CUR_ROLE = 'student'

const USERS = {
  student: {
    userId: 1001,
    username: 'stu2200850123',
    role: 'student',
    name: '黎练',
    userNo: '2200850123',
    phone: '175****4413',
    email: 'lilian@stu.gzu.edu.cn',
    avatar: '',
    deptId: 201,
    majorId: 1,
    clazzId: 1,
    className: '软件 2201',
    title: '',
    status: 'active',
    notifyPref: 'all',
    lastLoginAt: '2026-09-21 08:40:12',
    certStatus: 'certified'
  },
  teacher: {
    userId: 1002,
    username: 't2018003',
    role: 'teacher',
    name: '李老师',
    userNo: 'T2018003',
    phone: '139****2233',
    email: 'li.li@gzu.edu.cn',
    avatar: '',
    deptId: 201,
    majorId: 1,
    clazzId: null,
    className: '',
    title: '副教授',
    status: 'active',
    notifyPref: 'all',
    lastLoginAt: '2026-09-21 08:12:00',
    certStatus: 'certified'
  },
  admin: {
    userId: 1,
    username: 'admin',
    role: 'admin',
    name: '管理员',
    userNo: 'A2020001',
    phone: '0851-88886666',
    email: 'admin@gzu.edu.cn',
    avatar: '',
    deptId: 200,
    majorId: null,
    clazzId: null,
    className: '',
    title: '',
    status: 'active',
    notifyPref: 'all',
    lastLoginAt: '2026-09-21 07:55:31',
    certStatus: 'none'
  }
}

const ok = (data, message = 'success') => ({ code: 0, message, data })
const fail = (code, message, details = undefined) => ({ code, message, details })

/** 假课程 / 作业数据，用于列表页自测 */
const COURSES = [
  { courseId: 10, courseName: '数据结构', teacherName: '李老师', semester: '2026-2027-1', credit: 3, hours: 48, progress: 62, totalWeeks: 16, enrolled: true },
  { courseId: 11, courseName: '高等数学 A', teacherName: '张老师', semester: '2026-2027-1', credit: 4, hours: 64, progress: 45, totalWeeks: 16, enrolled: true },
  { courseId: 12, courseName: '大学英语 III', teacherName: '王老师', semester: '2026-2027-1', credit: 2, hours: 32, progress: 78, totalWeeks: 16, enrolled: true }
]

const HOMEWORKS = [
  { assignmentId: 1, title: '习题 2-1 导数定义', courseName: '高等数学 A', deadline: '2026-09-26 23:59', status: 'pending', myScore: null },
  { assignmentId: 2, title: '栈与队列 编程题', courseName: '数据结构', deadline: '2026-09-19 23:59', status: 'graded', myScore: 92 },
  { assignmentId: 3, title: 'Unit 3 阅读理解', courseName: '大学英语 III', deadline: '2026-09-12 23:59', status: 'appealing', myScore: 88 }
]

/**
 * AI 答疑 mock 知识库（按 courseId 区分），数据取自原型 pc/student-ai.html 的演示知识库。
 * 仅用于让「AI 答疑」页在无后端时能跑通并看到完整交互（含命中与降级两种分支）。
 */
const KB_ENTRIES = {
  11: [
    { k: ['拉格朗日', 'lagrange'], a: '拉格朗日中值定理：若函数 f(x) 在闭区间 [a,b] 上连续、在开区间 (a,b) 内可导，则至少存在一点 ξ∈(a,b)，使得 f(b)−f(a) = f′(ξ)(b−a)。几何意义是：区间内至少有一点，其切线平行于连接两端点的割线。', r: ['《第3章 微分中值定理》课件 · P12', '教学大纲 · §3.2'], s: 0.96 },
    { k: ['罗尔', 'rolle'], a: '罗尔定理是拉格朗日中值定理的特例——当 f(a)=f(b) 时，结论退化为存在 ξ 使 f′(ξ)=0。反之，罗尔定理也是证明拉格朗日中值定理的关键引理（构造辅助函数后应用罗尔定理）。', r: ['《第3章 微分中值定理》课件 · P15'], s: 0.94 },
    { k: ['中值定理'], a: '微分中值定理包含罗尔定理、拉格朗日中值定理与柯西中值定理三条，其中拉格朗日是核心：它建立了函数增量与导数之间的联系。三者的关系是「罗尔 ⇒ 拉格朗日 ⇒ 柯西」，证明路径均为构造辅助函数。', r: ['《第3章 微分中值定理》课件 · P10-P18', '习题集 · 第3章 考点归纳'], s: 0.91 },
    { k: ['导数', '求导'], a: '导数 f′(x₀)=lim[Δx→0] (f(x₀+Δx)−f(x₀))/Δx，刻画函数在该点的瞬时变化率。可导必连续，连续不一定可导。求导四则运算法则与复合函数链式法则是本章基础。', r: ['《第2章 导数与微分》课件 · P3', '教材 §2.1 定义'], s: 0.93 },
    { k: ['泰勒', 'taylor'], a: '泰勒公式把函数在一点附近展开为幂级数：f(x)=Σ f⁽ⁿ⁾(x₀)(x−x₀)ⁿ/n! + Rₙ(x)。其中拉格朗日余项 Rₙ(x)=f⁽ⁿ⁺¹⁾(ξ)(x−x₀)ⁿ⁺¹/(n+1)!，常用于近似计算与极限求解。x₀=0 时退化为麦克劳林公式。', r: ['《第4章 泰勒公式》课件 · P6'], s: 0.9 },
    { k: ['洛必达', 'lhopital'], a: '洛必达法则用于 0/0 或 ∞/∞ 型未定式：若 lim f/g 为上述型，且 f′、g′ 存在、g′≠0，则 lim f/g = lim f′/g′。使用前必须先验证是否满足未定式条件，否则结论不成立。', r: ['《第4章 洛必达法则》课件 · P2'], s: 0.92 }
  ],
  10: [
    { k: ['栈', 'stack'], a: '栈是后进先出（LIFO）的线性结构，只允许在栈顶插入与删除，基本操作 push/pop/top 均为 O(1)。典型应用：函数调用栈、表达式求值、括号匹配、深度优先搜索。', r: ['《第3章 栈与队列》课件 · P4', '实验指导书 · 实验二 栈的实现'], s: 0.95 },
    { k: ['队列', 'queue'], a: '队列是先进先出（FIFO）的线性结构，在一端入队、另一端出队。循环队列用取模运算解决假溢出：队满条件 (rear+1)%maxSize == front。典型应用：层序遍历、任务调度、广度优先搜索。', r: ['《第3章 栈与队列》课件 · P12'], s: 0.94 },
    { k: ['时间复杂度', '复杂度', 'bigo'], a: '时间复杂度用大 O 记号描述算法运行时间随规模 n 的增长量级，只保留最高阶项并忽略常数。常见量级由优到劣：O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ)。', r: ['《第1章 绪论》课件 · P8', '教学大纲 · §1.3'], s: 0.93 },
    { k: ['二叉树', '遍历'], a: '二叉树遍历分深度优先与广度优先。深度优先三类：先序（根左右）、中序（左根右）、后序（左右根）；广度优先即层序遍历，需借助队列实现。已知中序 + 先序/后序可唯一确定一棵二叉树。', r: ['《第5章 树与二叉树》课件 · P9'], s: 0.92 },
    { k: ['链表', '线性表'], a: '链表以结点 + 指针组织数据，插入删除 O(1)（已知前驱），查找 O(n)，无需连续内存。单链表、双链表、循环链表的差异在于指针域数量与首尾连接方式。', r: ['《第2章 线性表》课件 · P6', '实验指导书 · 实验一 线性表操作'], s: 0.9 }
  ],
  12: [
    { k: ['虚拟语气', 'subjunctive'], a: '虚拟语气用于表达与事实相反的假设或主观愿望。与现在事实相反：if + 过去式，主句 would/could + 动词原形；与过去相反：if + had done，主句 would have done；与将来相反：if + were to do / should do。', r: ['《Unit 5 Grammar》讲义 · P3'], s: 0.91 },
    { k: ['非谓语', '不定式', '分词'], a: '非谓语动词包含不定式、动名词与分词三类，不能独立作谓语。不定式常表目的与将来，动名词具名词性质，现在分词表主动进行、过去分词表被动完成。', r: ['《Unit 3 Grammar》讲义 · P7'], s: 0.89 }
  ]
}
let QA_SEQ = 100

/** 路由表：pattern 用 {} 标记路径参数 */
const ROUTES = [
  { method: 'POST', pattern: '/api/v1/auth/login', handle: (body) => {
      const who = /^admin/i.test(body?.username || '') ? 'admin'
        : /^t/i.test(body?.username || '') ? 'teacher' : 'student'
      CUR_ROLE = who
      if (!body?.password || body.password.length < 3) {
        return fail(401, '账号或密码错误')
      }
      return ok({ token: 'mock-token-' + Date.now(), user: USERS[who], mustChangePwd: who === 'admin' })
    } },

  { method: 'POST', pattern: '/api/v1/auth/register', handle: (body) => {
      if (!body?.username) return fail(422, '参数校验失败', 'username 不能为空')
      return ok({ userId: 2001, status: body.role === 'teacher' ? 'pending' : 'active' })
    } },

  { method: 'POST', pattern: '/api/v1/auth/captcha/send', handle: (body) => {
      if (!body?.account) return fail(422, '请先输入手机号或邮箱')
      return ok({ expireSeconds: 300 })
    } },

  { method: 'POST', pattern: '/api/v1/auth/password/reset', handle: (body) => {
      if (body?.captcha !== '123456') return fail(422, '验证码错误或已过期')
      return ok({ result: true })
    } },

  { method: 'POST', pattern: '/api/v1/auth/logout', handle: () => ok({ result: true }) },

  { method: 'GET', pattern: '/api/v1/users/me', handle: () => ok({ ...USERS[CUR_ROLE] }) },

  { method: 'PUT', pattern: '/api/v1/users/me/password', handle: (body) => {
      if (!body?.oldPassword) return fail(422, '请输入原密码')
      if (!body?.newPassword || body.newPassword.length < 8) return fail(422, '新密码不少于 8 位')
      return ok({ result: true })
    } },

  { method: 'PUT', pattern: '/api/v1/users/me/profile', handle: () => ok({ result: true }) },
  { method: 'POST', pattern: '/api/v1/users/me/avatar', handle: () => ok({ avatar: 'https://example.com/mock-avatar.png' }) },
  { method: 'PUT', pattern: '/api/v1/users/me/notify-pref', handle: () => ok({ result: true }) },
  { method: 'POST', pattern: '/api/v1/users/me/cancel', handle: () => ok({ result: true }) },

  { method: 'GET', pattern: '/api/v1/auth/certification', handle: () => ok({ certStatus: USERS[CUR_ROLE].certStatus, certAt: '2026-09-01 10:00:00' }) },
  { method: 'POST', pattern: '/api/v1/auth/certification', handle: () => ok({ certStatus: 'certified', certAt: '2026-09-21 15:00:00', mismatchFields: [] }) },
  { method: 'GET', pattern: '/api/v1/auth/devices', handle: () => ok({ list: [
      { deviceRowId: 1, deviceName: 'Windows · Chrome', ip: '10.0.0.12', lastActiveAt: '2026-09-21 14:52:00', status: 'active' },
      { deviceRowId: 2, deviceName: 'iPhone · 微信小程序', ip: '10.0.0.31', lastActiveAt: '2026-09-20 22:10:00', status: 'active' }
    ] }) },
  { method: 'DELETE', pattern: '/api/v1/auth/devices/{deviceRowId}', handle: () => ok({ result: true }) },
  { method: 'PUT', pattern: '/api/v1/auth/phone', handle: () => ok({ result: true }) },
  { method: 'GET', pattern: '/api/v1/auth/school-bind-apply', handle: () => ok({ list: [] }) },
  { method: 'POST', pattern: '/api/v1/reports', handle: () => ok({ reportId: 1, status: 'pending' }) },

  { method: 'GET', pattern: '/api/v1/courses', handle: () => ok({ list: COURSES, total: COURSES.length, page: 1, pageSize: 20 }) },
  { method: 'GET', pattern: '/api/v1/courses/{courseId}', handle: (b, q, m) => {
      const c = COURSES.find((x) => String(x.courseId) === String(m.courseId))
      if (!c) return fail(404, '课程不存在')
      return ok({ course: c, weeks: [], enrolled: true })
    } },
  { method: 'POST', pattern: '/api/v1/courses/{courseId}/enroll', handle: (b, q, m) => {
      if (m.courseId === '10') return fail(409, '已选过该课程')
      return ok({ enrollmentId: 1, status: 'enrolled' })
    } },
  { method: 'GET', pattern: '/api/v1/courses/{courseId}/resources', handle: () => ok({ list: [], total: 0, page: 1, pageSize: 20 }) },

  { method: 'GET', pattern: '/api/v1/assignments', handle: () => ok({ list: HOMEWORKS, total: HOMEWORKS.length, page: 1, pageSize: 20 }) },
  { method: 'GET', pattern: '/api/v1/notifications', handle: () => ok({ list: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 }) },
  { method: 'GET', pattern: '/api/v1/conversations', handle: () => ok({ list: [], total: 0, page: 1, pageSize: 20 }) },

  // ---- M-D：AI 答疑（表 3-9 / 3-10）----
  // ---- M-D：AI 学情（表 3-11 / 3-19）----
  { method: 'GET', pattern: '/api/v1/profiles/me', handle: (b, query) => {
      // 数值取自原型 pc/student-analytics.html（掌握度 42/48/55 三项即原型里的薄弱知识点）
      const BY_COURSE = {
        11: {
          masteryAvg: 82.5,
          homeworkAvg: 86.2,
          rankText: '▲ 班级前 15%',
          learningProgress: 62,
          attendanceRate: 96.5,
          learningTimeSec: 23400, // 6.5h
          kpList: [
            { kpId: 1, kpName: '极限', percent: 92 },
            { kpId: 2, kpName: '导数', percent: 88 },
            { kpId: 3, kpName: '级数', percent: 76 },
            { kpId: 4, kpName: '积分', percent: 55 },
            { kpId: 5, kpName: '中值定理', percent: 48 },
            { kpId: 6, kpName: '微分', percent: 42 }
          ]
        },
        10: {
          masteryAvg: 88.4,
          homeworkAvg: 91.0,
          rankText: '▲ 班级前 8%',
          learningProgress: 74,
          attendanceRate: 100,
          learningTimeSec: 27000,
          kpList: [
            { kpId: 11, kpName: '线性表', percent: 94 },
            { kpId: 12, kpName: '栈与队列', percent: 90 },
            { kpId: 13, kpName: '树与二叉树', percent: 82 },
            { kpId: 14, kpName: '图', percent: 68 },
            { kpId: 15, kpName: '查找', percent: 58 },
            { kpId: 16, kpName: '排序', percent: 46 }
          ]
        },
        12: {
          masteryAvg: 79.1,
          homeworkAvg: 80.5,
          rankText: '班级中游',
          learningProgress: 78,
          attendanceRate: 92.0,
          learningTimeSec: 16200,
          kpList: [
            { kpId: 21, kpName: '时态', percent: 88 },
            { kpId: 22, kpName: '非谓语动词', percent: 72 },
            { kpId: 23, kpName: '虚拟语气', percent: 66 },
            { kpId: 24, kpName: '阅读理解', percent: 84 },
            { kpId: 25, kpName: '写作', percent: 58 },
            { kpId: 26, kpName: '听力', percent: 52 }
          ]
        }
      }
      const d = BY_COURSE[String(query?.courseId ?? '11')] || BY_COURSE[11]
      return ok(d)
    } },

  { method: 'GET', pattern: '/api/v1/practice/recommend', handle: (b, query) => {
      const byCourse = String(query?.courseId ?? '11')
      const base = byCourse === '10'
        ? [
            { type: 'basic', icon: 'target', title: '基础巩固题', kpName: '排序', count: 10, desc: '排序 · 10 题（掌握度 <50%，先打基础）' },
            { type: 'advanced', icon: 'trending-up', title: '能力提高题', kpName: '线性表与栈', count: 8, desc: '线性表与栈 · 8 题（已 >85%，拔高训练）' },
            { type: 'material', icon: 'book-open', title: '推荐资料', desc: '《排序算法对比.pdf》《树与图遍历精讲》' }
          ]
        : [
            { type: 'basic', icon: 'target', title: '基础巩固题', kpName: '微分中值定理', count: 10, desc: '微分中值定理 · 10 题（掌握度 <50%，先打基础）' },
            { type: 'advanced', icon: 'trending-up', title: '能力提高题', kpName: '极限与导数', count: 8, desc: '极限与导数 · 8 题（已 >85%，拔高训练）' },
            { type: 'material', icon: 'book-open', title: '推荐资料', desc: '《微分中值定理精讲.pdf》《洛必达法则微课》' }
          ]
      return ok({ list: base, total: base.length })
    } },

  { method: 'POST', pattern: '/api/v1/qa/ask', handle: (body) => {
      const list = KB_ENTRIES[String(body?.courseId ?? '')] || []
      const q = String(body?.question || '').toLowerCase()
      // 简化召回：关键词命中取相似度最高的一条；未命中则给一个低于阈值的分数（触发降级提示）
      let best = null
      for (const e of list) {
        if (e.k.some((k) => q.includes(k.toLowerCase())) && (!best || e.s > best.s)) best = e
      }
      const qaId = ++QA_SEQ
      if (!best) {
        return ok({
          qaId,
          answer: '',
          citations: [],
          hitKnowledge: false,
          score: Number((0.32 + Math.random() * 0.15).toFixed(2)),
          provider: 'local-tfidf'
        })
      }
      return ok({
        qaId,
        answer: best.a,
        citations: best.r.map((s) => ({ sourceFile: s, snippet: '', score: best.s })),
        hitKnowledge: true,
        score: best.s,
        provider: 'local-tfidf'
      })
    } },

  { method: 'POST', pattern: '/api/v1/qa/{qaId}/feedback', handle: (body) => {
      if (!['useful', 'useless'].includes(body?.feedback)) return fail(422, 'feedback 取值只能是 useful / useless')
      return ok({ result: true })
    } }
]

function match(method, url) {
  // 去掉 baseURL 与 query
  const path = (url || '').split('?')[0]
  for (const r of ROUTES) {
    if (r.method !== method) continue
    const rx = new RegExp('^' + r.pattern.replace(/\{[^}]+\}/g, '([^/]+)') + '$')
    const m = path.match(rx)
    if (!m) continue
    const keys = (r.pattern.match(/\{([^}]+)\}/g) || []).map((s) => s.slice(1, -1))
    const params = {}
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    return { handle: r.handle, params }
  }
  return null
}

/** axios 自定义 adapter：命中路由则本地返回，否则 404（提示 mock 未覆盖） */
export function mockAdapter(config) {
  // 该 Promise 只会 resolve（失败也以业务码返回，由 request.js 统一处理），故不需要 reject
  return new Promise((resolve) => {
    const method = (config.method || 'get').toUpperCase()
    let body = config.data
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch (e) { body = null }
    }
    const hit = match(method, config.url)
    setTimeout(() => {
      if (!hit) {
        const payload = fail(404, `Mock 未覆盖该接口：${method} ${config.url}`)
        return resolve({ data: payload, status: 200, statusText: 'OK', headers: {}, config })
      }
      const payload = hit.handle(body, config.params || {}, hit.params)
      resolve({ data: payload, status: 200, statusText: 'OK', headers: {}, config })
    }, 260)  // 模拟一点延迟，便于看见 loading 态
  })
}

export const mockInfo = { users: USERS, courses: COURSES, homeworks: HOMEWORKS, routes: ROUTES.length }
