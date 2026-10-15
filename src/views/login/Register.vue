<script setup>
/**
 * 注册页（接口文档 表 2-2 POST /api/v1/auth/register）
 *
 * ★ 2026-10-15 v2 改版（QQ/微信官网式）：
 *   - 不再把所有注册方式铺开放一起：**默认只显示「学生注册」极简表单**
 *     （手机号 / 验证码 / 密码 / 确认），右下角小链接可切换「教师注册」；
 *   - 教师注册后端暂未支持自助（RegisterRequest 无角色参数）→ 教师视图如实说明，不假装；
 *   - 姓名 / 身份证 / 学校等按原型口径不在注册页收集，登录后于「个人中心」绑定（学籍认证 = 表 2-18）。
 *
 * 数据链路（实测）：
 *   验证码 → POST /api/v1/auth/captcha/send {channel:'phone', target, scene:'register'}
 *   注册   → POST /api/v1/auth/register {username:手机号, password, phone, channel, code}
 *   （演示环境短信为模拟发送，不真实下发；本地可用 --zhike.verify.return-code=true 回显验证码）
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { register, sendCaptcha } from '@/api/auth'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/* ---------- 注册方式（默认学生；教师可切换） ---------- */
const ROLE = ref('student')
const SUB = {
  student: '学生注册成功后即可用课程码加入课程',
  teacher: '教师账号需管理员审核开通'
}
function toggleRole() {
  ROLE.value = ROLE.value === 'student' ? 'teacher' : 'student'
}

/* ---------- 学生注册表单（极简四项） ---------- */
const phone = ref('')
const code = ref('')
const pwd = ref('')
const pwd2 = ref('')
const agree = ref(true)
const loading = ref(false)

