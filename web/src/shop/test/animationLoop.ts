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
 * 恰好没走到，而是**导出机制本身把这一维冻掉了**。
 *
 * ## 三条路，各自评估过（xl-knp.11）
 *
 * ### (a) 导出时不冻时钟，或改用别的推进方式 —— **不选**
 *
 * **(a1) 直接把 `ShopDriver.SLOW` 调回 `1.0`：不选，而且理由是量出来的。**
 * 影响面先量清楚了：`Clock.setFactor` 只有 `MenuDriver` 与 `ShopDriver` 用
 * （`SceneDriver` 只 `freezeTimers`，`BattleDriver` 自带两段倍率），而一次导出
 * 只跑一条剧本，所以动它波及的**只有商店那几条**。真正拦住这条路的是下面这个
 * 读数 —— 2026-09-09 实测，把 `SLOW` 改成 `1.0` 之后把 `shop-party` 在两个
 * 独立 JVM 里各导一遍：
 *
 *     trace.json      两遍**逐字节一致**
 *     导出的位图      15 帧里 **14 帧两遍不同**
 *
 * 也就是说 `tools/export-trace.sh --check`（只 `cmp` trace.json）与
 * `git diff tools/traces/out`（产物里没有位图）**两道都是绿的**，而跨端逐帧
 * 比对从此每一轮结果都不一样 —— 一次偶然的通过与一次真的对上长得一模一样。
 * 这正是 `dispatch.md` 反复点名的那种形状，代价远大于它买到的东西。
 *
 * **(a2) 学 `BattleDriver` 在 `repaint()` 上装闸门，一步放一格：不选，理由是
 * 代价与收益不匹配。** 技术上做得到（重写 `repaint()` 是虚派发，不用碰
 * `src/`），做成之后逐帧比对能守住**次序与回绕**。但：它守不住 **120ms 那一格
 * 有多久**（闸门恰恰把时间这一维抹掉了），而那正是下面这份模型顺手解出来的；
 * 它要改的是**已经验收过**的商店导出机制（四条剧本的位图全变，`awaitFirstFrame`
 * 那段竞态要重新想一遍）；而且闸门放行的节奏由驱动器说了算，回放端也得跟着
 * 按同一个节奏算帧号 —— 两端的"一步一格"都是我们自己写的。**留作后手**：
 * 哪天这份源码模型被证明不够，它是下一条路。
 *
 * ### (b) 判据回到 GBK 源码上取 —— **选它**
 *
 * 就是这个文件。`xl-knp.7` 三条绿的篡改也是这么救回来的，是本仓库已经走通的
 * 路子。它一次买到四样：次序、回绕、每格毫秒数、以及"五张图共用同一个下标"。
 * 它买不到的那一样照实说：**它证不了浏览器里真的在转** —— 那一半由
 * `render/useShopPreview.test.tsx` 把 hook 真挂起来补上（React 真跑、计时器
 * 用 `vi.useFakeTimers` 推、只有 `ShopRenderer` 是假的）。
 *
 * ### (c) 登记成不可验 —— **不选**
 *
 * 只有在 (a) 与 (b) 都够不着时才该走这条。(b) 当天就做出来了，而且**实测让两条
 * 本来全绿的篡改变红**（矩阵在 `useShopPreview.test.tsx` 的头注里）。在有会红的
 * 判据可写时登记"不可验"，等于把一个能守的洞写成公告。
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

  // `while (true)` 要在那条 for **之前**出现，且两者之间只有空白 —— 否则它套的
  // 是别的东西。⚠️ 这一条**解出布尔值，不抛错**：抛错的话 `wraps` 就永远是
  // 字面量 `true`，「断言本身按构造成立」（dispatch.md 纪律 3 那一族），
  // 而它恰恰是这份模型里最要紧的一位 —— 不循环的话头一圈与循环长得一模一样。
  const between = body.slice(0, body.indexOf(forHeader[0]))
  const whileAt = between.lastIndexOf('while (true) {')
  const wraps =
    whileAt >= 0 && between.slice(whileAt + 'while (true) {'.length).trim() === ''

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

  return { from, bound, step, wraps, intervalMs: Number(sleep[1]), variable }
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
