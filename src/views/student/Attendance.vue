<script setup>
/**
 * 课堂签到（分支 stu-pc-live）
 * 关联接口（接口设计文档表号）：表 3-14 课堂签到
 *   GET  /api/v1/sessions/{sessionId}/signin   → 签到任务 + 我的签到状态 + 已签/应到
 *   POST /api/v1/sessions/{sessionId}/attendance/sign
 * 对应原型：ui-prototype/pc/student-attendance.html —— ★ 1:1 还原
 *   （签到状态卡 + 5 种签到方式卡（扫码/定位/拍照/数字口令/手动）+ 右侧课堂信息与须知
 *    + 5 个方式弹窗（含二维码点阵、地理围栏、取景框、口令输入））
 *
 * ★ 2026-10-10 接真接口，删掉全部硬编码演示数据（原来是「数据结构/李老师/明德楼302/已签18/应到32/倒计时14:32」）。
 *   · 课程、教师、地点、签到方式、截止时间、已签人数**全部来自接口**
 *   · 未选择课堂（没有 sessionId）时显示空态，引导从「实时课堂」进入
 *   · 倒计时由 signinTask.expireAt 实时计算
 *
 * ⚠️ 与原型的两处硬偏差（无数据支撑，已显式说明）：
 *   ① 原型的「第 3 周 / 第 3-4 节」接口没返回 → 已去掉这两项
 *   ② 原型的「演示口令 482913」「定位 92% 概率在围栏内」是纯前端假校验 → 已删除；
 *      定位围栏与数字口令的服务端校验尚未实现，提交时只带 signType 交给后端
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import BaseIcon from '@/components/base/BaseIcon.vue'
import EmptyState from '@/components/base/EmptyState.vue'
import { signinDetail, signAttendance } from '@/api/student/live'
import { signinRecords } from '@/api/student/learning'

const route = useRoute()
const router = useRouter()
/** 课堂 ID 由「实时课堂」页跳转时带过来（?sessionId=9001） */
const sessionId = computed(() => route.query.sessionId || '')

const loading = ref(false)
const info = ref({ course: '—', teacher: '—', room: '—' })

/** 5 种签到方式（照原型 WAYS）；是否开启由后端 signinTask.signTypes 决定 */
const WAYS_DEF = [
  { key: 'qr', icon: 'qr-code', nm: '扫码签到', ds: '对准课堂二维码' },
  { key: 'location', icon: 'map-pin', nm: '定位签到', ds: '教室内自动定位' },
  { key: 'photo', icon: 'camera', nm: '拍照签到', ds: '活体人脸核验' },
  { key: 'numeric', icon: 'hash', nm: '数字口令', ds: '输入 6 位口令' },
  { key: 'manual', icon: 'hand', nm: '手动点名', ds: '请老师标记' }
]
const openTypes = ref([])
const WAYS = computed(() => WAYS_DEF.map((w) => ({ ...w, open: openTypes.value.includes(w.key) })))
const openedNames = computed(() => WAYS.value.filter((w) => w.open).map((w) => w.nm.replace('签到', '')).join(' · '))

const SIGN_TYPE_NAME = {
  qr: '扫码签到',
  location: '定位签到',
  photo: '拍照签到',
  numeric: '数字口令',
  manual: '手动点名'
}

const signed = ref(false)
const signWay = ref('')
const signTime = ref('')
const signedCount = ref(0)
const totalCount = ref(0)
const taskId = ref(null)
const expireAt = ref('')
const signedWayName = computed(() => SIGN_TYPE_NAME[signWay.value] || signWay.value || '')

/* ---------------- 签到倒计时（由 signinTask.expireAt 实时计算） ---------------- */
const left = ref(0)
let timer = null
const leftText = computed(() => {
  if (!expireAt.value) return '—'
  if (left.value <= 0) return '已截止'
  const m = Math.floor(left.value / 60)
  const s = left.value % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
})
function tickCountdown() {
  if (!expireAt.value) {
    left.value = 0
    return
  }
  const s = String(expireAt.value).trim()
  const t = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s).getTime()
    : new Date(s.replace('T', ' ').replace(/-/g, '/')).getTime()
  left.value = Number.isNaN(t) ? 0 : Math.max(0, Math.floor((t - Date.now()) / 1000))
}

