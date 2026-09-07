import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { drugCount, drugEntries, resetDrugPack } from '../fakes/drugPack'
import { equipmentCount, equipmentEntries, resetEquipmentPack } from '../fakes/equipmentPack'
import { getCoins, resetWallet } from '../fakes/wallet'
import { checkEnemyDead, stepBattle } from './step'
import { replayBattle } from './replay'
import { BATTLE_TRACE_NAMES, readBattleTrace } from './trace'
import { SHOW_ATTR_START, SHOW_EXP_INDEX, VICTORY } from './victory'
import { createBattle } from './world'
import { ENEMIES, expToLevelUp } from './units'
import type { Attributes, PartyKey } from './units'
import type { BattleWorld } from './types'

/**
 * 打赢之后的结算（`VictoryReminder`）—— 票 xl-rh9.5。
 *
 * ## ⚠️ 这一段没有行为真值覆盖，所以先说清楚凭什么算过
 *
 * 五份 `driver=battle` 的行为真值一份都没走进结算：`battle-min` 的末步正是
 * 「胜利」第一次出现的那一刻，三份打输的走的是 `GameOver`。也就是说
 * `victory.ts` 里每一个数抄错了和抄对了，推出来的**每一个真值字段都相同**。
 *
 * 于是这一整个文件就是它的判据，四条，每一条的失败都和它的通过长得不一样：
 *
 * 1. **常量逐个对回原版源码**：把 `VictoryReminder.update()` 方法体里的整数
 *    字面量按出现顺序解出来，与 `VICTORY` 表逐个对撞。分母是 Java 源码里有
 *    几个字面量 —— 解析器空转是 0，那条断言先红。
 * 2. **两条路端到端**：升级与不升级各跑一遍，断言切面板发生在哪一拍，而那个
 *    拍号是从**解析出来的阈值**算的闭式，不是手写的；两条路差的拍数必须正好
 *    等于 `endAt - levelCheckAt`。
 * 3. **发奖那一拍**：物品与钱落进三个假货里，早一拍空、当拍满、后一拍不再变
 *    —— 三个方向都断言（`thing_sx1==4` 在整场里只出现一次）。
 * 4. **假货登记册的双向对撞**在 `fakes/registry.test.ts`（ADR-0005）。
 *
 * 真值哪天往后接了一段（导出器支持 victory 之后的拍），第 1、2 条退成保险丝，
 * 由逐字段比对接手。
 *
 * ## 第 1 条与第 2 条分工不同，别指望其中一条兼管另一条
 *
 * 篡改验证里量出来的（xl-rh9.5）：把 `VICTORY.levelCheckAt` 从 15 改成 16，
 * **只有第 1 条红**，两条端到端全绿。原因是端到端那两个拍号是 `exitTick()`
 * 从同一张 `VICTORY` 表算出来的，常量一改，期望值跟着一起漂 —— 这不是判据
 * 失灵，是**它验的本来就不是数值**：它验的是那台状态机的形状（顺序、分支、
 * 两条路差几拍）。数值由第 1 条对回原版源码。
 *
 * 反过来也一样：把 `if(expToGet<=0)` 那一段收进 `if(timeCode===warmup)` 里
 * （原版写在外面），常量一个没动，**第 1 条全绿而两条端到端全红**。
 */

