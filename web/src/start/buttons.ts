/**
 * 开始界面上那两颗按钮的摆位与命中框（xl-kaa）。
 *
 * 数字全部照抄 `src/start/StartPanel.java` 的 `initialButtons()`：
 *
 *     start = new StartButton(200, 150, 50, 50, 起.png,  起2.png, 起2.png, …)
 *     load  = new StartButton(200, 250, 50, 50, 承.png,  承2.png, 承2.png, …)
 *
 * `buttons.test.ts` 把这两行从 GBK 源码里现读出来逐个数比，所以这里抄错一个
 * 数会红 —— 不然"按钮偏了 50 px"在画面上完全说不出对错。
 *
 * ## 画在哪儿 ≠ 点在哪儿
 *
 * 原版 `StartButton.drawButton` 画在 `(x, y)`，而三个判定
 * （`isMoveIn` / `isPressedButton` / `isRelesedButton`）用的都是同一个
 * **偏移过的**矩形：
 *
 *     currentX > x-15 && currentX < x+width-15 && currentY > y-6 && currentY < y+height-6
 *
 * 也就是命中框整个往左上挪了 (15, 6)。这不是笔误，是原版三处一致的写法，
 * 而且战斗面板的命令按钮是**同一个** −15 / −6（见 `game/session.test.ts` 里
 * 那个 `attack.x - 15, attack.y - 6`）。照抄。
 *
 * ## ⚠️ DOM 的命中比原版**大一圈**，差一个像素（登记，不是遗漏）
 *
 * 原版那四个不等号全是**严格**的，所以有效区其实是 49×49 的开区间 ——
 * 四条边本身不算命中。这一层的命中判定交给了 DOM：按钮元素的盒子就是下面
 * `startButtonHitBox` 返回的那个 50×50 矩形，而 CSS 盒子含左上两条边。
 *
 * 于是与原版差在左边与上边那一列 / 一行：原版点不着，这里点得着。
 *
 * 不去补这一像素，是因为补它要在 DOM 上再叠一层自己的命中判定
 * （`pointer-events: none` 加一个 `onMouseDown` 手算坐标），而那会把「按钮是
 * 真的 `<button>`、读屏读得到、Tab 走得到、回车按得动」整个作废 —— 为一个
 * 像素换掉四样无障碍能力，不划算。写在这里，是因为**差一个像素和一模一样
 * 在画面上分不开**。
 */

/**
 * 原版那五颗按钮的逻辑名。与 `assets.ts` 的图片名**逐字**一一对应
 * （`newGame` ↔ `newGame` / `newGameHover`），所以渲染层只有一处拼接。
 *
 * ⚠️ 「回」叫 `goBack` 而不是 `back`：`back` 在 `START_IMAGES` 里已经是
 * **背景图** `back.png` 了。原版自己就撞了这两个词（`StartButton back` 与
 * `Image backgroundImage = readImage("back.png")`），照抄名字会让
 * `startAssetId('back')` 查出一张 1024×641 的底图当按钮画，而"按钮变成
 * 一整屏"这件事在测试里是查得出来的、在画面上却像是布局崩了。
 */
export type StartButtonKey = 'newGame' | 'load' | 'about' | 'end' | 'goBack'

export interface StartButtonSpec {
  readonly key: StartButtonKey
  /** `new StartButton(x, y, width, height, …)` 的前四个数。**画**在这里。 */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 读屏与测试要的名字。原版按钮上只有一个「起」/「承」字，没有可读文本。 */
  readonly label: string
}

/** 命中框相对绘制位置的偏移，见文件头注。 */
export const HIT_OFFSET_X = -15
export const HIT_OFFSET_Y = -6

/**
 * 五颗按钮，**顺序照抄 `initialButtons()`**。
 *
 * 顺序是有意义的：`initialAnimations()` 里那圈高亮动画是
 * `new StartAnimation(4, "按钮动画", this, 200, 150 + i * 100)` 按 `i` 建的，
 * 第 5 条单独建在 (800, 550)，而 `initialButtons()` 正是按同样的顺序把
 * `buttonAnimations.get(0..4)` 分给五颗按钮的。于是**每颗按钮的高亮动画就画在
 * 它自己的 (x, y) 上** —— 这条由 `layout.test.ts` 对着源码比，不是看出来的。
 */
export const START_BUTTONS: readonly StartButtonSpec[] = [
  { key: 'newGame', x: 200, y: 150, width: 50, height: 50, label: '开始新游戏' },
  { key: 'load', x: 200, y: 250, width: 50, height: 50, label: '读取存档' },
  { key: 'about', x: 200, y: 350, width: 50, height: 50, label: '关于我们' },
  { key: 'end', x: 200, y: 450, width: 50, height: 50, label: '结束游戏' },
  { key: 'goBack', x: 800, y: 550, width: 50, height: 50, label: '返回标题' },
]

