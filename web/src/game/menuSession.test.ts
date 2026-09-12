import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { attributesOf, getParty, resetParty } from '../fakes/party'
import { addDrug, drugCount, resetDrugPack } from '../fakes/drugPack'
import { createMemorySaveStore } from '../save/memoryStore'
import { javaSource } from '../test/javaSource'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { roleTileX, roleTileY } from '../state/role'
import { MENU_TICK_MS } from '../menu/loop'
import { FUNC_MAIN_ORDER, drawnFuncButtons } from '../menu/funcButtons'
import { DRUGS } from '../battle/drugs'
import { HEROES, derive } from '../battle/units'
import { createBattle } from '../battle/world'
import { DEFAULT_WEAPONS, withWeapon } from '../menu/defaultWeapons'
import { DRUG_LIST_VIEW, DRUG_LIST_X, DRUG_ROW_H } from '../menu/drugPanel'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import {
  EQUIP_LIST_VIEW,
  EQUIP_ROW_H,
  EQUIP_X_START,
  addEquipment,
  equipCount,
  equipList,
  snapshotEquip,
} from '../menu/equipPanel'
import { rowBandTop } from '../menu/scroll'
import { buttonCenter, clickButton, selectEquipRow } from '../test/menuClicks'
import { TITLE_BGM } from '../start/assets'
import { getAudioSettings, rememberAudioSettings, resetAudioSettings } from './audioSettings'
import {
  NO_INPUT,
  advanceSession,
  configFor,
  createSession,
  currentBgm,
  enterScene,
  menuWorldOf,
  openMenu,
  sceneMusicReplayed,
} from './session'
import type { RunningSession, SessionDeps } from './session'
import type { BattleInfo } from '../state/fight'
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
  saves: createMemorySaveStore(),
}

