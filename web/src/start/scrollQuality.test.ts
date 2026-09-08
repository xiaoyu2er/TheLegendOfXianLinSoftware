import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../generated/assets.json'
import { startFrameAssetId } from '../assets/ids'
import type { StartSequenceName } from '../assets/ids'
import { repoPath } from '../test/repoPath'
import {
  START_SEQUENCES,
  START_SEQUENCE_ALIASES,
  aliasSourceFrame,
  isAliasedStartSequence,
} from './assets'

/**
 * 入库的开始界面动画产物，编码方式跟 `START_SEQUENCES` 的 `lossy` 一列对得上
 * 吗（xl-bbs）。
 *
 * 为什么需要这条：`toWebp` 的 `-lossless` 与 `-q 80` 是两条互斥的分支，而
 * **走错了分支在画面上看不出来** —— 无损产物只是大十倍，有损产物只是在 10 倍
 * 放大下更平。xl-bbs 把两段卷轴从 4642 KB 降到 414 KB，靠的就是那个分支，
 * 而"分支被谁不小心改回去了"与"一切正常"在别的任何检查里长得一模一样：
 * `bakeStamp.test.ts` 只核输入没变，`resolve.test.ts` 只核 URL 取得到，
 * `pnpm build` 只关心文件在不在。
 *
 * 判据的分母是**现算的**：`START_SEQUENCES` 有几段、每段几帧，就核几个文件
 * （走别名的那几段除外，它们没有自己的产物，见 xl-l6h）。名单不手抄，加一段
 * 动画自动进来（dispatch.md 纪律 3）。
 */

/** WebP 的编码方式，从产物字节里读出来。 */
type Codec = 'lossless' | 'lossy'

/**
 * 一个 WebP 文件是无损还是有损。
 *
 * RIFF 容器：`RIFF` + 4 字节长度 + `WEBP`，之后是一串 `<4 字节 id><4 字节长度>`
 * 的块。简单文件直接就是 `VP8L`（无损）或 `VP8 `（有损，注意**结尾那个空格**）；
 * 带 alpha 的有损文件走扩展容器 `VP8X`，真正的编码块在后面的子块里。所以这里
 * **走一遍块表**，而不是只看第 12 个字节起的那四个字符 —— 后者对本仓库的卷轴
 * （有 alpha）会读到 `VP8X`，既不是 `VP8L` 也不是 `VP8 `。
 *
 * 认不出来一律抛，不返回一个默认值：默认值会让"文件根本不是 WebP"读起来像
 * "它是无损的"。
 */
