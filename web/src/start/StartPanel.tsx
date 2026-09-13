import type { MouseEvent as ReactMouseEvent } from 'react'
import { startAssetId, startFrameAssetId } from '../assets/ids'
import type { StartSequenceName } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import {
  HIT_OFFSET_X,
  HIT_OFFSET_Y,
  START_BUTTONS,
  START_BUTTON_WIRING,
  startButtonHitBox,
} from './buttons'
import type { StartButtonKey, StartButtonSpec } from './buttons'
import {
  ABOUT_HEIGHT,
  CLOUD_X,
  LOADING2_X,
  LOADING2_Y,
  LOADING_X,
  LOADING_Y,
  SCROLL_X,
  SCROLL_Y,
} from './layout'
import type { StartButtonView, StartEffect, StartView } from './panelState'
import { useStartPanel } from './useStartPanel'
import type { StartPanelKeep } from './useStartPanel'

/**
 * 开始界面（xl-kaa 起，xl-4si 补齐）—— `src/start/StartPanel.java` 那一屏。
 *
 * **真 DOM，不画进画布**，跟 `ui/DialogueBox.tsx` 同一个理由与同一套坐标：
 * 它叠在舞台的 overlay 层里，而 overlay 已经是一个 1024×640 的逻辑坐标系并
 * 整体跟着舞台缩放（`stage/Stage.tsx`），所以下面的数字可以照抄原版。
 * 顺带把按钮做成真的 `<button>`：读屏读得到、Tab 走得到、回车按得动 ——
 * 画进画布的按钮这三样一样都没有。
 *
 * **这个文件里没有一拍状态**：每一帧画什么由 `panelState.ts` 算，
 * `useStartPanel.ts` 驱动。分开是因为这张票的验收标准要的是"可断言的状态
 * （第几帧、播没播完一循环）"，而截图对不出"少了云"。
 *
 * ## 五颗按钮里有两颗是**明写不做**的（登记，不是遗漏）
 *
 * 见 `buttons.ts` 的 `START_BUTTON_WIRING`（登记与理由）与下面的 `actions`
 * （哪个动作接到了什么）。禁用而不是不画：不画的话"这一版还没做"与
 * "原版本来就只有三颗按钮"在画面上分不开，而后者是错的。
 *
 * ## 自绘鼠标：`cursor: none` 而不是一个透明光标
 *
 * 原版 `start.Mouse` 造了一个 16×16 全透明的 `Cursor` 塞给面板，再自己画
 * 8 帧 `鼠标/`。浏览器里 `cursor: none` 就是那件事的对应物，而且不必伪造一张
 * 透明图。**这不是等价的**在一处：系统光标被藏起来之后，原版与这里都得靠
 * 自己画的那 8 帧来告诉人指针在哪 —— 所以那 8 帧要是漏了，界面就没有指针了。
 * 那正是它要被当成动画层认真复刻、而不是"顺手 hide 一下"的理由。
 */
export interface StartPanelProps {
  /** 「起」：`GameLauncher.init()` + `switchTo("scene")` + 进脚本1。 */
  readonly onNewGame: () => void
  /** 「承」：`setLastPanel("start")` + `changeStateTo(LOAD)` + `switchTo("ls")`（xl-i06.9）。 */
  readonly onLoad: () => void
  /**
   * 标题状态放在哪（xl-6zf）。给了就活过组件的卸载 —— 原版那块面板从开机活到关机，
   * 见 `useStartPanel.ts`。不给就随组件生灭。
   */
  readonly keep?: StartPanelKeep
}

/** 逻辑名 → 那颗按钮的摆位。`START_BUTTONS` 是模块常量，这张表也就不必每渲染重建。 */
const SPECS = new Map<StartButtonKey, StartButtonSpec>(START_BUTTONS.map((b) => [b.key, b]))

/** 一段逐帧动画的第几帧 → URL。 */
const frameSrc = (name: StartSequenceName, frame: number): string =>
  resolveAsset(startFrameAssetId(name, frame))

export function StartPanel({ onNewGame, onLoad, keep }: StartPanelProps) {
  /**
   * 状态机推出来的三种动作，各自接到什么上。
   *
   * `null` 的那一个对应 `START_BUTTON_WIRING` 里 `enabled: false` 的那颗按钮
   * （「结」/ `exit`），理由逐字写在那张表上。两处必须
   * 一致，而**验它的不是一条比对而是行为**：`StartPanel.test.tsx` 里那条
   * 「每一颗活着的按钮，点下去屏幕都得真的变」—— 把某颗按钮放开却不在这里
   * 接线，那条立刻红，因为点了它屏幕上什么都不会变。
   */
  const actions: Readonly<Record<StartEffect, (() => void) | null>> = {
    newGame: onNewGame,
    loadPanel: onLoad,
    exit: null,
  }

  const panel = useStartPanel((effect) => actions[effect]?.(), keep)
  return <StartPanelView view={panel.view} handlers={panel} />
}