function inScene(name: string): RunningSession {
  resetParty()
  // 菜单每一拍把物品页的数写回模块级药包（xl-bsv），开菜单又从那里现读 ——
  // 不清的话上一条用例喝剩的药会出现在下一条的物品页上。
  resetDrugPack()
  return enterScene(createSession(DEPS), createWorld(getScene(name)))
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
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(menu!.tabs.func)) }, 0)
    expect(menuWorldOf(s)!.panel).toBe('funcPanel')

    const back = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton
    const inMenu = s
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
    expect(s.panel).toBe('scene')
    expect(menuWorldOf(s)).toBeNull()
    // 场景曲从头放（xl-4io）：点「返回」那一拍只置 SCENE_SIGNAL，场景线程下一拍
    // 才 readBGM —— 曲名前后都是宿舍那首，只有这条边沿分得出来。
    expect(sceneMusicReplayed(inMenu, s)).toBe(false)
    // 一拍都没推（pump 两帧间隔不足一拍时就是这样）：信号还在，readBGM 还没发生。
    const idle = advanceSession(s, NO_INPUT, 0)
    expect(idle.scene.world.sceneSignal).toBe(true)
    expect(sceneMusicReplayed(s, idle)).toBe(false)
    const replayed = advanceSession(s, NO_INPUT, MENU_TICK_MS)
    expect(sceneMusicReplayed(s, replayed)).toBe(true)
    expect(currentBgm(replayed)).toBe(getScene('宿舍').sceneMusic)
    expect(sceneMusicReplayed(replayed, advanceSession(replayed, NO_INPUT, MENU_TICK_MS))).toBe(false)
    expect({
      x: roleTileX(s.scene.world.role),
      y: roleTileY(s.scene.world.role),
      scene: s.scene.world.scene,
    }).toEqual(before)
  })

  /**
   * 天书页「退出」→「重新开始」回标题（xl-03x.11）。
   *
   * 形状照打输回标题那条（`game/session.test.ts` 的「打输的两条分支各走各的」
   * 与「打输回标题：曲子换成主题曲」）：面板由**会话**翻成 `'start'`，曲子跟着
   * 换成主题曲。标题上点「起」之后做什么，App 不分是从哪条路来的（`app/App.tsx`
   * 的 `atTitle` 只读 `view.panel`），所以「队伍回出厂」那条例外由既有判据守，
   * 这里不另写一份。
   */
  /** 宿舍里开菜单 → 天书页 → 点「退出」，停在「重新开始」刚展开、还没点的那一刻。 */
  function upToRestart() {
    let s = openMenu(inScene('宿舍'))
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
    const fb = menuWorldOf(s)!.panels.funcPanel.funcButtons!
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb.main.exitButton)) }, 0)
    return { s, fb }
  }

  it('天书页「退出」→「重新开始」：会话把面板翻回标题，曲子换成主题曲', () => {
    const { fb, s: before } = upToRestart()
    let s = before
    // 反向控制：「重新开始」这一下之前**还在菜单里**，而且那颗按钮真的画出来了
    // —— 否则下面那条「到了标题」分不清是点着了还是别的什么把面板翻走了。
    expect(s.panel).toBe('menu')
    expect(fb.sub.restart.isDraw, '「退出」没把「重新开始」展开').toBe(true)
    expect(currentBgm(s)).not.toBe(TITLE_BGM)

    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb.sub.restart)) }, 0)
    expect(s.panel).toBe('start')
    expect(menuWorldOf(s)).toBeNull()
    expect(currentBgm(s)).toBe(TITLE_BGM)
  })

  it('「重新开始」那条一次性信号读了就收 —— 「承」读档回场景再开菜单，不会当场又回标题', () => {
    const { fb, s: before } = upToRestart()
    let s = advanceSession(before, { ...NO_INPUT, menu: click(...buttonCenter(fb.sub.restart)) }, 0)
    expect(s.panel).toBe('start')
    // 菜单世界活过了标题（原版 `menuPanel` 从开机活到关机；web 端的「起」重建会话，
    // 但「承」读档不重建 —— `loadInto` 与 `enterScene` 都是 `...session`）。
    expect(s.menu.world.panels.funcPanel.funcButtons, '菜单世界没活过标题，下面那条恒真').toBe(fb)
    expect(fb.restartToTitle, '回标题的信号没收掉').toBe(false)

    // 用 `enterScene` 代「承」读档的那一步：两者对菜单世界做的是同一件事（都不碰）。
    s = openMenu(enterScene(s, createWorld(getScene('宿舍'))))
    s = advanceSession(s, NO_INPUT, 5 * MENU_TICK_MS)
    expect(s.panel, '再开菜单当场又被翻回标题').toBe('menu')
  })

  /**
   * 「重新开始」把背景音乐开关拨回「开」（xl-03x.21）—— `switchTo("start")` 末尾那句
   * `MusicReader.openBGM()`。原版读数（2026-09-11，JVM 实跑，同样是先点天书页的「关」
   * 再点「重新开始」）：`CAN_PLAY_BGM` 1 → 2 → 1，切到 `startPanel`。
   *
   * 关也走天书页那颗按钮，不直接改开关：那样才是玩家碰得到的那条路。
   */
  it('天书页关掉背景音乐 →「重新开始」：标题上主题曲照响，开关回到开，特殊音效那位不碰', () => {
    resetAudioSettings()
    try {
      let s = openMenu(inScene('宿舍'))
      const press = (b: Parameters<typeof buttonCenter>[0]) => {
        s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(b)) }, 0)
      }
      press(menuWorldOf(s)!.tabs.func)
      const fb = menuWorldOf(s)!.panels.funcPanel.funcButtons!
      press(fb.main.setButton)
      press(fb.sub.setClick)
      press(fb.sub.off_click)
      press(fb.main.setButton)
      press(fb.sub.setBGM)
      press(fb.sub.off_BGM)
      // 反向控制：两个开关真的被天书页关掉了，此刻无声。
      expect(getAudioSettings()).toEqual({ bgm: false, sfx: false })
      expect(currentBgm(s)).toBeNull()

      press(fb.main.exitButton)
      press(fb.sub.restart)
      expect(s.panel).toBe('start')
      expect(getAudioSettings()).toEqual({ bgm: true, sfx: false })
      expect(currentBgm(s)).toBe(TITLE_BGM)

      // 「承」回场景再开菜单：天书页那两颗看到的也是开着的（`openMenu` 现读开关）。
      s = openMenu(enterScene(s, createWorld(getScene('宿舍'))))
      expect(menuWorldOf(s)!.audio).toEqual({ bgm: true, sfx: false })
    } finally {
      resetAudioSettings()
    }
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

    // 这条判据有两个坑，两个都是实测踩出来的（篡改矩阵第 26 条掉了个绿）：
    //
    // ⚠️ **按键状态留在世界里**，而且松手之后主角还会把当前那一格走完。
    // 不松手、或者松手之后立刻量，主角本来就该继续走（原版同理，那条状态在
    // `ScenePanel` 里），掐没掐输入门推出来的数完全相同。所以先按一下、
    // 松开、**再空推 600 ms 停稳**，才开始量。
    //
    // ⚠️ **方向不能随便挑**：宿舍里往右 / 往下几步就顶到墙上，此后再按也不动
    // （实测 right/down 的 parked 与"再按"完全相等），那时这条恒真。往左
    // 是通的（576 → 520），正向那条控制就是用来把这件事钉住的。
    const press = { e: 'press', k: 'left', ctrl: false } as const
    const release = { e: 'release', k: 'left' } as const

    /** 从宿舍起手走两步停稳，再喂 `during` 那批键，返回主角挪了几个像素。 */
    function walk(during: readonly (typeof press | typeof release)[], openIt: boolean): number {
      let w = inScene('宿舍')
      w = advanceSession(w, { ...NO_INPUT, scene: [press] }, 200)
      w = advanceSession(w, { ...NO_INPUT, scene: [release] }, 600)
      const parked = w.scene.world.role.px
      if (openIt) w = openMenu(w)
      w = advanceSession(w, { ...NO_INPUT, scene: during }, 600)
      expect(w.panel).toBe(openIt ? 'menu' : 'scene')
      return Math.abs(w.scene.world.role.px - parked)
    }

    // 先证明**它真的停稳了** —— 没停稳的话下面两条量的都是惯性。
    expect(walk([], false), '空推也在动，说明上一步没停稳').toBe(0)
    // 正向：不开菜单时这批键真的把主角推动了 —— 推不动的话反向那条恒真。
    expect(walk([press], false), '这一场里往这个方向本来就走不动').toBeGreaterThan(0)
    // 反向：开着菜单，同样一批键，一个像素都不许动。
    expect(walk([press], true), '菜单开着时主角还在走').toBe(0)
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

/**
 * **菜单里改掉的东西回得到队伍**（xl-6lo.16）。
 *
 * ## ⚠️ 这一段同样没有行为真值，凭什么算过
 *
 * 与上面那条环路一个理由：两条 menu 真值都从 `new MenuPanel()` 起、到剧本跑完
 * 为止，**关菜单之后不在任何一份真值里**。而这条缝原版**根本不存在** ——
 * `GameLauncher` 构造函数里 `menuPanel=new MenuPanel(zhangXiaoFan,luXueQi,yuJie)`
 * 传的就是战斗那三个对象，它们的数据字段几乎全是 `static`，喝药那句
 * `DrugPanel.addValue()` 改的就是战斗与场景读的同一份东西。
 *
 * 所以判据是三条，每一条都跑得出红绿，而且**期望值不手写**：
 *
 * 1. **喝一瓶药**，从场景一路点进去（`advanceSession` 收输入），看队伍那边
 *    跟没跟上，回到场景之后还在不在；
 * 2. **穿一件盔甲**改四项属性，看队伍那边跟没跟上；
 * 3. **下一场战斗读到的是队伍那一份**，不是按等级重算出来的裸属性。
 *
 * ## 药从哪来
 *
 * 药包的唯一落点是 `fakes/drugPack.ts`（商店、宝箱、战利品、读档都写它），
 * `openMenu` 从那里现读（xl-bsv）。所以下面那句 `addDrug` 就是游戏本体里
 * 药进背包的那一句，不是往菜单世界里塞货。装备那一半仍然走菜单装备页的
 * `owned`（战利品另落一处，归 xl-5jx）。
 */
