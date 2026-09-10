import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import {
  PRESENT_BASELINE,
  PRESENT_FONT_SIZE,
  PRESENT_TEXT_DX,
  PRESENT_Y,
  boxPlacement,
  presentCells,
} from './presentLayout'

/**
 * 提示框与宝箱的摆位，**每一个数从 GBK 源码现读**（xl-yg6.10）。
 * 逐帧比对之外，落到哪个像素只有这里核。
 */

function statements(file: string): string {
  const source = javaSource(file).replace(/\s+/g, ' ')
  if (source.length === 0) throw new Error(`${file} 读出来是空的`)
  return source
}

/** 恰好一处匹配，返回各组。零处或多处都抛 —— "没匹配到"与"数对上了"要分得开。 */
function once(text: string, re: RegExp): string[] {
  const all = [...text.matchAll(new RegExp(re.source, 'g'))]
  if (all.length !== 1) throw new Error(`${re} 匹配到 ${all.length} 处，应为 1 处`)
  return all[0]!.slice(1)
}

describe('drawPresentation', () => {
  const src = statements('src/scene/EquipmentEvent.java')

  it('框的上边、正文的偏移与基线、字号、颜色', () => {
    const [y] = once(src, /g\.drawImage\(Reader\.readImage\("dialogue\/\/提示框\.png"\), x_presentImage, (\d+), scene\)/)
    expect(Number(y)).toBe(PRESENT_Y)
    const [dx, baseline] = once(src, /g\.drawString\(bufferedText, x_presentImage \+ (\d+), (\d+)\)/)
    expect([Number(dx), Number(baseline)]).toEqual([PRESENT_TEXT_DX, PRESENT_BASELINE])
    const [size] = once(src, /new Font\("宋体", Font\.BOLD, (\d+)\)/)
    expect(Number(size)).toBe(PRESENT_FONT_SIZE)
    const [color] = once(src, /g\.setColor\(Color\.(\w+)\)/)
    expect(color).toBe('red')
    // `Color.red` → `PRESENT_COLOR` 这一层映射是手写的，拿常量比它自己的字面值
    // 是恒真的装饰，所以这里不比 —— 颜色对不对由逐帧比对说话（maze-treasure）。
  })

  it('全角字按字号整格步进，半角字按量出来的宽度', () => {
    const measured: string[] = []
    const cells = presentCells('得到金疮药 * 2', (c) => {
      measured.push(c)
      return 9
    })
    expect(cells.map((c) => c.x)).toEqual([0, 30, 60, 90, 120, 150, 159, 168, 177])
    // 全角字一次都不许去量 —— 量了就是把漂移放回来。
    expect(measured).toEqual([' ', '*', ' ', '2'])
  })
})

describe('TreasureBox.paintBox', () => {
  const src = statements('src/scene/TreasureBox.java')

  it('格子乘 32 减镜头的 firstTile × 8，开过画 emptyBox', () => {
    const empty = once(src, /if \(isEmpty\) \{ g\.drawImage\((\w+), x \* (\d+) - equipmentEvent\.scene\.otherEvent\.firstTileX \* (\d+), y \* (\d+) - equipmentEvent\.scene\.otherEvent\.firstTileY \* (\d+),/)
    expect(empty).toEqual(['emptyBox', '32', '8', '32', '8'])
    const full = once(src, /\} else \{ g\.drawImage\((\w+), x \* 32 - equipmentEvent\.scene\.otherEvent\.firstTileX \* 8,/)
    expect(full).toEqual(['fullBox'])

    const viewport = { offsetX: -100, offsetY: -60, firstTileX: 12, lastTileX: 140, firstTileY: 7, lastTileY: 87 }
    expect(boxPlacement({ x: 4, y: 17, name: '金疮药', empty: false, near: false }, viewport)).toEqual({
      x: 4 * 32 - 12 * 8,
      y: 17 * 32 - 7 * 8,
      image: 'fullBox',
    })
    expect(boxPlacement({ x: 4, y: 17, name: '金疮药', empty: true, near: true }, viewport).image).toBe(
      'emptyBox',
    )
  })
})
