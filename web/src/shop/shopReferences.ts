import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { listFiles } from '../assets/listFiles'
import { SHOP_ROOT } from './shopAssets'

/**
 * 「原版代码引用到了 `sources/Shop/` 下的哪几个文件」——**从 Java 源码现扫**
 * （xl-knp.5）。
 *
 * **只在 Node 侧用**（烘焙器与测试）：它 import 了 `node:fs`，进不了浏览器包。
 *
 * ## 为什么是扫源码，不是手写一份名单
 *
 * 这是「双向盖满」里**产物→源**那一半的分母。手写它就等于让被守的东西自己
 * 签字：`UNREFERENCED_SHOP_ASSETS` 那份登记的全部意义在于「有人接上引用时
 * 它要红」，而「有没有接上引用」要是也由我手写，那条红就永远不会来
 * （dispatch.md 纪律 3 里 `xl-rh9.8` 造出恒真判据的那个形状）。
 *
 * 扫源码让它变成一条真判据：给 `ShopPanel.java` 加一句
 * `new ShopAnimation("宋大仁", …)`，这里立刻多出 8 条，`reconcileShopAssets`
 * 第 4 条当场红。
 *
 * ## 扫描的两条规则，都是从源码量出来的
 *
 * 全仓库拼 `sources/Shop/…` 的地方只有五种，`src/` 下现扫可得
 * （2026-09-09：38 条逐字字面量 + 一处 `ShopAnimation` 的拼接）：
 *
 * 1. **逐字字面量** `"sources/Shop/按钮组件/钱.png"` —— 33 张图 + `drug.txt`；
 * 2. **`ShopAnimation` 的构造函数**（`ShopAnimation.java:24` 是
 *    `sources/Shop/商店人物/` 全仓库**唯一**的读取点）：
 *    `image=Reader.readImage("sources/Shop/商店人物/"+s+"/"+s+" ("+i+").png")`，
 *    `i` 从 1 到构造函数第 4 个实参 `length`；
 * 3. `"sources/Shop/" + s + ".txt"`（`ShopReader.readEquipment`）→ 数据表，
 *    由 `shopDataFiles()` 那一头核；
 * 4. `"sources/Shop/药品/回复类/" + <drug.txt 第 4 列>` → `SHOP_ASSETS_OWNED_ELSEWHERE`；
 * 5. `"sources/Shop/装备/" + s + "/" + <表里第 6 列>` → 同上。
 *
 * 这个函数只做 1 与 2 —— 3/4/5 三摊各有自己的对账，在这里再实现一遍等于把
 * `equipmentPictures.ts` 的五条重写一次。
 *
 * ## 三处会骗人的地方
 *
 * - **源码是 GBK 的**（`CLAUDE.md`）。按 UTF-8 读，中文路径会解成乱码，
 *   正则一条都匹配不上 —— 而「一条都没匹配上」与「确实没有引用」长得一模
 *   一样，接着每一张图都会被报成「没登记」。所以下面**先 `TextDecoder('gbk')`
 *   解码**，并且一条都没扫到时是**抛**，不是返回空集。
 * - **`grep 文件名` 不是判据**：那数的是出现次数。「宋大仁」在 `src/` 里有
 *   3 处命中，全是战斗侧的注释。这里认的是**那条路径被拼出来**。
 * - **分母是 `src/` 下的每一个 `.java`**，不是 `src/shop/`。缩到 shop 包
 *   等于先假设「只有它读商店素材」，而那正是要验的事。
 */

/** 原版源码根目录，仓库相对。 */
const JAVA_ROOT = 'src'

/** 逐字字面量：`"sources/Shop/<…>"`。 */
const LITERAL = /"sources\/Shop\/([^"]*)"/g

/**
 * `new ShopAnimation("<角色>", <x>, <y>, <帧数>, this)` —— 只取第 1 与第 4 个
 * 实参。空白照 `[\s\S]` 收，源码里那几行是 CRLF 且实参间有换行。
 */
const SHOP_ANIMATION = /new\s+ShopAnimation\(\s*"([^"]+)"\s*,[^,]*,[^,]*,\s*(\d+)\s*,/g

/** `ShopAnimation.java:24` 那句拼出来的路径。 */
function animationFrame(role: string, frame: number): string {
  return `商店人物/${role}/${role} (${frame}).png`
}

/**
 * 扫出来的引用，相对 `SHOP_ROOT` 的正斜杠路径，去重排序。
 *
 * `onRead` 是给烘焙器把源码记进指纹用的（`useInput`）：不记的话，改
 * `ShopPanel.java` 接上一个新角色而不重烘，产物少 8 张而判据照绿。测试侧
 * 不需要它，默认是恒等。
 */
export function scanShopReferences(
  repoRoot: string,
  onRead: (absolute: string) => string = (p) => p,
): string[] {
  const decoder = new TextDecoder('gbk')
  const javaRoot = resolve(repoRoot, JAVA_ROOT)
  const sources = listFiles(javaRoot).filter((f) => f.endsWith('.java'))
  if (sources.length === 0) {
    throw new Error(`${JAVA_ROOT}/ 下一个 .java 都没有 —— 商店素材的引用集合是从那里扫的`)
  }

  const refs = new Set<string>()
  let literals = 0
  for (const relative of sources.sort()) {
    const text = decoder.decode(readFileSync(onRead(resolve(javaRoot, relative))))
    for (const m of text.matchAll(LITERAL)) {
      const path = m[1] as string
      literals++
      // 拼接用的那几个前缀（`"sources/Shop/"`、`"sources/Shop/商店人物/"`……）
      // 不是文件：没有扩展名的一律不算引用，它们各自的对账在别处。
      if (/\.[A-Za-z0-9]+$/.test(path)) refs.add(path)
    }
    for (const m of text.matchAll(SHOP_ANIMATION)) {
      const role = m[1] as string
      const length = Number(m[2])
      for (let i = 1; i <= length; i++) refs.add(animationFrame(role, i))
    }
  }

  // 一条都没扫到多半是解码错了（GBK 当 UTF-8 读），而它的表现是「每一张图都
  // 没有代码引用」—— 一片红，看起来像素材出了问题。抛，把话说清楚。
  if (literals === 0) {
    throw new Error(
      `扫了 ${sources.length} 个 .java，一条 "${SHOP_ROOT}/…" 字面量都没有 —— ` +
        `多半是源码解码错了（它们是 GBK 的）`,
    )
  }
  return [...refs].sort()
}
