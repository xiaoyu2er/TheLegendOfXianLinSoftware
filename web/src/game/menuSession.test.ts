import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { attributesOf, getParty, resetParty } from '../fakes/party'
import { javaSource } from '../test/javaSource'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { roleTileX, roleTileY } from '../state/role'
import { MENU_TICK_MS } from '../menu/loop'
import { FUNC_MAIN_ORDER } from '../menu/funcButtons'
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
import {
  NO_INPUT,
  advanceSession,
  configFor,
  createSession,
  enterScene,
  menuWorldOf,
  openMenu,
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
}

function inScene(name: string): RunningSession {
  resetParty()
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
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(back)) }, 0)
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
 * ## 今天游戏本体走不到，判据里那一句"塞货"是怎么回事
 *
 * 药与装备在游戏本体里的唯一来源是商店（M4 / xl-knp），`openMenu` 不喂
 * `drugs` / `equipment`，六种药与六张装备表的持有量全是 0 —— 玩家点不出
 * 「使用」按钮。判据里那句"往背包里塞一瓶"就是药店将来要做的那一句，写在
 * 这里是**为了让这条路今天就有人走**：等到 M4 才发现写回漏了，中间这段时间
 * "没写回"与"写回了"长得一模一样。
 */
describe('菜单里改掉的血与属性回得到队伍（xl-6lo.16）', () => {
  /** 往菜单世界的背包里塞货 —— 药店（xl-knp）将来做的就是这一句。 */
  function stockDrug(s: RunningSession, name: string, count: number): void {
    const stock = menuWorldOf(s)!.drugPack.find((d) => d.name === name)
    if (!stock) throw new Error(`六种药里没有「${name}」`)
    stock.count += count
  }

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
    s = openMenu(s)

    const drug = DRUGS[0]!
    stockDrug(s, drug.name, 1)
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
    s = advanceSession(s, { ...NO_INPUT, menu: click(ux, uy) }, 0)

    const inMenu = zhang().hp
    expect(inMenu, '这一口药没喝下去').toBe(1 + drug.addHp)
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
 * 关机（唯一会重建它的 `GameLauncher.init()` 整个是注释掉的死代码）。这一层
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
    expect(s.menu.world.panels.equipPanel.equip!.packs[1]!.armor, '这件盔甲没穿上').toBe(armor.name)
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
    expect(before.packs[1]!.armor).toBe(armor.name)
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
    expect(afterFirst.physicalPower).toBe(
      menuWorldOf(s)!.heroes[0]!.physicalPower,
    )

    s = leaveMenu(s)
    s = openMenu(s)
    // 关菜单之后队伍记着 +5，而槽位里那件盔甲**必须还在** —— 不在的话下面
    // 这串点击会把它再穿一次，四项属性变成 +10。
    expect(
      menuWorldOf(s)!.panels.equipPanel.equip!.packs[1]!.armor,
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

  it('⚠️ 但「返回」那颗按钮的 isclicked 照原版留着 —— 再开菜单在天书页上按一下就又出去了', () => {
    // 先从原版现读：鼠标监听器挂在 `MenuPanel` **自己**身上，所以 CardLayout
    // 把它藏起来之后松手那一下根本到不了它 —— `isRelesedButton` 一次没跑，
    // 那个 `isclicked` 就一直是 true。
    const menuPanel = javaSource('src/menu/MenuPanel.java')
    expect(menuPanel).toContain('addMouseListener(')
    expect(menuPanel, '鼠标监听器不在 MenuPanel 自己身上，这条推理就不成立了').toContain(
      'public void mouseReleased(MouseEvent e)',
    )

    let s = openMenu(inScene('宿舍'))
    s = leaveMenu(s)
    const fb = s.menu.world.panels.funcPanel.funcButtons!
    expect(fb.main.returnButton.isclicked, '「返回」的 isclicked 被清掉了 —— 原版清不掉').toBe(true)

    // 再开菜单：当前页还是天书页（页也跨过来了），在上面按任何一处，
    // `funcCheckPressed` 那串 if-else 又会走到「返回」那一支 ——「退出」排在
    // 它后面，所以点「退出」得到的是"又出去了"。
    s = openMenu(s)
    expect(menuWorldOf(s)!.panel).toBe('funcPanel')
    s = advanceSession(s, { ...NO_INPUT, menu: click(...buttonCenter(fb.main.exitButton)) }, 0)
    expect(s.panel, '这一下没把菜单弹出去 —— 那个粘住的 isclicked 没复刻上').toBe('scene')
  })

  it('再开菜单看到的是队伍此刻的属性 —— 关着的这段时间队伍变了也跟得上', () => {
    // 这一条守的是 `refreshMenuWorld` 那一半（另一半是"刷得太多"，上面第一条
    // 守着）。**关菜单期间**改队伍，走的正是战斗升级与商店将来那条路。
    let s = openMenu(inScene('宿舍'))
    const menuHpMax = () => menuWorldOf(s)!.heroes[0]!.hpMax
    const opened = menuHpMax()
    s = leaveMenu(s)

    // 菜单关着的时候队伍涨了体力（打完一场升了级就是这样）。
    getParty().zhang.physicalPower += 10
    const expected = derive(getParty().zhang)
    // 反向控制：这十点**真的把上限顶上去了**，否则下面那条恒真。
    expect(expected.hpMax).toBeGreaterThan(opened)

    s = openMenu(s)
    const zhang = menuWorldOf(s)!.heroes[0]!
    expect(zhang.physicalPower, '再开菜单没把队伍的属性刷进来').toBe(
      getParty().zhang.physicalPower,
    )
    // 派生值也要跟着重算 —— 只抄四项属性、不跑 `refreshValue()` 的话，
    // 属性那一条是绿的而上限停在旧数上。
    expect(zhang.hpMax, '属性刷进来了，派生值没重算').toBe(expected.hpMax)
    resetParty()
  })

  it('「起」不重建菜单 —— 原版那一句 init() 是注释掉的死代码', () => {
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
