/**
 * 公共域接口（接口设计文档 表 2-1 ~ 2-17）
 * 公共 17 个为全端共用池，只由 owner 修改，其他端只消费（PRD §8.12）
 *
 * ★ 2026-10-12 若依迁移：登录 / 注册 / 登出 改为**若依统一鉴权入口**，
 *   即 RuoYi SysLoginController 的 /login、/register、/logout（全端共用同一套 SSO），
 *   不再走自研的 /api/v1/auth/**（该模块已随迁移删除）。
 */
import request from './request'

/**
 * 用户登录 → 若依 POST /login
 * 请求体（RuoYi LoginBody）：{ username, password, code?, uuid? }（code/uuid 仅在开启验证码时必填）
 * 响应体：{ code:200, msg:'操作成功', token:'eyJ...' }　★ token 在**顶层**，不在 data 里
 */
export function login(data) {
  return request.post('/login', data)
}

/** 用户注册 → 若依 POST /register（需 sys_config 的 sys.account.registerUser 为 true） */
export function register(data) {
  return request.post('/register', data)
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