/** 怪物出场图的像素尺寸，与 `battleTrace.test.ts` 同一条路：读 IHDR。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

describe('结算用到的常量逐个对回 VictoryReminder.update()', () => {
  /**
   * `update()` 方法体里的整数字面量，**按出现顺序**。
   *
   * 先剥注释、再把字符串字面量整个换掉：`case "1"` / `case "2"` 里那两个数字
   * 不是常量而是掉落物类型的**字符串**，混进来会让下面那条比对错位一位，
   * 而错位一位之后每一项看上去都还是个合理的数。
   */
  const literals = (() => {
    // GBK 源码要显式解码（`javaSource`）。按 UTF-8 读出来匹配不到 = 0 个，
    // 而 0 个的逐项比对是恒真的 —— 下面第一条断言拦的正是这个。
    const src = javaSource('src/battle/VictoryReminder.java')
    const from = src.indexOf('public void update(){')
    if (from < 0) throw new Error('在 VictoryReminder.java 里找不到 update() —— 解析器该改了')
    const body = src
      .slice(from)
      .replace(/\/\/[^\n]*/g, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    return [...body.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]))
  })()

  it('从源码里真的解出了字面量 —— 解析器空转要响', () => {
    expect(literals.length, 'update() 里一个整数字面量都没解出来').toBeGreaterThan(0)
  })

  it('逐个相等，一个不多一个不少', () => {
    const V = VICTORY
    // 结构性的 0 / 1 / 2 用裸数写：它们是下标与比较，不是可调的常量。
    // 每一行末尾注明它在原版里是哪一句。
    const expected = [
      V.scrollTarget, //            if(sy2<480)
      V.scrollStep, //              dy2+=20
      V.scrollStep, //              sy2+=20
      0, //                         if(thing_sx1>0)
      V.thingStepX, //              thing_dx1-=4
      V.thingStepX, //              thing_dx2+=4
      V.thingStepX, //              thing_sx1-=4
      V.thingStepX, //              thing_sx2+=4
      V.thingStepY, //              thing_dy1-=5
      V.thingStepY, //              thing_dy2+=5
      V.thingStepY, //              thing_sy1-=5
      V.thingStepY, //              thing_sy2+=5
      V.thingAwardAt, //            if(thing_sx1==4)
      1, //                         switch(s.split("/")[1])
      0, //                         DrugPack.addDrug(s.split("/")[0],
      1, //                                                          1)
      0, //                         EquipmentPack.addEqupment(s.split("/")[0],
      1, //                                                                   1)
      0, //                         if(thing_sx1==0)
      V.scrollTarget, //            if(sy2==480)
      V.warmup, //                  if(timeCode<10)
      V.warmup, //                  if(timeCode==10)
      0, //                         if(expToGet>0)
      V.expStep, //                 expToGet-=40
      0, //                         for(int i=0;
      2, //                                     i<=2;
      0, //                         if(showNums.get(i)>0)
      V.expStep, //                 showNums.set(i,showNums.get(i)-40)
      0, //                         showNums.set(i,0)
      0, //                         if(expToGet<=0)
      0, //                         expToGet=0
      V.levelCheckAt, //            if(timeCode==15)
      V.secondPageAt, //            if(timeCode==25)
      V.addValueFrom, //            if(timeCode>=35
      V.addValueTo, //                            &&timeCode<55)
      SHOW_ATTR_START.zhang, //     addValue(3, bp.zxf)
      SHOW_ATTR_START.yu, //        addValue(7, bp.yj)
      SHOW_ATTR_START.lu, //        addValue(11, bp.lxq)
      V.endAt, //                   if(timeCode==55)
    ]
    expect(literals).toEqual(expected)
  })

  it('构造函数里那两个初值也对回源码', () => {
    const src = javaSource('src/battle/VictoryReminder.java')
    // `thing_sx1=60;`（物品框展开的起点）与 `sy2=0;`（卷轴的起点）。
    expect(src, 'thing_sx1 的初值').toContain(`thing_sx1=${VICTORY.thingSx1Start};`)
    expect(src, 'sy2 的初值').toContain('sy2=0;')
  })

  it('showNums 的三段起点就是原版那句注释说的 0--2 / 3--6 / 7--10 / 11--14', () => {
    expect([SHOW_EXP_INDEX.zhang, SHOW_EXP_INDEX.yu, SHOW_EXP_INDEX.lu]).toEqual([0, 1, 2])
    expect([SHOW_ATTR_START.zhang, SHOW_ATTR_START.yu, SHOW_ATTR_START.lu]).toEqual([3, 7, 11])
  })
})

/** 这两场只差一个等级 —— 掉落物、钱、经验、怪都一样，好让两条路正面对照。 */
const BACKGROUND = 'image/背景图/伏魔山树林.png'
const PARTY: readonly PartyKey[] = ['zhang', 'yu', 'lu']
/** 罹年居士掉的是装备（`御衡镇日刀/2`），商塔弟子掉的是药（`还魄丹/1`）—— 两支都走到。 */
const ENEMY_SLOTS: readonly (string | null)[] = ['罹年居士/5', '商塔弟子/6', null]

function battleAt(level: number): BattleWorld {
  return createBattle({
    background: BACKGROUND,
    party: PARTY,
    levels: { zhang: level, yu: level, lu: level },
    enemies: ENEMY_SLOTS,
    seed: 20260907,
    sprite: spriteSize,
  })
}

/** 把三个槽位打空，再跑 `Check.checkEnemyDead()` —— 胜利就是这么开始的。 */
function win(w: BattleWorld): void {
  for (const e of w.slots) if (e !== null) e.hp = 0
  checkEnemyDead(w)
}

