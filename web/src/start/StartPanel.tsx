import { useEffect, useRef } from 'react'
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

/** 视图组件收的几种输入。取图页不给（它只画、不收输入）。 */
export interface StartPanelHandlers {
  readonly hover: (key: StartButtonKey | null) => void
  readonly press: (key: StartButtonKey | null) => void
  readonly release: (key: StartButtonKey | null) => void
  readonly click: (key: StartButtonKey) => void
  readonly moveCursor: (x: number, y: number) => void
}

/** `MouseEvent.button` → 它在 `buttons` 里占的那一位（左 1、中 4、右 2，与 `app/App.tsx` 同一张表）。 */
const BUTTON_BITS: readonly number[] = [1, 4, 2, 8, 16]

/**
 * 一个 DOM 事件落在哪颗按钮上 —— 命中判定归 DOM（按钮元素占的就是命中框，见 `buttons.ts`），
 * 这里只顺着 `target` 往上找。禁用的那颗按空处算，与悬停同一个口径（ADR-0001 的 start-exit-disabled）。
 */
function buttonOf(target: EventTarget | null): StartButtonKey | null {
  if (!(target instanceof Element)) return null
  const key = target.closest<HTMLElement>('.start-button')?.dataset.key as StartButtonKey | undefined
  return key !== undefined && START_BUTTON_WIRING[key].enabled ? key : null
}

/**
 * 客户端坐标 → 舞台**逻辑坐标**（1024×640），不裁（舞台外就是负数或超出）。外接矩形为 0（没布局）
 * 就 `null`。跟 `app/App.tsx` 的 `stagePointIn` 同一套换算，同一个理由：`offsetX` 在有 CSS 缩放时
 * 给的是**缩放后**的像素，指针越靠右偏得越多，而画面看起来完全正常。
 */
