/**
 * 用户与登录态（Pinia）
 * 只放跨页面共享状态；页面内状态不外提（PRD §6.6）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getToken, setToken, clearToken } from '@/api/request'
import { login as loginApi, logout as logoutApi, getCurrentUser } from '@/api/auth'

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
    // ★ 2026-10-12 若依迁移：统一鉴权入口 POST /login
    //   返回 { code:200, msg:'操作成功', token:'eyJ...' } —— token 在响应**顶层**，
    //   由 api/request.js 拦截器「无 data 时返回剩余字段」兜住，这里拿到 { token }。
    //   响应里不含角色，角色由 fetchInfo() 调 GET /api/v1/users/me 获取。
    const accessToken = data?.token || data?.accessToken
    token.value = accessToken
    setToken(accessToken)
    return data
  }

  /** 登录后 / 刷新后拉取当前用户信息（接口文档 表 2-14） */
  async function fetchInfo() {
    const me = await getCurrentUser()
    info.value = me
    // ★ 经理版返回 roles 数组，取第一个作为当前角色
    const r = Array.isArray(me?.roles) ? me.roles[0] : me?.role
    sessionStorage.setItem('itap_role', r || 'student')
    return me
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

  return { token, info, perms, unread, isLogin, role, name, login, fetchInfo, logout, setPerms }
})