describe('菜单里改掉的血与属性回得到队伍（xl-6lo.16）', () => {
  /** 物品页清单第 `index` 行的带中 —— 与 `MenuDriver.move()` 同一条公式。 */
  function drugRow(index: number): { x: number; y: number } {
    return {
      x: DRUG_LIST_X + 1,
      y: rowBandTop(DRUG_LIST_VIEW, index, 0) + Math.floor(DRUG_ROW_H / 2),
    }
  }

  it('喝一瓶药：队伍那边当场跟上，回到场景还在', () => {
    let s = inScene('宿舍')
    // 把张小凡打成残血 —— 满血的话喝下去被夹回上限，`before === after` 恒真。
    getParty().zhang.hp = 1
    // 这三样菜单改不动，末尾要拿它们对一次。给它们**非零的值**：全是 0 的话
    // "没被动过"与"被写成了 0"长得一样。
    Object.assign(getParty().zhang, { exp: 77, isDead: true, angryValue: 42 })
    const untouched = { ...getParty().zhang }
    const drug = DRUGS[0]!
    addDrug(drug.name, 1)
    s = openMenu(s)

    const zhang = () => menuWorldOf(s)!.heroes[0]!
    expect(zhang().name, '第 0 个人应当是张小凡').toBe('zhangxiaofan')
    expect(zhang().hp, '菜单打开的那一刻看到的就该是队伍那个残血').toBe(1)
    // 这一场真的分得开：喝完不会顶到上限，也就不会与"什么都没发生"混在一起。
    expect(1 + drug.addHp).toBeLessThan(zhang().hpMax)

    // 选中那一行（鼠标一移就选中），再点「使用」—— 两步都走 advanceSession。
    s = advanceSession(s, { ...NO_INPUT, menu: [{ e: 'move', ...drugRow(0) }] }, 0)
    expect(menuWorldOf(s)!.panels.thingPanel.drug!.currentDrug).toBe(drug.name)

    // ⚠️ **喝之前先量一遍队伍**：不量的话，下面那句"队伍等于菜单"在
    // "两边都是 1、一口药都没喝下去"时照样绿。
    expect(getParty().zhang.hp, '还没点「使用」，队伍不该动').toBe(1)

    const [ux, uy] = buttonCenter(menuWorldOf(s)!.panels.thingPanel.drug!.useButton)
    // 期望值在动作之前记下（dispatch.md「事后比」）。
    const heldBefore = drugCount(drug.name)
    expect(heldBefore).toBe(1)
    s = advanceSession(s, { ...NO_INPUT, menu: click(ux, uy) }, 0)

    const inMenu = zhang().hp
    expect(inMenu, '这一口药没喝下去').toBe(1 + drug.addHp)
    // xl-bsv 的反方向：喝掉的那一瓶当拍就从药包里扣掉（存档读的是药包）。
    expect(drugCount(drug.name), '菜单里喝了药，药包没跟上').toBe(heldBefore - 1)
    // 正本判据一：**每一拍都写回**，不是等关菜单。
    expect(getParty().zhang.hp, '喝完这一拍队伍还是陈的').toBe(inMenu)

    // 正本判据二：关菜单回场景，那个数还在（没被回场景那条路抹掉）。
    const back = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
    expect(s.panel).toBe('scene')
    expect(getParty().zhang.hp, '关菜单把喝出来的血丢了').toBe(inMenu)

    // ⚠️ `rememberMenuParty` **只记五样**，理由是"菜单里没有一条路改得动
    // 经验 / 死没死 / 怒气"。那句话原先没有判据守着 —— 它正是"找不到东西
    // 就算通过"那一族（/code-review 标准轴提的）。这里把它变成一条断言：
    // 走完这一整趟，那三样一个字都不许变。哪天菜单真的动得了其中一样
    // （读档、学技能），这条会红，提醒有人把它加进写回清单。
    expect({
      exp: getParty().zhang.exp,
      isDead: getParty().zhang.isDead,
      angryValue: getParty().zhang.angryValue,
    }).toEqual({ exp: untouched.exp, isDead: untouched.isDead, angryValue: untouched.angryValue })
  })

  it('穿一件盔甲：四项属性与上限一起回到队伍', () => {
    let s = inScene('宿舍')
    s = openMenu(s)
    const w = menuWorldOf(s)!
    const e = w.panels.equipPanel.equip!

    // 张小凡用得了、而且**真的加体力**的第一件盔甲 —— 名字与数从表里取。
    // 不加体力的话 hpMax 不变，"跟上了"与"没跟上"长得一样。
    const armor = EQUIPMENT_LISTS.armor.find(
      (i) => (i.user === 0 || i.user === 1) && i.addPhysicalPower > 0,
    )
    if (!armor) throw new Error('盔甲表里没有张小凡用得了、又加体力的东西')
    // 装备超市（xl-knp）将来做的就是这一句。
    addEquipment(e, armor.name, 1)

    const before = { ...getParty().zhang }
    // 装备页那几下用现成的点击助手（`test/menuClicks.ts`），它们直接推菜单
    // 世界 —— 这一条要验的是**写回那一步**，输入怎么进来上一条已经验过了。
    w.panel = 'equipPanel'
    clickButton(w, e.slots.armor)
    selectEquipRow(w, armor.name)
    clickButton(w, e.use)
    expect(e.packs[1]!.armor, '这件盔甲没穿上').toBe(armor.name)

    const zhang = w.heroes[0]!
    expect(zhang.physicalPower, '穿上了却没加体力').toBe(before.physicalPower + armor.addPhysicalPower)

    // 还没推过一拍，队伍应当还是旧的 —— 这一句让下面那条不至于按构造成立。
    expect(getParty().zhang.physicalPower).toBe(before.physicalPower)

    s = advanceSession(s, NO_INPUT, 0)
    const after = getParty().zhang
    expect({
      physicalPower: after.physicalPower,
      agile: after.agile,
      strength: after.strength,
      sprit: after.sprit,
    }).toEqual({
      physicalPower: zhang.physicalPower,
      agile: zhang.agile,
      strength: zhang.strength,
      sprit: zhang.spirit,
    })
    // 派生值不入库（队伍只记四项基础属性），所以核的是**算出来的那个上限**。
    expect(derive(after).hpMax).toBe(zhang.hpMax)
    expect(derive(after).hpMax).toBeGreaterThan(derive(before).hpMax)

    // ⚠️ **再开一次菜单，那件盔甲加的属性还在**。少了这一条，"开菜单时按等级
    // 重算一遍属性"这个改法是绿的：这一场里等级没变，重算出来的正好等于
    // 出厂那一份 —— 而玩家看到的是"翻了一次菜单，盔甲白穿了"。
    s = advanceSession(
      s,
      { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs.func)) },
      0,
    )
    const back = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
    expect(s.panel).toBe('scene')
    s = openMenu(s)
    // ⚠️ **四项一起比，不能只比体力**。篡改矩阵第 8 条就是这么漏掉的：把
    // 「喂了实时队伍就照单全收」改成"在实时属性上**再加一次**武器加成"
    // （开一次菜单加一把刀），整条判据仍然全绿 —— 因为张小凡那把月苗刀
    // `addPhysicalPower` 是 **0**，重复计数在体力与 hpMax 上一个数都不差。
    // 它加的是敏捷 1 / 武力 2 / 精气 1，比上四项立刻红。
    const reopened = menuWorldOf(s)!.heroes[0]!
    expect({
      physicalPower: reopened.physicalPower,
      agile: reopened.agile,
      strength: reopened.strength,
      spirit: reopened.spirit,
      hpMax: reopened.hpMax,
    }).toEqual({
      physicalPower: zhang.physicalPower,
      agile: zhang.agile,
      strength: zhang.strength,
      spirit: zhang.spirit,
      hpMax: zhang.hpMax,
    })
    // 而它有分辨力的前提是那把武器**真的加了点什么** —— 四项全 0 的话
    // "再加一次"与"不加"长得一样，上面那条又恒真了。
    const knife = DEFAULT_WEAPONS.zhang
    expect(
      knife.addPhysicalPower + knife.addAgile + knife.addStrength + knife.addSpirit,
    ).toBeGreaterThan(0)
  })

  it('下一场战斗读到的是队伍那一份属性，不是按等级重算的裸属性', () => {
    resetParty()
    // 空槽位在脚本里写的就是字面的 `null` 三个字（`enemySlots` 认的是它）。
    const info: BattleInfo = ['迷宫1/1.jpg', 'zhang', 'yu', 'lu', '怪物1/5', 'null', 'null']
    const naked = derive(HEROES.yu.attributes(getParty().yu.level))

    // 出厂就带着开局那把武器：玉洁的鸳鸯刀加体力，上限跟着高一截。
    // 期望值走 `derive` 现算，**不写 70 那个系数** —— 写死的话 `derive` 改了
    // 公式这里照样绿，而它正是被测的那条算式。
    const base = HEROES.yu.attributes(getParty().yu.level)
    const fresh = createBattle(configFor(info, DEPS))
    const yu = fresh.heroes.find((h) => h.spec.key === 'yu')!
    expect(yu.hpMax).toBe(derive(withWeapon(base, DEFAULT_WEAPONS.yu)).hpMax)
    // 反向控制：这个差不是 0，上面那条才有分辨力（武器不加体力的话，
    // "喂了队伍属性"与"按等级重算"算出来是同一个数）。
    expect(yu.hpMax).toBeGreaterThan(naked.hpMax)

    // 再改一次队伍属性（菜单里穿装备走的就是这条路），战斗跟着变。
    const bumped = { ...getParty().yu, physicalPower: getParty().yu.physicalPower + 1 }
    getParty().yu.physicalPower = bumped.physicalPower
    const again = createBattle(configFor(info, DEPS))
    const yu2 = again.heroes.find((h) => h.spec.key === 'yu')!
    expect(yu2.hpMax).toBe(derive(bumped).hpMax)
    expect(yu2.hpMax).toBeGreaterThan(yu.hpMax)
    resetParty()
  })
})