function stagePoint(
  panel: Element,
  event: { readonly clientX: number; readonly clientY: number },
): { x: number; y: number } | null {
  const box = panel.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null
  return {
    x: Math.round(((event.clientX - box.left) / box.width) * STAGE_WIDTH),
    y: Math.round(((event.clientY - box.top) / box.height) * STAGE_HEIGHT),
  }
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
   * 按下挂在面板上，**松手按下那一刻挂到 window 上**（xl-4zo）—— 原版的对应物是 Swing 的
   * mouse grab：在面板上按下，松手不论落在哪儿都派给这块面板。原版 `mouseReleased` 先
   * `setButton()`，它只看 `isclicked`、不看坐标，所以在按钮上按下、拖出框松手照样触发。
   *
   * 只挂一个面板上的 `onMouseUp` 不够：拖出舞台松手它收不到。反过来也不能常挂在 window 上：
   * 舞台外按下、拖进来松手，原版一下都不收（按下不在面板上，grab 不归它）。
   *
   * `buttons` 为 0 才解除（和弦里每一下松手原版都收，都要送）。松在禁用的「结」上，浏览器一下
   * `mouseup` 都不派（无头 Chrome 153（CDP 派输入）量过，xl-qzx：只派 `pointerup`，`click` 改派给面板；jsdom 照派）；
   * 窗口外松手按「可能不派」写 —— ⚠️ 真窗口外没量过：CDP 派到视口外的松手 window 收得到，可那不经过
   * 操作系统。舞台外、窗口内松手 window 照收（量过）。两种都靠回来头一下没按着键的移动当场补上
   * 那一下松手，与 `app/App.tsx` 的 `grabRelease` 同一个做法；补的落点是见到它的那一刻，不是真正松手的地方。
   *
   * 面板上的 `dragstart` 一律取消（xl-qzx）：在背景图上按下拖一段，Chrome 起了 `<img>` 的原生拖放，
   * 之后 `pointercancel`、mousemove 与 mouseup 一下都不再派 —— 自绘光标冻住、松手丢了（无头 Chrome 153（CDP 派输入）
   * 量过，`scripts/measureStartInput.ts` 的 2c）。原版 Swing 没有拖放。
   *
   * 按下、松手、grab 期间的拖动都先记自绘鼠标的坐标（原版三个监听器头两句都是 `currentX = e.getX()`；补的松手记见到的那一刻）。
   * grab 期间 JDK 17 `LightweightDispatcher` 把 MOUSE_DRAGGED / MOUSE_RELEASED 照样派给这块面板，
   * 坐标只减面板偏移、不裁：拖出舞台就是负数或超过 1024×640，光标画到画面外去（xl-40m）。
   */
  const grabRef = useRef<(() => void) | null>(null)
  useEffect(() => () => grabRef.current?.(), [])
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!handlers) return
    const own = BUTTON_BITS[event.button] ?? 0
    const othersHeld = (event.buttons & ~own) !== 0
    // 没 grab、而这一下之外还按着别的键（舞台外按下拖进来的）：`isMouseGrab` 为真，目标还是那个 null
    // —— 按下不派、不起 grab，之后的拖动与松手也就一个都不收（xl-m9q，与 `App.tsx` 的 `grabbedElsewhere`
    // 同一判法）。⚠️ 未验证：全松开那一下 JDK 会重设目标并派松手，原版收不收得到要看平台把它送给谁。
    if (grabRef.current === null && othersHeld) return
    const panel = event.currentTarget
    const moveTo = (e: { readonly clientX: number; readonly clientY: number }) => {
      const p = stagePoint(panel, e)
      if (p) handlers.moveCursor(p.x, p.y)
    }
    moveTo(event)
    // 拦截还挂着、而这一下之外没按着别的键：上一次的松手丢在窗口外了，回来没动就又按下。
    // 先补上那一下松手（落点是见到它的这一刻），再送这次按下 —— 与 `App.tsx` 的 `grabRelease`
    // 里 `onPress` 同一个判法（按下看的是**别的**键，`isMouseGrab`）。
    if (grabRef.current !== null && !othersHeld) {
      grabRef.current()
      handlers.release(buttonOf(event.target))
    }
    handlers.press(buttonOf(event.target))
    if (grabRef.current !== null) return
    const onUp = (e: MouseEvent) => {
      if (e.buttons === 0) end()
      moveTo(e)
      handlers.release(buttonOf(e.target))
    }
    const onMove = (e: MouseEvent) => {
      moveTo(e)
      if (e.buttons !== 0) return
      end()
      handlers.release(buttonOf(e.target))
    }
    const end = () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove, true)
      grabRef.current = null
    }
    grabRef.current = end
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove, true)
  }

  /**
   * 一次没按着键的 `mousemove` → 自绘鼠标（原版 `mouseMoved`）。按着键的归上面挂到 window 上的
   * `onMove`（grab 在这块面板上，舞台外也记）；grab 不在这块面板上（舞台外按下再拖进来）不记：
   * 原版目标是 null，`mouseDragged` 一次都不派（xl-b98）。
   */
  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!handlers || event.buttons !== 0) return
    const p = stagePoint(event.currentTarget, event)
    if (p) handlers.moveCursor(p.x, p.y)
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
        data-key={button.key}
        // ⚠️ `onMouseMove` 与 `onMouseEnter` **两个都要**，且只认**没按着键**的。原版 `mouseMoved`
        // 每动一个像素就对每颗按钮重跑 `isMoveIn`，而 `isPressedButton` 会把高亮停掉 —— 于是"点一下、
        // 不出框、动一动"高亮当场续播；只挂 `onMouseEnter` 就得移出去再移回来才转。按着键是
        // `mouseDragged`，它只记坐标、不跑 `isMoveIn`（舞台外按下再拖进来，原版连它都不派），所以
        // `buttons` 非 0 不碰悬停（xl-vi8）。移出**也看键**（xl-4zo）：拖出框时原版的按下图留到松手，
        // 松手那一下（面板上的 `onMouseDown` 挂到 window 上的那个）再按落点把图换回来。
        // 命中判定仍然归 DOM（按钮元素占的就是那个命中框，见 `buttons.ts`），这里不自己算坐标。
        onMouseMove={(event) => { if (event.buttons === 0) handlers?.hover(button.key) }}
        onMouseEnter={(event) => { if (event.buttons === 0) handlers?.hover(button.key) }}
        onMouseLeave={(event) => { if (event.buttons === 0) handlers?.hover(null) }}
        // 鼠标按下不给焦点：焦点会走下面的 `onFocus` = 悬停，把 `isPressedButton` 刚停掉的高亮
        // 当场又转起来。原版没有焦点这回事，按下就是按下。无头 Chrome 153（CDP 派输入）量过（xl-qzx）：按过之后焦点
        // 留在 body；「关于」展开后头一下 Tab 落在「返回标题」上，回车 / 空格照按得动。它还顺带挡了按钮里那两张图的原生拖放。
        onMouseDown={(event) => event.preventDefault()}
        // @exception ADR-0001#start-focus-hover
        // 键盘走到这颗上等于"鼠标移进来"：原版没有这一条（它只认坐标），
        // 是这里补的无障碍。补它而不是只补一条 CSS，是为了让那圈高亮动画
        // 也跟着转 —— 只换图不转动画，Tab 过来的人看到的是一颗半死的按钮。
        onFocus={() => handlers?.hover(button.key)}
        onBlur={() => handlers?.hover(null)}
        // 只收键盘的那一下（`detail` 为 0：回车 / 空格 / 读屏的激活）。鼠标的 `click` 在按下与松手
        // 之后才来，那两下已经由面板上的 `onMouseDown` 与挂到 window 上的松手送过了（xl-4zo）。
        onClick={(event) => { if (event.detail === 0) handlers?.click(button.key) }}
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
    <div className="start-panel" data-testid="start-panel" onMouseMove={onMouseMove} onMouseDown={onMouseDown} onDragStart={(event) => event.preventDefault()}>
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