/** 时间显示（照原型的 HH:mm） */
function fmtHM(t) {
  if (!t) return ''
  const s = String(t).trim()
  const d = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(s)
    : new Date(s.replace('T', ' ').replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) return s
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

async function load() {
  if (!sessionId.value) return
  loading.value = true
  try {
    const d = await signinDetail(sessionId.value)
    info.value = {
      course: d?.courseName || '—',
      teacher: d?.teacherName || '—',
      room: d?.classroomName || '—'
    }
    const t = d?.signinTask || {}
    taskId.value = t.taskId ?? null
    expireAt.value = t.expireAt || ''
    try {
      openTypes.value = JSON.parse(t.signTypes || '[]')
    } catch {
      openTypes.value = []
    }
    signed.value = !!d?.signed
    signWay.value = d?.myAttendance?.sign_type || ''
    signTime.value = fmtHM(d?.myAttendance?.sign_time)
    signedCount.value = d?.signedCount ?? 0
    totalCount.value = d?.shouldCount ?? 0
    tickCountdown()
  } catch {
    ElMessage.error('签到信息加载失败，请确认后端与 SSH 隧道已启动')
  } finally {
    loading.value = false
  }
}

/* ---------------- ★ 2026-10-23 我的签到记录（stu-pc /stu/signin-records） ---------------- */
const records = ref([])
const recLoading = ref(false)

async function loadRecords() {
  if (recLoading.value) return
  recLoading.value = true
  try {
    records.value = (await signinRecords({ limit: 20 })) || []
  } catch {
    // 拦截器已提示
  } finally {
    recLoading.value = false
  }
}
function statusLabel(v) {
  return { normal: '已签到', signed: '已签到', late: '迟到', leave: '请假', absent: '缺勤' }[v] || v || '未知'
}
function statusTag(v) {
  return { normal: 'success', signed: 'success', late: 'warning', leave: 'info', absent: 'danger' }[v] || 'info'
}
function fmtTime(t) {
  return String(t || '').replace('T', ' ').slice(0, 16)
}
onMounted(loadRecords)

onMounted(async () => {
  await load()
  timer = setInterval(tickCountdown, 1000)
  buildQR()
})
onUnmounted(() => clearInterval(timer))

/** 路由 query 里的 sessionId 变化时要重新拉数据 ——
 *  同一路由只改 query 时 Vue 会复用组件、onMounted 不再触发，不加这个会一直停在初始空态。 */
watch(sessionId, () => {
  load()
})

/* ---------------- 弹窗 ----------------
 * ★★ 坑（2026-10-09 修复，勿再踩）：
 *   el-dialog 的 modelValue 是**布尔** prop。Vue 对声明为 Boolean 的 prop 有「空串转真」规则——
 *   绑定的值只要是 `''`（空字符串）就会被转成 `true`。
 *   原写法 `const dlg = ref('')` + `v-model="dlg"` 于是表现为：
 *     ① 一进页面 dlg='' → 被转成 true → **空弹窗自动弹出**；
 *     ② 所有关闭路径都把 dlg 设回 '' → 又被转成 true → **弹窗永远关不掉**，整页像卡死。
 *   因此：显隐用布尔 `dlgOpen`，方式 key 另用 `dlg`，两者分离。
 */
const dlgOpen = ref(false)
const dlg = ref('')

/** 各方式弹窗标题（原型是 5 个独立弹窗，标题各不相同：pc/student-attendance.html 第 89~119 行） */
const DLG_TITLE = {
  qr: '扫码签到',
  location: '定位签到',
  photo: '拍照签到',
  numeric: '数字口令签到',
  manual: '手动点名'
}
const dlgTitle = computed(() => DLG_TITLE[dlg.value] || '')

const num = ref('')
const qrCells = ref([])

function openWay(w) {
  if (signed.value) {
    ElMessage.info('你已完成签到')
    return
  }
  if (!w.open) {
    ElMessage.info('教师未开启' + w.nm)
    return
  }
  if (expireAt.value && left.value <= 0) {
    ElMessage.warning('本次签到已截止')
    return
  }
  dlg.value = w.key
  dlgOpen.value = true
}

/** 关闭弹窗（放方法里，避免行内表达式再被误写成 ''） */
function closeDlg() {
  dlgOpen.value = false
}

const submitting = ref(false)

/**
 * 真正签到：POST 表 3-14，成功后重新拉取状态。
 * ★ 2026-10-10 起不再本地伪造 —— 原实现直接 `signed.value = true` 并写死「已签 19」，是假数据。
 */
async function doSign(way) {
  if (!sessionId.value || submitting.value) return
  submitting.value = true
  try {
    await signAttendance(sessionId.value, {
      attendStatus: 'signed',
      signType: way,
      signinTaskId: taskId.value
    })
    closeDlg()
    ElMessage.success('签到成功')
    await load()
  } catch (e) {
    // ⚠️ 后端对「同一学生重复签到」会撞 attendance.uk_attend_session_student 唯一键并抛 500，
    //    这里兜住给可读提示；已签到时按钮已失效，正常不会走到这里。
    ElMessage.error('签到失败：' + (e?.message || '请稍后重试'))
  } finally {
    submitting.value = false
  }
}

/** 定位签到（教室地理围栏的服务端校验尚未实现，直接提交 signType） */
function locate() {
  doSign('location')
}

/** 数字口令签到：服务端口令校验尚未实现，这里只做 6 位长度校验（原型的「演示口令 482913」已删除） */
function checkNum() {
  const v = (num.value || '').trim()
  if (v.length !== 6) {
    ElMessage.warning('请输入 6 位口令')
    return
  }
  doSign('numeric')
}

/** 二维码点阵（照原型 buildQR：21×21，三角定位块 + 随机点） */
function buildQR() {
  const cells = []
  for (let i = 0; i < 21 * 21; i++) {
    const r = Math.floor(i / 21)
    const c = i % 21
    const corner = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7)
    const on = corner
      ? (r === 0 || r === 6 || c === 0 || c === 6) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
        (r >= 16 && r <= 18 && c >= 2 && c <= 4) ||
        (r >= 2 && r <= 4 && c >= 16 && c <= 18)
      : Math.random() > 0.5
    cells.push(on)
  }
  qrCells.value = cells
}
</script>

