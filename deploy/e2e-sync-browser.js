/**
 * 学生端「统一课堂时间轴」浏览器级回归（playwright-cli 片段）。
 *
 * 用途：不依赖登录 / LiveKit / 后端数据库，直接在当前 Vite 页面里加载
 * `src/utils/classroomTimeline.js`，验证时钟校准、延迟估计、标记队列、
 * 暂停冻结、seek 重锚、失败降级、手动微调与缓冲中断。
 *
 * 用法（先启动学生端 dev server）：
 *   npx --yes @playwright/cli@latest run-code --filename deploy/e2e-sync-browser.js
 *
 * 返回 { ok, checks: [{ name, ok, detail }], state }，由执行者汇总为报告。
 */
async page => {
  return await page.evaluate(async () => {
    const m = await import('/src/utils/classroomTimeline.js?e2e=' + Date.now())
    const out = { checks: [], details: {} }
    const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) })
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))

    m.setManualOffset(0)
    m.recalibrate()
    m.setAudioStatus({ state: 'connected', reason: '', blocked: false, network: { jitterMs: 40, rttMs: 60 } })

    const now = Date.now()
    for (let i = 0; i < 4; i++) {
      m.addClockSample({
        serverTimeMs: now + 500 + i * 10,
        clientTimeMs: now + i * 10,
        recvMs: now + i * 10 + 20
      })
    }
    let s = m.getState()
    out.details.afterClock = s
    check('时钟样本收敛', s.sampleCount >= 3 && Number.isFinite(s.clockOffsetMs), `samples=${s.sampleCount}, offset=${s.clockOffsetMs}`)
    check('时钟偏移误差在阈值内', s.clockSkewMs != null && s.clockSkewMs <= s.thresholds.skewGood, `${s.clockSkewMs}ms <= ${s.thresholds.skewGood}ms`)
    check('连接后状态为已同步', s.syncState === 'synced', s.syncState)
    check('输出延迟在阈值区间', s.audioLatencyMs >= 20 && s.audioLatencyMs <= 500, `${s.audioLatencyMs}ms`)

    // Safari / Firefox / 微信 WebView 常缺少 outputLatency 与 jitterBuffer 统计：走 RTT/2 + 默认值兜底
    m.setAudioStatus({ network: { jitterMs: 0, rttMs: 80 }, outputLatencyMs: 0 })
    s = m.getState()
    check('缺失输出延迟统计时按 RTT/2 回退', s.audioLatencyMs === 160, `${s.audioLatencyMs}ms = 40 + 120`)
    m.setAudioStatus({ network: { jitterMs: 40, rttMs: 60 } })

    const t0 = Date.now()
    m.applyStageFrame('audio-marker', { markerId: 'm1', action: 'play', timelineMs: t0 + 700, timeSec: 1.5 }, { timelineMs: t0 + 700 })
    await sleep(900)
    s = m.getState()
    out.details.afterMarker = s
    check('标记按期生效', s.appliedMarkers === 1 && s.pendingMarkers === 0, `applied=${s.appliedMarkers}, pending=${s.pendingMarkers}`)
    check('生效偏差在 warn 区间内', Math.abs(s.driftMs) <= s.thresholds.driftWarn, `drift=${s.driftMs}ms`)

    m.applyStageFrame('playback', { state: 'paused', timeSec: 2 }, { timelineMs: Date.now() + 100 })
    // pause 本身是控制标记（只冻结、不入队）；再发一条 slide 验证队列确实被冻结
    m.applyStageFrame('audio-marker', { markerId: 'm2', action: 'slide', timelineMs: Date.now() + 2000 }, {})
    await sleep(500)
    s = m.getState()
    check('暂停冻结队列', s.frozen && s.pausedByPlayback && s.pendingMarkers >= 1 && s.appliedMarkers === 1,
      `frozen=${s.frozen}, pending=${s.pendingMarkers}, applied=${s.appliedMarkers}`)

    m.applyStageFrame('playback', { state: 'playing', action: 'seek', timeSec: 5 }, {})
    s = m.getState()
    check('拖动进度条清空待生效标记', !s.frozen && !s.pausedByPlayback && s.pendingMarkers === 0,
      `frozen=${s.frozen}, pending=${s.pendingMarkers}`)

    m.setAudioStatus({ state: 'error', reason: 'audio load failed' })
    const before = m.getState().appliedMarkers
    m.applyStageFrame('audio-marker', { markerId: 'm3', action: 'play', timelineMs: Date.now() + 5000 }, {})
    await sleep(300)
    s = m.getState()
    check('音频失败降级立即呈现', s.syncState === 'degraded' && s.appliedMarkers === before + 1,
      `state=${s.syncState}, applied=${s.appliedMarkers}`)

    m.setManualOffset(120)
    const persisted = localStorage.getItem('stu-pc:classroom-timeline:manualOffsetMs')
    check('手动微调持久化', persisted === '120' && m.getState().manualOffsetMs === 120, `stored=${persisted}`)
    m.resetManualOffset()

    m.setAudioStatus({ state: 'reconnecting', reason: '' })
    m.applyStageFrame('audio-marker', { markerId: 'm4', action: 'play', timelineMs: Date.now() + 100 }, {})
    await sleep(500)
    s = m.getState()
    out.details.afterBuffering = s
    check('缓冲中断冻结队列', s.syncState === 'buffering' && s.frozen && s.audioFrozen && s.pendingMarkers >= 1,
      `state=${s.syncState}, frozen=${s.frozen}, pending=${s.pendingMarkers}`)

    out.ok = out.checks.every(c => c.ok)
    return out
  })
}