function webpCodec(file: string): Codec {
  const buffer = readFileSync(file)
  if (buffer.length < 16 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`${file} 不是 RIFF 容器`)
  }
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${file} 不是 WebP`)
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    if (id === 'VP8L') return 'lossless'
    if (id === 'VP8 ') return 'lossy'
    const size = buffer.readUInt32LE(offset + 4)
    // 块长度是奇数时后面补一个填充字节，不算进长度里。漏掉这个 +1 会让游标
    // 从下一块的中间开始读，于是读出一串垃圾 id，最后落到下面那句抛 ——
    // 那时报的是"认不出编码"，而真相是游标错位。
    // `VP8X` 的子块（`ALPH` / `VP8 `）是**平铺在同一层**的，不是嵌套的，
    // 所以跨过它这 10 个字节就能接着往下读。
    offset += 8 + size + (size % 2)
  }
  throw new Error(`${file} 里既没有 VP8L 也没有 VP8 块，认不出编码`)
}

const ASSETS = repoPath('web/src/generated/assets')
const TABLE = manifest as Record<string, string>

/** 逻辑 ID → 入库产物的绝对路径。映射表里没有这一条就抛，不静静跳过。 */
function productPath(name: StartSequenceName, frame: number): string {
  const id = startFrameAssetId(name, frame)
  const relative = TABLE[id]
  if (relative === undefined) throw new Error(`映射表里没有 ${id}；跑一次 pnpm bake`)
  return resolve(ASSETS, relative)
}

describe('开始界面动画的 WebP 档位', () => {
  it('每一帧的编码方式都跟 START_SEQUENCES 的 lossy 一列一致', () => {
    const wrong: string[] = []
    const read = new Set<string>()
    for (const [name, sequence] of Object.entries(START_SEQUENCES)) {
      const want: Codec = sequence.lossy ? 'lossy' : 'lossless'
      for (let frame = 0; frame < sequence.count; frame++) {
        const file = productPath(name as StartSequenceName, frame)
        const got = webpCodec(file)
        read.add(file)
        if (got !== want) wrong.push(`${name}/${frame}：声明 ${want}，产物 ${got}`)
      }
    }
    expect(wrong).toEqual([])
    // 一条都没核到与"全都对"长得一样。分母现算。
    //
    // 数的是**互异的文件**而不是循环跑了几圈。这一条是篡改矩阵改出来的：
    // 原来数的是圈数，而把下标写死（`startFrameAssetId(name, 0)`）之后循环
    // 照样跑满 45 圈、读出来的编码方式还全对（同一段里每一帧的档位一样），
    // 那一版是绿的。换成互异文件数之后同一条篡改立刻红。
    //
    // **走别名的那几段不进分母**（xl-l6h）：它们没有自己的产物文件，第 f 帧
    // 读到的正是被指向那一段的第 9−f 帧那一份字节。上面那 45 圈仍然跑满，
    // 互异文件只有 35 个 —— 这个减法从 `START_SEQUENCE_ALIASES` 现推，不写
    // 死 35，别人加一段动画时它自己跟着走。
    expect(read.size).toBe(
      Object.entries(START_SEQUENCES)
        .filter(([name]) => !isAliasedStartSequence(name))
        .reduce((sum, [, sequence]) => sum + sequence.count, 0),
    )
    expect(read.size).toBeGreaterThan(0)
  })

  /**
   * 上面那条只证明"声明与产物一致"。声明本身被整列改成 `false` 时它照样绿
   * （重烘一遍就又一致了），所以**裁定那一半要单独钉住**：xl-bbs 选的是
   * 「只给两段卷轴开例外」，别的四段一张都不许降质。
   *
   * 这是一份**登记**，不是分母，所以手写（dispatch.md 纪律 3）—— 从
   * `START_SEQUENCES` 里现筛出来的话，这条就变成恒真的。
   */
  it('开了有损例外的恰好是两段卷轴', () => {
    const lossy = Object.entries(START_SEQUENCES)
      .filter(([, sequence]) => sequence.lossy)
      .map(([name]) => name)
      .sort()
    expect(lossy).toEqual(['backScroll', 'scroll'])
  })

  /**
   * 上面两条之外，还有一份**登记**要钉：哪一段整段指向了另一段（xl-l6h）。
   *
   * 同样手写，理由同上 —— 从 `START_SEQUENCE_ALIASES` 现筛出来的话，这条就是
   * 恒真的（dispatch.md 纪律 3 那条"登记必须由人来签"）。
   */
  it('走别名的恰好是 backScroll，逆序指向 scroll', () => {
    expect(START_SEQUENCE_ALIASES).toEqual({ backScroll: { of: 'scroll', order: 'reverse' } })
  })

  /**
   * 别名在**映射表**那一端真的落下了吗：`backScroll` 的第 f 帧与 `scroll` 的
   * 第 9−f 帧必须是**同一条相对路径**，而且 `backScroll` 不许再有自己的产物
   * 目录。
   *
   * 为什么两句都要：只比路径的话，烘焙器多烘一套 `start/backScroll/*.webp`
   * 留在那儿也读不出来（映射表指着 `scroll`，多出来的文件没人引用，
   * `pnpm build` 一声不吭把它们打进 dist）；只查目录的话，映射表指错帧
   * （比如顺序而不是逆序）照样绿。两半各自打红过（篡改 6 与 7）。
   *
   * ⚠️ **这条单独钉不住「逆序」这件事**：它算期望值用的正是烘焙器用的那个
   * `aliasSourceFrame`，改了那个函数，两边一起跟着改。真正拦住它的是这一对：
   * 只改函数不重烘 → 入库的映射表跟新算法对不上，**这条红**（篡改 6 的形状）；
   * 改了函数又重烘 → 烘焙期那条恒等判据红（篡改 4 实测 10/10 帧对不上）。
   * 所以别把 `aliasSourceFrame` 只留一处读成"这条测试自足了"。
   */
  it('backScroll 逐帧指向 scroll 的逆序帧，且不再有自己的产物目录', () => {
    const alias = START_SEQUENCE_ALIASES.backScroll
    if (alias === undefined) throw new Error('backScroll 的别名登记没了；上一条本该先红')
    const count = START_SEQUENCES.backScroll.count
    const pairs = Array.from({ length: count }, (_, frame) => [
      TABLE[startFrameAssetId('backScroll', frame)],
      TABLE[startFrameAssetId('scroll', aliasSourceFrame(alias, frame, count))],
    ])
    expect(pairs.filter(([mine, theirs]) => mine === undefined || mine !== theirs)).toEqual([])
    // 分母不为零。上一行的 `filter(...).toEqual([])` 在 `count` 为 0 时是恒真的
    // ——「一对都没核到」与「全都对」长得一模一样，跟这个文件里别处那两句
    // `toBeGreaterThan(0)` 是同一条。
    //
    // ⚠️ 这里原来写的是 `expect(pairs).toHaveLength(count)`，那一行**恒真**：
    // `pairs` 是 `Array.from({ length: count })` 造出来的，长度按构造就等于
    // `count`。它读起来像在守分母，其实一次都不可能红（/code-review 标出来的，
    // 已跑代码确认）。
    expect(count).toBeGreaterThan(0)
    expect(existsSync(resolve(ASSETS, 'start/backScroll'))).toBe(false)
  })

  /**
   * 降质是为了字节数，所以字节数也要有个上界 —— 否则"档位还在、但源素材换成
   * 了一批更重的"这件事没人看得见。
   *
   * 上界是**量出来的**：2026-09-08 两段各 414 KB（10 帧合计 423666 字节），
   * 留一倍余量取 900 KB。无损那批是每段 4642 KB，所以这条线离"改回无损"很远
   * 而离今天的实测很近 —— 两边都撞得到。实测过它对"只是变糊得少了"也有分辨力：
   * 档位从 q80 滑到 q95 是 1287 KB，这条红。
   *
   * ⚠️ **走别名的那几段不在这条里量**（xl-l6h）。`backScroll` 没有自己的产物，
   * 量它等于把 `scroll` 那 414 KB 又数了一遍 —— 上界读起来像两道锁，其实是
   * 同一份字节两次。美术只换掉 `反向卷轴/` 那一批的话，拦它的是烘焙期那条
   * 恒等判据（`START_SEQUENCE_ALIASES` 的头注），从来不是这里。
   *
   * ⚠️ **档位本身没有判据，这里只有体积这个代理。** 真要钉住"解回来的像素跟
   * 源差多少"，得在测试里塞一个 WebP 解码器；今天没有。上面那条 q95 → 1287 KB
   * 说明代理不是摆设，但它不是同一件事。
   */
  it('每一段声明为有损的动画，字节数都不超过 900 KB', () => {
    // 名单从 `lossy` 那一列现筛，不手抄 —— 这条验的是**字节数**，不是 lossy
    // 声明本身，所以现筛不会让它变恒真（"恰好是两段卷轴"由上面那条钉着）。
    const lossy = Object.entries(START_SEQUENCES).filter(
      ([name, sequence]) => sequence.lossy && !isAliasedStartSequence(name),
    )
    expect(lossy.length).toBeGreaterThan(0)
    for (const [name, sequence] of lossy) {
      const total = Array.from({ length: sequence.count }, (_, frame) =>
        readFileSync(productPath(name as StartSequenceName, frame)).length,
      ).reduce((sum, n) => sum + n, 0)
      const kb = Math.round(total / 1024)
      expect(kb, `${name} 实测 ${kb} KB`).toBeLessThan(900)
    }
  })
})
