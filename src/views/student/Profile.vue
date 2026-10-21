<script setup>
/**
 * 个人资料（分支 stu-pc-profile）
 *
 * ★ 2026-10-15 整体接真接口、去演示数据（新注册白号必须显示空态，不能出现原型假数据）：
 *   - 资料头部/邮箱/手机号 → GET /api/v1/users/me（表 2-14）+ PUT /api/v1/users/me/profile（表 2-7）
 *     手机号 = 登录账号，本页只读展示（换绑走短信验证，后续模块补）；
 *   - 账号标识（学号）/ 学籍认证 → stu-pc 模块 GET/POST /api/v1/auth/certification（表 2-18/2-19）
 *   - 修改密码 → PUT /api/v1/users/me/password（表 2-6），改后强制重新登录
 *   - 通知偏好 → PUT /api/v1/users/me/notify-pref（表 2-16，整体覆盖写入；无读取接口，页面默认全开）
 *   - 注销 → POST /api/v1/users/me/cancel（表 2-9，密码二次验证）
 * 原则：接口失败如实报错（拦截器统一提示），绝不本地假装成功。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { getMe, updateProfile, changePassword, updateNotifyPref, cancelAccount } from '@/api/student/profile'
import { getCertStatus, submitCertification, changeEmail, changePhone, sendBindCode, deviceList, kickDevice } from '@/api/student/account'
import { uploadAvatar } from '@/api/student/profile'
import { useUserStore } from '@/store/user'

const router = useRouter()
const userStore = useUserStore()

/* ---------------- 我的资料（真实数据；未填 = 空态） ---------------- */
const me = ref(null)
const loaded = ref(false)
const nickName = ref('')
const loading = ref(false)

const avatarText = computed(() => (nickName.value || '学').slice(0, 1))

const maskPhone = (p) => {
  if (!p) return '未绑定'
  return /^\d{11}$/.test(p) ? p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : p
}

/* ---------------- 学籍认证（stu-pc 模块） ---------------- */
const cert = ref(null)
const certLoading = ref(false)
const certForm = ref({ realName: '', idCard: '', schoolName: '', deptName: '', userNo: '' })
const certified = computed(() => cert.value?.status === 'certified')

/* ---------------- 通知偏好 ---------------- */
const notify = ref({ homework: true, live: true, notice: true })
const notifySaving = ref(false)

/* ---------------- 头像（依赖 MinIO 对象存储，未部署） ---------------- */
/* ---------------- ★ 2026-10-20 头像上传（本地存储已启用） ---------------- */
const avatarLoading = ref(false)
function pickAvatar() {
  if (avatarLoading.value) return
  const el = document.createElement('input')
  el.type = 'file'
  el.accept = 'image/*'
  el.onchange = async () => {
    const f = el.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) {
      ElMessage.warning('头像不能超过 5MB')
      return
    }
    avatarLoading.value = true
    try {
      await uploadAvatar(f)
      ElMessage.success('头像已更新')
      await load()
      userStore.fetchInfo().catch(() => {})
    } catch {
      ElMessage.error('头像上传失败，请重试')
    } finally {
      avatarLoading.value = false
    }
  }
  el.click()
}

/* ---------------- 保存资料（昵称；邮箱走绑定弹窗、手机号走换绑弹窗） ---------------- */
async function save() {
  if (!nickName.value.trim()) {
    ElMessage.warning('昵称不能为空')
    return
  }
  loading.value = true
  try {
    await updateProfile({ nickName: nickName.value.trim() })
    ElMessage.success('个人资料已保存')
    await load()
    // 顶栏昵称同步
    userStore.fetchInfo().catch(() => {})
  } catch {
    // 失败原因由拦截器统一提示
  } finally {
    loading.value = false
  }
}

/* ---------------- 绑定/换绑弹窗（邮箱 / 手机号，均需验证码） ---------------- */
const bindVisible = ref(false)
/** 'email' | 'phone' */
const bindKind = ref('email')
const bindValue = ref('')
const bindCode = ref('')
const bindSaving = ref(false)
const cd = ref({ email: 0, phone: 0 })
/** 演示期后端回显的验证码（页面内固定展示） */
const bindDemoCode = ref('')

