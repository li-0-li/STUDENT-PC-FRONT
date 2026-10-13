<script setup>
/**
 * 找回密码（三步验证重置）
 * ★ 1:1 还原 ui-prototype/pc/forgot-password.html（布局 / 三步骤 / 文案 / 校验逐块对齐）
 *
 * 接口：表 2-3 发送验证码 POST /api/v1/auth/captcha/send（公共域 M-A，后端未实现）
 *       表 2-4 重置密码   POST /api/v1/auth/password/reset（同上）
 * 当前按**原型行为**走前端校验与提示；接口就绪后可把 toStep3 的成功分支换成 resetPassword 调用。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'

const router = useRouter()

/* ---------- 步骤控制（照原型 go/mark） ---------- */
const step = ref(1)
const steps = [
  { n: 1, label: '验证账号' },
  { n: 2, label: '设置新密码' },
  { n: 3, label: '完成' }
]

/* ---------- 表单 ---------- */
const account = ref('')
const phone = ref('')
const code = ref('')
const pwd1 = ref('')
const pwd2 = ref('')

/* ---------- 短信验证码（照原型：60s 倒计时 + 演示验证码 123456） ---------- */
const CD = ref(0)
const codeBtnText = ref('获取验证码')
function sendCode() {
  const p = phone.value.trim()
  if (!p) {
    ElMessage.warning('请先输入绑定手机号')
    return
  }
  if (!/^1[3-9]\d{9}$/.test(p)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (CD.value > 0) return
  CD.value = 60
  codeBtnText.value = '60s 后重发'
  const tk = setInterval(() => {
    CD.value--
    if (CD.value < 0) {
      clearInterval(tk)
      codeBtnText.value = '获取验证码'
    } else {
      codeBtnText.value = CD.value + 's 后重发'
    }
  }, 1000)
  ElMessage.success('验证码已发送至 ' + p + '（原型演示：123456）')
}

/* ---------- 密码强度（照原型 strength：弱 / 较弱 / 中等 / 较强 / 强） ---------- */
const strengthMap = computed(() => {
  const v = pwd1.value
  if (!v) return { text: '未输入', color: 'var(--ink-400)', score: 0 }
  let s = 0
  if (v.length >= 8) s++
  if (/[A-Z]/.test(v)) s++
  if (/[0-9]/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v)) s++
  const txt = ['弱', '较弱', '中等', '较强', '强'][s]
  const color = ['var(--ink-400)', 'var(--error)', 'var(--warning)', 'var(--brand-600)', 'var(--success)'][s]
  return { text: txt, color, score: s }
})

const matchTip = computed(() => {
  if (!pwd2.value) return ''
  return pwd1.value === pwd2.value ? '两次输入一致' : '两次输入不一致'
})
const matchOk = computed(() => !!pwd2.value && pwd1.value === pwd2.value)