/**
 * **菜单世界跨得过一次关菜单**（xl-6lo.18）。
 *
 * ## 这张票要守的那条缝
 *
 * 原版的 `MenuPanel` 是 `GameLauncher` 构造函数里 `new` 的**一份**，从开机活到
 * 关机（唯一会重建它的 `GameLauncher.init()` 没有人调 —— 那个方法本身是活的
 * 源码，被注释掉的是它在 `StartPanel` 里唯一的调用点）。这一层
 * 起先每次开菜单都新建一份，于是**两样在这一层没有别的出处**的状态活不过一次
 * 关菜单：`EquipPanelState.packs`（六个槽位穿着什么）与 `EquipPanelState.owned`
 * （六张装备表的持有量，原版是 `static` 的全局背包）。顺带还有当前在哪一页、
 * 四个 `Mouse` 的计数器、两条列表的滚动位置。
 *
 * xl-6lo.16 让四项属性与血 / 灵力跨过了这条缝（写回 `fakes/party.ts`），
 * 于是留下一处**会跟着变红的不一致**：队伍记着"加成"却记不住"加成是谁给的"，
 * 穿一件 +5 体力的盔甲 → 关菜单（+5 记住了）→ 再开菜单（盔甲不在槽位里了）
 * → 再穿一次 → +10。
 *
 * ## ⚠️ 同样没有行为真值，凭什么算过
 *
 * 与上面两组同一个理由：两条 menu 真值都从 `new MenuPanel()` 起、到剧本跑完
 * 为止，**关菜单之后不在任何一份真值里**。判据是五条，每条都跑得出红绿：
 *
 * 1. **装备状态逐字段跨得过去** —— 关菜单那一刻的整份 `equip` 快照，与再开
 *    菜单之后逐字段相等；
 * 2. **"穿两次加两次"那条路径** —— 关菜单再开，**原样重放**同一串点击，
 *    四项属性一个数都不许再动；
 * 3. **一次性信号真的收掉了** —— 不收的话下次开菜单第一拍就自己关上；
 * 4. **`returnButton.isclicked` 照原版留着**（复刻的缺陷，不是疏忽）；
 * 5. **「起」不重建菜单** —— 判据从 GBK 源码现读。
 *
 * ## 判据不是"今天到不了所以恒真"
 *
 * 装备在游戏本体里的唯一来源是装备超市（M4 / xl-knp），所以下面那句
 * `addEquipment(...)` 就是**装备超市将来要做的那一句** —— 与上一组里那句
 * "往背包里塞一瓶药"同一个手法。它落在**会话自己那份**菜单世界上
 * （`s.menu.world`），而不是另造一个世界：另造一个的话这一整组测的就不是
 * 会话那条缝了。塞完之后每一下都走真的输入（`advanceSession` 收
 * `SessionInput.menu`），一个状态字段都不手写。
 */