function openBind(kind) {
  bindKind.value = kind
  bindValue.value = ''
  bindCode.value = ''
  bindDemoCode.value = ''
  bindVisible.value = true
}

async function sendCodeForBind() {
  const kind = bindKind.value
  const v = bindValue.value.trim()
  if (kind === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return ElMessage.warning('请输入正确的邮箱地址')
  } else {
    if (!/^1[3-9]\d{9}$/.test(v)) return ElMessage.warning('请输入正确的 11 位手机号')
  }
  if (cd.value[kind] > 0) return
  try {
    const d = await sendBindCode(v, kind === 'email' ? 'email' : 'phone', kind === 'email' ? 'bind_email' : 'bind_phone')
    cd.value[kind] = 60
    const tk = setInterval(() => {
      cd.value[kind]--
      if (cd.value[kind] <= 0) clearInterval(tk)
    }, 1000)
    bindDemoCode.value = d?.code || ''
    ElMessage.success('验证码已发送')
  } catch {
    // 限流等由拦截器提示
  }
}

async function submitBind() {
  const kind = bindKind.value
  const v = bindValue.value.trim()
  if (!v) return ElMessage.warning(kind === 'email' ? '请输入邮箱' : '请输入手机号')
  if (!bindCode.value.trim()) return ElMessage.warning('请输入验证码')
  bindSaving.value = true
  try {
    if (kind === 'email') {
      await changeEmail({ email: v, code: bindCode.value.trim() })
      ElMessage.success('邮箱已更新')
    } else {
      await changePhone({ phone: v, code: bindCode.value.trim() })
      ElMessage.success('手机号已换绑')
    }
    bindVisible.value = false
    await load()
  } catch {
    // 409 邮箱被占用 / 422 验证码无效等由拦截器提示
  } finally {
    bindSaving.value = false
  }
}

/* ---------------- 提交学籍认证 ---------------- */
async function submitCert() {
  const f = certForm.value
  if (!f.realName.trim()) return ElMessage.warning('请填写真实姓名')
  if (!/^\d{17}[\dXx]$/.test(f.idCard.trim())) return ElMessage.warning('请输入正确的 18 位身份证号')
  if (!f.schoolName.trim()) return ElMessage.warning('请填写学校')
  if (!f.deptName.trim()) return ElMessage.warning('请填写院系')
  if (!f.userNo.trim()) return ElMessage.warning('请填写学号')
  certLoading.value = true
  try {
    await submitCertification({
      realName: f.realName.trim(),
      idCard: f.idCard.trim(),
      schoolName: f.schoolName.trim(),
      deptName: f.deptName.trim(),
      userNo: f.userNo.trim()
    })
    ElMessage.success('学籍认证已提交')
    await loadCert()
  } catch {
    // 比对不通过（reason 提示）等错误由拦截器统一提示
  } finally {
    certLoading.value = false
  }
}

/* ---------------- 修改密码（改后强制重新登录） ---------------- */
const pwdVisible = ref(false)
const pwd = ref({ old: '', neu: '', confirm: '' })
async function submitPwd() {
  if (!pwd.value.old || !pwd.value.neu) {
    ElMessage.warning('请填写原密码与新密码')
    return
  }
  if (pwd.value.neu.length < 6) {
    ElMessage.warning('新密码不少于 6 位')
    return
  }
  if (pwd.value.neu !== pwd.value.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  try {
    await changePassword({ oldPassword: pwd.value.old, newPassword: pwd.value.neu })
  } catch {
    return // 旧密码错误等由拦截器提示
  }
  pwdVisible.value = false
  pwd.value = { old: '', neu: '', confirm: '' }
  ElMessage.success('密码已修改，请用新密码重新登录')
  await userStore.logout()
  router.push('/login')
}

/* ---------------- 通知偏好 ---------------- */
async function saveNotify() {
  notifySaving.value = true
  try {
    await updateNotifyPref({ pref: { ...notify.value } })
    ElMessage.success('通知偏好已保存')
  } catch {
    // 拦截器统一提示
  } finally {
    notifySaving.value = false
  }
}

/* ---------------- 退出 / 注销 ---------------- */
async function doLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录？', '退出登录', { confirmButtonText: '退出', cancelButtonText: '取消' })
  } catch {
    return
  }
  await userStore.logout()
  router.push('/login')
}

