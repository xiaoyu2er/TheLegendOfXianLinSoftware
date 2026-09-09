import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { hits, menuButton, moveInButton, pressButton, releaseButton } from './buttons'

/**
 * 三条都是**复刻缺陷**，所以三条都从原版源码里现读一遍再对：注释里写"这里
 * 照抄了一个 bug"和真的照抄了，长得一模一样（dispatch.md §注释里写「这里会
 * 红」，就得像判据一样被跑一遍）。
 */
describe('菜单按钮的三条原版语义', () => {
  const gameButton = javaSource('src/tools/GameButton.java')
  const menuButtonSrc = javaSource('src/menu/MenuButton.java')

  it('命中框的 −15 / −6 偏移真的在原版里', () => {
    const matches = [
      ...gameButton.matchAll(
        /currentX>x-15&&currentX<\(x\+width-15\)&&currentY>\(y-6\)&&currentY<\(y\+height-6\)/g,
      ),
    ]
    // 三个方法各一处。解不出来说明原版那一行变了，下面几条断言就失去了出处。
    expect(matches.length).toBe(3)
  })

  it('命中框确实偏左偏上 —— 左右两边各挑一个只有偏移才分得开的点', () => {
    const b = menuButton(100, 100, 52, 37, true)
    // 画出来的矩形是 [100,152)×[100,137)；命中框是 (85,137)×(94,131)。
    expect(hits(b, 90, 100)).toBe(true) // 画面外的左边，命中框里
    expect(hits(b, 145, 100)).toBe(false) // 画面里的右边，命中框外
    expect(hits(b, 100, 96)).toBe(true) // 画面外的上边，命中框里
    expect(hits(b, 100, 133)).toBe(false) // 画面里的下边，命中框外
  })

  it('isMoveIn 这个字段恒为 false —— 原版那一句少了大括号', () => {
    // 先核原版：`isMoveIn=true;` 在 if 里，`isMoveIn=false;` 在 else 之后，
    // 且 else 后面只有一句 `buttonImage=normalImage;`。
    const method = /public void isMoveIn\(int currentX, int currentY\)\{([\s\S]*?)\n\t\}/.exec(
      gameButton,
    )
    expect(method, 'GameButton.isMoveIn 的方法体没解出来').not.toBeNull()
    const body = method![1]!
    expect(body).toContain('isMoveIn=true;')
    // `else` 之后的那一句是贴图，`isMoveIn=false;` 落在它后面、不在 else 里。
    expect(/else\s*\n?\s*buttonImage=normalImage;\s*\n?\s*isMoveIn=false;/.test(body)).toBe(true)

    // 再核这一层：命中了也照样是 false，但贴图换了 —— 两件事分开断言，
    // 因为"整个方法没跑"与"字段被那一句清掉了"长得一样。
    const b = menuButton(100, 100, 52, 37, true)
    moveInButton(b, 100, 100)
    expect(b.isMoveIn).toBe(false)
    expect(b.image).toBe('waitclick')
  })

  it('isDraw=No 时按不动，但松开照样清 isclicked', () => {
    // `MenuButton` 覆写了 isPressedButton 并包了一层 isDraw；它**没有**覆写
    // isRelesedButton —— 这个不对称是原版的，不是这里漏了。
    expect(menuButtonSrc).toContain('public void isPressedButton(int currentX,int currentY)')
    expect(menuButtonSrc).not.toContain('isRelesedButton')

    const b = menuButton(100, 100, 52, 37, false)
    pressButton(b, 100, 100)
    expect(b.isclicked).toBe(false)
    expect(b.image).toBe('normal')

    b.isclicked = true
    releaseButton(b, 100, 100)
    expect(b.isclicked).toBe(false)
    expect(b.image).toBe('waitclick')
  })

  it('按下 / 松开在框外时只换贴图，不动 isclicked', () => {
    const b = menuButton(100, 100, 52, 37, true)
    pressButton(b, 0, 0)
    expect(b.isclicked).toBe(false)
    expect(b.image).toBe('normal')

    pressButton(b, 100, 100)
    expect(b.isclicked).toBe(true)
    // 框外松手：原版只把贴图拨回常态，isclicked 留着 —— 导出器正是靠这个
    // 差别核"松手有没有落在按钮上"。
    releaseButton(b, 0, 0)
    expect(b.isclicked).toBe(true)
  })
})
