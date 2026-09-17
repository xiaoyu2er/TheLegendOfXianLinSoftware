/**
 * 鼠标 grab 两边共用的**按键编号换算**（xl-dnj）。
 *
 * 舞台上握 grab 的地方有两处，它们各自管一块 DOM：`app/App.tsx` 的 `grabRelease`（场景 /
 * 战斗 / 菜单 / 商店 / 存读档这几块宿主）与 `start/StartPanel.tsx` 的 `onMouseDown`（标题页
 * 那一块面板，它自己挂 window 监听、不走 `grabRelease`）。两处都要把 `MouseEvent.button`
 * 换成 `MouseEvent.buttons` 里的那一位，换算规则是 DOM 规范定的、与游戏无关 —— 所以放这儿
 * 一份，不各写一份。
 *
 * ⚠️ **只有这一半该共享 —— 位图那一半不合，理由在这儿写一次，别处不再重复。**
 *
 * 两处还各有一张「这个 grab 收下过按下的那几只键」的位图（`grabRelease` 里的 `taken`、
 * `StartPanelView` 里的 `takenRef`）。语义是同一个，生命周期是两种，差别只来自一件事：
 * **窗口外丢掉的那一下松手，是由谁补上的。**
 *
 * - `grabRelease`：两条补松手通路（`onPress` / `onDrag`）都是这个 grab **自己挂在 window 上**
 *   的监听，跑的时候闭包还在 —— 位图于是是闭包局部量、一个 grab 一份、用完即弃，`endGrab`
 *   里不需要（也不能有）清零那一句（xl-df1 的篡改矩阵证过那是死代码）。
 * - 标题页：**window 上没有 `mousedown` 监听**，走按下的那条补松手通路在面板自己的
 *   `onMouseDown` 里，跑在**下一次按下**时 —— 那时上一个 grab 的 `end()` 还没跑（正是它要跑
 *   的那一句）。位图必须活过 `end()`，所以只能是跨 grab 存活的 `useRef` 加显式清零。
 *   （它走移动的那一条倒是同一个闭包里的 window 监听，和 `grabRelease` 那边一样 —— 一条就够。）
 *
 * 硬并会把这处差异抹掉。两处的 `taken` / `takenRef` 各留一行指回这里，**别把这段论证抄过去**：
 * xl-dnj 一趟里它已经因为抄了三份而漂过一次。
 *
 * 落在 `stage/` 是因为这是两边**都已经依赖**的目录（`app/` 与 `start/` 互不 import），
 * 而这张表讲的正是「舞台这块 DOM 上收到的那一下是哪只键」。
 */

/**
 * `MouseEvent.button`（哪只键）→ 它在 `MouseEvent.buttons` 位掩码里的那一位。
 *
 * **中键与右键是反着的**：`button` 里中键 1、右键 2，`buttons` 里中键 4、右键 2。
 */
export const BUTTON_BITS: readonly number[] = [1, 4, 2, 8, 16]

/**
 * 这一下按的是哪只键，换成它在 `buttons` 里的那一位。
 *
 * 表上没有的键（第 6 只往后，`buttons` 规范只定到第 5 只）按 `1 << button` 兜底，**不能按 0**：
 * 位图靠「按下与松手拿到同一位」认人，给 0 等于这只键的按下记不进位图，而按下那一下已经送出去了 ——
 * 于是送出去的按下配不上一次松手。两处宿主上的后果不同、都不对：
 *
 * - `grabRelease`：`useGame.routeByGrab` 按「送了几次按下就等几次松手」数，计数永远回不到 0，
 *   **grab 再也解不开**（判据在 `app/appGrab.test.tsx`「第 6 只键起的 grab」那条）；
 * - 标题页：起 grab 那一下直接被 `othersHeld` 挡掉（`buttons & ~0` 恒非零），第 6 只键**整只失灵**；
 *   而 grab 已经挂着时它的按下照送、松手被位图挡掉，按钮卡在按下态（判据在
 *   `start/StartPanel.test.tsx`「第 6 只键」那两条）。
 *
 * `1 << button` 从第 6 只起是 32 / 64 /…，与表里那五个（1/4/2/8/16）不撞。
 */
export const bitOf = (event: { readonly button: number }): number => BUTTON_BITS[event.button] ?? 1 << event.button
