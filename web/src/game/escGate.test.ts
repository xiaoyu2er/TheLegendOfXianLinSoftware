import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { resetParty } from '../fakes/party'
import { createMemorySaveStore } from '../save/memoryStore'
import { javaSource } from '../test/javaSource'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { NO_INPUT, advanceSession, createSession, enterScene, openMenu } from './session'
import type { RunningSession, SessionDeps } from './session'

/**
 * 退出键开菜单的那两道门（xl-03x.16）。
 *
 * 原版那句 `if (keyCode == VK_ESCAPE) GameLauncher.switchTo("menu")` 在
 * `ScenePanel.keyPressed` 里，外面套着两层：
 *
 *     if (!narratage.isNarratage) {
 *         if (!dialogueEvent.isSpeaking) {
 *             …
 *             if (keyCode == KeyEvent.VK_ESCAPE) GameLauncher.switchTo("menu");
 *         } else {
 *             dialogueEvent.keyPressed(keyCode);
 *         }
 *     }
 *
 * ⚠️ **口头语（`npcEvent.isOral`）不挡它**：ESC 那一句在 `if (!npcEvent.isOral)`
 * 的 if/else **之后**，与它并列。所以门读的是 `dialogue.speaking`，不是
 * `dialogueActive()`（后者把口头语也算进去）。
 *
 * ## 为什么落在会话层、不落在逐帧比对
 *
 * 实查过（2026-09-11）：取图页每一套装配都**不画菜单**。场景那套的 `seek()` 只推
 * `step()` + `settleSceneRequests()`，不经 `openMenu`；结局那套经 `openMenu`，但
 * 被切走之后停在切走前最后一帧。原版那边的场景剧本指令集里也没有按 ESC 的指令。
 * 于是「开了菜单」与「没开」两端画出来是同一张图 —— 那条比对**看不见**这件事。
 *
 * ## 原版那一半的读数（实跑，不是读出来的）
 *
 * 一次性探针借 `SceneDriver` 起场景、逐拍推，到指定状态时直接调
 * `ScenePanel.keyPressed(VK_ESCAPE)`，读 `PanelTap` 记下的切换（openjdk 17）：
 *
 * | 场景 | 拍 | isNarratage | isSpeaking | 切换次数 | card |
 * |---|---|---|---|---|---|
 * | 脚本1 | 0 | true | false | 0→0 | null |
 * | 脚本1 | 810 | false | true | 0→0 | null |
 * | 宿舍（预热脚本1） | 0 | false | false | 0→1 | menuPanel |
 *
 * 口头语那一条**原版没有跑过**，是照上面那段嵌套从源码读的（下面那条源码现读的
 * 判据钉着这个嵌套）。
 */

const DEPS: SessionDeps = {
  scenes: sceneSourceOf(getScene),
  sprite: () => ({ width: 1, height: 1 }),
  random: () => 0.5,
  saves: createMemorySaveStore(),
}

function inScene(name: string): RunningSession {
  resetParty()
  return enterScene(createSession(DEPS), createWorld(getScene(name)))
}

/** 一拍一拍推，直到 `until` 成立。推满 `max` 拍还不成立是硬失败 —— 等不到那个状态，下面的断言就恒真。 */
function tickUntil(s: RunningSession, until: (s: RunningSession) => boolean, max: number): RunningSession {
  for (let i = 0; i < max; i++) {
    if (until(s)) return s
    s = advanceSession(s, NO_INPUT, 10)
  }
  throw new Error(`推了 ${max} 拍还没等到要的状态`)
}

const narrating = (s: RunningSession) => s.scene.world.narratage.active
const speaking = (s: RunningSession) => !s.scene.world.narratage.active && s.scene.world.dialogue.speaking

describe('退出键开菜单的两道门', () => {
  it('旁白播着时按退出键，菜单不弹出', () => {
    const s = tickUntil(inScene('脚本1'), narrating, 10)
    const after = openMenu(s)
    expect(after.panel).toBe('scene')
    expect(after).toBe(s)
  })

  it('主线对话正在说时按退出键，菜单不弹出', () => {
    const s = tickUntil(inScene('脚本1'), speaking, 2000)
    const after = openMenu(s)
    expect(after.panel).toBe('scene')
    expect(after).toBe(s)
  })

  it('对照：两者都不在时按退出键照开菜单 —— 上面两条不是「怎么按都不开」', () => {
    const s = inScene('宿舍')
    expect(narrating(s) || s.scene.world.dialogue.speaking, '这一场起手就在旁白或对话里，对照失效').toBe(false)
    expect(openMenu(s).panel).toBe('menu')
  })

  it('口头语不挡退出键 —— 门读的是 isSpeaking，不是「对话框开着」', () => {
    const s = inScene('宿舍')
    const oral: RunningSession = {
      ...s,
      scene: { ...s.scene, world: { ...s.scene.world, dialogue: { ...s.scene.world.dialogue, oral: true } } },
    }
    expect(openMenu(oral).panel).toBe('menu')
  })

  it('结局那条路：对话按到 `$` 切进结局，那一刻 speaking 已是假的 —— 退出键照开菜单', () => {
    // 原版 `DialogueEvent.keyPressed` 在 gameOver 那支里先 `isSpeaking = false` 再
    // `switchTo("end")`。end-credits 那份回放是直接 `enterEnd` 进去的，不经这条路，
    // 所以这条次序只有这里钉着。
    const space = { e: 'press', k: 'space', ctrl: false } as const
    let s = inScene('脚本41')
    for (let i = 0; i < 20000 && s.panel !== 'end'; i++) {
      s = advanceSession(s, i % 20 === 0 ? { ...NO_INPUT, scene: [space] } : NO_INPUT, 10)
    }
    expect(s.panel, '脚本41 按了一路空格也没进结局').toBe('end')
    expect(s.scene.world.dialogue.speaking).toBe(false)
    expect(openMenu(s).panel).toBe('menu')
  })

  it('源码现读：ESC 那一句套在 !isNarratage 与 !isSpeaking 里、在 isOral 那组 if/else 之后', () => {
    const src = javaSource('src/scene/ScenePanel.java')
    const m = /public void keyPressed\(int keyCode, boolean isControl\) \{([\s\S]*?)\n\t\}/.exec(src)
    expect(m, 'ScenePanel.keyPressed 的方法体没解出来').not.toBeNull()
    const body = m![1]!.replace(/\r/g, '')
    const nar = body.indexOf('if (!narratage.isNarratage) {')
    const spk = body.indexOf('if (!dialogueEvent.isSpeaking) {')
    const oralElse = body.indexOf('npcEvent.keyPress(keyCode);')
    const esc = body.indexOf('if (keyCode == KeyEvent.VK_ESCAPE) {')
    const spkElse = body.indexOf('dialogueEvent.keyPressed(keyCode);')
    for (const [name, at] of Object.entries({ nar, spk, oralElse, esc, spkElse })) {
      expect(at, `${name} 没在方法体里找到`).toBeGreaterThanOrEqual(0)
    }
    // 先后次序即嵌套：两道门 → 口头语那一支的 else → ESC → 说话那一支的 else。
    expect([nar, spk, oralElse, esc, spkElse]).toEqual([...[nar, spk, oralElse, esc, spkElse]].sort((a, b) => a - b))
  })
})
