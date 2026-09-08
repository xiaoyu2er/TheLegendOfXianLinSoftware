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