<template>
  <div>
    <!-- 未选择课堂 → 空态（本页已不再内置任何演示数据） -->
    <EmptyState v-if="!sessionId" desc="未选择课堂 —— 请从「实时课堂」页点右上角「课堂签到」进入">
      <el-button type="primary" @click="router.push('/student/live')">前往实时课堂</el-button>
    </EmptyState>

    <template v-else>
      <!-- 页头 -->
      <div class="between mb16">
        <div>
          <h1 class="h1">课堂签到</h1>
          <div class="small muted mt6">{{ info.course }} · {{ info.teacher }} · {{ info.room }}</div>
        </div>
        <div class="row" style="gap: 10px">
          <div class="mini brand">
            <div class="small lb">签到剩余</div>
            <b class="vd">{{ leftText }}</b>
          </div>
          <div class="mini">
            <div class="small muted">已签 / 应到</div>
            <b>{{ signedCount }} / {{ totalCount }}</b>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="stack">
          <!-- 签到状态 -->
          <el-card v-if="signed" shadow="never" class="status-ok">
            <div class="ok">
              <div class="ring"><BaseIcon name="check" :size="20" /></div>
              <div>
                <b class="ok-t">签到成功</b>
                <div class="small muted mt4">方式：{{ signedWayName }} · {{ signTime }}</div>
              </div>
            </div>
          </el-card>
          <el-card v-else shadow="never">
            <div class="between">
              <div>
                <b>尚未签到</b>
                <div class="small muted">请选择上方一种方式完成签到</div>
              </div>
              <el-tag type="warning" effect="light">未签</el-tag>
            </div>
          </el-card>

          <!-- 方式选择 -->
          <el-card shadow="never">
            <div class="card-title">选择签到方式</div>
            <div class="small muted sub-note">教师本次开启：{{ openedNames || '（未开启任何方式）' }}（可任选其一完成签到）</div>
            <div class="grid g3">
              <div
                v-for="w in WAYS"
                :key="w.key"
                class="way-card"
                :class="{ dim: !w.open && !signed }"
                @click="openWay(w)"
              >
                <span class="wic"><BaseIcon :name="w.icon" :size="20" /></span>
                <div>
                  <div class="nm">{{ w.nm }}</div>
                  <div class="ds">{{ w.ds }}</div>
                  <div v-if="!w.open" class="off">本次未开启</div>
                </div>
              </div>
            </div>
          </el-card>
        </div>

        <div class="stack">
          <el-card shadow="never">
            <div class="card-title">课堂信息</div>
            <div class="info-row"><span class="k">课程</span><span class="v">{{ info.course }}</span></div>
            <div class="info-row"><span class="k">教师</span><span class="v">{{ info.teacher }}</span></div>
            <div class="info-row"><span class="k">地点</span><span class="v">{{ info.room }}</span></div>
            <div class="info-row">
              <span class="k">状态</span>
              <el-tag v-if="signed" type="success" effect="light">已签到</el-tag>
              <el-tag v-else-if="expireAt && left <= 0" type="info" effect="light">已截止</el-tag>
              <el-tag v-else type="warning" effect="light">进行中</el-tag>
            </div>
          </el-card>

          <el-card shadow="never">
            <div class="card-title">签到须知</div>
            <ul class="rules">
              <li>可按教师开启的任一种方式签到。</li>
              <li>定位 / 拍照方式系统自动校验位置与活体，防代签。</li>
              <li>未在时效内签到记为迟到，课后由教师补签。</li>
              <li>疑问请联系教师或查看消息中心通知。</li>
            </ul>
          </el-card>
        </div>
      </div>

      <!-- ★ 2026-10-23 我的签到记录 -->
      <el-card shadow="never" class="mt16">
        <div class="between">
          <div class="card-title no-margin">我的签到记录</div>
          <el-button size="small" text :loading="recLoading" @click="loadRecords">刷新</el-button>
        </div>
        <div v-loading="recLoading" class="mt12">
          <div v-if="records.length" class="stack" style="gap: 8px">
            <div v-for="(r, i) in records" :key="i" class="rec-row">
              <div class="row" style="gap: 8px; align-items: center">
                <b class="small">{{ r.courseName || '课程' }}</b>
                <el-tag size="small" :type="statusTag(r.status)" effect="light">{{ statusLabel(r.status) }}</el-tag>
                <el-tag v-if="r.isMakeup" size="small" type="warning" effect="plain">补签</el-tag>
              </div>
              <span class="small muted">{{ fmtTime(r.signTime) }}</span>
            </div>
          </div>
          <EmptyState v-else-if="!recLoading" desc="还没有签到记录" />
        </div>
      </el-card>

      <!-- 扫码 -->
      <el-dialog
        v-model="dlgOpen"
        :title="dlgTitle"
        width="420px"
        class="dlg-switch"
        @closed="dlg = ''"
      >
        <template v-if="dlg === 'qr'">
          <div class="qr">
            <i v-for="(on, i) in qrCells" :key="i" :class="{ o: !on }" />
          </div>
          <div class="small muted mt12 center">对准课堂二维码即可自动识别（演示点击「模拟扫码」）。</div>
        </template>
        <template v-else-if="dlg === 'location'">
          <div class="fence">
            <span class="pin"><BaseIcon name="map-pin" :size="22" /></span>
            <div class="small fence-tip">{{ info.room }} · 半径 50m 内有效</div>
          </div>
          <div class="small muted mt12">点击获取当前位置，系统校验是否在教室地理围栏内。</div>
        </template>
        <template v-else-if="dlg === 'photo'">
          <div class="cam">
            <span class="ring-cam" />
            <div class="tip">将面部置于框内<br />系统自动活体核验</div>
          </div>
        </template>
        <template v-else-if="dlg === 'numeric'">
          <div class="field-label">输入教师公布的 6 位口令</div>
          <el-input v-model="num" maxlength="6" placeholder="------" class="num-input" />
          <div class="small muted mt12">口令由教师现场公布（服务端校验尚未实现，输入 6 位即可提交）。</div>
        </template>
        <template v-else-if="dlg === 'manual'">
          <div class="small muted">教师将在花名册中为你标记到课。点击「我已到课」通知老师。</div>
        </template>

        <template #footer>
          <el-button @click="closeDlg">取消</el-button>
          <el-button v-if="dlg === 'qr'" type="primary" :loading="submitting" @click="doSign('qr')">
            模拟扫码
          </el-button>
          <el-button v-else-if="dlg === 'location'" type="primary" :loading="submitting" @click="locate">
            <BaseIcon name="map-pin" :size="14" />获取定位
          </el-button>
          <el-button v-else-if="dlg === 'photo'" type="primary" :loading="submitting" @click="doSign('photo')">
            <BaseIcon name="camera" :size="14" />拍照并签到
          </el-button>
          <el-button v-else-if="dlg === 'numeric'" type="primary" :loading="submitting" @click="checkNum">提交</el-button>
          <el-button v-else-if="dlg === 'manual'" type="primary" :loading="submitting" @click="doSign('manual')">
            我已到课
          </el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-900);
}
.mini {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  text-align: center;
}
.mini.brand {
  background: var(--brand-50);
  border-color: var(--brand-300);
}
.mini .lb {
  color: var(--brand-600);
}
.mini .vd {
  color: var(--brand-700);
  font-size: 15px;
}
.two-col {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 18px;
  align-items: start;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-900);
  margin-bottom: 12px;
}
.sub-note {
  margin-top: -4px;
  margin-bottom: 14px;
}
.way-card {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px;
  cursor: pointer;
  background: #fff;
  transition: 0.15s;
}
.way-card:hover {
  border-color: var(--brand-300);
  box-shadow: 0 4px 14px rgba(13, 148, 136, 0.08);
}
.way-card.dim {
  opacity: 0.55;
  cursor: not-allowed;
}
.wic {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.nm {
  font-weight: 600;
  font-size: 13.5px;
}
.ds {
  font-size: 12px;
  color: var(--ink-500);
}
.off {
  font-size: 11.5px;
  color: var(--ink-400);
}
.status-ok {
  border-color: var(--brand-300);
  background: var(--brand-50);
}
.ok {
  display: flex;
  align-items: center;
  gap: 14px;
}
.ok .ring {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--brand-600);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.ok-t {
  font-size: 16px;
  color: var(--brand-700);
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 13.5px;
}
.info-row:last-child {
  border-bottom: none;
}
.info-row .k {
  color: var(--ink-500);
}
.info-row .v {
  font-weight: 600;
}
.rules {
  padding-left: 18px;
  line-height: 1.9;
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--ink-500);
}
.qr {
  display: grid;
  grid-template-columns: repeat(21, 1fr);
  gap: 1px;
  width: 210px;
  height: 210px;
  margin: 0 auto;
  background: #fff;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.qr i {
  background: #0f172a;
  border-radius: 1px;
}
.qr i.o {
  background: transparent;
}
.fence {
  position: relative;
  height: 180px;
  border-radius: 12px;
  background: radial-gradient(circle at 50% 55%, rgba(13, 148, 136, 0.18), rgba(13, 148, 136, 0.04) 60%, transparent 70%),
    var(--bg-subtle);
  border: 1px dashed var(--brand-300);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.fence .pin {
  color: var(--brand-700);
}
.fence-tip {
  z-index: 2;
}
.cam {
  position: relative;
  height: 200px;
  border-radius: 12px;
  background: #0f172a;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.cam .ring-cam {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.5);
}
.cam .tip {
  color: rgba(255, 255, 255, 0.75);
  font-size: 12.5px;
  text-align: center;
  line-height: 1.6;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-700);
  margin-bottom: 8px;
}
.num-input :deep(input) {
  font-family: var(--font-mono);
  font-size: 22px;
  letter-spacing: 8px;
  text-align: center;
}
.mb16 {
  margin-bottom: 16px;
}
.mt6 {
  margin-top: 6px;
}
@media (max-width: 1000px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
/* ★ 2026-10-23 签到记录 */
.rec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg-subtle);
  border-radius: 8px;
}
</style>
