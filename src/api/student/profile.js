/**
 * 学
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 2-14 获取当前登录用户信息 */
export function getMe() {
  return request.get('/api/v1/users/me')
}

/** 表 2-6 修改密码 */
export function changePassword(data) {
  return request.put('/api/v1/users/me/password', data)
}

/** 表 2-7 修改个人资料 */
export function updateProfile(data) {
  return request.put('/api/v1/users/me/profile', data)
}

/** 表 2-16 通知偏好设置 */
export function updateNotifyPref(data) {
  return request.put('/api/v1/users/me/notify-pref', data)
}

/** 表 2-9 注销账号 */
export function cancelAccount(data) {
  return request.post('/api/v1/users/me/cancel', data)
}

/** 表 2-5 退出登录 */
export function logout(data) {
  return request.post('/api/v1/auth/logout', data)
}

/**
 * ★ 2026-10-20 上传头像（表 2-3，multipart 字段名 avatarfile）
 * POST /api/v1/users/me/avatar → { url, fileName }；后端同时写 sys_user.avatar
 */
export function uploadAvatar(file) {
  const fd = new FormData()
  fd.append('avatarfile', file)
  return request.post('/api/v1/users/me/avatar', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}