async function doCancel() {
  let pwdInput = ''
  try {
    const r = await ElMessageBox.prompt(
      '注销后账号将不可登录，学习记录保留 30 天，期间可联系客服恢复。请输入登录密码确认注销：',
      '注销账户',
      {
        confirmButtonText: '确定注销',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '请输入登录密码',
        type: 'warning'
      }
    )
    pwdInput = r.value
  } catch {
    return
  }
  if (!pwdInput) {
    ElMessage.warning('请输入登录密码')
    return
  }
  try {
    await cancelAccount({ password: pwdInput, reason: '用户主动注销' })
  } catch {
    return // 密码错误等由拦截器提示
  }
  ElMessage.success('账号已注销')
  await userStore.logout()
  router.push('/login')
}

/* ---------------- 数据加载 ---------------- */
async function loadCert() {
  try {
    cert.value = await getCertStatus()
  } catch {
    cert.value = null
  }
}
async function load() {
  try {
    const d = await getMe()
    me.value = d || null
    nickName.value = d?.nickName || ''
  } catch {
    me.value = null
  } finally {
    loaded.value = true
  }
  await loadCert()
  loadDevices()
}

/* ---------------- 登录设备（表 2-20 / 2-21） ---------------- */
const devices = ref([])
const devLoading = ref(false)

/** 时间显示：2026-10-19 09:30 */
function fmtDev(t) {
  if (!t) return '—'
  return String(t).replace('T', ' ').slice(0, 16)
}

async function loadDevices() {
  if (devLoading.value) return
  devLoading.value = true
  try {
    const d = await deviceList()
    devices.value = Array.isArray(d) ? d : d?.list || []
  } catch {
    devices.value = []
  } finally {
    devLoading.value = false
  }
}