/** 视图组件收的三种输入。取图页不给（它只画、不收输入）。 */
export interface StartPanelHandlers {
  readonly hover: (key: StartButtonKey | null) => void
  readonly click: (key: StartButtonKey) => void
  readonly moveCursor: (x: number, y: number) => void
}

export interface StartPanelViewProps {
  /** 这一帧画什么，`panelState.ts` 算好的。 */
  readonly view: StartView
  /** 不给就是只画不收输入 —— 取图页（`replay/main.ts`）就是这么用的。 */
  readonly handlers?: StartPanelHandlers
}

/**
 * **把一帧画成 DOM，别的什么都不做**（xl-whk 从 `StartPanel` 里拆出来）。
 *
 * 拆出来是为了逐帧比对：取图页要画的是**产品这一份 DOM**，而不是照着它另写一个
 * 渲染器 —— 另写一份，比出来的是那一份像不像原版，产品自己画错了照样绿。
 */
export function StartPanelView({ view, handlers }: StartPanelViewProps) {
  /**
   * 一次 `mousemove` → 舞台**逻辑坐标**（1024×640），给自绘鼠标用。
   *
   * 跟 `app/App.tsx` 的 `onStageClick` 同一套换算，同一个理由：`offsetX` 在
   * 有 CSS 缩放时给的是**缩放后**的像素，指针越靠右偏得越多，而画面看起来
   * 完全正常。
   */
  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!handlers) return
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    handlers.moveCursor(
      Math.round(((event.clientX - box.left) / box.width) * STAGE_WIDTH),
      Math.round(((event.clientY - box.top) / box.height) * STAGE_HEIGHT),
    )
  }

  const renderButton = (button: StartButtonView) => {
    const spec = SPECS.get(button.key)!
    const hit = startButtonHitBox(spec)
    const wiring = START_BUTTON_WIRING[button.key]
    // 把图从**命中框**的左上角推回原版的绘制位置 (x, y)。数字不写进 CSS：
    // 那样它就和 `buttons.ts` 里那对偏移各说各话了。
    const face = { left: `${-HIT_OFFSET_X}px`, top: `${-HIT_OFFSET_Y}px` }
    return (
      <button
        key={button.key}
        type="button"
        className="start-button"
        // 按钮元素占的是**命中框**，不是绘制矩形：原版三个判定用的都是那个
        // 往左上挪了 (15,6) 的矩形（见 `buttons.ts`）。让 DOM 的悬停与点击
        // 区域就是它，两者才不会各说各话。
        style={{
          left: `${hit.x}px`,
          top: `${hit.y}px`,
          width: `${hit.width}px`,
          height: `${hit.height}px`,
        }}
        aria-label={spec.label}
        disabled={!wiring.enabled}
        title={wiring.disabledReason ?? undefined}
        data-hover={button.hover ? 'true' : 'false'}
        // ⚠️ `onMouseMove` 与 `onMouseEnter` **两个都要**，且只认**没按着键**的。原版 `mouseMoved`
        // 每动一个像素就对每颗按钮重跑 `isMoveIn`，而 `isPressedButton` 会把高亮停掉 —— 于是"点一下、
        // 不出框、动一动"高亮当场续播；只挂 `onMouseEnter` 就得移出去再移回来才转。按着键是
        // `mouseDragged`，它只记坐标、不跑 `isMoveIn`（舞台外按下再拖进来，原版连它都不派），所以
        // `buttons` 非 0 不碰悬停（xl-vi8）。移出**不看键**：原版拖出框再松手，`isRelesedButton`
        // 换回常态、高亮早被按下停了；这里没有分开的按下 / 松手（`useStartPanel` 的 `click`），
        // 移出就是那一下的对应物。
        // 命中判定仍然归 DOM（按钮元素占的就是那个命中框，见 `buttons.ts`），这里不自己算坐标。
        onMouseMove={(event) => event.buttons === 0 && handlers?.hover(button.key)}
        onMouseEnter={(event) => event.buttons === 0 && handlers?.hover(button.key)}
        onMouseLeave={() => handlers?.hover(null)}
        // @exception ADR-0001#start-focus-hover
        // 键盘走到这颗上等于"鼠标移进来"：原版没有这一条（它只认坐标），
        // 是这里补的无障碍。补它而不是只补一条 CSS，是为了让那圈高亮动画
        // 也跟着转 —— 只换图不转动画，Tab 过来的人看到的是一颗半死的按钮。
        onFocus={() => handlers?.hover(button.key)}
        onBlur={() => handlers?.hover(null)}
        onClick={() => handlers?.click(button.key)}
      >
        {/*
          常态图与悬停图**只画一张**，由状态机说画哪张 —— 原版
          `StartButton.buttonImage` 就是一个字段。不带宽高，跟原版
          `g.drawImage(buttonImage, x, y, mp)` 一样按原始尺寸画：悬停那张是
          190×53，会往右铺开成一条横幅，不是把 50×50 撑大。
        */}
        <img
          className="start-button-face"
          style={face}
          src={resolveAsset(startAssetId(button.hover ? `${button.key}Hover` : button.key))}
          alt=""
        />
        {/*
          按钮身边那圈 4 帧高亮，**排在按钮图之后** —— 原版 `drawButton` 是
          `drawImage(buttonImage, x, y)` 在前、`animation.drawAnimation(g)` 在后，高亮盖在
          按钮图上面。这里原先反过来写，逐帧比对（xl-whk）第 0 帧就在四颗按钮的左沿量到了差。
          它无条件画（停着时画第 0 帧），画在按钮自己的 (x, y) 上，53×54，比 50×50 的按钮
          大一圈，所以要能溢出。
        */}
        <img className="start-button-glow" style={face} src={frameSrc('buttonGlow', button.glowFrame)} alt="" />
      </button>
    )
  }

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div className="start-panel" data-testid="start-panel" onMouseMove={onMouseMove}>
      {/*
        背景图**按原始尺寸画在 (0,0)**，与原版
        `backgroundGraphics.drawImage(backgroundImage, 0, 0, this)` 一致。
        它实测是 1024×641，比舞台高一行 —— 原版画进一张 1024×640 的缓冲图，
        最后一行被裁掉。这里靠 `.start-panel { overflow: hidden }` 裁，
        不是把它缩成 640：缩一下整张图就纵向差半个像素，而画面上看起来正常。
      */}
      <img className="start-back" src={resolveAsset(startAssetId('back'))} alt="" />
      {/* 云。原版画在背景之后、按钮之前，1024×1024，只有 y 在动。 */}
      <img
        className="start-cloud"
        style={{ left: `${CLOUD_X}px`, top: `${view.cloudY}px` }}
        src={resolveAsset(startAssetId('cloud'))}
        alt=""
      />
      {view.buttons.map(renderButton)}
      {/* 卷轴。展开中是 `卷轴`，展开完是 `反向卷轴`，两者同一个左上角。 */}
      <img
        className="start-scroll"
        style={{ left: `${SCROLL_X}px`, top: `${SCROLL_Y}px` }}
        src={frameSrc(view.scroll.sequence, view.scroll.frame)}
        data-sequence={view.scroll.sequence}
        data-frame={view.scroll.frame}
        alt=""
      />
      {/*
        「关于我们」。原版揭开到一半画的是
        `drawImage(img, 0,0,w,640, 0,0,w,640, this)` —— 左边 w 像素**原样**
        露出来，不缩放。DOM 上的对应物是把整张图放进一个宽 w 的裁剪窗口里，
        **不是**给 `<img>` 设 `width: w`（那是缩放，画面上看起来也像在展开，
        而每一列像素都错了）。
      */}
      {view.aboutWidth === null ? null : (
        <div
          className="start-about"
          data-testid="start-about"
          data-width={view.aboutWidth}
          style={{ width: `${view.aboutWidth}px`, height: `${ABOUT_HEIGHT}px` }}
        >
          <img src={resolveAsset(startAssetId('aboutPage'))} alt="关于我们" />
        </div>
      )}
      {/* 两段载入动画。原版 `if (isStop != true)` 才画，所以停着就整个不在。 */}
      {view.loadingFrame === null ? null : (
        <img
          className="start-loading"
          style={{ left: `${LOADING_X}px`, top: `${LOADING_Y}px` }}
          src={frameSrc('loading', view.loadingFrame)}
          data-frame={view.loadingFrame}
          alt=""
        />
      )}
      {view.loading2Frame === null ? null : (
        <img
          className="start-loading"
          style={{ left: `${LOADING2_X}px`, top: `${LOADING2_Y}px` }}
          src={frameSrc('loading2', view.loading2Frame)}
          data-frame={view.loading2Frame}
          alt=""
        />
      )}
      {/* 「回」排在卷轴之后 —— 原版就是这么画的，不然它会被卷轴盖住。 */}
      {view.goBack === null ? null : renderButton(view.goBack)}
      {/*
        自绘鼠标。系统光标由 CSS 的 `cursor: none` 藏起来（原版是一个 16×16
        全透明的自定义 `Cursor`），指针位置由上面那个 `onMouseMove` 换算成
        舞台逻辑坐标。`pointer-events: none` 是必须的：它盖在按钮上面，
        不透传的话鼠标永远进不了任何一颗按钮。
      */}
      <img
        className="start-cursor"
        style={{ left: `${view.cursorX}px`, top: `${view.cursorY}px` }}
        src={frameSrc('cursor', view.cursorFrame)}
        data-frame={view.cursorFrame}
        alt=""
      />
    </div>
  )
}