/**
 * 开机就在屏幕上的那四颗 —— 原版构造函数末尾那四句
 * `buttons.add(start/load/about/end)`。
 *
 * 「回」不在里面：它是点了「转」、卷轴展开之后才 `buttons.add(back)` 的，
 * 点了它自己又 `buttons.remove(back)`。这条名单因此是**会变的**，变的那一半
 * 在 `panelState.ts` 里。
 */
export const INITIAL_START_BUTTONS: readonly StartButtonKey[] = [
  'newGame',
  'load',
  'about',
  'end',
]

/**
 * 一颗按钮**点得着**的那个矩形（不是画出来的那个）。
 *
 * 这就是 DOM 上那个 `<button>` 元素的盒子，见 `StartPanel.tsx` —— 与原版的
 * 开区间差一个像素，理由与代价在文件头注里。
 *
 * 偏移走的是上面那对常量，不再写一遍 `-15` / `-6`：同一对数字两种写法，
 * 改了一处不改另一处的表现是「按钮偏了 15 px」，而画面上说不出对错。
 *
 * **没有配套的 `hitsStartButton`**：命中判定归 DOM，再留一个"逻辑上点不点得
 * 着"的函数，就是留下一条**没有生产调用方、而且与真正生效的判定差一像素**的
 * 规则 —— 下一个人会以为那才是权威。
 */
export function startButtonHitBox(button: StartButtonSpec): {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
} {
  return {
    x: button.x + HIT_OFFSET_X,
    y: button.y + HIT_OFFSET_Y,
    width: button.width,
    height: button.height,
  }
}

/**
 * 五颗按钮各自的**接线**：活没活、不活的话为什么 —— 一份**手写的登记**，
 * 不是从别处推出来的（`docs/agents/dispatch.md` 纪律 3：登记必须由人签，
 * 推导出来的登记等于让被守的东西自己给自己签字）。
 *
 * 两件事合在一条里，是因为它们**必须一起改**：`enabled: false` 而没有理由，
 * 与"忘了接线"长得一模一样；有理由却是 `true`，那句理由永远没人看得见。
 * 分成两张表（原本正是两张）就要靠人记得同时改两处。
 *
 * `false` 的那两颗在 UI 上是 `disabled`，**不是不画** —— 不画的话"这一版还没
 * 做"与"原版本来就只有三颗按钮"在画面上分不开，而后者是错的。
 *
 * ⚠️ **不要把 `enabled` 改成从别处推出来的**（比如"有 handler 的就是活的"）：
 * 那样它就成了自己给自己签字，而这份登记要守的恰恰是"有没有人悄悄画了一颗
 * 点了没反应的按钮"。真正把这件事验出来的是 `StartPanel.test.tsx` 里那对
 * 「点下去屏幕得真的变 / 得纹丝不动」—— 把这里任何一颗翻个面，两条都红
 * （实测：`end` 翻成 `true`，三条用例当场红）。
 */
export interface StartButtonWiring {
  /** `false` = 这一版明写不做，UI 上 `disabled`。 */
  readonly enabled: boolean
  /** 禁用理由，会写进按钮的 `title`。**活着的那几颗必须是 `null`**。 */
  readonly disabledReason: string | null
}

export const START_BUTTON_WIRING: Readonly<Record<StartButtonKey, StartButtonWiring>> = {
  newGame: { enabled: true, disabledReason: null },
  // 「转」与「回」是活的，但它们**不换面板** —— 走的是卷轴过场加「关于我们」
  // 那一屏，全在状态机里（`panelState.ts`），所以组件那边没有它们的 handler。
  about: { enabled: true, disabledReason: null },
  goBack: { enabled: true, disabledReason: null },
  // 「承」进存读档面板（xl-i06.9）。点中非空槽之后那条重建路径归 xl-i06.10。
  load: { enabled: true, disabledReason: null },
  end: {
    enabled: false,
    // 原版是 `System.exit(0)`（`src/start/StartPanel.java:234`）。浏览器里没有
    // 对应物：`window.close()` 只对脚本自己开的窗口有效，玩家从地址栏进来的
    // 页面调它一声不吭。
    //
    // **这不是「还没做」，是 xl-u23 量过三条路之后的定案**（用户 2026-09-08
    // 裁定）。另外两条各自的代价：
    //
    // - 只在 `window.opener` 存在时才启用 —— 最接近原版语义，但同一颗按钮
    //   在不同入口下行为不同，判据要分两组写；
    // - 换一个说得清的行为（回标题 / 提示「请关掉这个标签页」）—— 那是在
    //   复刻品里加一个原版没有的行为，与 ADR-0001 的方向相反。
    //
    // @exception ADR-0001#start-exit-disabled
    // 所以留成禁用。**画出来而不是不画**也是有意的：不画的话「这一版还没做」
    // 与「原版本来就只有三颗按钮」在画面上分不开。
    //
    // 天书页「退出」→「确认离开」是同一句 `System.exit(0)`，同一行登记、同一口径
    // （`menu/funcButtons.ts` 的 `FUNC_DISABLED`，xl-03x.12）。
    disabledReason: '浏览器里没有 System.exit(0) 的对应物，定案不做（xl-u23）',
  },
}
