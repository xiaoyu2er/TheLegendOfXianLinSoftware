import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { IMAGE_ROOT } from './battleAssets'
import { listFiles } from './listFiles'

/**
 * 背景动画烘出来的产物尺寸对不对（xl-9do；门槛在 xl-x6w 里删掉了）。
 *
 * 原版 `battle.BackgroundAnimation.drawBackAnimation` 把整张图画在 (0,0)、
 * 不缩放，画布是 1024×640，所以超出这个矩形的像素**一个也没有被画出来过**。
 * 但「画不出来」并不等于「该裁」：`cwebp` 的有损档会因为输入变小而重掷一次
 * 量化骰子，可视区内的像素跟着动 —— xl-9do 因此加了一条面积门槛
 * （`CROP_MIN_AREA = 0.25`），只裁 1240×744 那一档。
 *
 * **xl-x6w 把那条门槛删了，改回「越界就裁」**，因为战斗有损那条路加了
 * `-sns 0`，裁引起的最坏单张恶化从 +18032 降到 +2869（2×2 全量实测见
 * `scripts/bake.ts` 的 `BATTLE_LOSSY_SNS` 头注）。骰子**没有消失**，只是小了
 * 一个量级 —— 这两件事是捆在一起的一个决定。
 *
 * 于是今天这批 753 张**全都越界、全都被裁**，第 2 条那种「门槛两侧各非空」
 * 的对撞不再存在。**但第 1 条没有因此退化成恒真**：三档源尺寸裁出来的目标
 * 矩形是三个不同的值（1066×639 → 1024×639 只削宽、1024×768 → 1024×640 只削高、
 * 1240×744 → 1024×640 两边都削），所以「无脑输出 1024×640」这种坏法会在 608 张
 * 上红。新的第 2 条守的正是这件事：**三种越界形态各非空**，可视矩形是逐张
 * 两条边各自 `min` 出来的，不是一个常数。
 *
 * **核的是产物，不是烘焙器的源码**，于是它和 `roleSpriteSize.test.ts` 有同一个
 * 边界：改坏 `scripts/bake.ts` 之后**要重跑 `pnpm bake`**，这条才会红。改了烘焙器
 * 不重烘就跑测试，拿到的是上一批产物的结论 —— 那件事由 `bakeStamp.test.ts` 拦。
 *
 * 下面三条各拦一种坏法，缺一条另两条就成了恒真的：
 *
 * 1. 逐张核尺寸 —— 拦「裁错了」「漏裁了」「裁到了不该裁的目录」。
 * 2. 三种越界形态各非空 —— 拦「今天这批只越一条边，于是第 1 条对另一条边恒真」。
 * 3. 技能动画一张都没被裁 —— 拦「裁剪漏到了别的目录」。技能动画由
 *    `battle.Animation` 画在**算出来的**坐标上，裁它就是裁到肉。
 *
 * 第 4 条核的是**前提**：裁剪的合法性整个建立在「原版把它画在 (0,0) 且不缩放」
 * 上，那句话在 Java 源码里。源码哪天变了（迁移期它是规格，本不该变），裁剪就
 * 静静地开始裁掉画得出来的像素，而产物尺寸那三条**照样全绿**。
 *
 * **上面说「三条」「第 4 条」，文件里就恰好是四个 `it`，别再多一个。**
 * xl-x6w 起初还加了第五条「越界的一张都没漏裁」，`/code-review` 规范轴指出它
 * **被第 1 条完全蕴含**：第 1 条已经断言每张产物都等于 `min(源, 画布)`，越界的
 * 那张必然 `产物 ≠ 源`，于是第五条只要第 1 条绿就恒绿 —— 它是个诊断，不是判据，
 * 而**假判据和真判据长得一样**。已删。要加第五条，先说清它能红而这四条全绿的
 * 那种坏法是什么。
 */

/** 画布：`battle.BattlePanel` 的 `WIDTH=32*32` / `HEIGHT=20*32`。第 4 条核它。 */
const CANVAS = { width: 1024, height: 640 }

