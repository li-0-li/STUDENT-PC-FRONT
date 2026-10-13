/**
 * Mock 冒烟测试（开发工具，可提交）
 * 用法：node scripts/mock-smoke.mjs
 *
 * 直接调用 mock 的 axios adapter，验证：路由匹配、路径参数、响应体形状、错误码。
 * 这样改 mock 或改接口层后能立刻发现是否被改坏。
 */
import { mockAdapter, mockInfo } from '../src/api/mock.js'

let pass = 0
let failed = 0

async function call(method, url, data) {
  const res = await mockAdapter({ method, url, data, headers: {} })
  return res.data
}

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? '  → ' + JSON.stringify(extra) : ''}`)
  }
}

console.log(`mock 已登记路由 ${mockInfo.routes} 条\n`)

console.log('[认证]')
let r = await call('POST', '/api/v1/auth/login', { username: 'stu2200850123', password: 'abc12345' })
check('学生登录返回 code=0', r.code === 0, r)
check('返回 token', typeof r.data?.token === 'string' && r.data.token.startsWith('mock-token-'), r.data)
check('返回 user.role=student', r.data?.user?.role === 'student', r.data?.user)
check('返回 mustChangePwd 字段', 'mustChangePwd' in (r.data || {}), r.data)

r = await call('POST', '/api/v1/auth/login', { username: 'admin', password: 'x' })
check('密码过短 → code=401', r.code === 401, r)
check('401 带中文提示', typeof r.message === 'string' && r.message.length > 0, r)

r = await call('POST', '/api/v1/auth/login', { username: 't2018003', password: 'abc12345' })
check('教师账号 → role=teacher', r.data?.user?.role === 'teacher', r.data)

r = await call('POST', '/api/v1/auth/register', {})
check('注册缺 username → code=422', r.code === 422, r)
check('422 带 details', r.details !== undefined, r)

r = await call('POST', '/api/v1/auth/captcha/send', { account: '175****4413' })
check('发验证码返回 expireSeconds', r.code === 0 && r.data?.expireSeconds === 300, r)

r = await call('POST', '/api/v1/auth/password/reset', { account: 'a', captcha: '000000', newPassword: 'abcdefgh1' })
check('验证码错误 → code=422', r.code === 422, r)

console.log('\n[当前用户 / 个人中心]')
r = await call('GET', '/api/v1/users/me')
check('GET users/me 跟随最近登录角色', r.code === 0 && r.data?.role === 'teacher', r.data)

r = await call('PUT', '/api/v1/users/me/password', { oldPassword: 'old', newPassword: 'short' })
check('新密码不足 8 位 → code=422', r.code === 422, r)

r = await call('PUT', '/api/v1/users/me/password', { oldPassword: 'old', newPassword: 'abcdefgh1' })
check('改密成功 → code=0', r.code === 0, r)

r = await call('GET', '/api/v1/auth/devices')
check('设备列表返回 list', r.code === 0 && Array.isArray(r.data?.list) && r.data.list.length === 2, r.data)

r = await call('DELETE', '/api/v1/auth/devices/7')
check('路径参数 /devices/{deviceRowId} 命中', r.code === 0, r)

r = await call('POST', '/api/v1/reports', { targetType: 'user', targetId: 5, reason: '测试' })
check('举报返回 reportId', r.code === 0 && r.data?.reportId === 1, r)

console.log('\n[学生域：课程 / 作业]')
r = await call('GET', '/api/v1/courses?page=1&pageSize=20')
check('课程列表 3 条', r.code === 0 && r.data?.list?.length === 3, r.data)
check('分页字段齐全', ['list', 'total', 'page', 'pageSize'].every((k) => k in (r.data || {})), r.data)

r = await call('GET', '/api/v1/courses/11')
check('课程详情按 courseId 命中', r.code === 0 && r.data?.course?.courseId === 11, r.data)

r = await call('GET', '/api/v1/courses/999')
check('不存在的课程 → code=404', r.code === 404, r)

r = await call('POST', '/api/v1/courses/10/enroll', { enrollType: 'code', courseCode: 'ABC' })
check('重复加课 → code=409（业务冲突）', r.code === 409, r)

r = await call('POST', '/api/v1/courses/13/enroll', { enrollType: 'code', courseCode: 'XYZ' })
check('正常加课 → code=0', r.code === 0, r)

r = await call('GET', '/api/v1/assignments')
check('作业列表 3 条', r.code === 0 && r.data?.list?.length === 3, r.data)

console.log('\n[未覆盖接口的兜底]')
r = await call('GET', '/api/v1/notifications')
check('已登记的 notifications 正常返回', r.code === 0, r)

r = await call('GET', '/api/v1/qa/ask')
check('未登记路由 → 404 且提示「Mock 未覆盖」', r.code === 404 && /Mock/.test(r.message), r)

console.log(`\n结果：通过 ${pass} 项，失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