describe('菜单世界跨得过一次关菜单（xl-6lo.18）', () => {
  /**
   * ⚠️ **这一组里张小凡有两个编号，它们不是同一套**：
   *
   * - `packs[ZHANG_SCOLL]` 的 `1` 是**卷轴上的头像编号**（`ScollHero`，
   *   1 张小凡 / 2 陆雪琪 / **4** 玉洁 —— 3 号原版没做进菜单）；
   * - `heroes[ZHANG_MENU]` 的 `0` 是 `MENU_HERO_ORDER` 的下标
   *   （张 / 陆 / 玉），队伍键还是第三套（`zhang` / `lu` / `yu`）。
   *
   * 裸下标并排写着的时候，认错一个的表现是"给张小凡穿的东西加到了陆雪琪
   * 身上"，而两个人的属性都还是合法数字（`equipPanel.ts` 的 `menuHeroOf`
   * 记着同一件事）。取名字是为了让下一个人不必再对一遍。
   */
  const ZHANG_SCOLL = 1
  const ZHANG_MENU = 0

  /** 张小凡用得了、而且**真的加体力**的第一件盔甲。名字与数从表里取。 */
  function armorForZhang() {
    const armor = EQUIPMENT_LISTS.armor.find(
      (i) => (i.user === 0 || i.user === 1) && i.addPhysicalPower > 0,
    )
    if (!armor) throw new Error('盔甲表里没有张小凡用得了、又加体力的东西')
    return armor
  }

  /** 点顶栏那一颗页签，走会话。 */
  function tab(s: RunningSession, key: 'thing' | 'equip' | 'magic' | 'func'): RunningSession {
    return advanceSession(
      s,
      { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs[key])) },
      0,
    )
  }

  /** 天书页那颗「返回」—— 出菜单唯一的路。 */
  function leaveMenu(s: RunningSession): RunningSession {
    let next = tab(s, 'func')
    const back = menuWorldOf(next)!.panels.funcPanel.funcButtons!.main.returnButton
    next = advanceSession(next, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
    expect(next.panel, '点了「返回」却没回到场景').toBe('scene')
    return next
  }

  /**
   * 在装备页上把 `name` 那件穿到当前那个人身上：切到装备页 → 点盔甲槽位 →
   * 把鼠标移到它那一行 → 点「使用」。**四下全走会话**。
   */
  function wearArmor(s: RunningSession, name: string): RunningSession {
    let next = tab(s, 'equip')
    expect(menuWorldOf(next)!.panel).toBe('equipPanel')
    const e = () => menuWorldOf(next)!.panels.equipPanel.equip!
    next = advanceSession(next, { ...NO_INPUT, menu: click(...buttonCenter(e().slots.armor)) }, 0)
    expect(e().currentList, '没切到盔甲那张表').toBe('armor')
    const index = equipList(e()).findIndex((i) => i.name === name)
    if (index < 0) throw new Error(`盔甲列表里没有「${name}」`)
    next = advanceSession(
      next,
      {
        ...NO_INPUT,
        menu: [
          {
            e: 'move',
            x: EQUIP_X_START + 1,
            y: rowBandTop(EQUIP_LIST_VIEW, index, 0) + Math.floor(EQUIP_ROW_H / 2),
          },
        ],
      },
      0,
    )
    expect(e().currentEquipment, `想选「${name}」，选中的却是别的`).toBe(name)
    return advanceSession(next, { ...NO_INPUT, menu: click(...buttonCenter(e().use)) }, 0)
  }

  /** 开一次菜单，往背包里塞两件盔甲（装备超市将来做的那一句），穿上一件。 */
  function equipOnce(): { s: RunningSession; armor: ReturnType<typeof armorForZhang> } {
    let s = openMenu(inScene('宿舍'))
    const armor = armorForZhang()
    // 塞**两件**：穿掉一件之后列表里还剩一件，`owned` 那一列于是既不是全 0、
    // 也不是"穿完就空"—— 一份分得出"跨过去了"与"重建成 0 了"的存货。
    addEquipment(s.menu.world.panels.equipPanel.equip!, armor.name, 2)
    s = wearArmor(s, armor.name)
    expect(s.menu.world.panels.equipPanel.equip!.packs[ZHANG_SCOLL]!.armor, '这件盔甲没穿上').toBe(
      armor.name,
    )
    return { s, armor }
  }

  it('穿一件盔甲、关菜单、再开菜单：整份装备状态逐字段相同', () => {
    const first = equipOnce()
    const armor = first.armor
    let s = leaveMenu(first.s)

    // 关菜单**那一刻**的快照。`menuWorldOf` 这时是 null（菜单没显示着），
    // 所以从会话自己那一份上取 —— 世界还在，这正是本票要守的事。
    const world = s.menu.world
    // ⚠️ **每次现取那份 `equip`，不要在外头存一个引用**：存了的话，"再开菜单
    // 时把装备页整个重建一份"这种改法会读到那个陈的对象，逐字段比对全绿
    // ——篡改矩阵第 9 条实测撞到的，头一版就是这么写的。
    const equip = () => world.panels.equipPanel.equip!
    const shot = () => ({
      equip: snapshotEquip(equip()),
      // 快照函数只记**当前那个人**的六个槽位，另外两个人的也要跨过去。
      packs: structuredClone(equip().packs),
      owned: structuredClone(equip().owned),
      // 顺带那三样（票面「现象」那一节列的）。
      panel: world.panel,
      scroll: equip().scroll,
      mouse: structuredClone(world.panels.equipPanel.mouse),
    })
    const before = shot()
    // 先证明这份快照**不是一份空货**：穿上的那件在槽位里、背包里还剩一件。
    expect(before.packs[ZHANG_SCOLL]!.armor).toBe(armor.name)
    expect(before.equip['equipped']).toMatchObject({ armor: armor.name })
    expect(equipCount(equip(), 'armor', armor.name)).toBe(1)

    s = openMenu(s)
    expect(menuWorldOf(s), '再开菜单却没有菜单世界').not.toBeNull()
    expect(shot(), '关一次菜单丢了装备状态').toEqual(before)
    // 而且是**同一份**世界，不是逐字段相等的另一份。
    expect(menuWorldOf(s)).toBe(world)
  })

  it('⚠️ 穿两次不会加两次 —— 关菜单再开，原样重放同一串点击', () => {
    const first = equipOnce()
    const armor = first.armor
    let s = first.s
    const zhang = () => attributesOf(getParty().zhang)
    // 写回是每一拍一次，先推一拍让队伍跟上（上一组已经验过这条）。
    s = advanceSession(s, NO_INPUT, 0)
    const afterFirst = zhang()
    // 反向控制：这一件**真的加了点什么**，否则下面那条"没再动"恒真。
    expect(armor.addPhysicalPower).toBeGreaterThan(0)
    expect(afterFirst.physicalPower).toBe(menuWorldOf(s)!.heroes[ZHANG_MENU]!.physicalPower)

    s = leaveMenu(s)
    s = openMenu(s)
    // 关菜单之后队伍记着 +5，而槽位里那件盔甲**必须还在** —— 不在的话下面
    // 这串点击会把它再穿一次，四项属性变成 +10。
    expect(
      menuWorldOf(s)!.panels.equipPanel.equip!.packs[ZHANG_SCOLL]!.armor,
      '再开菜单，槽位里那件盔甲不见了',
    ).toBe(armor.name)

    // **原样重放**同一串点击：切装备页 → 点盔甲槽位 → 选那一行 → 点「使用」。
    // 槽位已经满了，`doUseButton` 记的是「已装备」那条拒绝，一个属性都不动。
    s = wearArmor(s, armor.name)
    s = advanceSession(s, NO_INPUT, 0)
    expect(zhang(), '穿两次加了两次').toEqual(afterFirst)
    // 存货也不许动 —— 拒绝那一支在减存货**之前**返回。
    expect(equipCount(menuWorldOf(s)!.panels.equipPanel.equip!, 'armor', armor.name)).toBe(1)
  })

  it('「返回」那条一次性信号读了就收 —— 再开菜单不会当场关上', () => {
    let s = openMenu(inScene('宿舍'))
    s = leaveMenu(s)
    expect(
      s.menu.world.panels.funcPanel.funcButtons!.exitToScene,
      '出菜单的信号没收掉，下次开菜单第一拍就自己关了',
    ).toBe(false)
    s = openMenu(s)
    // 推几拍：信号还立着的话这里当场掉回场景。
    s = advanceSession(s, NO_INPUT, 5 * MENU_TICK_MS)
    expect(s.panel).toBe('menu')
  })

  it('⚠️ 那一下松手照样送得到 —— 「返回」的 isclicked 被清掉，再开菜单不会一按就弹出去', () => {
    // ## 这一条守的是什么，以及它起先是**反着写**的
    //
    // `GameButton.isclicked` 只由 `isRelesedButton` 在命中时清零。按下「返回」
    // 那一下之后 CardLayout 就把 `menuPanel` 藏了起来，而鼠标监听器挂在
    // `MenuPanel` **自己**身上（`MenuPanel.setMouse()`）—— 看起来那一下松手
    // 到不了它，`isclicked` 于是永远粘着 true。本票头一版就是这么推的，还照着
    // 它把会话改成"逐个投递、见到「返回」就 break"。
    //
    // **那条推理是假的，是量出来的**（2026-09-10，openjdk 17，真 JFrame +
    // CardLayout：A 面板在 `mousePressed` 里把自己 `cl.show` 掉，再往窗口派一条
    // MOUSE_RELEASED，读数是 `A pressed=true released=true`、B 两个都 false）。
    // Swing 的 `LightweightDispatcher` 从按下到松开一直握着 grab，事件按**按下
    // 时**那个组件重定向，不看它还显不显示。所以原版是**清掉的**。
    //
    // ⚠️ 这条判据本身在 TS 里跑不了那个 JVM，所以它守的是**这一层的行为**；
    // 那个读数由 `session.ts` 里那段注释记着。剩下的半条缝（松手落在下一帧时
    // `useGame` 整个丢掉）是 xl-z4f。
    const menuPanel = javaSource('src/menu/MenuPanel.java')
    // 鼠标监听器确实挂在 MenuPanel 自己身上 —— 上面那条推理的前半段是对的，
    // 错的是后半段。留着这句是因为它决定了松手到底派给谁。
    expect(menuPanel).toContain('addMouseListener(')
    expect(menuPanel).toContain('currentPanel.mouseReleased(currentX, currentY);')
    // 而 `GameButton.isRelesedButton` 命中时清 isclicked —— 落点与按下同一处。
    expect(javaSource('src/tools/GameButton.java')).toContain('isclicked=false;')

    let s = openMenu(inScene('宿舍'))
    s = leaveMenu(s)
    const fb = s.menu.world.panels.funcPanel.funcButtons!
    expect(fb.main.returnButton.isclicked, '松手没送到菜单 ——「返回」还按着').toBe(false)

    // 再开菜单：当前页还是天书页（页跨过来了）。在上面按一颗**排在「返回」
    // 后面**的按钮（「退出」）—— `isclicked` 要是还粘着，那串 if-else 会先
    // 命中「返回」，菜单当场又被弹回场景。
    s = openMenu(s)
    expect(menuWorldOf(s)!.panel).toBe('funcPanel')
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb.main.exitButton)) }, 0)
    expect(s.panel, '一按「退出」菜单就被弹回场景 —— 那个 isclicked 粘住了').toBe('menu')
    // 反向控制：这一下**真的按到了「退出」**（子菜单第 4 组被打开），
    // 否则"没被弹出去"与"这一下什么都没点着"长得一样。
    expect(
      menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.exitForSure.isDraw,
      '这一下根本没点着「退出」—— 上面那条于是恒真',
    ).toBe(true)
  })

  it('⚠️ 松手落在**下一帧**也送得到（xl-z4f）—— 菜单已经藏了，送来的那一下照样交给它', () => {
    // 上一条是按下与松手**同一批**；浏览器里两者跨帧才是常态。原版按**按下时**
    // 那个组件派发松手（Swing 的 grab），不看它还显不显示 —— 所以会话收到一批
    // 菜单输入而菜单没显示着时，照样交给菜单那一份世界。
    let s = tab(openMenu(inScene('宿舍')), 'func')
    const fb = menuWorldOf(s)!.panels.funcPanel.funcButtons!
    const [x, y] = buttonCenter(fb.main.returnButton)
    s = advanceSession(s, { ...NO_INPUT, menu: [{ e: 'press', x, y }] }, 0)
    expect(s.panel, '按下「返回」那一帧菜单就该关').toBe('scene')
    // 反向控制：松手之前真的按着 —— 否则下面那条「清掉了」恒真。
    expect(fb.main.returnButton.isclicked).toBe(true)

    const tickBefore = s.menu.world.tick
    s = advanceSession(s, { ...NO_INPUT, menu: [{ e: 'release', x, y }] }, 0)
    expect(s.panel).toBe('scene')
    expect(fb.main.returnButton.isclicked, '下一帧的松手没送到菜单 ——「返回」还按着').toBe(false)
    // 交给藏着的菜单的只有那一下松手：不补脉冲、不画（原版藏着的面板 repaint 不真画）。
    expect(s.menu.world.tick, '藏着的菜单被推了一步').toBe(tickBefore)

    s = openMenu(s)
    expect(menuWorldOf(s)!.panel).toBe('funcPanel')
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb.main.exitButton)) }, 0)
    expect(s.panel, '一按「退出」菜单就被弹回场景 ——「返回」的 isclicked 粘住了').toBe('menu')
    expect(fb.sub.exitForSure.isDraw, '这一下根本没点着「退出」—— 上面那条于是恒真').toBe(true)
  })

  it('再开菜单看到的是队伍此刻的属性 —— 关着的这段时间队伍变了也跟得上', () => {
    // 这一条守的是 `refreshMenuWorld` 那一半（另一半是"刷得太多"，上面第一条
    // 守着）。**关菜单期间**改队伍，走的正是战斗升级与商店将来那条路。
    let s = openMenu(inScene('宿舍'))
    const menuHpMax = () => menuWorldOf(s)!.heroes[ZHANG_MENU]!.hpMax
    const opened = menuHpMax()
    s = leaveMenu(s)

    // 菜单关着的时候队伍涨了体力（打完一场升了级就是这样）。
    getParty().zhang.physicalPower += 10
    const expected = derive(getParty().zhang)
    // 反向控制：这十点**真的把上限顶上去了**，否则下面那条恒真。
    expect(expected.hpMax).toBeGreaterThan(opened)

    s = openMenu(s)
    const zhang = menuWorldOf(s)!.heroes[ZHANG_MENU]!
    expect(zhang.physicalPower, '再开菜单没把队伍的属性刷进来').toBe(
      getParty().zhang.physicalPower,
    )
    // 派生值也要跟着重算 —— 只抄四项属性、不跑 `refreshValue()` 的话，
    // 属性那一条是绿的而上限停在旧数上。
    expect(zhang.hpMax, '属性刷进来了，派生值没重算').toBe(expected.hpMax)
    resetParty()
  })

  it('音频那两个开关同理：菜单关着的时候被别处改了，再开菜单跟得上', () => {
    // 与上一条同一个形状，守的是 `refreshMenuWorld` 的另一半。
    //
    // ⚠️ **这一条是篡改矩阵逼出来的**：把 `refreshMenuWorld` 里刷音频那两句
    // 去掉，整套判据原先是**绿的** —— 因为菜单开着时每一拍都
    // `rememberAudioSettings` 写回去，世界又跨得过关菜单，两边本来就一直相等。
    // 也就是说那两句在"只有菜单改得动它"的今天是空操作。它们不是多余的：
    // 权威在 `game/audioSettings.ts`（原版那两个 static），世界只是它的镜子，
    // 而将来读档、设置页都从那一头改。这条判据现在就把那条路走一遍。
    resetAudioSettings()
    let s = openMenu(inScene('宿舍'))
    expect(menuWorldOf(s)!.audio, '出厂就该是两个都开着').toEqual({ bgm: true, sfx: true })
    s = leaveMenu(s)

    // 菜单关着的时候别处把两个都关了（读档将来走的就是这一句）。
    rememberAudioSettings({ bgm: false, sfx: false })
    s = openMenu(s)
    expect(menuWorldOf(s)!.audio, '再开菜单没把音频开关刷进来').toEqual({ bgm: false, sfx: false })
    // 顺带：`currentBgm` 立刻就该是 null（播放器收到 null 就 pause）。
    expect(currentBgm(s)).toBeNull()

    // ⚠️ **再走一轮，只翻其中一个** —— 两个一起翻的话，"两句各刷各的"与
    // "一句把另一句也顺手带上"长得一样（篡改矩阵实测：只翻 bgm 时，删掉刷
    // `sfx` 那一句整套判据是绿的）。
    s = leaveMenu(s)
    rememberAudioSettings({ bgm: true, sfx: false })
    s = openMenu(s)
    expect(menuWorldOf(s)!.audio, '两个开关分不开家').toEqual({ bgm: true, sfx: false })
    expect(currentBgm(s), '背景音乐开回来了，曲子该回来').not.toBeNull()
    resetAudioSettings()
  })

  it('「起」不重建菜单 —— 原版那句 init() 的调用点是注释掉的', () => {
    // ⚠️ **被注释掉的是调用点，不是 `init()` 本身**：`GameLauncher.init()` 是
    // 一段活的源码（它会 `new MenuPanel(...)`），只是全仓库没有一处非注释的
    // 调用。本票头一版把这句写成了"`init()` 整个是注释掉的死代码"，结论对、
    // 理由错 —— /code-review 的 Spec 轴抓到的。判据核的一直是调用点。
    expect(javaSource('src/main/GameLauncher.java'), 'init() 本身不见了').toContain(
      'public  void init(){',
    )
    const start = javaSource('src/start/StartPanel.java')
    // ⚠️ 先切出 `startLoadAction` 再找 `case 0:` —— 这个文件里有**好几个**
    // switch，直接 `/case 0:/` 抓到的是别处那一个（头一版就这么错了，
    // 报的是"找不到那句注释"，看起来像原版改过）。
    const action = /private void startLoadAction\(\) \{([\s\S]*?)\n\t\}/.exec(start)
    expect(action, 'startLoadAction 的方法体没解出来').not.toBeNull()
    const case0 = /case 0:([\s\S]*?)break;/.exec(action![1]!)
    expect(case0, 'startLoadAction 的 case 0 没解出来').not.toBeNull()
    // 那一句在原版里是被注释掉的，行首带 `//`。
    expect(case0![1]!).toContain('//	Game.game.init();')
    // 而这一支里一个字都没碰菜单。
    expect(case0![1]!).not.toContain('menuPanel')

    // 这一层的对应物：`enterScene` 交回来的会话，菜单还是同一份。
    const idle = createSession(DEPS)
    const s = enterScene(idle, createWorld(getScene('宿舍')))
    expect(s.menu, '「起」把菜单重建了').toBe(idle.menu)
  })
})