/* ---------- 短信验证码（真实接口 + 60s 倒计时） ---------- */
const CD = ref(0)
const codeBtnText = ref('获取验证码')
/** 演示验证码：后端联调期回显（zhike.verify.return-code），页面内固定展示，避免只弹一次看不到 */
const demoCode = ref('')
let cdTimer = null
function startCountdown() {
  CD.value = 60
  codeBtnText.value = '60 秒后重发'
  cdTimer = setInterval(() => {
    CD.value--
    if (CD.value <= 0) {
      clearInterval(cdTimer)
      codeBtnText.value = '获取验证码'
    } else {
      codeBtnText.value = CD.value + ' 秒后重发'
    }
  }, 1000)
}
async function sendCode() {
  const p = phone.value.trim()
  if (!/^1[3-9]\d{9}$/.test(p)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (CD.value > 0) return
  try {
    const d = await sendCaptcha({ channel: 'phone', target: p, scene: 'register' })
    startCountdown()
    // 后端回显（联调/演示期）→ 页面内固定展示；未回显则仅提示已发送
    demoCode.value = d?.code || ''
    const masked = p.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    ElMessage.success(`验证码已发送至 ${masked}`)
  } catch {
    // 60s 间隔 / 每日限流等业务错误已由 request.js 拦截器统一提示
  }
}

/* ---------- 注册（手机号 = 账号） ---------- */
async function doRegister() {
  const p = phone.value.trim()
  if (!/^1[3-9]\d{9}$/.test(p)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (!code.value.trim()) {
    ElMessage.warning('请输入短信验证码')
    return
  }
  if (pwd.value.length < 6) {
    ElMessage.warning('请设置至少 6 位的登录密码')
    return
  }
  if (pwd.value !== pwd2.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  if (!agree.value) {
    ElMessage.warning('请先阅读并同意《平台服务协议》与《隐私政策》')
    return
  }
  loading.value = true
  try {
    await register({
      username: p,
      password: pwd.value,
      phone: p,
      channel: 'phone',
      code: code.value.trim()
    })
    // 注册成功 → 自动登录直接进主页（QQ/微信式体验）；自动登录失败则回登录页手动登
    demoCode.value = ''
    try {
      await userStore.login({ username: p, password: pwd.value })
      ElMessage.success('注册成功，欢迎加入！')
      router.push('/student/courses')
    } catch {
      await ElMessageBox.alert('注册成功！\n\n请使用「手机号 + 密码」登录。', '注册成功', { confirmButtonText: '去登录' })
      router.push('/login')
    }
  } catch {
    // 业务错误（验证码错误 / 手机号已注册 / 验证码过期等）已由拦截器统一提示
  } finally {
    loading.value = false
  }
}

/* ---------- URL 参数支持：?role=teacher|student ---------- */
onMounted(() => {
  const r = route.query.role
  if (r === 'teacher' || r === 'student') ROLE.value = r
})
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-hero">
        <div class="cap">
          <span class="cap-icons">
            <BaseIcon name="user-plus" :size="34" />
            <BaseIcon name="graduation-cap" :size="40" />
            <BaseIcon name="sparkles" :size="34" />
          </span>
        </div>
        <h3>加入平台</h3>
        <p>手机号极速注册 · 学生即开即用</p>
      </div>

      <div class="auth-form">
        <h2>注册账号</h2>
        <p class="sub">{{ SUB[ROLE] }}</p>

        <!-- ============ 学生注册（默认，极简四项） ============ -->
        <template v-if="ROLE === 'student'">
          <div class="field">
            <label>手机号</label>
            <input v-model="phone" class="input" placeholder="用于登录与找回密码" maxlength="11" />
          </div>

          <div class="field">
            <label>短信验证码</label>
            <div class="row" style="gap: 10px">
              <input v-model="code" class="input" placeholder="6 位验证码" maxlength="6" style="flex: 1; letter-spacing: 3px" />
              <button class="btn btn-outline" style="flex: none; white-space: nowrap" :disabled="CD > 0" @click="sendCode">
                {{ codeBtnText }}
              </button>
            </div>
            <div v-if="demoCode" class="demo-code">
              <BaseIcon name="info" :size="13" />
              演示验证码：<b>{{ demoCode }}</b>
              <span class="muted">（演示环境短信为模拟发送，未真实下发）</span>
            </div>
          </div>

          <div class="field">
            <label>设置密码</label>
            <input v-model="pwd" type="password" class="input" placeholder="请设置登录密码（至少 6 位）" maxlength="32" />
          </div>

          <div class="field">
            <label>确认密码</label>
            <input v-model="pwd2" type="password" class="input" placeholder="请再次输入密码" maxlength="32" />
          </div>

          <div class="row small muted" style="gap: 6px; margin: 4px 0 14px; line-height: 1.6">
            <input id="rgAgree" v-model="agree" type="checkbox" style="margin-top: 2px" />
            <label for="rgAgree" style="cursor: pointer">我已阅读并同意《平台服务协议》与《隐私政策》</label>
          </div>

          <button class="btn btn-primary btn-block" style="padding: 12px" :disabled="loading" @click="doRegister">
            {{ loading ? '提交中…' : '注册并登录' }}
          </button>

          <!-- 右下角：切换注册方式（QQ/微信官网式） -->
          <div class="switch-line">
            <span class="small muted">姓名 / 学校 / 学号登录后在个人中心绑定</span>
            <a class="switch-link" @click="toggleRole">注册教师账号 →</a>
          </div>
        </template>

        <!-- ============ 教师注册（切换视图：后端暂不支持自助） ============ -->
        <template v-else>
          <div class="teacher-panel">
            <BaseIcon name="info" :size="16" />
            <div>
              <b>教师账号需管理员开通</b>
              <p>
                教师注册暂未开放自助申请。请联系管理员在「账号管理 → 新增账号」中创建教师账号并分配角色权限，
                开通后使用手机号 / 账号 + 密码登录。
              </p>
            </div>
          </div>
          <button class="btn btn-outline btn-block" style="padding: 12px" @click="toggleRole">← 返回学生注册</button>
        </template>

        <p class="center small muted mt16">已有账号？<router-link to="/login">返回登录</router-link></p>
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

/* ===== 演示验证码（页面内固定展示） ===== */
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
.demo-code svg {
  flex: none;
}

/* ===== 教师视图说明面板 ===== */
.teacher-panel {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  color: var(--ink-600);
  background: var(--bg-subtle);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 16px;
  line-height: 1.7;
}
.teacher-panel svg {
  flex: none;
  margin-top: 3px;
  color: var(--ink-400);
}
.teacher-panel b {
  color: var(--ink-800);
}
.teacher-panel p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ink-500);
}

/* ===== 右下角切换注册方式 ===== */
.switch-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}
.switch-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-600);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.switch-link:hover {
  color: var(--brand-700);
  text-decoration: underline;
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
  .auth-form {
    padding: 28px 22px;
  }
}
</style>
