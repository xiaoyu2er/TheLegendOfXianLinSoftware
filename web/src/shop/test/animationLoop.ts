import { javaSource } from '../../test/javaSource'

/**
 * **原版那条鼠标动画线程的参照模型 —— 整个从 GBK 源码解出来（xl-knp.11）。**
 *
 * ## 为什么要有它
 *
 * 「这八格按什么次序、多久换一格」是商店渲染层唯一**两层判据都盖不住**的一维：
 *
 * - **状态真值不记它。** `ShopDriver.snapshotState` 一个动画字段都不记
 *   （状态列里那个 `icon` 是"光标所在那一行的图标"，不是动画）。
 * - **跨端逐帧比对够不着它。** 导出时 `Clock.setFactor(1e-9)` 把
 *   `Clock.sleep(120)` 拉成约 3800 年，那条线程整次导出停在第 0 格
 *   （`replay/main.ts` 的 `SHOP_FROZEN_FRAME = 0`）—— 也就是说逐帧比对
 *   验得了「谁站在哪、画的是哪一张」，验不了「这八格怎么转」。
 *
 * 这与 `xl-knp.7` 那三条「真值盖不到那个分支」是同一族，但更深一层：不是真值
 * 恰好没走到，而是**导出机制本身把这一维冻掉了**。出路照那一票的第二条走 ——
 * **判据回到 GBK 源码上取**。
 *
 * ## 它解的是「怎么转」，不是「几格」
 *
 * 帧数 8、每格 120ms、坐标那几个数，`layout.test.ts` 与 `render/animation.test.ts`
 * 已经在守。这里解的是那条 `for` 的**形状**：从哪起、到哪止、每次走多少、
 * 走完之后回不回头。所以模型不是"抄一份 0..7 的表"，而是照解出来的四个数
 * **算**出来的 —— 原版哪天写成 `i += 2` 或者 `i--`，模型跟着变，而实现不变
 * 的话当场对不上。
 *
 * ⚠️ **为什么连 `while (true)` 都要解**：少了它这段就只是"开局走八格然后停住"，
 * 而**停住与循环在头八格里长得一模一样** —— 判据只有跨过第 8 格才分得开，
 * 那正是 `wraps` 这个字段存在的理由。
 */
export interface AnimationLoop {
  /** `for (int i = <from>; …` */
  readonly from: number
  /** `…; i < <bound>; …`（开区间上界） */
  readonly bound: number
  /** `…; i++)` 的步长。 */
  readonly step: number
  /** 那条 `for` 外面套着 `while (true)` —— 走完一圈从头再来。 */
  readonly wraps: boolean
  /** 循环体里 `tools.Clock.sleep(<ms>)` 的实参。 */
  readonly intervalMs: number
  /** 循环变量名。`mouses[i]` 与 `images.get(i)` 都要用这一个。 */
  readonly variable: string
}

/**
 * 从一份面板源码里解出那条线程。
 *
 * 界标一层套一层，每一层解不出来都是**抛错**而不是给默认值：一个解错了的
 * 模型与一个解对了的模型在下游长得一模一样，而"零匹配"是这一族最会骗人的
 * 结果（`javaSource.ts` 的头注、`dispatch.md` 的 GBK 那条）。
 */
export function parseAnimationLoop(source: string): AnimationLoop {
  const at = source.indexOf('Thread mouseAnimation = new Thread()')
  if (at < 0) throw new Error('mouseAnimation 那条线程的界标没找着 —— 多半是 GBK 解码错了')
  // 到 `mouseAnimation.start();` 为止：那是这条线程在源码里的最后一句。
  const end = source.indexOf('mouseAnimation.start();', at)
  if (end < 0) throw new Error('mouseAnimation.start() 的尾界标没找着')
  const body = source.slice(at, end)

  const forHeader = body.match(/for \(int (\w+) = (-?\d+); \1 < (-?\d+); \1(\+\+|--|\+= *\d+)\) \{/)
  if (!forHeader) throw new Error('那条 for 的头没解出来')
  const variable = forHeader[1]!
  const from = Number(forHeader[2])
  const bound = Number(forHeader[3])
  const inc = forHeader[4]!
  const step = inc === '++' ? 1 : inc === '--' ? -1 : Number(inc.replace(/\+=\s*/, ''))

  // `while (true)` 必须在那条 for **之前**出现，且两者之间只有空白 —— 否则
  // 它套的是别的东西，而"套着"与"没套"在头八格里分不开。
  const between = body.slice(0, body.indexOf(forHeader[0]))
  const whileAt = between.lastIndexOf('while (true) {')
  if (whileAt < 0) throw new Error('那条 for 外面没有 while (true)')
  if (between.slice(whileAt + 'while (true) {'.length).trim() !== '') {
    throw new Error('while (true) 与那条 for 之间还有别的语句 —— 套的不是它')
  }

  const sleep = body.match(/tools\.Clock\.sleep\((\d+)\);/)
  if (!sleep) throw new Error('循环体里的 Clock.sleep 没解出来')

  // 鼠标图与四条人物动画**都要拿同一个循环变量**。抄错一个下标的表现是
  // 「五张图各转各的」，而单看任何一张都正常。
  if (!body.includes(`mouse = mouses[${variable}];`)) {
    throw new Error(`循环体里没有 mouse = mouses[${variable}];`)
  }
  if (!body.includes(`animation.image=animation.images.get(${variable});`)) {
    throw new Error(`循环体里没有 animation.image=animation.images.get(${variable});`)
  }

  return { from, bound, step, wraps: true, intervalMs: Number(sleep[1]), variable }
}

/** 两个面板各自解一遍。⚠️ 两段源码是复制粘贴的关系，解出来必须一模一样。 */
export function animationLoopOfPanels(): AnimationLoop {
  const drug = parseAnimationLoop(javaSource('src/shop/ShopPanel.java'))
  const equipment = parseAnimationLoop(javaSource('src/shop/EquipmentShopPanel.java'))
  if (JSON.stringify(drug) !== JSON.stringify(equipment)) {
    throw new Error(
      `两个面板的动画线程解出来不一样：${JSON.stringify(drug)} / ${JSON.stringify(equipment)}`,
    )
  }
  return drug
}

/**
 * 这条循环**依次走过**的那几格，前 `count` 个。
 *
 * 照解出来的四个数算，不是抄一份 0..7。走完一圈从 `from` 再来（`wraps`）；
 * 不循环的话第 8 个及以后就没有了 —— 那时返回的数组比 `count` 短，而调用处
 * 的 `toEqual` 会因为长度对不上而红。
 */
export function loopFrames(loop: AnimationLoop, count: number): number[] {
  const out: number[] = []
  let i = loop.from
  while (out.length < count) {
    if (loop.step > 0 ? i >= loop.bound : i <= loop.bound) {
      if (!loop.wraps) return out
      i = loop.from
    }
    out.push(i)
    i += loop.step
  }
  return out
}