/**
 * 这张源图该烘成多大：越界就裁到可视矩形，不越界就原样。
 *
 * **故意不 import `scripts/bake.ts` 的 `backgroundAnimCrop`**：期望值这一侧一旦
 * 跟被测那一侧共用代码，共用的那段错了两边就一起错，而这条测试照绿
 * （`jpegSize` 的头注写的是同一件事）。
 */
function wantedSize(src: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.min(src.width, CANVAS.width),
    height: Math.min(src.height, CANVAS.height),
  }
}

const BACKGROUND_ANIM = '背景动画'
const SKILL_ANIM = '技能动画'

/** 产物落在 `web/public/battle-anim/<目录>/<帧号>.webp`（按需加载那一半）。 */
const productOf = (relative: string) =>
  repoPath('web/public/battle-anim', relative.replace(/\.[^./]+$/, '.webp'))

/** 分母现扫，不写死张数：少一张是源素材少了，`git status` 立刻看得见。 */
function sources(topDir: string): string[] {
  const all = listFiles(repoPath(IMAGE_ROOT, topDir)).sort()
  expect(all.length, `${IMAGE_ROOT}/${topDir} 下一张素材都没扫到`).toBeGreaterThan(0)
  return all
}

describe('背景动画的烘焙裁剪', () => {
  it('每一张的产物尺寸都是可视矩形算出来的那个', () => {
    const wrong: string[] = []
    for (const relative of sources(BACKGROUND_ANIM)) {
      const src = jpegSize(repoPath(IMAGE_ROOT, BACKGROUND_ANIM, relative))
      const baked = webpSize(productOf(`${BACKGROUND_ANIM}/${relative}`))
      const want = wantedSize(src)
      if (baked.width !== want.width || baked.height !== want.height) {
        wrong.push(
          `${relative}：源 ${src.width}×${src.height}，产物 ${baked.width}×${baked.height}，` +
            `应为 ${want.width}×${want.height}`,
        )
      }
    }
    expect(wrong).toEqual([])
  })

  /**
   * 上面那条在**这批素材只越一条边**时会对另一条边退化成恒真：假如全都只越宽，
   * 那么 `height` 那一半写 `min` 还是写「原样」都过；反过来同理；而假如没有一张
   * 两条边都越，「两条边同时裁」这件事就一次都没被走到过。所以**三种形态各断言
   * 一次非空**。
   *
   * 只断言「非空」，不断言「608 / 30 / 115」：张数是别的 agent 换一批素材就会变
   * 的东西（dispatch.md 纪律 3），而「这一类一张都没有」才是判据失效的那个点。
   * 2026-09-08 的读数是只越宽 608（1066×639）、只越高 30（1024×768）、
   * 两边都越 115（1240×744），是记录不是断言。
   */
  it('三种越界形态各有素材，可视矩形是两条边各自算出来的', () => {
    const shapes = sources(BACKGROUND_ANIM).map((relative) => {
      const src = jpegSize(repoPath(IMAGE_ROOT, BACKGROUND_ANIM, relative))
      return { w: src.width > CANVAS.width, h: src.height > CANVAS.height }
    })
    expect(shapes.filter((s) => s.w && !s.h).length, '没有一张只越宽：削高那一半恒真').toBeGreaterThan(0)
    expect(shapes.filter((s) => !s.w && s.h).length, '没有一张只越高：削宽那一半恒真').toBeGreaterThan(0)
    expect(shapes.filter((s) => s.w && s.h).length, '没有一张两边都越：同时裁没被走到').toBeGreaterThan(0)
  })

  it('技能动画那一层一张都没被裁', () => {
    const cropped: string[] = []
    for (const relative of sources(SKILL_ANIM)) {
      const src = pngSize(repoPath(IMAGE_ROOT, SKILL_ANIM, relative))
      const baked = webpSize(productOf(`${SKILL_ANIM}/${relative}`))
      if (baked.width !== src.width || baked.height !== src.height) {
        cropped.push(`${relative}：源 ${src.width}×${src.height} → 产物 ${baked.width}×${baked.height}`)
      }
    }
    expect(cropped).toEqual([])
  })

  it('原版确实把背景动画整张画在 (0,0) 且不缩放，画布确实是 1024×640', () => {
    const java = javaSource('src/battle/BackgroundAnimation.java')

    // 四参数的 drawImage：`(img, x, y, observer)`。十参数那一支会带源矩形与
    // 缩放，届时"裁到画布"就不再是等价变换。
    const draws = [...java.matchAll(/g\.drawImage\(([^;]*?)\);/g)].map((m) => m[1]!.trim())
    expect(draws).toEqual(['currentImage, x, y, bp'])

    // `x` / `y` 的每一个赋值点都必须是 `=0`。两个构造器各一对，`set()` 不碰它们。
    //
    // 正则要认全所有**写**的形态，不能只认行首的裸赋值：`this.x=`、`x+=`、`x++`
    // 逃出去之后「没匹配到」就是这条判据的通过条件（dispatch.md：「找不到东西」
    // 不许成为通过条件）。所以这里连 `this.`、复合赋值与自增自减一起抓，
    // 抓到什么都原样记进 `assigns`，让它去和白名单比。
    const assigns = [
      ...java.matchAll(/(?:^|[^\w.])(?:this\.)?([xy])\s*(\+\+|--|[-+*/%]?=)\s*([^;]*);/g),
    ].map((m) => `${m[1]}${m[2]}${m[3]!.trim()}`)
    expect(assigns.length, 'x/y 的赋值点一个都没匹配到 —— 界标写错了或源码挪走了').toBeGreaterThan(0)
    // 四处：两个构造器各写一次 x 与 y。多出任何别的形态都会在这里现形。
    expect(assigns.length).toBe(4)
    expect([...new Set(assigns)].sort()).toEqual(['x=0', 'y=0'])

    const panel = javaSource('src/battle/BattlePanel.java')
    const dims = Object.fromEntries(
      [...panel.matchAll(/static final int (WIDTH|HEIGHT)\s*=\s*([^;]+);/g)].map((m) => [
        m[1]!,
        // `32*32` / `20*32`：照抄的是表达式，这里按乘法算出来，不抄结果。
        m[2]!.split('*').reduce((a, b) => a * Number(b.trim()), 1),
      ]),
    )
    expect(dims).toEqual({ WIDTH: CANVAS.width, HEIGHT: CANVAS.height })
  })
})

