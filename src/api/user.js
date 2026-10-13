/**
 * 公共域 · 个人中心扩展（本次 101 接口新增的实名认证 / 登录设备 / 换绑手机 / 学校绑定 / 举报）
 * 表号按《05-接口设计文档》表格顺序；学生 PC 端「个人资料」弹窗与登录页会用到。
 *
 * ★ 路径口径：以 `docs/05-接口设计文档.docx`（101 个接口，骨架 README §四 标记为「已冻结」）
 *   的「实际URL」列**逐字为准** —— 注意它**不带端前缀**（如 `/api/v1/courses`），
 *   与骨架 README §八 那句「路径 `/api/v1/{端}/{模块}`」不一致，已记入对齐清单待 PM 裁定。
 *   接口编号直接标文档表号，方便与验收用例对照。
 */
import request from '../request'

/** 表 2-18 实名 / 学籍认证提交  POST /api/v1/auth/certification */
export function submitCertification(data) {
  return request.post('/api/v1/auth/certification', data)
}

/** 表 2-19 认证状态查询  GET /api/v1/auth/certification */
export function getCertification() {
  return request.get('/api/v1/auth/certification')
}

/** 表 2-20 登录设备列表  GET /api/v1/auth/devices */
export function deviceList(params) {
  return request.get('/api/v1/auth/devices', { params })
}

/** 表 2-21 远程下线设备  DELETE /api/v1/auth/devices/{deviceRowId} */
export function removeDevice(deviceRowId) {
  return request.delete(`/api/v1/auth/devices/${deviceRowId}`)
}

/** 表 2-22 换绑手机号  PUT /api/v1/auth/phone */
export function changePhone(data) {
  return request.put('/api/v1/auth/phone', data)
}

/** 表 2-23 微信登录  POST /api/v1/auth/wx-login（小程序端为主，PC 端一般不用） */
export function wxLogin(data) {
  return request.post('/api/v1/auth/wx-login', data)
}

/** 表 2-24 微信绑定  POST /api/v1/auth/wx-bind（小程序端为主） */
export function wxBind(data) {
  return request.post('/api/v1/auth/wx-bind', data)
}

/** 表 2-25 解绑微信  DELETE /api/v1/auth/wx-bind */
export function wxUnbind(platform) {
  return request.delete('/api/v1/auth/wx-bind', { params: { platform } })
}

/** 表 2-26 学校绑定 / 换校申请提交  POST /api/v1/auth/school-bind-apply */
export function applySchoolBind(data) {
  return request.post('/api/v1/auth/school-bind-apply', data)
}

/** 表 2-27 学校绑定申请查询  GET /api/v1/auth/school-bind-apply */
export function schoolBindList(params) {
  return request.get('/api/v1/auth/school-bind-apply', { params })
}

/** 表 2-28 用户举报  POST /api/v1/reports */
export function reportUser(data) {
  return request.post('/api/v1/reports', data)
}