/* ---------- 步骤流转（照原型 toStep2 / toStep3） ---------- */
function toStep2() {
  if (!account.value.trim()) {
    ElMessage.warning('请输入账号')
    return
  }
  if (!/^1[3-9]\d{9}$/.test(phone.value.trim())) {
    ElMessage.warning('请输入正确的手机号')
    return
  }
  if (code.value.trim().length < 4) {
    ElMessage.warning('请输入短信验证码')
    return
  }
  step.value = 2
}
function toStep3() {
  if (pwd1.value.length < 8) {
    ElMessage.warning('新密码需 8 位以上')
    return
  }
  if (strengthMap.value.score < 2) {
    ElMessage.warning('密码强度不足，请包含字母与数字')
    return
  }
  if (pwd1.value !== pwd2.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  step.value = 3
  ElMessage.success('密码重置成功，请使用新密码登录')
}
</script>

<template>
  <div class="auth">
    <div class="auth-card">
      <!-- 左侧：品牌叙事 -->
      <div class="auth-hero">
        <div>
          <span class="logo"><BaseIcon name="graduation-cap" :size="24" /></span>
          <h2>找回密码</h2>
          <p>通过绑定的手机号验证身份后重置密码。整个流程通常在 1 分钟内完成。</p>
        </div>
        <div class="ft">智能教学辅助平台 · 安全保障</div>
      </div>

      <!-- 右侧：表单 -->
      <div class="auth-form">
        <h2>验证身份</h2>
        <p class="sub">请填写账号信息并完成短信验证</p>

        <div class="steps">
          <template v-for="(s, i) in steps" :key="s.n">
            <div class="step" :class="{ active: step >= s.n }">
              <span class="num">{{ s.n }}</span><span>{{ s.label }}</span>
            </div>
            <div v-if="i < steps.length - 1" class="sep" :class="{ on: step >= s.n + 1 }" />
          </template>
        </div>

        <!-- 步骤 1 -->
        <div v-show="step === 1">
          <div class="field">
            <label>账号</label>
            <div class="input-ic">
              <BaseIcon name="user" :size="18" />
              <input v-model="account" class="input" placeholder="学号 / 工号 / 管理员账号" />
            </div>
          </div>
          <div class="field">
            <label>绑定手机号</label>
            <div class="input-ic">
              <BaseIcon name="smartphone" :size="18" />
              <input v-model="phone" class="input" placeholder="账号绑定的 11 位手机号" maxlength="11" />
            </div>
          </div>
          <div class="field">
            <label>短信验证码</label>
            <div class="code-row">
              <div class="input-ic">
                <BaseIcon name="shield-check" :size="18" />
                <input v-model="code" class="input" placeholder="6 位验证码" maxlength="6" />
              </div>
              <button class="btn btn-outline" type="button" :disabled="CD > 0" @click="sendCode">
                {{ codeBtnText }}
              </button>
            </div>
          </div>
          <button class="btn btn-primary btn-block" style="justify-content: center; padding: 12px" @click="toStep2">
            下一步
          </button>
          <div class="center mt16"><router-link class="link small" to="/login">← 返回登录</router-link></div>
        </div>

        <!-- 步骤 2 -->
        <div v-show="step === 2">
          <div class="field">
            <label>新密码</label>
            <div class="input-ic">
              <BaseIcon name="lock" :size="18" />
              <input v-model="pwd1" class="input" type="password" placeholder="8 位以上，含字母与数字" />
            </div>
            <div class="small" :style="{ marginTop: '6px', color: strengthMap.color }">
              {{ pwd1 ? '强度：' + strengthMap.text : '未输入' }}
            </div>
          </div>
          <div class="field">
            <label>确认新密码</label>
            <div class="input-ic">
              <BaseIcon name="lock" :size="18" />
              <input v-model="pwd2" class="input" type="password" placeholder="再次输入新密码" />
            </div>
            <div class="small" :style="{ marginTop: '6px', color: matchOk ? 'var(--success)' : 'var(--error)' }">
              {{ matchTip || '\u00a0' }}
            </div>
          </div>
          <button class="btn btn-primary btn-block" style="justify-content: center; padding: 12px" @click="toStep3">
            确认重置
          </button>
          <button class="btn btn-ghost btn-block" style="justify-content: center; margin-top: 8px" @click="step = 1">
            返回上一步
          </button>
        </div>

        <!-- 步骤 3 -->
        <div v-show="step === 3" style="text-align: center; padding: 18px 0 4px">
          <span class="icon-box lg" style="background: var(--success-soft); color: var(--success)">
            <BaseIcon name="circle-check" :size="26" />
          </span>
          <h3 style="margin: 14px 0 6px">密码重置成功</h3>
          <p class="muted small" style="margin: 0">请使用新密码登录</p>
          <button
            class="btn btn-primary btn-block mt16"
            style="justify-content: center; padding: 12px"
            @click="router.push('/login')"
          >
            返回登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== 布局（对齐 forgot-password.html 内联样式） ===== */
.auth {
  background: linear-gradient(135deg, var(--brand-700), var(--brand-600));
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}
.auth-card {
  width: min(960px, 100%);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.3);
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  overflow: hidden;
}
.auth-hero {
  background: linear-gradient(135deg, var(--brand-700), var(--brand-500));
  padding: 48px 36px;
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
}
.auth-hero::after {
  content: '';
  position: absolute;
  inset: auto -30% -40% auto;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
}
.auth-hero .logo {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}
.auth-hero h2 {
  color: #fff;
  font-size: 22px;
  margin-bottom: 8px;
}
.auth-hero p {
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}
.auth-hero .ft {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  position: relative;
  z-index: 1;
}
.auth-form {
  padding: 48px 44px;
  display: flex;
  flex-direction: column;
}
.auth-form h2 {
  font-size: 22px;
  margin: 0 0 6px;
}
.auth-form .sub {
  color: var(--ink-500);
  font-size: 13px;
  margin-bottom: 24px;
}

/* ===== 步骤条 ===== */
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 28px;
}
.steps .step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-500);
}
.steps .step .num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-soft);
  color: var(--ink-500);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.steps .step.active .num {
  background: var(--brand-600);
  color: #fff;
}
.steps .step.active {
  color: var(--ink-900);
  font-weight: 600;
}
.steps .sep {
  flex: 1;
  height: 2px;
  background: var(--bg-soft);
  border-radius: 2px;
  min-width: 24px;
}
.steps .sep.on {
  background: var(--brand-600);
}

/* ===== 表单 ===== */
.field {
  margin-bottom: 18px;
}
.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}
.input {
  width: 100%;
  font-family: inherit;
  font-size: 14px;
  color: var(--ink-900);
  background: #fff;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 11px 14px;
  outline: none;
  transition: 0.15s;
}
.input::placeholder {
  color: var(--ink-400);
}
.input:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.18);
}
.input-ic {
  position: relative;
  display: flex;
  align-items: center;
}
.input-ic > svg {
  position: absolute;
  left: 14px;
  color: var(--ink-400);
  width: 18px;
  height: 18px;
  pointer-events: none;
}
.input-ic .input {
  padding-left: 42px;
}
.code-row {
  display: flex;
  gap: 10px;
}
.code-row .input-ic {
  flex: 1;
}
.code-row .btn {
  flex: none;
  padding: 0 16px;
}

/* ===== 按钮 / 图标盒（对齐 theme.css） ===== */
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
.btn-ghost {
  color: var(--ink-600);
}
.btn-ghost:hover {
  background: var(--bg-soft);
  color: var(--ink-900);
}
.btn-block {
  width: 100%;
}
.icon-box {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-box.lg {
  width: 52px;
  height: 52px;
  border-radius: var(--r-lg);
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

@media (max-width: 780px) {
  .auth-card {
    grid-template-columns: 1fr;
  }
  .auth-hero {
    padding: 24px 22px;
  }
  .auth-form {
    padding: 28px 22px;
  }
}
</style>
