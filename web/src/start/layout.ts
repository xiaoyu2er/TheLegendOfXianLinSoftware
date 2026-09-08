/**
 * 开始界面上那几段动画**画在哪儿、走多少拍**（xl-4si）。
 *
 * 数字全部照抄 `src/start/StartPanel.java` 的 `initialAnimations()` /
 * `setButton()` / `startButtonAction()` 与 `src/start/CloudAnimation.java`，
 * 由 `layout.test.ts` 对着 GBK 源码现读比 —— 抄错一个数在画面上说不出对错，
 * 而"云飘得不对"没人看得出来。
 *
 * 与 `buttons.ts` 分开：那边是**按钮**的摆位与命中框（连带 DOM 那一层的
 * 取舍），这边是**动画**的摆位与拍数。两份都不进 `assets.ts`，因为烘焙指纹
 * 把 `bake.ts` 的整个 import 闭包算进去（xl-23y），挪一下坐标不该逼人重烘。
 */

/** 卷轴与反向卷轴都画在这里：`new StartAnimation(10, "卷轴", this, -320, -100)`。 */
export const SCROLL_X = -320
export const SCROLL_Y = -100

/** `new StartAnimation(10, "载入", this, 650, 480)`。 */
export const LOADING_X = 650
export const LOADING_Y = 480

/** `new StartAnimation(3, "载入2", this, 700, 200)`。 */
export const LOADING2_X = 700
export const LOADING2_Y = 200

/** `new CloudAnimation(0, 360, 最终云彩.png, 0, this)` 的前两个数。 */
export const CLOUD_X = 0
export const CLOUD_START_Y = 360

/** `CloudAnimation` 构造函数里那句 `move = 10`：一拍走多少像素。 */
export const CLOUD_MOVE = 10

/**
 * 掉头条件里那两个字面量：`if (y + 1024 < 640) isChange = true`。
 *
 * 它们在原版里是**两个恰好相等的巧合**：`1024` 正是 `最终云彩.png` 的高，
 * `640` 正是舞台的高。两件事都由 `layout.test.ts` 现量 —— 素材换了尺寸而
 * 这个常量不动，云就会在半空掉头，而画面上看起来完全正常。
 */
export const CLOUD_IMAGE_HEIGHT = 1024
export const CLOUD_FLOOR = 640

/**
 * ⚠️ **云真正的上下端点不是 360 与 −384**。
 *
 * 票面上写的是"在 y=360 与 y=−384 之间每拍 ±10 往返"，那是从掉头**条件**
 * 推出来的，不是量出来的。条件是 `y + 1024 < 640`，即 `y < -384`，而 y 是从
 * 360 每拍减 10 走过去的，所以踩到的第一个满足它的值是 **−390**；掉头往上之后
 * 条件是 `y > 360`，踩到的第一个值是 **370**，于是此后的上端点是 370 而不是
 * 360。实测（`layout.test.ts` 现跑）：第一程 360 → −390 走 75 拍，此后
 * −390 → 370 → −390 一轮 **152 拍**。
 *
 * 这两个数写在这里是**登记**，不是判据：判据是那条用例真的把 `updateCloud`
 * 跑出来数的。
 */
export const CLOUD_LOW_Y = -390
export const CLOUD_HIGH_Y = 370

/** `aboutTimer.start(10)` —— 「转」与「回」两处都是 10。 */
export const ABOUT_TICKS = 10

/** `loadTimer.start(30)` —— 卷轴展开之后再等 30 拍才换面板。 */
export const LOAD_TICKS = 30

/**
 * 「关于我们」逐段揭开的那条式子里的两个数：
 * `100 * (9 - aboutTimer.getTimeLeft())`（展开）与
 * `100 * aboutTimer.getTimeLeft()`（收回）。
 */
export const ABOUT_REVEAL_STEP = 100
export const ABOUT_REVEAL_BASE = 9

/**
 * `关于我们.png` 的整幅尺寸。展开到一半时原版画的是
 * `drawImage(img, 0,0,w,640, 0,0,w,640, this)` —— **左半边原样露出来，不缩放**；
 * 完全展开之后画的是 `drawImage(img, 0, 0, this)`，也就是整幅。
 * 视图层用 `width === ABOUT_WIDTH` 表示后者。
 */
export const ABOUT_WIDTH = 1024
export const ABOUT_HEIGHT = 640

/**
 * 一拍多少毫秒：`startAnimationThread()` 里那句 `tools.Clock.sleep(100)`。
 *
 * 与场景/战斗那两条线的 `TICK_MS`（10 ms）不是一回事 —— 开始界面在原版里是
 * 一条自己的 100 ms 线程，两者不共用一个时钟。
 */
export const START_TICK_MS = 100
