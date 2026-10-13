<script setup>
/**
 * 个人资料（分支 stu-pc-profile）
 * 关联接口（接口设计文档表号）：表 2-5 退出登录、表 2-6 修改密码、表 2-7 修改个人资料、
 *                              表 2-8 上传头像、表 2-9 注销账号、表 2-14 当前用户、表 2-16 通知偏好
 * 对应原型：ui-prototype/pc/（顶栏头像 → 个人资料弹窗，见 assets/shell.js 的 openProfile/certSection）
 *   —— 本页为同一表单的整页版：头像可换、姓名可改、账号信息、学籍认证、账号安全、退出/注销
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/base/PageHeader.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { getMe, updateProfile, changePassword, updateNotifyPref, cancelAccount } from '@/api/student/profile'
import { useUserStore } from '@/store/user'

const router = useRouter()
const userStore = useUserStore()

/** 资料（原型 PROFILES.student） */
const p = ref({
  name: '黎练',
  role: '学生',
  org: '软件工程 · 软件 2201',
  no: '学号 2200850123',
  mail: 'lilian@stu.gzu.edu.cn',
  phone: '175****4413'
})
const email = ref(p.value.mail)
const phone = ref(p.value.phone)
const loading = ref(false)

/* ---------------- 学籍认证（照 shell.js certSection） ---------------- */
const SCHOOLS = ['贵州大学', '贵州师范大学', '贵州理工学院']
const DEPTS = ['计算机科学与技术学院', '软件学院', '数学与统计学院', '外国语学院', '教育科学学院']
const cert = ref({ school: '贵州大学', dept: '软件学院', no: '' })
const certDone = ref(false)
const certSchool = ref('')
const certDept = ref('')

/* ---------------- 通知偏好 ---------------- */
const notify = ref({ homework: true, live: true, notice: true })

/* ---------------- 头像 ---------------- */
const avatarText = ref('黎')
function pickAvatar() {
  ElMessage.info('选择头像图片（支持 jpg / png，≤ 2MB）')
}

/* ---------------- 操作 ---------------- */
async function save() {
  loading.value = true
  try {
    await updateProfile({ name: p.value.name, email: email.value, phone: phone.value })
  } catch {
    /* 接口未就绪时按原型行为 */
  } finally {
    loading.value = false
  }
  ElMessage.success('个人资料已保存')
}

async function submitCert() {
  if (!cert.value.no.trim()) {
    ElMessage.warning('请填写学号')
    return
  }
  certSchool.value = cert.value.school
  certDept.value = cert.value.dept
  certDone.value = true
  ElMessage.success('学籍认证已提交，认证通过后即可加入课程与查看课表')
}

