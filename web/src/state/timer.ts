/**
 * `javax.swing.Timer` 的替身：走/跑/NPC 的动画与移动全挂在它上面。
 *
 * 抽成一个模块而不是各写各的，是因为**间隔必须跟着定时器走**。主角的两个
 * 定时器是 80 ms，NPC 的两个是 200 ms（`NPC.java:30-31`）；这几行原先写死了
 * 80，NPC 接进来时若照用，NPC 会以 2.5 倍速动 —— 而画面上只是"NPC 走得有点
 * 快"，没有任何东西会响。所以间隔一律由调用方传，这里不留默认值。
 *
 * 语义照抄 Swing，两条都在本项目里害过人（见 `tools/src/devtools/VirtualTimer.java`）：
 *
 *   `start()`   对已经在跑的定时器是**空操作**（`TimerQueue.addTimer` 直接
 *               忽略已入队的定时器），到期时刻不变；
 *   `restart()` 才是 `stop()` + `start()`，会重新计时。
 *
 * 后果是具体的：`NPCEvent.checkNPCStop` 对 type==2 的 NPC 每 10 ms 就无条件
 * `action.start()` 一次。按 Swing 的语义那个原地动画照常播；把 `start()` 写成
 * 重新计时，它就再也播不动了 —— 导出器第一版正是这么错的，三份 trace 里所有
 * 原地运动的 NPC 都被记成永远停在第 0 帧，退出码 0、`--check` 全绿。
 */
export interface MutableTimer {
  running: boolean
  dueMs: number
}

/** `Timer.start()`：已经在跑就什么都不做，**不重新计时**。 */
export function startTimer(t: MutableTimer, now: number, intervalMs: number): void {
  if (t.running) return
  t.running = true
  t.dueMs = now + intervalMs
}

/** `Timer.stop()`。到期时刻留着不动 —— 下次 `start()` 会重设它。 */
export function stopTimer(t: MutableTimer): void {
  t.running = false
}

/**
 * 到期就触发一次；返回是否触发过。
 *
 * **先推进 `dueMs` 再执行**：监听器里可能把自己停掉（主角落格）或把别人起来，
 * 顺序反了会把监听器刚设好的状态覆盖回去。这一条与
 * `devtools.VirtualTimer.fireIfDue` 逐行对应。
 */
export function fireIfDue(
  t: MutableTimer,
  now: number,
  intervalMs: number,
  run: () => void,
): boolean {
  if (!t.running || now < t.dueMs) return false
  t.dueMs += intervalMs
  run()
  return true
}

/**
 * 把这一 tick 欠下的都补上。tick 步长（10 ms）比任何一个间隔都小，所以正常
 * 情况下最多触发一次；循环是为了将来有人把步长调大时不至于悄悄丢帧。
 *
 * 64 次是硬失败而不是 `break`：`break` 会让"时钟算错了"表现为"动画慢了点"。
 */
export function fireDue(
  t: MutableTimer,
  now: number,
  intervalMs: number,
  run: () => void,
  label: string,
): void {
  let guard = 0
  while (fireIfDue(t, now, intervalMs, run)) {
    if (++guard > 64) throw new Error(`${label}在一个 tick 内触发超过 64 次`)
  }
}
