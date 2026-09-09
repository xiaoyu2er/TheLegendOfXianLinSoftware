import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { getParty, resetParty } from '../fakes/party'
import { javaSource } from '../test/javaSource'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { roleTileX, roleTileY } from '../state/role'
import { MENU_TICK_MS } from '../menu/loop'
import { FUNC_MAIN_ORDER } from '../menu/funcButtons'
import { NO_INPUT, advanceSession, createSession, enterScene, menuWorldOf, openMenu } from './session'
import type { RunningSession, SessionDeps } from './session'
import type { MenuInput } from '../menu/step'

/**
 * 「按 ESC 进菜单、翻页、点「返回」回到刚才那个场景」这一整条环路。
 *
 * ## ⚠️ 这一段没有行为真值，凭什么算过
 *
 * 两条 menu 真值都从 `new MenuPanel()` 之后开始、到剧本跑完为止 —— **进菜单
 * 之前与出菜单之后都不在任何一份真值里**（场景那五份走的三个场景里没有一次
 * ESC）。也就是这一层抄错了和抄对了，二十一份真值的每一个字段都相同。
 *
 * 所以这里不假装有真值判据，改成三条各自跑得出红绿的检查：
 *
 * 1. **环路真的跑一遍**：真场景 → ESC → 菜单世界真的建出来 → 点「返回」 →
 *    回到**同一个场景、主角在同一格**；
 * 2. **菜单开着的时候场景照跑不误**，而这一条**与票面写反了** —— 判据同时
 *    从 GBK 源码现读 `switchTo("menu")` 的 case，证明它一句都没停线程；
 * 3. **进了菜单按 ESC 出不去**（复刻的死代码）。
 */

const DEPS: SessionDeps = {
  scenes: sceneSourceOf(getScene),
  sprite: () => ({ width: 1, height: 1 }),
  random: () => 0.5,
}

function inScene(name: string): RunningSession {
  resetParty()
  return enterScene(createSession(DEPS), createWorld(getScene(name)))
}

/** 天书页那颗按钮的命中中心 —— 与导出器 `MenuDriver.center()` 同一条公式。 */
function centerOf(b: { x: number; y: number; width: number; height: number }) {
  return { x: b.x - 15 + Math.floor(b.width / 2), y: b.y - 6 + Math.floor(b.height / 2) }
}

function click(x: number, y: number): MenuInput[] {
  return [
    { e: 'press', x, y },
    { e: 'release', x, y },
  ]
}

