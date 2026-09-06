import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { headAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import { getScene } from '../data/scenesEager'
import type { DialogueState } from '../state/dialogue'
import { createWorld, step } from '../state/step'
import { readTrace, sceneNameOf } from '../state/trace'
import type { World } from '../state/types'
import { DialogueBox } from './DialogueBox'

/**
 * 对话框的 DOM。
 *
 * **状态一个字都不手写**：全部由真值回放推出来 —— 拿 trace 里那一 tick 实际
 * 喂给原版的按键回放到某个条件成立，再把当时的 `world.dialogue` 交给组件。
 * 手写一个 `DialogueState` 字面量很容易写出一个原版永远不会出现的状态
 * （比如"正在打字但对话框还没滑到位"），那样的测试会绿，而且是错的。
 *
 * 这里验的是"接线对不对、该出现的东西出现了没有"，**不验像素**：正文用的
 * `文鼎粗钢笔行楷` 绝大多数机器上没有，Java2D 的基线与 DOM 的行盒也不是一回
 * 事。逐像素那一头由跨端比对兜底，并且在 `src/compare/expected.ts` 里明确记着
 * 它是已知缺口。
 */
afterEach(cleanup)

/** 回放某份真值，直到 `done(world)` 成立；到头都没成立就是硬失败。 */
function replayUntil(name: string, done: (world: World) => boolean): DialogueState {
  const trace = readTrace(name)
  let world = createWorld(getScene(sceneNameOf(trace)), trace.script.isScript)
  for (const tick of trace.ticks) {
    world = step(world, tick.input, trace.script.tickMs)
    if (done(world)) return world.dialogue
  }
  throw new Error(
    `回放完 ${name} 的 ${trace.ticks.length} 个 tick 都没等到要的状态 —— ` +
      `这份真值不再覆盖它了，别把用例改成跳过。`,
  )
}

describe('对话框（DOM）', () => {
  it('没有对话时什么都不画', () => {
    const idle = replayUntil('dorm-walk', (w) => w.timeMs > 0)
    const { container } = render(<DialogueBox dialogue={idle} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('名字式对话框：走到 NPC 跟前按空格，框、名字牌与正文都在', () => {
    // dorm-walk 的剧本就是"走到萧逸才身边按一次空格"（见
    // tools/traces/scripts/dorm-walk.json），所以这一条同时是
    // "靠近 NPC 按空格弹出对话框"这条验收标准的可执行形式。
    const printing = replayUntil('dorm-walk', (w) => w.dialogue.printing && w.dialogue.cursor > 3)
    render(<DialogueBox dialogue={printing} />)

    expect(screen.getByTestId('dialogue-box')).toBeTruthy()
    // 名字来自脚本数据里那个 NPC，不是手写的字符串。
    const name = getScene('宿舍').npcList!.find((row) => row[0] === '2')![4]!
    expect(screen.getByText(name)).toBeTruthy()
    // 已经打出来的字，逐格都在 DOM 里。
    const printed = printing.sentence!.slice(0, printing.cursor)
    const chars = [...document.querySelectorAll('.dialogue-char')].map((el) => el.textContent)
    expect(chars.join('')).toBe(printed)
    // 头像式的东西一个都不该有。
    expect(screen.queryByTestId('dialogue-head')).toBeNull()
  })

  it('头像式对话框：显示这一句指定的那张头像', () => {
    // dorm-intro 的主线对话第一句就是头像式（样式 0）。
    const withHead = replayUntil(
      'dorm-intro',
      (w) => w.dialogue.speaking && w.dialogue.type === 0 && w.dialogue.printing,
    )
    render(<DialogueBox dialogue={withHead} />)

    const head = screen.getByTestId('dialogue-head') as HTMLImageElement
    // 头像号来自脚本数据（`0/59/正文` 的那个 59），URL 由映射表查出来。
    expect(head.getAttribute('src')).toBe(resolveAsset(headAssetId(withHead.headNo)))
  })

  it('整句话另有一份读屏读得到的副本 —— 80 个绝对定位的单字读不成句', () => {
    const printing = replayUntil('dorm-walk', (w) => w.dialogue.printing && w.dialogue.cursor > 3)
    render(<DialogueBox dialogue={printing} />)
    expect(screen.getByTestId('dialogue').textContent).toContain(printing.sentence)
  })
})
