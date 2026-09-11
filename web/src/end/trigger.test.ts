import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import type { SceneScript } from '../data/types'
import { NO_INPUT, advanceSession, createSession, currentPanelOf, enterScene } from '../game/session'
import type { RunningSession } from '../game/session'
import { createMemorySaveStore } from '../save/memoryStore'
import { TICK_MS, createWorld, step } from '../state/step'
import { readTrace, replayWorld, sceneSourceOf } from '../state/trace'
import type { InputEvent, World } from '../state/types'
import { javaSource } from '../test/javaSource'

/**
 * 结局的触发点（xl-czb.6）。
 *
 * 原版走到结局的路**全仓只有一条**，从源码现读：
 *
 * 1. `Dialogue.java` 逐字打印时 `bufferedText[i][j] == '$'` → `scene.dialogueEvent.gameOver = true`
 *    （**画的那一层**置的旗标，那个字符本身跳过不画）；
 * 2. `DialogueEvent.keyPressed`：一段对话按完的那一下空格（`dialogueOver` 那一支），
 *    `if (gameOver) { GameLauncher.switchTo("end"); gameOver = false; }` —— 跳转发生在
 *    **场景的按键分发**里。
 *
 * `$` 在数据里别处也出现过：装备超市那个确认框的「是」那一行（`$进入购买`）。那几行走的是
 * `SelectEvent` 自己的 `drawString`，一次都不经过 `Dialogue.bufferedText`，**不触发结局** ——
 * 下面两条各从源码与行为两头确认。
 */

/** 全部场景里所有带 `$` 的字符串，按它落在哪个字段分开。分母现扫（烘好的 96 份）。 */
function dollarHits(): { scene: string; field: string; group?: number; text: string }[] {
  const hits: { scene: string; field: string; group?: number; text: string }[] = []
  for (const name of SCENE_NAMES) {
    const s = getScene(name) as unknown as Record<string, unknown>
    for (const [field, value] of Object.entries(s)) {
      if (field === 'dialogue') {
        ;((value as string[][][] | null) ?? []).forEach((group, g) => {
          for (const sentence of group) for (const part of sentence) if (part.includes('$')) hits.push({ scene: name, field, group: g, text: part })
        })
        continue
      }
      const visit = (v: unknown): void => {
        if (typeof v === 'string') {
          if (v.includes('$')) hits.push({ scene: name, field, text: v })
        } else if (Array.isArray(v)) v.forEach(visit)
      }
      visit(value)
    }
  }
  return hits
}

describe('触发点从源码现读', () => {
  it('置旗标的只有 Dialogue.java 那一处，跳转只有 DialogueEvent.keyPressed 那一处', () => {
    const dialogue = javaSource('src/scene/Dialogue.java').replace(/\s+/g, '')
    expect(dialogue).toContain("elseif(bufferedText[i][j]=='$'){scene.dialogueEvent.gameOver=true;continue;}")
    const event = javaSource('src/scene/DialogueEvent.java').replace(/\s+/g, '')
    expect(event).toContain('if(gameOver){GameLauncher.switchTo("end");gameOver=false;}')
    // 同一个字符的判断别处没有：SelectEvent 一个 `'$'` 都不认。
    expect(javaSource('src/scene/SelectEvent.java')).not.toContain("'$'")
  })
})

describe('数据里的 $（现扫全部场景）', () => {
  const hits = dollarHits()

  it('对话正文里至少有一处 —— 否则结局在这份数据里走不到', () => {
    expect(hits.filter((h) => h.field === 'dialogue').length).toBeGreaterThan(0)
  })

  it('对话之外的 $ 只在确认框那几个字段里（走 SelectEvent 的 drawString，不经过对话）', () => {
    const elsewhere = [...new Set(hits.filter((h) => h.field !== 'dialogue').map((h) => h.field))].sort()
    expect(elsewhere.length, '今天对话之外有 $ —— 这一条要是空转了就改成断言没有').toBeGreaterThan(0)
    for (const f of elsewhere) expect(f, `${f} 不是确认框字段`).toMatch(/^select/)
  })

  it('没有一段对话同时带 @ 与 $（state/step.ts 里两句的先后因此观测不到）', () => {
    const both = hits
      .filter((h) => h.field === 'dialogue')
      .filter((h) => getScene(h.scene).dialogue![h.group!]!.some((sentence) => sentence.some((p) => p.includes('@'))))
    expect(both).toEqual([])
  })
})