/**
 * 四项属性。返回类型写成 `Attributes` 而不是让它推断 —— 这样「升级前的那份」
 * 与「升级后的那份」是同一个类型，下面就不需要 `as unknown as` 把一个记录硬掰
 * 成 `Hero`。dispatch.md 说过：`as unknown as` 断言过去的东西 TypeScript 什么
 * 都不核。
 */
function attrsOf(h: Attributes): Attributes {
  return {
    physicalPower: h.physicalPower,
    sprit: h.sprit,
    agile: h.agile,
    strength: h.strength,
  }
}

/**
 * 切面板落在**第几拍**（`updateVictoryReminder` 被调用的次数，1 起）。
 *
 * 这是从 `VICTORY` 那几个阈值算出来的**闭式**，和实现那个逐拍状态机是两条路：
 *
 * - 卷轴要 `480/20 = 24` 拍拉满，主段从第 24 拍开始；
 * - 主段头一拍 `timeCode` 就 +1，所以它第一次等于 10 是第 `24+10-1` 拍；
 * - 从那一拍起每拍扣 40 点经验，扣 `ceil(exp/40)` 拍到 ≤0；**扣到 0 的那一拍
 *   同一拍里** `timeCode` 就变成 11（那句 `if(expToGet<=0)` 写在 `==10` 外面）；
 * - 此后每拍 +1。
 */
function exitTick(expToGet: number, timeCodeTarget: number): number {
  const scrollTicks = VICTORY.scrollTarget / VICTORY.scrollStep
  const firstWarmTick = scrollTicks + VICTORY.warmup - 1
  const drains = Math.ceil(expToGet / VICTORY.expStep)
  if (drains < 1) throw new Error('这条闭式只在真的要扣经验时成立')
  const lastDrainTick = firstWarmTick + drains - 1
  return lastDrainTick + (timeCodeTarget - (VICTORY.warmup + 1))
}

