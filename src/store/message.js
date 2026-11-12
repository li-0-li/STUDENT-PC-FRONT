/**
 * 消息未读（Pinia 全局单例）
 *
 * <p>为什么要有这个 store：未读数原先由 Messages.vue 自己拉、自己算，
 * 只在消息页存在；侧栏「消息」菜单拿不到，新消息到达也没有任何全局感知，
 * 于是出现「列表项该有的红点不出现、左侧菜单永远没有总角标」。
 *
 * <p>现在未读只有一处来源：GET /api/v1/stu/conversation-unread
 * （后端按 conversation_member.last_read_time 自算，不依赖 conversation_member.unread_count
 *   这个历史字段 —— 后者存在未清零的脏值，例如 9027 的 unread_count=1 但其最后一条消息已撤回）。
 *
 * <p>谁在用：
 * <ul>
 *   <li>layout/PcShell.vue —— 侧栏「消息」总角标，全局轮询</li>
 *   <li>views/student/Messages.vue —— 会话列表逐项红点，点开即清零</li>
 * </ul>
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { conversationUnread } from '@/api/student/message'

export const useMessageStore = defineStore('message', () => {
  /** 逐会话未读：{ [conversationId]: count } */
  const byConv = ref({})
  /** 所有会话未读之和（侧栏总角标） */
  const total = ref(0)
  /** 上次成功拉取的时间戳，用于节流 */
  const lastAt = ref(0)

  let inflight = null

  function recount() {
    total.value = Object.values(byConv.value).reduce((s, n) => s + (Number(n) || 0), 0)
  }

  /** 全量覆盖（后端返回什么就是什么） */
  function setAll(rows) {
    const next = {}
    for (const r of rows || []) {
      const id = Number(r?.conversationId)
      if (!id) continue
      next[id] = Math.max(0, Number(r?.unreadCount) || 0)
    }
    byConv.value = next
    recount()
    lastAt.value = Date.now()
  }

  function getOne(id) {
    return Math.max(0, Number(byConv.value[Number(id)] || 0))
  }

  /** 单会话置数（例如本地已知条数） */
  function setOne(id, n) {
    const key = Number(id)
    if (!key) return
    byConv.value = { ...byConv.value, [key]: Math.max(0, Number(n) || 0) }
    recount()
  }

  /**
   * 单会话清零。
   * 点开会话时立即调用：红点当场消失、总角标同步减少，
   * 不必等下一次轮询 —— 否则用户点了却还挂着红点，会以为没生效。
   */
  function clearOne(id) {
    const key = Number(id)
    if (!key) return
    if (!byConv.value[key]) return
    byConv.value = { ...byConv.value, [key]: 0 }
    recount()
  }

  /**
   * 拉取最新未读。
   *
   * @param {number} minInterval 节流间隔（毫秒）。侧栏与消息页各有一个定时器，
   *   同时触发时靠这个间隔合并成一次请求；传 0 表示强制刷新。
   */
  async function refresh(minInterval = 6000) {
    // 已有请求在飞：复用同一个 Promise，避免并发重复拉取
    if (inflight) return inflight
    if (minInterval > 0 && Date.now() - lastAt.value < minInterval) return

    inflight = (async () => {
      try {
        const rows = await conversationUnread()
        setAll(Array.isArray(rows) ? rows : rows?.list || [])
      } catch {
        // 静默失败：网络抖动不应把已有角标清零，等下一轮
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  /** 退出登录时清空，避免换账号后残留上一个人的角标 */
  function reset() {
    byConv.value = {}
    total.value = 0
    lastAt.value = 0
  }

  return { byConv, total, lastAt, refresh, setAll, setOne, clearOne, getOne, recount, reset }
})