/** 按一次键：先一拍带着这个键，再空推若干拍。每一拍都记下来，请求只亮一拍。 */
function press(world: World, k: string, ms: number, seen: World[]): World {
  const ev: InputEvent = { e: 'press', k, ctrl: false }
  let w = step(world, [ev], TICK_MS)
  seen.push(w)
  for (let t = TICK_MS; t < ms; t += TICK_MS) {
    w = step(w, [], TICK_MS)
    seen.push(w)
  }
  return w
}

/** 带 `$` 的那一段对话所在的场景 —— 从数据里现取，不写死。 */
function endScene(): SceneScript {
  const scenes = [...new Set(dollarHits().filter((h) => h.field === 'dialogue').map((h) => h.scene))]
  expect(scenes).toHaveLength(1)
  return getScene(scenes[0]!)
}

describe('行为：$ 那段对话按完的那一下空格才切', () => {
  it('状态层：endRequest 恰好亮一拍，亮在让 speaking 由真转假的那一下空格上，旗标随即清掉', () => {
    let w = createWorld(endScene())
    const seen: World[] = []
    for (let i = 0; i < 200 && !seen.some((s) => s.endRequest !== null); i++) {
      w = press(w, 'enter', 100, seen)
      w = press(w, 'space', 100, seen)
    }
    const lit = seen.flatMap((s, i) => (s.endRequest !== null ? [i] : []))
    expect(lit, 'endRequest 亮过几拍').toHaveLength(1)
    const at = lit[0]!
    expect(seen[at - 1]!.dialogue.speaking, '亮之前对话还开着').toBe(true)
    expect(seen[at - 1]!.dialogue.gameOver, '亮之前旗标已经置上了（逐字打印经过了 $）').toBe(true)
    expect(seen[at]!.dialogue.speaking).toBe(false)
    expect(seen[at]!.dialogue.gameOver, '切了之后旗标清掉（gameOver = false）').toBe(false)
    // 再按几下：不会再亮（那段对话已经按完）。
    const after: World[] = []
    for (let i = 0; i < 5; i++) w = press(w, 'space', 100, after)
    expect(after.some((s) => s.endRequest !== null)).toBe(false)
  })

  it('会话层：面板翻到 end，当前面板仍是场景', () => {
    let s: RunningSession = enterScene(
      createSession({ scenes: () => undefined, sprite: () => ({ width: 0, height: 0 }), random: () => 0, saves: createMemorySaveStore([]) }),
      createWorld(endScene()),
    )
    for (let i = 0; i < 400 && s.panel === 'scene'; i++) {
      const k = i % 2 === 0 ? 'enter' : 'space'
      s = advanceSession(s, { ...NO_INPUT, scene: [{ e: 'press', k, ctrl: false }] }, 100)
    }
    expect(s.panel).toBe('end')
    expect(currentPanelOf(s.panel)).toBe('scene')
    expect(s.end?.world).toMatchObject({ isDraw: true, isStop: false })
  })

  it('确认框里的 $ 不触发：装备超市那扇门的真值整条回放下来，一拍都没亮、旗标一次都没置', () => {
    const trace = readTrace('equipshop-door')
    const source = sceneSourceOf(getScene)
    let w = replayWorld(trace, getScene)
    // 不空转：这一条确实选了「是」、进了装备超市 —— 那个确认框的「是」那一行就是 `$进入购买`。
    const text = getScene(trace.script.scene.replace(/\.txt$/, '')).selectEquipmentShopPanel ?? []
    expect(text.some((l) => l.includes('$'))).toBe(true)
    let entered = false
    for (const tick of trace.ticks) {
      w = step(w, tick.input, trace.script.tickMs, source)
      if (w.selectPanelRequest === 'equipmentShop') entered = true
      expect(w.endRequest, `第 ${tick.t} 拍`).toBeNull()
      expect(w.dialogue.gameOver, `第 ${tick.t} 拍`).toBe(false)
    }
    expect(entered, '这份真值没走进装备超市 —— 这条判据空转了').toBe(true)
  })
})