function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24)
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (head.length < 24 || !head.subarray(0, 8).equals(magic)) throw new Error(`${file} 不是 PNG`)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/**
 * 读一张 JPEG 的宽高。**与烘焙器里的 `jpegSize` 是两份独立的实现，故意不共用**
 * ——期望值这一侧一旦跟被测那一侧共用代码，共用的那段错了两边就一起错，而测试
 * 照绿（`roleSpriteSize.test.ts` 的头注写的是同一件事）。
 */
function jpegSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error(`${file} 不是 JPEG`)
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const m = b[i + 1]!
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2
      continue
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    const length = b.readUInt16BE(i + 2)
    // 段长 < 2 会让 `i` 不前进，循环永远走不完 —— 而「测试跑不完」和「测试还没跑」
    // 在 CI 上长得一样。烘焙器那份有这条守卫，这份原先漏了。
    if (length < 2) throw new Error(`${file} 的段长 ${length} 不合法`)
    i += 2 + length
  }
  throw new Error(`${file} 里找不到 SOF 段`)
}

/**
 * 读一张 WebP 的宽高，**有损（VP8）与无损（VP8L）两种都认**：背景动画的源是
 * JPG 走 `-q`，技能动画的源是 PNG 走 `-lossless`，这条测试两边都要读。
 * 认不出的一律抛 —— 猜出来的宽高会让上面几条拿两个垃圾数字去比。
 */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WEBP') {
    throw new Error(`${file} 不是 WebP`)
  }
  const fourcc = b.subarray(12, 16).toString('latin1')
  if (fourcc === 'VP8L') {
    if (b[20] !== 0x2f) throw new Error(`${file} 的 VP8L 签名不对`)
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (fourcc === 'VP8 ') {
    // 关键帧头：3 字节 tag + 起始码 9d 01 2a + 两个小端 16 位，各取低 14 位。
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      throw new Error(`${file} 的 VP8 起始码不对（不是关键帧？）`)
    }
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  throw new Error(`${file} 是 ${fourcc}，这里只认烘焙器产出的 VP8 / VP8L`)
}
