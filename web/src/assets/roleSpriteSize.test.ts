import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'

/**
 * 烘出来的主角精灵，尺寸必须**正好是原版 drawImage 的源矩形**。
 *
 * 为什么这一条要单独立一个用例（xl-u39）：原版 `Role.drawHero` 画的是
 *
 *   走 `g.drawImage(img, x, y-32, x+32, y+32,  0,0, 32,64, …)`
 *   跑 `g.drawImage(img, x-5, y-32, x+37, y+32, 0,0, 42,64, …)`
 *
 * 后面那四个数是**源矩形**，素材比它大的部分被**裁掉**。仓库里真有两张比它大：
 * `roles/zhangxiaofanRun/15.png` 与 `16.png` 是 42×65，其余 14 张 42×64。
 * 而 Web 侧 `sceneRenderer` 走的是 `setSize(42, 64)` —— 那是**缩**，不是裁。
 * 一张 65 行的图缩成 64 行，整个人物纵向重采样一遍：画面看起来完全正常，
 * 只有逐像素比对量得出来（dorm-walk 的三个跑动采样帧各差 360~412 个像素）。
 *
 * 所以裁在烘焙器里做，这里核产物。**核的是产物不是源码**：改回不裁、或者
 * 裁错一维，都会让下面这条红。
 */

/** 走 / 跑各自的源矩形与素材目录。数与编号照抄 `scene.Role` 的构造函数。 */
const SPRITES = {
  walk: { dir: 'roles/zhangxiaofan', count: 32, firstFile: 0, width: 32, height: 64 },
  run: { dir: 'roles/zhangxiaofanRun', count: 16, firstFile: 1, width: 42, height: 64 },
} as const

describe('主角精灵的烘焙尺寸', () => {
  for (const gait of ['walk', 'run'] as const) {
    const spec = SPRITES[gait]

    it(`${gait}：${spec.count} 帧全部烘成源矩形与素材的交集`, () => {
      // 分母是 spec.count 本身，逐帧核一遍：只核"那两张出问题的"等于把判据
      // 钉死在今天这批素材上，换一批素材就悄悄不核了。
      for (let frame = 0; frame < spec.count; frame++) {
        const png = pngSize(repoPath(spec.dir, `${frame + spec.firstFile}.png`))
        const baked = webpSize(
          repoPath('web/src/generated/assets/roles', gait, `${frame}.webp`),
        )
        expect(baked, `${gait} 第 ${frame} 帧`).toEqual({
          width: Math.min(png.width, spec.width),
          height: Math.min(png.height, spec.height),
        })
      }
    })
  }

  /**
   * 上面那条对一批**恰好全是 42×64** 的素材是恒真的 —— 不裁也过。所以这里把
   * "真有比源矩形大的素材"本身也断言出来：哪天素材换了、这条不成立了，要响，
   * 而不是让上面那条退化成一个永远绿的检查。
   */
  it('跑步图里确实有比源矩形高的素材，裁剪这件事不是空转', () => {
    const spec = SPRITES.run
    const taller: number[] = []
    for (let frame = 0; frame < spec.count; frame++) {
      const png = pngSize(repoPath(spec.dir, `${frame + spec.firstFile}.png`))
      if (png.height > spec.height || png.width > spec.width) taller.push(frame)
    }
    // 下标 14 / 15 = 文件 15.png / 16.png = 朝右的第 3、4 帧，42×65。
    expect(taller).toEqual([14, 15])
  })
})

function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24)
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (head.length < 24 || !head.subarray(0, 8).equals(magic)) {
    throw new Error(`${file} 不是 PNG`)
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/**
 * 读一张**无损** WebP 的宽高。烘焙器对 PNG 一律 `-lossless`，产物是单个
 * `VP8L` 块：`RIFF····WEBPVP8L` + 块长 4 字节 + 签名 `0x2f` + 4 字节里
 * 低 14 位存 width-1、接着 14 位存 height-1（WebP Lossless 规范 §2）。
 *
 * 不认的格式一律抛，不猜：猜出来的宽高会让上面那条断言拿两个垃圾数字去比，
 * 而"比垃圾"和"比对了"长得一样。
 */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WEBP') {
    throw new Error(`${file} 不是 WebP`)
  }
  if (b.subarray(12, 16).toString('latin1') !== 'VP8L' || b[20] !== 0x2f) {
    throw new Error(`${file} 不是单块无损 WebP（这里只认烘焙器产出的那一种）`)
  }
  const bits = b.readUInt32LE(21)
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
}
