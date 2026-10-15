<script setup>
/**
 * 登录页
 * ★ 1:1 还原 ui-prototype/pc/login.html（结构 / 文案 / 交互逐块对齐）
 *
 * 2026-10-12 若依迁移后的接口口径：
 * - 登录走**若依统一鉴权**：POST /login { username, password, code?, uuid? }
 *   → 响应 { code:200, msg, token }（token 在顶层，由 api/request.js 兜住）
 * - 图形验证码：后端开启（sys_config: sys.account.captchaEnabled=true）时用若依
 *   GET /captchaImage 的图片与 uuid；关闭时退回原型 canvas 本地演示码（仅前端校验、不提交）
 * - 登录成功后查 GET /api/v1/users/me（M-D 模块）取真实角色再跳转
 *
 * 与原型保留的差异（事实约束，非自作主张）：
 * - 邮箱/手机验证码登录：契约表 2-3/2-4 与若依都没有对应接口（自研后端也从未实现），
 *   故保持原型的演示行为并提示改用密码登录。
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import { getCaptcha, sendCaptcha } from '@/api/auth'
import BaseIcon from '@/components/base/BaseIcon.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/* ---------- 身份（照原型 ROLES） ---------- */
const ROLES = {
  admin: { label: '管理员', hint: '以管理员身份登录，进入管理后台', home: '/admin/dashboard' },
  teacher: { label: '老师', hint: '以教师身份登录，进入教学工作台', home: '/teacher/courses' },
  student: { label: '学生', hint: '以学生身份登录，进入学习中心', home: '/student/courses' }
}
const ROLE = ref('student')
const roleMeta = [
  { key: 'admin', name: '管理员', desc: '后台管理', icon: 'shield-check' },
  { key: 'teacher', name: '老师', desc: '教学工作台', icon: 'presentation' },
  { key: 'student', name: '学生', desc: '学习中心', icon: 'graduation-cap' }
]
function pickRole(key) {
  ROLE.value = key
}

/* ---------- 登录方式切换（pwd / mail / phone） ---------- */
const MODE = ref('pwd')
const MODES = [
  { key: 'pwd', label: '密码登录' },
  { key: 'mail', label: '邮箱验证码登录' },
  { key: 'phone', label: '手机验证码登录' }
]
function pickMode(key) {
  MODE.value = key
}

/* ---------- 表单 ---------- */
const account = ref('')
const password = ref('')
const remember = ref(true)
const capInput = ref('')
const loading = ref(false)

/* ---------- 图形验证码 ----------
 * 两套模式（2026-10-12 若依迁移后新增）：
 *   A) 后端开启验证码（若依 sys_config: sys.account.captchaEnabled = true）
 *      → 用若依 GET /captchaImage 返回的图片 + uuid，登录时把它一起提交
 *   B) 后端关闭验证码
 *      → 用原型 pc/login.html 的 canvas 本地演示验证码，仅做前端校验、不提交
 */
const capCanvas = ref()
const serverCaptcha = ref(false) // true = 用后端（若依）验证码
const captchaImg = ref('')
const captchaUuid = ref('')
let cap = ''

async function loadCaptcha() {
  try {
    const c = await getCaptcha()
    serverCaptcha.value = !!c?.captchaEnabled
    captchaImg.value = c?.img || ''
    captchaUuid.value = c?.uuid || ''
  } catch (e) {
    // 取不到就当后端未开启验证码，退回本地演示验证码
    serverCaptcha.value = false
  }
  if (!serverCaptcha.value) genCap()
}
function refreshCaptcha() {
  if (serverCaptcha.value) {
    loadCaptcha()
  } else {
    genCap()
  }
  capInput.value = ''
}

function genCap() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  cap = ''
  for (let i = 0; i < 4; i++) cap += chars[Math.floor(Math.random() * chars.length)]
  const cv = capCanvas.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, 0, cv.width, cv.height)
  const colors = ['#0d9488', '#2563eb', '#dc2626', '#7c3aed']
  for (let j = 0; j < 4; j++) {
    ctx.save()
    ctx.translate(14 + j * 22, 24)
    ctx.rotate((Math.random() - 0.5) * 0.5)
    ctx.font = 'bold 24px monospace'
    ctx.fillStyle = colors[j]
    ctx.fillText(cap[j], -8, -4)
    ctx.restore()
  }
  for (let k = 0; k < 6; k++) {
    ctx.strokeStyle = 'rgba(0,0,0,.08)'
    ctx.beginPath()
    ctx.moveTo(Math.random() * cv.width, Math.random() * cv.height)
    ctx.lineTo(Math.random() * cv.width, Math.random() * cv.height)
    ctx.stroke()
  }
}

