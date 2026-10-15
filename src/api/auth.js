/**
 * 公共域接口（接口设计文档 表 2-1 ~ 2-17）
 * 公共 17 个为全端共用池，只由 owner 修改，其他端只消费（PRD §8.12）
 *
 * ★ 2026-10-14 登录入口修正（真实联调）：
 *   - 登录改走 **POST /api/v1/auth/login**（学生端专用登录，签发含 role/schoolId 的
 *     StudentLoginUser 会话）；响应 data = { role, schoolId, name, mustChangePwd, expireIn,
 *     accessToken, token }。
 *   - 原因：若依统一入口 POST /login 签发的是普通会话（无 role），student-mp 侧
 *     McAuthGuard 按角色门禁（/api/v1/assignments 等）会一路 403。
 *   - 登出/图形验证码仍用若依入口（POST /logout、GET /captchaImage），实测同一会话兼容。
 */
import request from './request'

/**
 * 用户登录 → POST /api/v1/auth/login（学生端）
 * 请求体：{ username, password }（图形验证码后端未开启，无需 code/uuid）
 * 响应：Result 信封，data = { role:'student', schoolId, name, mustChangePwd, expireIn,
 *        accessToken, token }  ★ token 在 data 里
 */
export function login(data) {
  return request.post('/api/v1/auth/login', data)
}

/**
 * ★ 2026-10-15 验证码登录 → POST /api/v1/auth/login-by-code（学生端）
 * 请求体：{ target: 手机号或邮箱, code: scene=login 的验证码 }
 *   （验证码先经 POST /api/v1/auth/captcha/send {channel:'phone'|'email', target, scene:'login'}）
 * 响应同 login，data 含 role / accessToken / token。
 */
export function loginByCode(data) {
  return request.post('/api/v1/auth/login-by-code', data)
}

/**
 * 用户注册 → POST /api/v1/auth/register（学生端）
 * 请求体（RegisterRequest）：{ username(手机号), password, phone, email?, channel:'phone', code }
 *   验证码先经 POST /api/v1/auth/captcha/send（scene=register）获取
 * 响应：Result 信封，data = { userId }
 * ★ 2026-10-15 修正：原先指向若依 /register（LoginBody 形态），学生端应走本接口（实测建号+默认 student 角色）。
 */
export function register(data) {
  return request.post('/api/v1/auth/register', data)
}

/** 图形验证码 → 若依 GET /captchaImage，返回 { captchaEnabled, uuid, img } */
export function getCaptcha() {
  return request.get('/captchaImage')
}

/** 退出登录 → 若依 POST /logout */
export function logout() {
  return request.post('/logout')
}

/** 获取当前登录用户信息 → 若依 GET /getInfo，返回 { user, roles, permissions } */
export function getInfo() {
  return request.get('/getInfo')
}

/**
 * 表 2-3 发送验证码 POST /api/v1/auth/captcha/send
 * ⚠️ 缺口：自研后端从未实现，若依也不提供（若依只做图形验证码 + 邮箱/短信需自行接）。
 *    保留函数占位，待后端补位后直接启用。
 */
export function sendCaptcha(data) {
  return request.post('/api/v1/auth/captcha/send', data)
}

/**
 * 表 2-4 重置密码 POST /api/v1/auth/password/reset
 * ⚠️ 缺口：同上。
 */
export function resetPassword(data) {
  return request.post('/api/v1/auth/password/reset', data)
}

/** 表 2-6 修改密码 PUT /api/v1/users/me/password */
export function changePassword(data) {
  return request.put('/api/v1/users/me/password', data)
}

/** 表 2-7 修改个人资料 PUT /api/v1/users/me/profile */
export function updateProfile(data) {
  return request.put('/api/v1/users/me/profile', data)
}

/** 表 2-8 上传头像 POST /api/v1/users/me/avatar */
export function uploadAvatar(file) {
  const fd = new FormData()
  // ★ 经理整合版 UserProfileController 用 @RequestParam("avatarfile")
  fd.append('avatarfile', file)
  return request.post('/api/v1/users/me/avatar', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/** 表 2-9 注销账号 POST /api/v1/users/me/cancel */
export function cancelAccount(data) {
  return request.post('/api/v1/users/me/cancel', data)
}

/** 表 2-14 获取当前登录用户信息 GET /api/v1/users/me */
export function getCurrentUser() {
  return request.get('/api/v1/users/me')
}

/** 表 2-15 通用文件上传 POST /api/v1/files/upload */
export function uploadFile(file, bizType) {
  const fd = new FormData()
  fd.append('file', file)
  if (bizType) fd.append('bizType', bizType)
  return request.post('/api/v1/files/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

/** 表 2-16 通知偏好设置 PUT /api/v1/users/me/notify-pref */
export function updateNotifyPref(data) {
  return request.put('/api/v1/users/me/notify-pref', data)
}
