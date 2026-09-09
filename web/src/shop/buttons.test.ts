import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import {
  clickedLabels,
  hits,
  moveInButton,
  pressButton,
  releaseButton,
  shopButton,
} from './buttons'

/**
 * `tools.GameButton` 那三个判定方法，**基类那一份**。
 *
 * `menu/buttons.test.ts` 守的是 `menu.MenuButton` 的覆写版（多一层 `isDraw`
 * 守卫）。商店用的是裸的 `GameButton`，两处的差别正好是**一条判据能不能红**
 * 的差别，所以两边各有一份测试，不共用。
 */

const source = javaSource('src/tools/GameButton.java')
const box = { x: 100, y: 50, width: 40, height: 20 }

describe('GameButton 基类的三个判定', () => {
  it('命中框比画出来的位置偏左 15、偏上 6，四个不等号都是严格的 —— 从源码解出来', () => {
    const matches = [
      ...source.matchAll(
        /currentX>x-(\d+)&&currentX<\(x\+width-(\d+)\)&&currentY>\(y-(\d+)\)&&currentY<\(y\+height-(\d+)\)/g,
      ),
    ]
    // 三个方法各一处。零匹配是硬失败：它与"偏移不存在"长得一样。
    expect(matches, 'GameButton 里那三处命中判据').toHaveLength(3)
    for (const m of matches) {
      expect([m[1], m[2], m[3], m[4]]).toEqual(['15', '15', '6', '6'])
    }
    // 左上两条边不算命中（严格不等号）。
    expect(hits(box, box.x - 15, box.y - 6)).toBe(false)
    expect(hits(box, box.x - 14, box.y - 5)).toBe(true)
    // 右下两条边同理。
    expect(hits(box, box.x + box.width - 15, box.y + box.height - 6)).toBe(false)
    expect(hits(box, box.x + box.width - 16, box.y + box.height - 7)).toBe(true)
  })

  it('⚠️ isPressedButton 的 else **不清 isclicked** —— 按下之后一直挂着', () => {
    // 源码里 `isPressedButton` 的 else 只有一句 `buttonImage=normalImage;`。
    const body = source.match(/public void isPressedButton\([^)]*\)\{([\s\S]*?)\n\t\}/)
    expect(body, 'isPressedButton 的方法体没解出来').not.toBeNull()
    expect(body![1]).toContain('isclicked=true;')
    // 整个方法体里只有一处 `isclicked=`，也就是没有 `isclicked=false`。
    expect([...body![1]!.matchAll(/isclicked=/g)]).toHaveLength(1)

    const b = shopButton('buy', box)
    pressButton(b, box.x, box.y)
    expect(b.isclicked).toBe(true)
    expect(b.image).toBe('pressed')
    // 再往别处按一下：贴图回到 normal，**而 isclicked 还挂着**。整个
    // `setButton()` 依赖这件事。
    pressButton(b, 0, 0)
    expect(b.image).toBe('normal')
    expect(b.isclicked).toBe(true)
  })

  it('isRelesedButton 命中时清 isclicked、贴 waitclick', () => {
    const b = shopButton('sell', box)
    pressButton(b, box.x, box.y)
    releaseButton(b, box.x, box.y)
    expect(b.isclicked).toBe(false)
    expect(b.image).toBe('waitclick')
  })

  it('⚠️ isRelesedButton 没命中时**也不清** isclicked —— 只换贴图', () => {
    const b = shopButton('sell', box)
    pressButton(b, box.x, box.y)
    releaseButton(b, 0, 0)
    expect(b.image).toBe('normal')
    // 原版那个 else 同样只有一句 `buttonImage=normalImage;`。松手落在别处时
    // 这一颗会一直挂着 isclicked，下一次松手就再触发一遍 —— 照抄的缺陷。
    expect(b.isclicked).toBe(true)
  })

  it('⚠️ isMoveIn 那个字段恒为 false —— 少了一对大括号', () => {
    // 源码里 `isMoveIn=false;` 在 else 的**外面**（那一句前面没有 else 的花括号）。
    const body = source.match(/public void isMoveIn\(int currentX, int currentY\)\{([\s\S]*?)\n\t\}/)
    expect(body, 'isMoveIn 的方法体没解出来').not.toBeNull()
    expect(body![1]).toMatch(/else\s*\n\s*buttonImage=normalImage;\s*\n\s*isMoveIn=false;/)

    const b = shopButton('back', box)
    moveInButton(b, box.x, box.y)
    // 贴图换成了 waitclick（那一句在 if 里面），字段却是 false。
    expect(b.image).toBe('waitclick')
    expect(b.isMoveIn).toBe(false)
    moveInButton(b, 0, 0)
    expect(b.image).toBe('normal')
    expect(b.isMoveIn).toBe(false)
  })

  it('clickedLabels 按按钮表的次序出名字', () => {
    const bs = [shopButton('buy', box), shopButton('sell', box), shopButton('back', box)]
    expect(clickedLabels(bs)).toEqual([])
    bs[2]!.isclicked = true
    bs[0]!.isclicked = true
    expect(clickedLabels(bs)).toEqual(['buy', 'back'])
  })
})