/**
 * 天书页「确认离开」走一整条会话也纹丝不动（xl-03x.12）。`menu/funcButtons.test.ts`
 * 那几条管的是菜单世界自己；票面要的「面板不变」是**会话**的 `panel`，而把它
 * 顺手切走的那一句只会写在 `advanceSession` 里，菜单世界那几条看不见。
 */
describe('天书页「确认离开」走会话也纹丝不动（xl-03x.12）', () => {
  it('点下去再推一秒：还在菜单、还在天书页、按钮组不变、背景音乐没换', () => {
    let s = openMenu(inScene('宿舍'))
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
    const fb = () => menuWorldOf(s)?.panels.funcPanel.funcButtons ?? null
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb()!.main.exitButton)) }, 0)
    expect(fb()!.sub.exitForSure.isDraw, '点了「退出」却没展开「确认离开」').toBe(true)

    const signature = () => ({
      panel: s.panel,
      menuPanel: menuWorldOf(s)?.panel ?? null,
      drawn: fb() === null ? null : drawnFuncButtons(fb()!),
      bgm: currentBgm(s),
    })
    // 期望值在动作之前记下 —— 不拿动作之后两个被同一次动作同步过的量互比。
    const before = signature()
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb()!.sub.exitForSure)) }, 0)
    s = advanceSession(s, NO_INPUT, 1000)
    expect(signature(), '点「确认离开」之后会话变了').toEqual(before)

    // 对照：同一个会话里点「返回」真的回场景 —— 「面板变了」在这条路上是看得见的。
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb()!.main.returnButton)) }, 0)
    expect(s.panel, '对照失效：点「返回」也没切面板').toBe('scene')
  })
})

