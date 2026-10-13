/**
 * 认证页（不带 PcShell，顶层路由）
 * 接口：表 2-1 登录 / 表 2-2 注册 / 表 2-3 发送验证码 / 表 2-4 重置密码
 */
export default [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/Login.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/login/Register.vue'),
    meta: { public: true, title: '注册' }
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/views/login/ForgotPassword.vue'),
    meta: { public: true, title: '找回密码' }
  }
]