/* ---------- 验证码登录（真实接口：scene=login；短信/邮件为模拟发送，回显码固定展示） ---------- */
const mailInput = ref('')
const mailCode = ref('')
const phoneInput = ref('')
const phoneCode = ref('')
/** 演示期回显的验证码（每个 tab 一份，页面内固定展示） */
const demoCodes = ref({ mail: '', phone: '' })
const CD = ref({ mail: 0, phone: 0 })
const mailBtnText = ref('获取验证码')
const phoneBtnText = ref('获取验证码')

async function sendCode(kind) {
  const isMail = kind === 'mail'
  const v = (isMail ? mailInput.value : phoneInput.value).trim()
  if (CD.value[kind] > 0) return
  if (isMail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    ElMessage.warning('请输入正确的邮箱地址')
    return
  }
  if (!isMail && !/^1[3-9]\d{9}$/.test(v)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  try {
    const d = await sendCaptcha({ channel: isMail ? 'email' : 'phone', target: v, scene: 'login' })
    demoCodes.value[kind] = d?.code || ''
    ElMessage.success('验证码已发送至 ' + (isMail ? v : v.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')))
  } catch {
    return // 60s 间隔 / 限流等由拦截器提示
  }
  CD.value[kind] = 60
  const btnText = isMail ? mailBtnText : phoneBtnText
  btnText.value = '60 秒后重发'
  const tk = setInterval(() => {
    CD.value[kind]--
    if (CD.value[kind] <= 0) {
      clearInterval(tk)
      btnText.value = '获取验证码'
    } else {
      btnText.value = CD.value[kind] + ' 秒后重发'
    }
  }, 1000)
}

/* ---------- 登录 ---------- */
async function doLogin() {
  if (MODE.value === 'pwd') {
    const v = capInput.value.trim().toUpperCase()
    if (!v) {
      ElMessage.warning('请输入图形验证码')
      return
    }
    // 后端未开验证码时用本地演示码校验；开启时交由若依校验
    if (!serverCaptcha.value && v !== cap) {
      ElMessage.error('图形验证码错误，请重新输入')
      refreshCaptcha()
      return
    }
    if (!account.value.trim() || !password.value) {
      ElMessage.warning('请输入账号与密码')
      return
    }
    loading.value = true
    try {
      // 学生端登录入口：POST /api/v1/auth/login { username, password }
      // （图形验证码后端未开启，不提交 code/uuid；开启时后端会校验）
      const payload = { username: account.value.trim(), password: password.value }
      if (serverCaptcha.value) {
        payload.code = capInput.value.trim()
        payload.uuid = captchaUuid.value
      }
      const data = await userStore.login(payload)
      const target = route.query.redirect || ROLES[ROLE.value].home
      ElMessage.success('登录成功')
      // 以响应里的真实角色为准（身份卡片只是引导）；缺 role 时再查 GET /api/v1/users/me
      let real = data?.role
      if (!real) {
        try {
          const me = await userStore.fetchInfo()
          real = Array.isArray(me?.roles) ? me.roles[0] : me?.role
        } catch (e) {
          // 取不到就用身份卡片选择的角色兜底
        }
      }
      const home = real && ROLES[real] ? ROLES[real].home : target
      router.push(route.query.redirect || home)
    } catch (e) {
      // 登录失败（含验证码错误）时刷新验证码，避免重复提交同一个无效 uuid
      if (serverCaptcha.value) refreshCaptcha()
    } finally {
      loading.value = false
    }
    return
  }
  // 验证码登录：契约里没有对应接口（只有发送验证码 表 2-3），提示改用密码登录
  const isMail = MODE.value === 'mail'
  const val = (isMail ? mailInput.value : phoneInput.value).trim()
  const code = (isMail ? mailCode.value : phoneCode.value).trim()
  if (isMail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    ElMessage.warning('请输入正确的邮箱地址')
    return
  }
  if (!isMail && !/^1[3-9]\d{9}$/.test(val)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (!code) {
    ElMessage.warning('请输入验证码')
    return
  }
  loading.value = true
  try {
    // 真实接口：POST /api/v1/auth/login-by-code（手机号/邮箱 + scene=login 验证码）
    const data = await userStore.loginByCode({ target: val, code })
    ElMessage.success('登录成功')
    const real = data?.role
    const home = real && ROLES[real] ? ROLES[real].home : ROLES[ROLE.value].home
    router.push(route.query.redirect || home)
  } catch {
    // 验证码错误 / 账号未注册等业务错误由拦截器统一提示
  } finally {
    loading.value = false
  }
}

/* ---------- URL 参数支持（照原型）：?m=mail|phone&role=admin|teacher|student ---------- */
onMounted(async () => {
  await loadCaptcha()
  const m = route.query.m
  const r = route.query.role
  if (r && ROLES[r]) ROLE.value = r
  if (m && ['pwd', 'mail', 'phone'].includes(m)) MODE.value = m
})
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-hero">
        <div class="cap">
          <span class="cap-icons">
            <BaseIcon name="book-open" :size="34" />
            <BaseIcon name="graduation-cap" :size="40" />
            <BaseIcon name="message-circle" :size="34" />
          </span>
        </div>
        <h3>智能教学，高效协同</h3>
        <p>覆盖教、学、管、评全场景</p>
      </div>

      <div class="auth-form">
        <h2>欢迎回来</h2>
        <p class="sub">{{ ROLES[ROLE].hint }}</p>

        <!-- 登录方式：密码 / 邮箱验证码 / 手机验证码 -->
        <div class="mtab-wrap">
          <span class="pilltabs">
            <span
              v-for="m in MODES"
              :key="m.key"
              class="pill"
              :class="{ active: MODE === m.key }"
              @click="pickMode(m.key)"
            >{{ m.label }}</span>
          </span>
        </div>

        <!-- 身份选择：管理员 / 教师 / 学生 -->
        <div class="role-tabs">
          <div
            v-for="r in roleMeta"
            :key="r.key"
            class="role-tab"
            :class="{ active: ROLE === r.key }"
            @click="pickRole(r.key)"
          >
            <span class="dot"><BaseIcon name="check" :size="11" /></span>
            <span class="ric"><BaseIcon :name="r.icon" :size="19" /></span>
            <span>{{ r.name }}</span>
            <span class="rdesc">{{ r.desc }}</span>
          </div>
        </div>

        <!-- ① 密码登录 -->
        <div v-show="MODE === 'pwd'">
          <div class="field">
            <label>账号</label>
            <input v-model="account" class="input" placeholder="学号 / 工号 / 手机号 / 邮箱" @keyup.enter="doLogin" />
          </div>
          <div class="field">
            <label>密码</label>
            <input v-model="password" class="input" type="password" placeholder="请输入密码" @keyup.enter="doLogin" />
          </div>
          <div class="field">
            <label>图形验证码</label>
            <div class="row" style="gap: 10px">
              <input
                v-model="capInput"
                class="input"
                placeholder="输入右侧 4 位字符"
                maxlength="4"
                style="flex: 1; letter-spacing: 3px; text-transform: uppercase"
                autocomplete="off"
                @keyup.enter="doLogin"
              />
              <canvas
                v-if="!serverCaptcha"
                ref="capCanvas"
                width="104"
                height="40"
                title="点击刷新验证码"
                style="border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: #f8fafc; flex: none"
                @click="refreshCaptcha"
              />
              <img
                v-else
                :src="'data:image/gif;base64,' + captchaImg"
                alt="验证码"
                title="点击刷新验证码"
                style="width: 104px; height: 40px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: #f8fafc; flex: none"
                @click="refreshCaptcha"
              />
            </div>
          </div>
          <div class="between">
            <label class="chk"><input v-model="remember" type="checkbox" /> 记住我</label>
            <router-link to="/forgot-password">忘记密码？</router-link>
          </div>
        </div>

        <!-- ② 邮箱验证码登录 -->
        <div v-show="MODE === 'mail'">
          <div class="bind-note">
            <BaseIcon name="mail" :size="14" />
            <span>仅<b>已绑定邮箱</b>的账号可用此方式登录。未绑定邮箱的账号请改用密码登录，或登录后在「个人资料 → 绑定邮箱」中完成绑定。</span>
          </div>
          <div class="field">
            <label>邮箱</label>
            <input v-model="mailInput" class="input" placeholder="请输入已绑定的邮箱" />
          </div>
          <div class="field">
            <label>邮箱验证码</label>
            <div class="row" style="gap: 10px">
              <input v-model="mailCode" class="input" placeholder="6 位验证码" maxlength="6" style="flex: 1; letter-spacing: 3px" />
              <button class="btn btn-outline" style="flex: none; white-space: nowrap" :disabled="CD.mail > 0" @click="sendCode('mail')">
                {{ mailBtnText }}
              </button>
            </div>
            <div v-if="demoCodes.mail" class="demo-code">
              <BaseIcon name="info" :size="13" />
              演示验证码：<b>{{ demoCodes.mail }}</b>
              <span class="muted">（演示环境为模拟发送）</span>
            </div>
          </div>
        </div>

        <!-- ③ 手机验证码登录 -->
        <div v-show="MODE === 'phone'">
          <div class="bind-note">
            <BaseIcon name="smartphone" :size="14" />
            <span>仅<b>已绑定手机号</b>的账号可用此方式登录。未绑定手机的账号请改用密码登录，或登录后在「个人资料 → 绑定手机号」中完成绑定。</span>
          </div>
          <div class="field">
            <label>手机号</label>
            <input v-model="phoneInput" class="input" placeholder="请输入已绑定的手机号" maxlength="11" />
          </div>
          <div class="field">
            <label>短信验证码</label>
            <div class="row" style="gap: 10px">
              <input v-model="phoneCode" class="input" placeholder="6 位验证码" maxlength="6" style="flex: 1; letter-spacing: 3px" />
              <button class="btn btn-outline" style="flex: none; white-space: nowrap" :disabled="CD.phone > 0" @click="sendCode('phone')">
                {{ phoneBtnText }}
              </button>
            </div>
            <div v-if="demoCodes.phone" class="demo-code">
              <BaseIcon name="info" :size="13" />
              演示验证码：<b>{{ demoCodes.phone }}</b>
              <span class="muted">（演示环境为模拟发送）</span>
            </div>
          </div>
        </div>

        <button class="btn btn-primary btn-block" style="padding: 12px" :disabled="loading" @click="doLogin">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
        <p class="center small muted mt16">
          还没有账号？<router-link to="/register">立即注册</router-link>（管理员账号不开放注册，由系统管理员创建）
        </p>
        <p class="center small mt8"><router-link to="/student/support">遇到登录问题？联系客服</router-link></p>

        <details class="demo">
          <summary>演示账号（与服务器库同步，点击展开）</summary>
          <div class="demo-body">
            <div><code>admin</code> / <code>13800000001</code> — 管理员 系统管理员  邮箱<span class="tag-ok">已绑定</span>  手机<span class="tag-ok">已绑定</span></div>
            <div><code>zhanglaoshi</code> / <code>13800000002</code> — 教师 张老师  邮箱<span class="tag-ok">已绑定</span>  手机<span class="tag-ok">已绑定</span></div>
            <div><code>lihaoyi</code> / <code>13800000003</code> — 学生 刘浩艺  邮箱<span class="tag-ok">已绑定</span>  手机<span class="tag-ok">已绑定</span></div>
            <div class="muted" style="margin-top: 6px">
              以上账号密码均为 <b>admin123</b>；也可用「手机号 + 验证码」免密登录（点「获取验证码」后页面内显示演示验证码）。
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== auth 布局（对齐 theme.css §登录注册） ===== */
.auth-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: var(--bg-subtle);
}
.auth-card {
  width: min(880px, 100%);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 1fr;
  box-shadow: var(--sh-2);
}
.auth-hero {
  position: relative;
  min-height: 480px;
  background:
    linear-gradient(160deg, rgba(13, 148, 136, 0.85), rgba(15, 118, 110, 0.92)),
    radial-gradient(circle at 30% 30%, #7ceadd33, transparent 60%),
    var(--brand-700);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 28px;
}
.auth-hero .cap {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -60%);
  opacity: 0.95;
  color: #d8fbf4;
}
.cap-icons {
  display: inline-flex;
  gap: 18px;
  align-items: center;
}
.auth-hero h3 {
  font-size: 22px;
  color: #fff;
}
.auth-hero p {
  color: #d8fbf4;
  margin: 6px 0 0;
  font-size: 13px;
}
.auth-form {
  padding: 40px 36px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.auth-form h2 {
  font-size: 22px;
}
.auth-form .sub {
  color: var(--ink-500);
  margin: 6px 0 18px;
  font-size: 13px;
}
.auth-form .between {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  margin: -6px 0 16px;
}

/* ===== 登录方式 pilltabs（对齐 theme.css） ===== */
.mtab-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 18px;
}
.pilltabs {
  display: inline-flex;
  background: var(--bg-soft);
  border-radius: var(--r-full);
  padding: 3px;
  gap: 2px;
}
.pilltabs .pill {
  padding: 6px 16px;
  border-radius: var(--r-full);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-500);
  cursor: pointer;
}
.pilltabs .pill.active {
  background: var(--brand-600);
  color: #fff;
}

/* ===== 身份卡片（对齐 login.html 内联样式） ===== */
.role-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 2px 0 12px;
}
.role-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 13px 6px 11px;
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--ink-600);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
}
.role-tab .ric {
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-soft);
  color: var(--ink-500);
  transition: all 0.15s ease;
}
.role-tab:hover {
  border-color: var(--brand-300);
  color: var(--brand-700);
}
.role-tab.active {
  border-color: var(--primary);
  background: var(--primary-softer);
  color: var(--brand-700);
}
.role-tab.active .ric {
  background: var(--primary);
  color: #fff;
  box-shadow: var(--sh-1);
}
.role-tab .rdesc {
  font-size: 11px;
  font-weight: 400;
  color: var(--ink-400);
}
.role-tab.active .rdesc {
  color: var(--brand-600);
}
.role-tab .dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: none;
  align-items: center;
  justify-content: center;
}
.role-tab.active .dot {
  display: flex;
}