/** 远程下线（踢掉对方会话，需二次确认） */
async function kick(d) {
  try {
    await ElMessageBox.confirm(
      `确定下线「${d.deviceName || '该设备'}」吗？下线后该设备需重新登录。`,
      '远程下线设备',
      { confirmButtonText: '下线', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await kickDevice(d.deviceRowId)
    ElMessage.success('该设备已下线')
    await loadDevices()
  } catch {
    // 403 越权等由拦截器提示
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="!loaded">
    <PageHeader title="个人资料" desc="资料编辑 / 学籍认证 / 账号安全 / 通知偏好" />

    <div class="two-col">
      <div class="stack">
        <!-- 个人资料 -->
        <el-card shadow="never">
          <div class="pf-head">
            <span class="avatar" title="点击更换头像" @click="pickAvatar">
              <img v-if="me?.avatar" :src="me.avatar" class="av-img" alt="头像" />
              <template v-else>{{ avatarText }}</template>
              <span class="cam"><BaseIcon name="camera" :size="11" /></span>
            </span>
            <div style="flex: 1">
              <div class="row" style="gap: 8px">
                <el-input v-model="nickName" class="name-input" placeholder="设置昵称" />
                <el-button :loading="loading" @click="save"><BaseIcon name="save" :size="14" />保存</el-button>
              </div>
              <div class="small muted mt8">
                {{ me?.roleGroup || '学生' }} ·
                <template v-if="certified">{{ cert?.deptName || me?.deptName || '已认证' }}</template>
                <template v-else>未认证</template>
              </div>
            </div>
          </div>
          <el-divider />
          <div class="pf-row">
            <span class="k">账号标识</span>
            <template v-if="certified">
              <span>学号 {{ cert?.userNo || '—' }}</span>
            </template>
            <template v-else>
              <el-tag type="info" effect="plain" size="small">未认证</el-tag>
            </template>
          </div>
          <div class="pf-row">
            <span class="k">邮箱</span>
            <div class="row" style="gap: 10px">
              <span :class="{ muted: !me?.email }">{{ me?.email || '未绑定' }}</span>
              <el-button size="small" text type="primary" @click="openBind('email')">
                {{ me?.email ? '修改' : '绑定' }}
              </el-button>
            </div>
          </div>
          <div class="pf-row">
            <span class="k">手机号</span>
            <div class="row" style="gap: 10px">
              <span>{{ maskPhone(me?.phone) }}</span>
              <span class="small muted">（登录账号）</span>
              <el-button size="small" text type="primary" @click="openBind('phone')">换绑</el-button>
            </div>
          </div>
          <div class="pf-row">
            <span class="k">账号状态</span>
            <el-tag type="success" effect="light">正常</el-tag>
          </div>
        </el-card>

        <!-- 学籍认证 -->
        <el-card shadow="never">
          <div class="between">
            <div class="card-title no-margin">学籍认证</div>
            <el-tag v-if="certified" type="success" effect="light">已认证</el-tag>
            <el-tag v-else type="info" effect="plain">未认证</el-tag>
          </div>

          <template v-if="certified">
            <div class="pf-row mt12"><span class="k">姓名</span><span>{{ cert?.realName || me?.nickName || '—' }}</span></div>
            <div class="pf-row"><span class="k">学号</span><span>{{ cert?.userNo || '—' }}</span></div>
            <div class="pf-row"><span class="k">学校</span><span>{{ cert?.schoolName || me?.deptName || '—' }}</span></div>
            <div class="pf-row"><span class="k">院系</span><span>{{ cert?.deptName || '—' }}</span></div>
            <div class="pf-row"><span class="k">证件号</span><span>{{ cert?.idCardMasked || '—' }}</span></div>
          </template>

          <template v-else>
            <div class="small muted mt8">填写与学籍档案一致的学籍信息，认证通过后即可加入课程与查看课表。</div>
            <div v-if="cert?.reason" class="cert-reason">
              <BaseIcon name="info" :size="13" />上次认证未通过：{{ cert.reason }}
            </div>
            <div class="grid g2 mt12">
              <el-input v-model="certForm.realName" placeholder="真实姓名（与身份证一致）" />
              <el-input v-model="certForm.idCard" placeholder="18 位身份证号" maxlength="18" />
            </div>
            <div class="grid g3 mt12">
              <el-input v-model="certForm.schoolName" placeholder="学校（如：贵州大学）" />
              <el-input v-model="certForm.deptName" placeholder="院系（如：计算机学院）" />
              <el-input v-model="certForm.userNo" placeholder="学号" />
            </div>
            <el-button type="primary" class="mt12" :loading="certLoading" @click="submitCert">
              <BaseIcon name="badge-check" :size="14" />提交认证
            </el-button>
          </template>
        </el-card>
      </div>

      <div class="stack">
        <!-- 账号安全 -->
        <el-card shadow="never">
          <div class="between">
            <div class="card-title no-margin">账号安全</div>
            <el-button size="small" @click="pwdVisible = true"><BaseIcon name="lock" :size="13" />修改密码</el-button>
          </div>
          <div class="small muted mt8">修改密码后需使用新密码重新登录</div>
        </el-card>

        <!-- 登录设备（表 2-20 / 2-21） -->
        <el-card shadow="never">
          <div class="between">
            <div class="card-title no-margin">登录设备</div>
            <el-button size="small" text :loading="devLoading" @click="loadDevices">
              <BaseIcon name="refresh-cw" :size="13" />刷新
            </el-button>
          </div>
          <div class="small muted mt8">发现陌生设备可立即下线，下线后对方需重新登录</div>
          <div v-if="devices.length" class="dev-list">
            <div v-for="d in devices" :key="d.deviceRowId" class="dev-row">
              <span class="dev-ic"><BaseIcon name="smartphone" :size="16" /></span>
              <div style="flex: 1; min-width: 0">
                <div class="dev-name">
                  {{ d.deviceName || '未知设备' }}
                  <el-tag v-if="d.current" size="small" type="success" effect="light">当前设备</el-tag>
                </div>
                <div class="small muted dev-meta">
                  {{ d.osVersion || '—' }} · IP {{ d.loginIp || '—' }} · {{ fmtDev(d.loginAt) }}
                </div>
              </div>
              <el-button v-if="!d.current" size="small" class="kick" @click="kick(d)">下线</el-button>
            </div>
          </div>
          <div v-else class="small muted" style="padding: 8px 0">暂无登录设备记录</div>
        </el-card>

        <!-- 通知偏好 -->
        <el-card shadow="never">
          <div class="card-title">通知偏好</div>
          <div class="pref"><span>作业与批改通知</span><el-switch v-model="notify.homework" /></div>
          <div class="pref"><span>课堂与签到通知</span><el-switch v-model="notify.live" /></div>
          <div class="pref"><span>平台公告通知</span><el-switch v-model="notify.notice" /></div>
          <el-button class="mt12" :loading="notifySaving" @click="saveNotify"><BaseIcon name="save" :size="14" />保存偏好</el-button>
        </el-card>

        <!-- 危险操作 -->
        <el-card shadow="never">
          <div class="card-title">账号操作</div>
          <div class="row" style="gap: 10px; flex-wrap: wrap">
            <el-button @click="doLogout"><BaseIcon name="log-out" :size="14" />退出登录</el-button>
            <el-button class="danger" @click="doCancel"><BaseIcon name="user-x" :size="14" />注销账户</el-button>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 绑定 / 换绑（邮箱 / 手机号，均带验证码） -->
    <el-dialog
      v-model="bindVisible"
      :title="bindKind === 'email' ? (me?.email ? '修改邮箱' : '绑定邮箱') : '换绑手机号'"
      width="440px"
    >
      <div class="field-label">{{ bindKind === 'email' ? '新邮箱' : '新手机号' }}</div>
      <el-input
        v-model="bindValue"
        :placeholder="bindKind === 'email' ? '请输入新邮箱地址' : '请输入新的 11 位手机号'"
        :maxlength="bindKind === 'email' ? 64 : 11"
      />
      <div class="field-label mt12">验证码</div>
      <div class="row" style="gap: 10px">
        <el-input v-model="bindCode" placeholder="6 位验证码" maxlength="6" style="flex: 1" />
        <el-button :disabled="cd[bindKind] > 0" @click="sendCodeForBind">
          {{ cd[bindKind] > 0 ? cd[bindKind] + ' 秒后重发' : '获取验证码' }}
        </el-button>
      </div>
      <div v-if="bindDemoCode" class="demo-code">
        <BaseIcon name="info" :size="13" />
        演示验证码：<b>{{ bindDemoCode }}</b>
        <span class="muted">（演示环境为模拟发送）</span>
      </div>
      <div class="small muted mt8">
        {{ bindKind === 'email' ? '验证码将发送至新邮箱，验证通过后完成绑定。' : '验证码将发送至新手机号；手机号同时是登录账号，换绑后请使用新号登录。' }}
      </div>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="bindSaving" @click="submitBind">
          {{ bindKind === 'email' ? '确认修改' : '确认换绑' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 修改密码 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <div class="field-label">原密码</div>
      <el-input v-model="pwd.old" type="password" show-password placeholder="请输入原密码" />
      <div class="field-label mt12">新密码</div>
      <el-input v-model="pwd.neu" type="password" show-password placeholder="6 位以上" />
      <div class="field-label mt12">确认新密码</div>
      <el-input v-model="pwd.confirm" type="password" show-password placeholder="再次输入新密码" />
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPwd">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.two-col {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 18px;
  align-items: start;
}
.pf-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.avatar {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--primary-soft);
  color: var(--brand-700);
  font-size: 20px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.avatar .cam {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--brand-600);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.name-input {
  max-width: 220px;
}
.name-input :deep(input) {
  font-size: 16px;
  font-weight: 700;
}
.pf-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 13.5px;
  gap: 12px;
}
.pf-row:last-child {
  border-bottom: none;
}
.pf-row .k {
  color: var(--ink-500);
  flex: none;
}
.row-input {
  max-width: 280px;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.card-title.no-margin {
  margin-bottom: 0;
}
.pref {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  font-size: 13.5px;
}
.danger {
  color: var(--error);
  border-color: #fca5a5;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 6px;
}
.mt12 {
  margin-top: 12px;
}
.mt8 {
  margin-top: 8px;
}
.cert-reason {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: var(--error);
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
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
.av-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.dev-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.dev-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed var(--border);
}
.dev-row:last-child {
  border-bottom: none;
}
.dev-ic {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--r-md);
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dev-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-800, var(--ink-700));
}
.dev-meta {
  margin-top: 2px;
  word-break: break-all;
}
.kick {
  color: var(--error);
  border-color: #fca5a5;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
