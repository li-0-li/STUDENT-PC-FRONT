<script setup>
/**
 * 注册页（接口文档 表 2-2 POST /api/v1/auth/register）
 * ★ 1:1 还原 ui-prototype/pc/register.html（结构 / 字段 / 文案 / 交互逐块对齐）
 *
 * 说明：表 2-2 属公共域（M-A），后端尚未实现。当前按**原型行为**走前端校验与提示；
 * 待接口就绪后，把 doRegister 里的原型提示替换为 registerApi 调用即可（字段与原型一致）。
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'

const route = useRoute()
const router = useRouter()

/* ---------- 身份（照原型 CFG） ---------- */
const CFG = {
  teacher: {
    sub: '教师注册需管理员审核，审核通过后短信通知开通',
    ok: '教师注册申请已提交！\n\n管理员审核通过后将短信通知开通。\n\n登录后可于「个人资料 → 实名认证」绑定所在学校 / 院系 / 工号，认证通过后方可开课。'
  },
  student: {
    sub: '学生注册成功后即可用课程码加入课程',
    ok: '注册成功！\n\n已为您开通学习账号，请使用手机号 + 短信验证码登录。\n\n登录后可于「个人资料 → 学籍认证」绑定所在学校 / 院系 / 学号，认证通过后方可加入课程与查看课表。'
  }
}
const ROLE = ref('teacher')
const roleMeta = [
  { key: 'teacher', name: '教师', desc: '提交申请 · 管理员审核', icon: 'presentation' },
  { key: 'student', name: '学生', desc: '注册即用 · 课程码加课', icon: 'graduation-cap' }
]
function pickRole(key) {
  ROLE.value = key
}

/* ---------- 表单 ---------- */
const name = ref('')
const idNo = ref('')
const phone = ref('')
const code = ref('')
const mail = ref('')
const agree = ref(true)
const loading = ref(false)

/* ---------- 短信验证码（演示行为照原型：验证码 123456 + 60s 倒计时） ---------- */
const CD = ref(0)
const codeBtnText = ref('获取验证码')
function sendCode() {
  const p = phone.value.trim()
  if (!/^1[3-9]\d{9}$/.test(p)) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (CD.value > 0) return
  CD.value = 60
  codeBtnText.value = '60 秒后重发'
  const tk = setInterval(() => {
    CD.value--
    if (CD.value <= 0) {
      clearInterval(tk)
      codeBtnText.value = '获取验证码'
    } else {
      codeBtnText.value = CD.value + ' 秒后重发'
    }
  }, 1000)
  ElMessage.success(
    '验证码已发送至 ' + p.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') + '（演示环境验证码：123456）'
  )
}

/* ---------- 注册（校验规则照原型） ---------- */
async function doRegister() {
  if (!name.value.trim()) {
    ElMessage.warning('请填写姓名')
    return
  }
  if (!/^\d{17}[\dXx]$/.test(idNo.value.trim())) {
    ElMessage.warning('请输入正确的 18 位身份证号')
    return
  }
  if (!/^1[3-9]\d{9}$/.test(phone.value.trim())) {
    ElMessage.warning('请输入正确的 11 位手机号')
    return
  }
  if (code.value.trim() !== '123456') {
    ElMessage.error('短信验证码错误（演示环境请输入 123456）')
    return
  }
  if (!agree.value) {
    ElMessage.warning('请先阅读并同意《平台服务协议》与《隐私政策》')
    return
  }
  loading.value = true
  try {
    await ElMessageBox.alert(CFG[ROLE.value].ok, ROLE.value === 'teacher' ? '申请已提交' : '注册成功', {
      confirmButtonText: '去登录'
    })
    router.push('/login')
  } finally {
    loading.value = false
  }
}

/* ---------- URL 参数支持（照原型）：?role=teacher|student ---------- */
onMounted(() => {
  const r = route.query.role
  if (r && CFG[r]) ROLE.value = r
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
        <p>教师 · 学生自助注册</p>
      </div>

      <div class="auth-form">
        <h2>注册账号</h2>
        <p class="sub">{{ CFG[ROLE].sub }}</p>

        <!-- 身份选择：教师 / 学生（管理员不开放自助注册） -->
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

        <div class="admin-note">
          <BaseIcon name="info" :size="14" />
          <span><b>管理员账号不开放自助注册。</b>管理员由系统管理员在「账号管理 → 新增账号」中创建并分配角色权限。注册只需填写真实<b>姓名、身份证号、手机号</b>三项（邮箱选填），<b>学校 / 院系 / 学号（工号）将在登录后于「个人资料 → 实名认证」中绑定</b>。</span>
        </div>

        <div class="field">
          <label>姓名</label>
          <input v-model="name" class="input" placeholder="请输入与身份证一致的真实姓名" />
        </div>

        <div class="field">
          <label>身份证号</label>
          <input v-model="idNo" class="input" placeholder="18 位居民身份证号" maxlength="18" />
        </div>

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
          <div class="small muted" style="margin-top: 6px">演示环境验证码固定为 <b>123456</b></div>
        </div>

        <div class="field">
          <label>邮箱（选填，注册后可在个人资料绑定）</label>
          <input v-model="mail" class="input" placeholder="例：name@itap.edu.cn" />
        </div>

        <div class="row small muted" style="gap: 6px; margin: 4px 0 14px; line-height: 1.6">
          <input id="rgAgree" v-model="agree" type="checkbox" style="margin-top: 2px" />
          <label for="rgAgree" style="cursor: pointer">我已阅读并同意《平台服务协议》与《隐私政策》</label>
        </div>

        <button class="btn btn-primary btn-block" style="padding: 12px" :disabled="loading" @click="doRegister">
          {{ loading ? '提交中…' : '注 册' }}
        </button>
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

/* ===== 身份卡片（2 列，对齐 register.html 内联样式） ===== */
.role-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 2px 0 12px;
}
.role-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
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

/* ===== 管理员说明（对齐 register.html 内联样式） ===== */
.admin-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  color: var(--ink-500);
  background: var(--bg-subtle);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 18px;
  line-height: 1.65;
}
.admin-note svg {
  flex: none;
  margin-top: 2px;
  color: var(--ink-400);
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
