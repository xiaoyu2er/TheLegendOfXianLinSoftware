import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { enemyShowsSelected } from './render/hitBox'
import { applyPaintInput, createPaintState } from './render/paint'
import { applyBattleInput, skillMenuButtons, stepBattle } from './step'
import type { BattleInput } from './step'
import type { BattleWorld, GameButton } from './types'
import { createBattle } from './world'

/**
 * 战斗画布上**分开来**的四种鼠标事件（xl-qqw）：移动 / 拖动 / 按下 / 松开。
 *
 * 在这之前战斗只认「一次点击」—— 同一个坐标上焊死的移入 + 按下 + 松开，于是原版
 * 真会走的几条路 web 上一条都走不到：
 *
 * - **按住拖开再松手照样触发**：`GameButton.isRelesedButton` 在框外只换贴图、不清
 *   `isclicked`，`Command.checkReleased` 读的又是 `isclicked`；
 * - **拖动不停帧**：`BattlePanel.setMouse()` 的 `mouseDragged` 比 `mouseMoved` 少一句
 *   `enemySlector.checkMoveIn`；
 * - **悬停**：技能说明图、药品说明、四颗按钮的待点态，都挂在 `mouseMoved` 上。
 *
 * 这些是单元层的判据；逐拍对原版的是 `battle-mouse` 那份真值（`battleTrace.test.ts`
 * 回放、`tools/compare-frames.sh` 比像素）。
 */

function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/** battle-min 那一场，推到控制台第一次画出来。 */
function atCommand(): BattleWorld {
  const w = createBattle({
    background: 'image/背景图/伏魔山树林.png',
    party: ['zhang', 'yu', 'lu'],
    levels: { zhang: 5, yu: 5, lu: 5 },
    enemies: ['怪物1/5', '怪物2/6', '怪物2/7'],
    seed: 20260906,
    sprite: spriteSize,
  })
  for (let i = 0; i < 2000 && !w.command.isDraw; i++) stepBattle(w)
  expect(w.command.isDraw, '两千拍控制台都没出来 —— 下面每一条都测不到东西').toBe(true)
  return w
}

/** 命中框中心（`GameButton` 判命中时左偏 15、上偏 6）。 */
function center(b: GameButton): { x: number; y: number } {
  return { x: b.x - 15 + Math.trunc(b.width / 2), y: b.y - 6 + Math.trunc(b.height / 2) }
}

/** 离四颗按钮、两个菜单、三只怪都远的一处空地。 */
const EMPTY = { x: 60, y: 60 }

const send = (w: BattleWorld, ...inputs: BattleInput[]) => {
  for (const input of inputs) applyBattleInput(w, input)
}

describe('按住拖开再松手', () => {
  it('在「击」上按下、拖到空处松手：照样开选敌，而「击」的 isclicked 粘着不清', () => {
    const w = atCommand()
    const at = center(w.command.attack)
    send(w, { e: 'move', ...at }, { e: 'press', ...at }, { e: 'drag', ...EMPTY }, { e: 'release', ...EMPTY })
    expect(w.selector.isSlectable).toBe(true)
    expect(w.currentPattern).toBe(1)
    expect(w.command.isDraw).toBe(false)
    // 原版 `isRelesedButton` 的 else 只换贴图。
    expect(w.command.attack.isclicked).toBe(true)
  })

  it('按下之后在按钮上松手：isclicked 清掉（对照组 —— 上一条的粘着不是按下本身造成的）', () => {
    const w = atCommand()
    const at = center(w.command.attack)
    send(w, { e: 'press', ...at }, { e: 'release', ...at })
    expect(w.selector.isSlectable).toBe(true)
    expect(w.command.attack.isclicked).toBe(false)
  })

  it('只按下不松开：什么都还没发生', () => {
    const w = atCommand()
    send(w, { e: 'press', ...center(w.command.attack) })
    expect(w.command.isDraw).toBe(true)
    expect(w.selector.isSlectable).toBe(false)
    expect(w.command.attack.isclicked).toBe(true)
  })
})

describe('选敌时的停帧：移动停、拖动不停', () => {
  function selecting(): BattleWorld {
    const w = atCommand()
    const at = center(w.command.attack)
    send(w, { e: 'press', ...at }, { e: 'release', ...at })
    expect(w.selector.isSlectable).toBe(true)
    return w
  }

  it('游标移到一号怪身上它停帧，移开再动', () => {
    const w = selecting()
    const s = w.selector
    expect(enemyShowsSelected(w.em1!), '还没悬停就画着选中图 —— 下面那条恒真').toBe(false)
    send(w, { e: 'move', x: s.x1 + 1, y: s.y1 + 1 })
    expect(w.em1!.isStop).toBe(true)
    expect(enemyShowsSelected(w.em1!)).toBe(true)
    send(w, { e: 'move', ...EMPTY })
    expect(w.em1!.isStop).toBe(false)
    // 框外那一支只放开 isStop：选中图留到下一次 doAction 真换帧。
    expect(enemyShowsSelected(w.em1!)).toBe(true)
    stepBattle(w)
    expect(enemyShowsSelected(w.em1!)).toBe(false)
  })

  it('按着键拖过一号怪：不停帧（mouseDragged 里没有 enemySlector.checkMoveIn）', () => {
    const w = selecting()
    const s = w.selector
    send(w, { e: 'press', ...EMPTY }, { e: 'drag', x: s.x1 + 1, y: s.y1 + 1 })
    expect(w.em1!.isStop).toBe(false)
    // 游标在框里，但原版没换图 —— 渲染按游标位置现算的话这里是 true（xl-qqw 逐帧比对逮到的）。
    expect(enemyShowsSelected(w.em1!)).toBe(false)
  })
})

describe('技能菜单的悬停', () => {
  it('游标移到第一颗技能上：说明图画出来、那颗换待点态', () => {
    const w = atCommand()
    const at = center(w.command.skill)
    send(w, { e: 'press', ...at }, { e: 'release', ...at })
    expect(w.skillMenu.isDraw).toBe(true)
    const first = skillMenuButtons(w)[0]!
    // 悬停之前：说明图没画、那颗是常态 —— 不然下面两条是恒真。
    expect(w.skillMenu.isDrawIntro).toBe(false)
    expect(first.variant).toBe(1)
    send(w, { e: 'move', ...center(first) })
    expect(w.skillMenu.isDrawIntro).toBe(true)
    expect(first.variant).toBe(2)
  })
})

describe('四颗按钮的贴图（渲染层）', () => {
  it('悬停换待点、按下换按下、框外松手换回常态', () => {
    const w = atCommand()
    const p = createPaintState(w)
    const feed = (input: BattleInput) => {
      applyPaintInput(w, p, input)
      applyBattleInput(w, input)
    }
    feed({ e: 'move', ...center(w.command.skill) })
    expect(p.buttons).toEqual({ attack: 1, skill: 2, defend: 1, thing: 1 })
    feed({ e: 'press', ...center(w.command.attack) })
    expect(p.buttons).toEqual({ attack: 3, skill: 1, defend: 1, thing: 1 })
    feed({ e: 'drag', ...center(w.command.defend) })
    expect(p.buttons).toEqual({ attack: 1, skill: 1, defend: 2, thing: 1 })
    feed({ e: 'release', ...EMPTY })
    expect(p.buttons).toEqual({ attack: 1, skill: 1, defend: 1, thing: 1 })
  })
})