describe('场景 ↔ 菜单这条环路', () => {
  it('按 ESC 进菜单，点天书页的「返回」回到同一个场景、同一格', () => {
    let s = inScene('宿舍')
    const before = { x: roleTileX(s.scene.world.role), y: roleTileY(s.scene.world.role), scene: s.scene.world.scene }

    s = openMenu(s)
    expect(s.panel).toBe('menu')
    const menu = menuWorldOf(s)
    expect(menu, '开了菜单却没有菜单世界').not.toBeNull()
    expect(menu!.panel).toBe('thingPanel')

    // 切到天书页 —— 顶栏那颗按钮的落点由几何算出来，不写死坐标。
    s = advanceSession(s, { ...NO_INPUT, menu: click(...Object.values(centerOf(menu!.tabs.func)) as [number, number]) }, 0)
    expect(menuWorldOf(s)!.panel).toBe('funcPanel')

    const back = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton
    const at = centerOf(back)
    s = advanceSession(s, { ...NO_INPUT, menu: click(at.x, at.y) }, 0)
    expect(s.panel).toBe('scene')
    expect(menuWorldOf(s)).toBeNull()
    expect({
      x: roleTileX(s.scene.world.role),
      y: roleTileY(s.scene.world.role),
      scene: s.scene.world.scene,
    }).toEqual(before)
  })

  it('⚠️ 菜单开着的时候主角站住 —— 「场景停步」对的是这一半', () => {
    // 原版 `GameLauncher` 那个 KeyListener 的 `keyPressed` / `keyReleased`
    // **两个方法都**从 `if(currentPanel==scenePanel)` 起手，所以菜单显示的
    // 时候一个键都到不了场景。这是票面那句「场景停步」真正说得通的那一半
    // （另一半 —— 那条线程 —— 见下一条）。
    const launcher = javaSource('src/main/GameLauncher.java')
    for (const method of ['keyPressed', 'keyReleased']) {
      const m = new RegExp(`public void ${method}\\(KeyEvent e\\) \\{([\\s\\S]*?)\\n\\t\\t\\}`).exec(launcher)
      expect(m, `GameLauncher.${method} 的方法体没解出来`).not.toBeNull()
      expect(m![1]!, `${method} 没有那道 currentPanel==scenePanel 的门`).toContain(
        'if(currentPanel==scenePanel)',
      )
    }

    let s = inScene('宿舍')
    const startX = roleTileX(s.scene.world.role)
    // 先证明这一场里方向键真的走得动 —— 走不动的话下面那条恒真。
    s = advanceSession(s, { ...NO_INPUT, scene: [{ e: 'press', k: 'right', ctrl: false }] }, 1000)
    expect(roleTileX(s.scene.world.role)).toBeGreaterThan(startX)

    // 开菜单，同样喂方向键：主角一格都不许动。
    s = openMenu(s)
    const held = roleTileX(s.scene.world.role)
    s = advanceSession(s, { ...NO_INPUT, scene: [{ e: 'press', k: 'right', ctrl: false }] }, 1000)
    expect(s.panel).toBe('menu')
    expect(roleTileX(s.scene.world.role), '菜单开着时主角还在走').toBe(held)
  })

  it('⚠️ 但那条线程不停 —— 菜单开着时地图上的 NPC 照走', () => {
    // 先从原版现读：`switchTo("menu")` 那个 case 里只有换面板与三句
    // refreshValue()，一句停线程的都没有；而 ScenePanel.run() 是
    // `while(true){ step(); sleep(10); }`。
    const launcher = javaSource('src/main/GameLauncher.java')
    const body = /case "menu":([\s\S]*?)break;/.exec(launcher)
    expect(body, 'switchTo 的 case "menu" 没解出来').not.toBeNull()
    expect(/stop|interrupt|suspend|pause/i.test(body![1]!)).toBe(false)
    expect(body![1]!).toContain('refreshValue();')
    expect(javaSource('src/scene/ScenePanel.java')).toContain('while (true) {')

    // 再看这一层：菜单开着推 2 秒，地图上的 NPC 照样在走。
    // 比的是 **NPC 的位置与帧号**，不是某个计数器 —— 「翻完菜单回来 NPC 站在
    // 哪」正是这条不变量守的东西（`session.ts` 给战斗那一侧写下的同一条）。
    let s = inScene('宿舍')
    s = openMenu(s)
    const snapshot = (x: RunningSession) =>
      JSON.stringify(x.scene.world.npcs.map((n) => [n.px, n.py, n.frame]))
    const before = snapshot(s)
    // 先确认这一场真的有 NPC 在动 —— 一个都没有的话下面那条恒真。
    expect(s.scene.world.npcs.length).toBeGreaterThan(0)
    s = advanceSession(s, NO_INPUT, 2000)
    expect(s.panel).toBe('menu')
    expect(snapshot(s), '菜单开着时地图上的 NPC 一步都没走').not.toBe(before)
    // 旁白那一层是唯一读「现在显示的是谁」的地方，所以 `showing` 要是假的。
    expect(s.scene.world.showing).toBe(false)
  })

  it('什么都不点，菜单里的游标照样往前走', () => {
    let s = openMenu(inScene('宿舍'))
    s = advanceSession(s, NO_INPUT, 5 * MENU_TICK_MS)
    expect(menuWorldOf(s)!.panels.thingPanel.mouse).toMatchObject({ code: 5, frame: 4 })
  })

  it('只有场景那一屏进得去菜单 —— 别的面板 openMenu 是空操作', () => {
    const idle = createSession(DEPS)
    expect(idle.panel).toBe('start')
    // 还没开局时连 RunningSession 都不是，所以这一条走的是已开局但不在场景上
    // 的那一路：先把面板掰成菜单，再开一次。
    const s = openMenu(inScene('宿舍'))
    expect(s.panel).toBe('menu')
    expect(openMenu(s)).toBe(s)
  })

  it('打开的那一刻看到的是三个人的最新属性', () => {
    resetParty()
    const party = getParty()
    // 把张小凡打成残血 —— 原版 `switchTo("menu")` 那三句 refreshValue() 之后
    // 菜单上看到的就该是这个数，不是满血。
    party.zhang.hp = 123
    const s = openMenu(enterScene(createSession(DEPS), createWorld(getScene('宿舍'))))
    const zhang = menuWorldOf(s)!.heroes[0]!
    expect(zhang.name).toBe('zhangxiaofan')
    expect(zhang.hp).toBe(123)
    expect(zhang.hpMax).toBeGreaterThan(123)
    resetParty()
  })

  it('进了菜单按 ESC 出不去 —— MenuPanel.keyPressed 是死代码', () => {
    // 顶层 keyPressed 只分发给场景 / 存档 / 战斗三家，菜单一个分支都不命中。
    const dispatched = [
      ...javaSource('src/main/GameLauncher.java').matchAll(/(\w+Panel)\.keyPressed\(/g),
    ].map((m) => m[1]!)
    expect(dispatched.length).toBeGreaterThan(0)
    expect(dispatched).not.toContain('menuPanel')
    // 这一层的对应物：出菜单只有天书页那一颗按钮，`SessionInput.menu` 里
    // 根本没有键盘那一种。
    expect(FUNC_MAIN_ORDER).toContain('returnButton')
  })
})