describe('打赢之后：结算走完，回地图', () => {
  beforeEach(() => {
    // 三个假货都是模块级单例（原版是静态字段）。不清的话「上一条用例留下的
    // 药」与「这一场真的发了药」长得一样。
    resetDrugPack()
    resetEquipmentPack()
    resetWallet()
  })

  const expOfSlots = ENEMY_SLOTS.filter((s): s is string => s !== null).map(
    (s) => ENEMIES[s.slice(0, s.lastIndexOf('/'))]!,
  )
  const totalExp = expOfSlots.reduce((sum, e) => sum + e.exp, 0)
  const totalMoney = expOfSlots.reduce((sum, e) => sum + e.money, 0)

  it('开场就把经验 / 钱 / 掉落物算死了（getInformation 在构造函数里）', () => {
    const v = battleAt(5).victoryReminder
    expect({ exp: v.expToGet, money: v.moneyToGet }).toEqual({ exp: totalExp, money: totalMoney })
    // 顺序是 `bp.enemies` 的顺序（**em2 → em1 → em3**，`BattlePanel.initial()`
    // 就是这么 add 的），不是槽位顺序 —— `thirdString` 那一列就照这个顺序画。
    const w = battleAt(5)
    expect(w.victoryReminder.things).toEqual(w.enemies.map((e) => e.spec.thing))
    expect(
      w.victoryReminder.things,
      '掉落物是按槽位顺序排的 —— 那说明抄的是 slots 不是 enemies，这一场分得开',
    ).not.toEqual(w.slots.filter((e) => e !== null).map((e) => e!.spec.thing))
    // 三个人都在场，15 项一项都不该是 null。
    expect(v.showNums.filter((n) => n === null)).toEqual([])
  })

  it('缺席的角色在 showNums 上是 null，而它从头到尾没被读过', () => {
    const w = createBattle({
      background: BACKGROUND,
      party: ['zhang'],
      levels: { zhang: 5 },
      enemies: ENEMY_SLOTS,
      seed: 20260907,
      sprite: spriteSize,
    })
    const v = w.victoryReminder
    expect(v.showNums[SHOW_EXP_INDEX.zhang]).not.toBeNull()
    expect(v.showNums[SHOW_EXP_INDEX.yu]).toBeNull()
    expect(v.showNums[SHOW_ATTR_START.lu]).toBeNull()
    // 整场跑完不许因为那几个 null 抛。
    win(w)
    for (let t = 0; t < exitTick(totalExp, VICTORY.endAt) + 10; t++) stepBattle(w)
    expect(w.exitPanel).toBe('scenePanel')
  })

  it('没人升级：经验涨了、属性一点没动、在 timeCode==15 那一拍回地图', () => {
    // 20 级升一次要 418340 点经验，这一场只有 10329 —— 谁都升不了。
    const w = battleAt(20)
    const before = w.party.map((h) => ({ exp: h.exp, level: h.level, ...attrsOf(h) }))
    expect(totalExp, '这一场的经验必须真的不够升级，不然这条用例验的是另一条路').toBeLessThan(
      expToLevelUp(20),
    )

    win(w)
    // 经验确实涨了 —— 三个人各拿全额（原版就是每人一份，不是平分）。
    expect(w.party.map((h) => h.exp)).toEqual(before.map((b) => b.exp + totalExp))
    expect(w.party.map((h) => h.isLevelUp)).toEqual([false, false, false])
    expect(w.party.map(attrsOf)).toEqual(before.map(attrsOf))

    const at = exitTick(totalExp, VICTORY.levelCheckAt)
    for (let t = 1; t < at; t++) {
      stepBattle(w)
      expect(w.exitPanel, `第 ${t} 拍就切面板了 —— 早了`).toBeNull()
    }
    stepBattle(w)
    expect(w.exitPanel, `第 ${at} 拍该切回场景`).toBe('scenePanel')
    // 「回到地图上原来的位置」靠的是场景面板自己留着的坐标；战斗这边欠的
    // 只有 SCENE_SIGNAL 这一个信号。
    expect(w.sceneSignal).toBe(true)
    // `bp.heroes.clear()`：出战名单还在（快照读的是它），循环用的那份清空了。
    expect(w.heroes).toEqual([])
    expect(w.party.length).toBe(3)
    // 没人升级就不翻第二页。
    expect(w.victoryReminder.levelUpIsDraw).toBe(false)
    expect(w.victoryReminder.secondIsDraw).toBe(false)
  })

  it('有人升级：属性按 levelUpDelta 涨、滚动动画追上去、在 timeCode==55 那一拍才回地图', () => {
    const w = battleAt(1)
    const before = w.party.map((h) => ({ ...attrsOf(h), level: h.level, expToLevelUp: h.expToLevelUp }))
    expect(totalExp, '这一场的经验必须真的够升级').toBeGreaterThanOrEqual(expToLevelUp(1))

    win(w)
    for (const [i, h] of w.party.entries()) {
      const b = before[i]!
      const d = h.spec.levelUpDelta
      expect(h.isLevelUp, `${h.spec.key} 该升级`).toBe(true)
      // 属性 = 原值 + levelUpDelta（原版加的是**当前值**，不是按新等级重算）。
      expect(attrsOf(h), `${h.spec.key} 的四项属性`).toEqual({
        physicalPower: b.physicalPower + d.physicalPower,
        sprit: b.sprit + d.sprit,
        agile: b.agile + d.agile,
        strength: b.strength + d.strength,
      })
      // 原版 `Check` 里那句是 `if(...){hero.levelUp();}` —— **不是 while**。
      // 这一场的经验够升十几级，原版也只升一级，剩下的经验留着。
      expect(h.level, `${h.spec.key} 只升一级`).toBe(b.level + 1)
      expect(h.exp).toBe(totalExp - b.expToLevelUp)
      expect(h.exp, '剩下的经验还够再升一级 —— 所以"只升一级"这条是看得见的').toBeGreaterThanOrEqual(
        h.expToLevelUp,
      )
      expect(h.expToLevelUp).toBe(expToLevelUp(b.level + 1))
      // `levelUp()` 末尾的 `hp=hpMax; mp=mpMax`。
      expect({ hp: h.hp, mp: h.mp }).toEqual({ hp: h.hpMax, mp: h.mpMax })
    }

    const noLevel = exitTick(totalExp, VICTORY.levelCheckAt)
    const withLevel = exitTick(totalExp, VICTORY.endAt)
    // 两条路差的拍数就是原版那两个阈值之差 —— 这个数是算出来的，不是手写的。
    expect(withLevel - noLevel).toBe(VICTORY.endAt - VICTORY.levelCheckAt)

    for (let t = 1; t < withLevel; t++) {
      stepBattle(w)
      expect(w.exitPanel, `第 ${t} 拍就切面板了 —— 早了`).toBeNull()
      if (t === noLevel) {
        // 反方向：不升级那条路的拍号在这里必须**不**切面板，否则两条路就分不开了。
        expect(w.victoryReminder.levelUpIsDraw, '第 15 拍该认出有人升级了').toBe(true)
      }
      if (t === noLevel + (VICTORY.addValueFrom - VICTORY.levelCheckAt) - 1) {
        // 属性滚动**还没开始**：showNums 还是开场那一份（升级前的值）。
        for (const [i, h] of w.party.entries()) {
          const b = before[i]!
          const at = SHOW_ATTR_START[h.spec.key]
          expect(w.victoryReminder.showNums.slice(at, at + 4), `${h.spec.key} 滚动前`).toEqual([
            b.physicalPower,
            b.sprit,
            b.agile,
            b.strength,
          ])
        }
      }
    }
    stepBattle(w)
    expect(w.exitPanel, `第 ${withLevel} 拍该切回场景`).toBe('scenePanel')
    expect(w.sceneSignal).toBe(true)
    expect(w.heroes).toEqual([])
    // 翻过第二页，滚动动画追到了新属性，`isLevelUp` 被收尾那三句清回去。
    expect(w.victoryReminder.secondIsDraw).toBe(true)
    expect(w.victoryReminder.levelUpIsDraw).toBe(false)
    expect(w.party.map((h) => h.isLevelUp)).toEqual([false, false, false])
    for (const h of w.party) {
      const at = SHOW_ATTR_START[h.spec.key]
      expect(w.victoryReminder.showNums.slice(at, at + 4), `${h.spec.key} 滚完`).toEqual([
        h.physicalPower,
        h.sprit,
        h.agile,
        h.strength,
      ])
    }
  })

  /**
   * `SCENE_SIGNAL` 这一位**不在行为真值里**（导出器的 `snapshotState` 不取它），
   * 所以它自己要一条判据，而且要正反两边：三条出口里有两条回地图（打赢结算完、
   * 剧情必败战），一条回标题。只验回地图那两条的话，"每条出口都置它"与
   * "回地图才置它"推出来的结果完全相同。
   *
   * 回地图那两条里，打输那一条由 `battle-defeat-scene` 这份真值走到（它的末步
   * 正是切面板那一拍），打赢那一条由上面几条用例走到。
   */
  it('两条回地图的路都置 SCENE_SIGNAL，回标题那条不置', () => {
    const outcomes = BATTLE_TRACE_NAMES.map((name) => {
      const trace = readBattleTrace(name)
      const w = replayBattle(trace, spriteSize)
      for (const tick of trace.ticks) stepBattle(w, tick.input)
      return { name, panel: w.exitPanel, signal: w.sceneSignal }
    })
    const toScene = outcomes.filter((o) => o.panel === 'scenePanel')
    const toStart = outcomes.filter((o) => o.panel === 'startPanel')
    expect(toScene.length, '没有一份真值走回地图那条出口').toBeGreaterThan(0)
    expect(toStart.length, '没有一份真值走回标题那条出口 —— 反方向就没了').toBeGreaterThan(0)
    for (const o of toScene) expect(o.signal, `${o.name} 回了地图却没置 SCENE_SIGNAL`).toBe(true)
    for (const o of toStart) expect(o.signal, `${o.name} 回的是标题，不该置 SCENE_SIGNAL`).toBe(false)
    // 一场都没切面板的那几份也不许置。
    for (const o of outcomes.filter((x) => x.panel === null)) {
      expect(o.signal, `${o.name} 一次面板都没切，却置了 SCENE_SIGNAL`).toBe(false)
    }
  })

  it('物品与钱在 thing_sx1==4 那一拍发出去，早一拍没有、晚一拍不再发', () => {
    const w = battleAt(20)
    win(w)
    // `thing_sx1` 从 60 每拍 -4，第 14 拍之后正好等于 4。
    const awardAt = (VICTORY.thingSx1Start - VICTORY.thingAwardAt) / VICTORY.thingStepX
    const coinsBefore = getCoins()

    for (let t = 1; t < awardAt; t++) stepBattle(w)
    // 早一拍：三个包都还是空的。
    expect([drugEntries(), equipmentEntries(), getCoins()]).toEqual([[], [], coinsBefore])

    stepBattle(w)
    // 当拍：药进背包、装备进装备包、钱进钱包，各一份。
    expect(drugCount('还魄丹'), '商塔弟子掉的药').toBe(1)
    expect(equipmentCount('御衡镇日刀'), '罹年居士掉的装备').toBe(1)
    expect(getCoins()).toBe(coinsBefore + totalMoney)
    // 一样不多：`things` 里有几件就发几件。
    expect(drugEntries().length + equipmentEntries().length).toBe(w.victoryReminder.things.length)

    const after = [drugEntries(), equipmentEntries(), getCoins()]
    for (let t = 0; t < 30; t++) stepBattle(w)
    // 晚一拍起不再发 —— `thing_sx1` 之后一直是 0，那一支只走一次。
    expect([drugEntries(), equipmentEntries(), getCoins()]).toEqual(after)
  })
})
