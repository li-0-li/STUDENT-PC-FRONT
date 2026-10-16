/**
 * 用户与登录态（Pinia）
 * 只放跨页面共享状态；页面内状态不外提（PRD §6.6）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getToken, setToken, clearToken } from '@/api/request'
import { login as loginApi, logout as logoutApi, getCurrentUser, loginByCode as loginByCodeApi } from '@/api/auth'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const info = ref(null)
  const perms = ref([])
  const unread = ref(0)

  const isLogin = computed(() => !!token.value)
  // ★ 经理整合版 /users/me 返回 roles: ['student']（数组），旧版为 role（字符串）
  const role = computed(() => {
    const r = info.value?.roles
    if (Array.isArray(r) && r.length) return r[0]
    return info.value?.role || sessionStorage.getItem('itap_role') || 'student'
  })
  // ★ 经理版姓名字段是 nickName
  const name = computed(() => info.value?.nickName || info.value?.name || '')

  async function login(form) {
    const data = await loginApi(form)
    // ★ 2026-10-14：登录入口 = POST /api/v1/auth/login（学生端，签发含 role 的会话）
    //   响应 data = { role, schoolId, name, mustChangePwd, expireIn, accessToken, token }
    //   —— accessToken 与 token 值相同，取其一即可；角色 data.role 可直接用于跳转。
    const accessToken = data?.token || data?.accessToken
    token.value = accessToken
    setToken(accessToken)
    return data
  }

  /**
   * ★ 验证码登录（手机号/邮箱 + 验证码）→ POST /api/v1/auth/login-by-code
   * 与密码登录同口径存储 token；响应 data 同样含 role / accessToken / token。
   */
  async function loginByCode(form) {
    const data = await loginByCodeApi(form)
    const accessToken = data?.token || data?.accessToken
    token.value = accessToken
    setToken(accessToken)
    return data
  }

  /** 登录后 / 刷新后拉取当前用户信息（接口文档 表 2-14）；并发去重：同刻多次调用复用同一请求 */
  let infoPromise = null
  async function fetchInfo() {
    if (infoPromise) return infoPromise
    infoPromise = getCurrentUser()
      .then((me) => {
        info.value = me
        // ★ 经理版返回 roles 数组，取第一个作为当前角色
        const r = Array.isArray(me?.roles) ? me.roles[0] : me?.role
        sessionStorage.setItem('itap_role', r || 'student')
        return me
      })
      .finally(() => {
        infoPromise = null
      })
    return infoPromise
  }

  async function logout() {
    try {
      await logoutApi()
    } catch (e) {
      // 登出失败也要清本地登录态
    }
    token.value = ''
    info.value = null
    clearToken()
  }

  /** 菜单权限点（后端 sys_permission 返回，接口文档 表 5-15 的端侧对应接口） */
  function setPerms(list) {
    perms.value = list || []
  }

  return { token, info, perms, unread, isLogin, role, name, login, loginByCode, fetchInfo, logout, setPerms }
})
