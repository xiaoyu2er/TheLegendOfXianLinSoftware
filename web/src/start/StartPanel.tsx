import { startAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import { HIT_OFFSET_X, HIT_OFFSET_Y, START_BUTTONS, startButtonHitBox } from './buttons'
import type { StartButtonKey } from './buttons'

/**
 * 开始界面（xl-kaa）—— `src/start/StartPanel.java` 那一屏。
 *
 * **真 DOM，不画进画布**，跟 `ui/DialogueBox.tsx` 同一个理由与同一套坐标：
 * 它叠在舞台的 overlay 层里，而 overlay 已经是一个 1024×640 的逻辑坐标系并
 * 整体跟着舞台缩放（`stage/Stage.tsx`），所以下面的数字可以照抄原版。
 * 顺带把两颗按钮做成真的 `<button>`：读屏读得到、Tab 走得到、回车按得动 ——
 * 画进画布的按钮这三样一样都没有。
 *
 * ## 这一屏**没有**复刻的东西（登记，不是遗漏）
 *
 * 原版那一屏还有：四颗按钮（另两颗是「转」关于我们、「结」`System.exit(0)`）、
 * 展开卷轴的过场动画（点下去要等 `loadTimer` 30 拍才真的换面板）、云彩上下
 * 飘、每颗按钮周围一圈 4 帧的高亮动画、以及一个把系统光标换成透明再自己画
 * 8 帧的鼠标。这张票（`bd show xl-kaa`）的范围是「标题图与两颗按钮
 * （开始新游戏 / 读取存档）」，上面这些都不在里面，登记在 `xl-4si`。
 *
 * 写成登记而不是"以后再说"，是因为**少一段动画和复刻完了长得一样** ——
 * 没人对着一张静止的截图看得出来少了云。
 *
 * ## 读档那颗按钮是禁用的
 *
 * 原版「承」进的是 `LoadAndSavePanel`，而 web 端的存档要等 M6（`xl-i06.1`）。
 * **禁用而不是不画**：不画的话"这一版还没做"与"原版本来就只有一颗按钮"
 * 在画面上分不开，而后者是错的。
 */
export interface StartPanelProps {
  /** 「起」：`GameLauncher.init()` + `switchTo("scene")` + 进脚本1。 */
  readonly onNewGame: () => void
}

export function StartPanel({ onNewGame }: StartPanelProps) {
  const handlers: Record<StartButtonKey, (() => void) | null> = {
    newGame: onNewGame,
    // 读档归 M6（xl-i06.1）。`null` = 这颗按钮禁用，见下面。
    load: null,
  }

  /**
   * 把两张图从**命中框**的左上角推回原版的绘制位置 `(x, y)`。
   * 数字不写进 CSS：那样它就和 `buttons.ts` 里那对偏移各说各话了。
   */
  const face = { left: `${-HIT_OFFSET_X}px`, top: `${-HIT_OFFSET_Y}px` }

  return (
    <div className="start-panel" data-testid="start-panel">
      {/*
        背景图**按原始尺寸画在 (0,0)**，与原版
        `backgroundGraphics.drawImage(backgroundImage, 0, 0, this)` 一致。
        它实测是 1024×641，比舞台高一行 —— 原版画进一张 1024×640 的缓冲图，
        最后一行被裁掉。这里靠 `.start-panel { overflow: hidden }` 裁，
        不是把它缩成 640：缩一下整张图就纵向差半个像素，而画面上看起来正常。
      */}
      <img className="start-back" src={resolveAsset(startAssetId('back'))} alt="" />
      {START_BUTTONS.map((button) => {
        const hit = startButtonHitBox(button)
        const onClick = handlers[button.key]
        return (
          <button
            key={button.key}
            type="button"
            className="start-button"
            // 按钮元素占的是**命中框**，不是绘制矩形：原版三个判定用的都是
            // 那个往左上挪了 (15,6) 的矩形（见 `buttons.ts`）。让 DOM 的
            // 悬停与点击区域就是它，两者才不会各说各话。
            style={{ left: `${hit.x}px`, top: `${hit.y}px`, width: `${hit.width}px`, height: `${hit.height}px` }}
            aria-label={button.label}
            disabled={onClick === null}
            title={onClick === null ? '读取存档要等 M6 存档（xl-i06.1）' : undefined}
            onClick={onClick ?? undefined}
          >
            {/*
              两张图叠着，CSS 的 :hover / :focus-visible 换哪张显示。
              **都不带宽高**，跟原版 `g.drawImage(buttonImage, x, y, mp)` 一样
              按原始尺寸画 —— 悬停那张是 190×53，会往右铺开成一条横幅，
              不是把 50×50 撑大。所以它得能溢出按钮盒子（`overflow: visible`）。

              偏移 (15,6) 把绘制位置从命中框换算回原版的 (x, y)。
            */}
            <img
              className="start-button-face start-button-face--normal"
              style={face}
              src={resolveAsset(startAssetId(button.key))}
              alt=""
            />
            <img
              className="start-button-face start-button-face--hover"
              style={face}
              src={resolveAsset(startAssetId(`${button.key}Hover`))}
              alt=""
            />
          </button>
        )
      })}
    </div>
  )
}
