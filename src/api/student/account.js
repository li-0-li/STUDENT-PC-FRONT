/**
 * 学生端 · 学籍认证（stu-pc 模块自有接口）
 *
 * GET  /api/v1/auth/certification → 认证状态
 *   { status: 'unverified'|'certified', realName, userNo, schoolName, deptName,
 *     idCardMasked, certifiedAt, reason }
 * POST /api/v1/auth/certification → 提交认证（与学籍档案逐字段比对，SHA-256 身份证）
 *   body: { realName, idCard, schoolName, deptName, userNo } 全必填
 *
 * 契约表号：表 2-18 提交 / 表 2-19 状态查询
 */
import request from '../request'

/** 我的认证状态 */
export function getCertStatus() {
  return request.get('/api/v1/auth/certification')
}

/** 提交学籍认证 */
export function submitCertification(data) {
  return request.post('/api/v1/auth/certification', data)
}

/**
 * 发送绑定类验证码（captcha/send 通用）
 * @param {string} target  邮箱或手机号
 * @param {string} channel 'email' | 'phone'
 * @param {string} scene   'bind_email' | 'bind_phone'
 */
export function sendBindCode(target, channel, scene) {
  return request.post('/api/v1/auth/captcha/send', { channel, target, scene })
}

/** 绑定/换绑邮箱（stu-pc 模块，scene=bind_email；重复邮箱 409） */
export function changeEmail(data) {
  return request.put('/api/v1/auth/email', data)
}

/** 换绑手机号（表 2-22，scene=bind_phone） */
export function changePhone(data) {
  return request.put('/api/v1/auth/phone', data)
}