/**
 * 物品页读的是药包那一份（xl-bsv）。
 *
 * 原版物品页读 static 的 `DrugPack.drugList`，与商店、宝箱、战斗、读档同一张表。
 * 这一层菜单世界只在 `createGameMenu` 里建一次；从前 `refreshMenuWorld` 不同步药，
 * 于是药包里有 3 瓶、物品页上是 0 瓶 —— 两边各自的单测都是绿的。
 */
describe('物品页看得见药包里的药（xl-bsv）', () => {
  /** 物品页上某味药的件数（菜单世界的存货，画的时候按 >0 过滤）。 */
  function menuHeld(s: RunningSession, name: string): number {
    const stock = menuWorldOf(s)!.drugPack.find((d) => d.name === name)
    if (!stock) throw new Error(`菜单存货里没有「${name}」`)
    return stock.count
  }

  it('建会话之前加的药，开菜单看得见', () => {
    resetParty()
    resetDrugPack()
    const drug = DRUGS[0]!
    addDrug(drug.name, 3)
    const expected = drugCount(drug.name)
    expect(expected, '对照失效：药包里本来就没进去').toBe(3)
    let s = enterScene(createSession(DEPS), createWorld(getScene('宿舍')))
    s = openMenu(s)
    expect(menuHeld(s, drug.name)).toBe(expected)
  })

  it('开过一次菜单之后别处再加药，下次开菜单看到的是新的数', () => {
    let s = inScene('宿舍')
    const drug = DRUGS[1]!
    s = openMenu(s)
    expect(menuHeld(s, drug.name)).toBe(0)
    // 关菜单：天书页「返回」。
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
    const back = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
    expect(s.panel).toBe('scene')

    // 商店 / 宝箱 / 战利品写的都是这一句。
    addDrug(drug.name, 2)
    const expected = drugCount(drug.name)
    s = openMenu(s as RunningSession)
    expect(menuHeld(s, drug.name), '菜单还是上次打开时的数').toBe(expected)
  })
})