/* ===== 表单（对齐 theme.css 通用组件） ===== */
.field {
  margin-bottom: 16px;
}
.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.input {
  width: 100%;
  font-family: inherit;
  font-size: 14px;
  color: var(--ink-900);
  background: #fff;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  padding: 10px 12px;
  outline: none;
  transition: 0.15s;
}
.input::placeholder {
  color: var(--ink-400);
}
.input:focus {
  border-color: var(--brand-400);
  box-shadow: 0 0 0 3px var(--brand-100);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-600);
  font-size: 13px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 14px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  transition: all 0.15s ease;
  white-space: nowrap;
  background: transparent;
}
.btn-primary {
  background: var(--primary);
  color: #fff;
  box-shadow: var(--sh-1);
}
.btn-primary:hover {
  background: var(--primary-hover);
  color: #fff;
}
.btn-outline {
  background: #fff;
  border-color: var(--border-strong);
  color: var(--ink-700);
}
.btn-outline:hover {
  border-color: var(--brand-400);
  color: var(--primary-hover);
  background: var(--primary-softer);
}
.btn-outline:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-block {
  width: 100%;
}

/* ===== 绑定提示 / 演示账号（对齐 login.html 内联样式） ===== */
.bind-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  color: var(--ink-500);
  background: var(--bg-subtle);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  line-height: 1.65;
}
.bind-note svg {
  flex: none;
  margin-top: 2px;
  color: var(--brand-600);
}
.demo-code {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--brand-700);
  background: var(--primary-softer);
  border: 1px solid var(--brand-200);
  border-radius: 8px;
}
.demo-code b {
  font-size: 15px;
  letter-spacing: 2px;
}
.demo {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.demo > summary {
  padding: 9px 12px;
  font-size: 12px;
  color: var(--ink-500);
  cursor: pointer;
  background: var(--bg-subtle);
  list-style: none;
}
.demo > summary::-webkit-details-marker {
  display: none;
}
.demo-body {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--ink-600);
  line-height: 1.9;
}
.demo-body code {
  background: var(--bg-soft);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11.5px;
}
.tag-no {
  color: var(--error);
  font-weight: 600;
}
.tag-ok {
  color: var(--success);
  font-weight: 600;
}

/* ===== 工具类 ===== */
.center {
  text-align: center;
}
.small {
  font-size: 12px;
}
.muted {
  color: var(--ink-500);
}
.mt8 {
  margin-top: 8px;
}
.mt16 {
  margin-top: 16px;
}

@media (max-width: 860px) {
  .auth-card {
    grid-template-columns: 1fr;
  }
  .auth-hero {
    min-height: 160px;
  }
  .auth-hero .cap {
    display: none;
  }
}
</style>
