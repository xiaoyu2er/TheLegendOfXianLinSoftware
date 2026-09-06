import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { createWorld, step } from '../state/step'
import { TRACE_NAMES, readTrace, sceneNameOf } from '../state/trace'
import type { DialogueState } from '../state/dialogue'
import { BOX_HEIGHT, BOX_WIDTH, boxPatch, textCells } from './dialogueLayout'

/**
 * 摆位的两条不变量，**在真值跑出来的每一个对话帧上**验，不手写状态。
 *
 * 为什么这两条值得单独验：`drawDialogue` 那两句 `drawImage` 各有 8 个参数，
 * 抄错一个的表现是"对话框揭开的时候有点怪"，画面上跟对的那版分不出来。
 * 而它们各自满足一条能写下来的性质：
 *
 * 1. **源矩形与目标矩形同尺寸** —— 这是"揭开"，不是缩放。抄错任何一个参数，
 *    这条立刻不成立。
 * 2. **动画播完（开始打字）时，对话框正好铺满那张 480×160 的图**，位置就是
 *    原版那两个终点。滑入的步长（±48/±16）或者停止条件抄错，终点就会偏。
 */
function dialogueFrames(name: string): DialogueState[] {
  const trace = readTrace(name)
  let world = createWorld(getScene(sceneNameOf(trace)), trace.script.isScript)
  const frames: DialogueState[] = []
  for (const tick of trace.ticks) {
    world = step(world, tick.input, trace.script.tickMs)
    if (world.dialogue.speaking || world.dialogue.oral) frames.push(world.dialogue)
  }
  return frames
}

describe('对话框的摆位', () => {
  // 分母是"真值里到底有多少个对话帧"，从真值现数：哪天剧本换了、对话没了，
  // 下面那句 `toBeGreaterThan(0)` 会响，而不是这几条断言悄悄一个都没跑。
  const frames = TRACE_NAMES.flatMap(dialogueFrames)

  it('真值里确实有对话帧可验', () => {
    expect(frames.length).toBeGreaterThan(0)
  })

  it('对话框是"揭开"不是缩放：目标矩形与源矩形永远同尺寸、且不为负', () => {
    for (const d of frames) {
      const patch = boxPatch(d)
      expect(patch).not.toBeNull()
      expect(patch!.width).toBeGreaterThanOrEqual(0)
      expect(patch!.height).toBeGreaterThanOrEqual(0)
      // 源矩形的右下角落在图内 —— 这就是"同尺寸"在两种样式下的统一写法。
      expect(patch!.sourceX + patch!.width).toBeLessThanOrEqual(BOX_WIDTH)
      expect(patch!.sourceY + patch!.height).toBeLessThanOrEqual(BOX_HEIGHT)
    }
  })

  it('开始打字时对话框已经铺满，位置是原版那两个终点', () => {
    const printing = frames.filter((d) => d.printing)
    expect(printing.length).toBeGreaterThan(0)
    for (const d of printing) {
      const patch = boxPatch(d)!
      expect({ width: patch.width, height: patch.height }).toEqual({
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
      })
      // 样式 0 的框在右下角 (160,480)，样式 1 的在中间偏上 (272,32)。
      expect({ x: patch.x, y: patch.y }).toEqual(
        d.type === 0 ? { x: 160, y: 480 } : { x: 272, y: 32 },
      )
    }
  })

  it('还没开始打字时一个字都不画（对话框在滑入）', () => {
    const sliding = frames.filter((d) => !d.printing)
    expect(sliding.length).toBeGreaterThan(0)
    for (const d of sliding) expect(textCells(d)).toEqual([])
  })

  it('画出来的字与状态层的字符缓冲逐格一致，@ 与 $ 除外', () => {
    // `@` / `$` 在原版是两个 `continue`：占着格子但不画。
    const printed = frames.filter((d) => d.printing && d.cursor > 0)
    expect(printed.length).toBeGreaterThan(0)
    for (const d of printed) {
      const inBuffer = d.text
        .flat()
        .filter((c): c is string => c !== null && c !== '@' && c !== '$')
      expect(textCells(d).map((cell) => cell.char)).toEqual(inBuffer)
    }
  })
})
