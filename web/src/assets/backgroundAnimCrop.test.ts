import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { IMAGE_ROOT } from './battleAssets'
import { listFiles } from './listFiles'

/**
 * 背景动画烘出来的产物尺寸对不对（xl-9do）。
 *
 * 原版 `battle.BackgroundAnimation.drawBackAnimation` 把整张图画在 (0,0)、
 * 不缩放，画布是 1024×640，所以超出这个矩形的像素**一个也没有被画出来过**。
 * 但「画不出来」并不等于「该裁」：`cwebp` 的有损档会因为输入变小而重掷一次
 * 量化骰子，可视区内的像素跟着动 —— 所以只有**裁掉的面积够大**（源面积的
 * 四分之一以上）时才裁。逐档的实测与用户裁定见 `scripts/bake.ts` 的
 * `backgroundAnimCrop` 头注。
 *
 * 今天这批素材落在两侧的是（2026-09-07 实测，记录不是断言）：115 张 1240×744
 * 裁掉 29.0% → 裁；30 张 1024×768 裁掉 16.7%、608 张 1066×639 裁掉 3.9% → 不裁。
 *
 * **核的是产物，不是烘焙器的源码**，于是它和 `roleSpriteSize.test.ts` 有同一个
 * 边界：改坏 `scripts/bake.ts` 之后**要重跑 `pnpm bake`**，这条才会红。改了烘焙器
 * 不重烘就跑测试，拿到的是上一批产物的结论 —— 那件事由 `bakeStamp.test.ts` 拦。
 *
 * 下面三条各拦一种坏法，缺一条另两条就成了恒真的：
 *
 * 1. 逐张核尺寸 —— 拦「裁错了」「漏裁了」「裁到了不该裁的那两档」。
 * 2. 门槛两侧都真的有素材 —— 拦「今天这批全在一侧，于是第 1 条退化成恒真」。
 *    两侧都要有：只有该裁的，`cut >= 门槛` 那半是恒真；只有不该裁的，反过来。
 * 3. 技能动画一张都没被裁 —— 拦「裁剪漏到了别的目录」。技能动画由
 *    `battle.Animation` 画在**算出来的**坐标上，裁它就是裁到肉。
 *
 * 第 4 条核的是**前提**：裁剪的合法性整个建立在「原版把它画在 (0,0) 且不缩放」
 * 上，那句话在 Java 源码里。源码哪天变了（迁移期它是规格，本不该变），裁剪就
 * 静静地开始裁掉画得出来的像素，而产物尺寸那三条**照样全绿**。
 */

/** 画布：`battle.BattlePanel` 的 `WIDTH=32*32` / `HEIGHT=20*32`。第 4 条核它。 */
const CANVAS = { width: 1024, height: 640 }

/**
 * 裁剪门槛，与 `scripts/bake.ts` 的 `CROP_MIN_AREA` 是同一个数，**故意各写一份**
 * ——期望值这一侧一旦 import 被测那一侧的常量，改这个数就两边一起改，而这条测试
 * 照绿。这里要的正是「改了烘焙器的门槛，产物没跟着重烘」会红。
 */
const CROP_MIN_AREA = 0.25

/** 这张源图该烘成多大：够门槛就裁到画布，不够就原样。 */
function wantedSize(src: { width: number; height: number }): { width: number; height: number } {
  const visible = {
    width: Math.min(src.width, CANVAS.width),
    height: Math.min(src.height, CANVAS.height),
  }
  const cut = 1 - (visible.width * visible.height) / (src.width * src.height)
  return cut >= CROP_MIN_AREA ? visible : src
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
  it('每一张的产物尺寸都是门槛裁决出来的那个', () => {
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
   * 上面那条在**素材全落在门槛同一侧**时会退化成恒真的一半：全都不该裁的话，
   * 「产物 = 源尺寸」不裁也过；全都该裁的话，反过来。所以两侧各断言一次「非空」。
   *
   * 只断言「非空」，不断言「115 / 638」：张数是别的 agent 换一批素材就会变的东西
   * （dispatch.md 纪律 3），而「这一侧一张都没有」才是判据失效的那个点。
   * 2026-09-07 的读数是该裁 115、不该裁 638，是记录不是断言。
   */
  it('门槛两侧都真的有素材，这条门槛不是空转', () => {
    const cuts = sources(BACKGROUND_ANIM).map((relative) => {
      const src = jpegSize(repoPath(IMAGE_ROOT, BACKGROUND_ANIM, relative))
      const w = wantedSize(src)
      return w.width !== src.width || w.height !== src.height
    })
    expect(cuts.filter(Boolean).length, '一张都不该裁：第 1 条退化成「产物=源」').toBeGreaterThan(0)
    expect(cuts.filter((c) => !c).length, '全都该裁：第 1 条退化成「产物=画布」').toBeGreaterThan(0)
  })

  /**
   * 门槛之下的那些素材**确实还越着界** —— 也就是说「不裁」是门槛裁出来的结论，
   * 不是「它们本来就在画布之内」。少了这一条，把门槛改成 999 也照样全绿。
   */
  it('不裁的那批里确实有越出画布的，是门槛拦下的而不是本来就不越界', () => {
    const oversizedButKept = sources(BACKGROUND_ANIM).filter((relative) => {
      const src = jpegSize(repoPath(IMAGE_ROOT, BACKGROUND_ANIM, relative))
      const w = wantedSize(src)
      const cropped = w.width !== src.width || w.height !== src.height
      return !cropped && (src.width > CANVAS.width || src.height > CANVAS.height)
    })
    // 2026-09-07 的读数是 30 张 1024×768（1066×639 只越宽不越高，也在里面）。
    expect(oversizedButKept.length).toBeGreaterThan(0)
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

    // `x` / `y` 的每一个赋值点都必须是 0。两个构造器各一对，`set()` 不碰它们。
    const assigns = [...java.matchAll(/^\s*(x|y)\s*=\s*([^;]+);/gm)].map((m) => `${m[1]}=${m[2]!.trim()}`)
    expect(assigns.length).toBeGreaterThan(0)
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
    i += 2 + b.readUInt16BE(i + 2)
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