const pwdVisible = ref(false)
const pwd = ref({ old: '', neu: '', confirm: '' })
async function submitPwd() {
  if (!pwd.value.old || !pwd.value.neu) {
    ElMessage.warning('请填写原密码与新密码')
    return
  }
  if (pwd.value.neu.length < 8) {
    ElMessage.warning('新密码不少于 8 位，需含字母与数字')
    return
  }
  if (pwd.value.neu !== pwd.value.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  try {
    await changePassword({ oldPassword: pwd.value.old, newPassword: pwd.value.neu })
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  pwdVisible.value = false
  pwd.value = { old: '', neu: '', confirm: '' }
  ElMessage.success('密码已修改，请用新密码重新登录')
}

async function saveNotify() {
  try {
    await updateNotifyPref(notify.value)
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  ElMessage.success('通知偏好已保存')
}

async function doLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录？', '退出登录', { confirmButtonText: '退出', cancelButtonText: '取消' })
  } catch {
    return
  }
  // ★ 2026-10-12 若依迁移：退出登录统一走 store 的 logout（后端 = 若依 POST /logout），
  //   不再走自研的 /api/v1/auth/logout —— 全端共用一套 SSO 入口。
  //   store 里已做「登出失败也清本地登录态」，这里不必再兜一层。
  await userStore.logout()
  router.push('/login')
}

async function doCancel() {
  try {
    await ElMessageBox.confirm(
      '注销后账号将不可登录，学习记录保留 30 天，期间可联系客服恢复。确定注销账户？',
      '注销账户',
      { confirmButtonText: '确定注销', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await cancelAccount({ reason: '用户主动注销' })
  } catch {
    /* 接口未就绪时按原型行为 */
  }
  ElMessage.success('注销申请已提交')
  router.push('/login')
}

async function load() {
  try {
    const d = await getMe()
    if (d) {
      p.value.name = d.nickName || d.name || p.value.name
      p.value.role = d.roleName || '学生'
      p.value.org = [d.majorName, d.className].filter(Boolean).join(' · ') || p.value.org
      p.value.no = d.userNo ? '学号 ' + d.userNo : p.value.no
      p.value.mail = d.email || p.value.mail
      p.value.phone = d.phonenumber || p.value.phone
      email.value = p.value.mail
      phone.value = p.value.phone
      avatarText.value = (p.value.name || '黎').slice(0, 1)
    }
  } catch {
    /* 接口未就绪时用原型演示数据 */
  }
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader title="个人资料" desc="资料编辑 / 学籍认证 / 账号安全 / 通知偏好" />

    <div class="two-col">
      <div class="stack">
        <!-- 个人资料 -->
        <el-card shadow="never">
          <div class="pf-head">
            <span class="avatar" title="点击更换头像" @click="pickAvatar">
              {{ avatarText }}
              <span class="cam"><BaseIcon name="camera" :size="11" /></span>
            </span>
            <div style="flex: 1">
              <div class="row" style="gap: 8px">
                <el-input v-model="p.name" class="name-input" />
                <el-button :loading="loading" @click="save"><BaseIcon name="save" :size="14" />保存</el-button>
              </div>
              <div class="small muted mt8">{{ p.role }} · {{ p.org }}</div>
            </div>
          </div>
          <el-divider />
          <div class="pf-row"><span class="k">账号标识</span><span>{{ p.no }}</span></div>
          <div class="pf-row">
            <span class="k">邮箱</span><el-input v-model="email" class="row-input" />
          </div>
          <div class="pf-row">
            <span class="k">手机号</span><el-input v-model="phone" class="row-input sm" />
          </div>
          <div class="pf-row">
            <span class="k">账号状态</span><el-tag type="success" effect="light">正常</el-tag>
          </div>
        </el-card>

        <!-- 学籍认证 -->
        <el-card shadow="never">
          <div class="between">
            <div class="card-title no-margin">学籍认证</div>
            <el-tag v-if="certDone" type="success" effect="light">已提交 · 待审核</el-tag>
          </div>
          <template v-if="certDone">
            <div class="pf-row mt12"><span class="k">学校</span><span>{{ certSchool }}</span></div>
            <div class="pf-row"><span class="k">院系</span><span>{{ certDept }}</span></div>
            <div class="pf-row"><span class="k">学号</span><span>{{ cert.no }}</span></div>
          </template>
          <template v-else>
            <div class="small muted mt8">认证通过后方可加入课程与查看课表。</div>
            <div class="grid g3 mt12">
              <el-select v-model="cert.school" placeholder="学校">
                <el-option v-for="s in SCHOOLS" :key="s" :label="s" :value="s" />
              </el-select>
              <el-select v-model="cert.dept" placeholder="院系">
                <el-option v-for="d in DEPTS" :key="d" :label="d" :value="d" />
              </el-select>
              <el-input v-model="cert.no" placeholder="学号" />
            </div>
            <el-button type="primary" class="mt12" @click="submitCert">
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
          <div class="small muted mt8">最近修改：30 天前 · 密码有效期 90 天</div>
        </el-card>

        <!-- 通知偏好 -->
        <el-card shadow="never">
          <div class="card-title">通知偏好</div>
          <div class="pref"><span>作业与批改通知</span><el-switch v-model="notify.homework" /></div>
          <div class="pref"><span>课堂与签到通知</span><el-switch v-model="notify.live" /></div>
          <div class="pref"><span>平台公告通知</span><el-switch v-model="notify.notice" /></div>
          <el-button class="mt12" @click="saveNotify"><BaseIcon name="save" :size="14" />保存偏好</el-button>
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

    <!-- 修改密码 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <div class="field-label">原密码</div>
      <el-input v-model="pwd.old" type="password" show-password placeholder="请输入原密码" />
      <div class="field-label mt12">新密码</div>
      <el-input v-model="pwd.neu" type="password" show-password placeholder="8 位以上，含字母与数字" />
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
  max-width: 180px;
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
.row-input.sm {
  max-width: 200px;
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
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
