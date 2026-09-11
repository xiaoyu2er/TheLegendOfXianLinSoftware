import { addDrug } from '../fakes/drugPack'
import { addEqupment } from '../fakes/equipmentPack'
import { addCoins } from '../fakes/wallet'
import type { PartyKey } from './units'
import type { BattleWorld, Hero, VictoryReminderState } from './types'

/**
 * `VictoryReminder` —— 打赢之后的结算：卷轴拉开、发物品与钱、经验滚下去、
 * 有人升级就翻页把属性一项项加上去，然后回地图。归 **xl-rh9.5**。
 *
 * ## ⚠️ 这一段没有行为真值覆盖，凭什么算过
 *
 * 五份 `driver=battle` 的行为真值（`tools/traces/out/battle-*.trace.json`）
 * **一份都没有走进这里**：`battle-min` 的末步正是「胜利」第一次出现的那一刻，
 * 三份打输的走的是 `GameOver`。也就是说这一整个文件里的每一个数，抄错了和
 * 抄对了推出来的**每一个真值字段都相同** —— 这个仓库最贵的那种失败。
 *
 * 所以它的判据是另外四条，都在 `victory.test.ts` 里，都能跑出红绿：
 *
 * 1. **常量逐个对回原版源码**：`VictoryReminder.update()` 的方法体里出现的
 *    每一个整数字面量，按出现顺序解出来，与下面这张 `VICTORY` 表对撞。分母是
 *    Java 源码里有几个字面量（解析器空转是 0，那条断言先红）。
 * 2. **两条路各自端到端跑通**，而且两条路**差的拍数**等于原版那两个阈值之差
 *    （`endAt - levelCheckAt`）—— 这个差也是从解析出来的常量算的，不是手写的。
 * 3. **发出去的东西落在假货里**：发奖那一拍之前包是空的、之后正好多这几样，
 *    正反两个方向都断言（`thing_sx1==4` 只出现一拍，早一拍或晚一拍都会红）。
 * 4. **假货登记册的双向对撞**（`fakes/registry.test.ts`，ADR-0005）。
 *
 * 哪天真值往后接了一段（导出器的 `awaitExit` 支持 victory 之后的拍），
 * 上面第 1、2 条就该退成保险丝，由逐字段比对接手。
 *
 * ## 时间是怎么走的
 *
 * 全靠两个计数器，**都不是"帧号"**：
 *
 * - `sy2` 每拍 +20，24 拍到 480 —— 卷轴拉开。到了 480 才开始数 `timeCode`。
 * - `thingSx1` 每拍 -4，从 60 数到 0（15 拍）—— 物品框展开。**发奖发生在它
 *   等于 4 的那一拍**（第 14 拍），而不是等于 0 的时候；等于 0 之后它不再变，
 *   所以 `thingSx1===0` 那一支每拍都会再执行一遍（幂等）。
 * - `timeCode` 先数到 10，然后卡在 10 上把 `expToGet` 每拍扣 40，扣到 ≤0 的
 *   那一拍**同一拍里**就 +1 变成 11；此后每拍 +1。15 查升级、25 翻页、
 *   35–54 属性滚动、55 收尾。
 *
 * 原版**从来不把 `isStop` 置回 true**：切了面板之后这个 update 还在跑，
 * `timeCode` 一直加下去。这里照抄 —— 少一句"收摊"就少一个和原版的差别。
 */
export const VICTORY = {
  /** `sy2+=20` / `dy2+=20`。 */
  scrollStep: 20,
  /** `if(sy2<480)`，也是 `if(sy2==480)`。 */
  scrollTarget: 480,
  /** `thing_sx1` 的初值（构造函数里的 `thing_sx1=60`）。 */
  thingSx1Start: 60,
  /** `thing_dx1-=4` 那一组。 */
  thingStepX: 4,
  /** `thing_dy1-=5` 那一组。 */
  thingStepY: 5,
  /** `if(thing_sx1==4)` —— 发物品与钱的那一拍。 */
  thingAwardAt: 4,
  /** `expToGet-=40`，`showNums` 也扣同样多。 */
  expStep: 40,
  /** `if(timeCode<10)` / `if(timeCode==10)`。 */
  warmup: 10,
  /** `if(timeCode==15)` —— 查有没有人升级；没有就在这里回地图。 */
  levelCheckAt: 15,
  /** `if(timeCode==25)` —— 翻到属性那一页。 */
  secondPageAt: 25,
  /** `if(timeCode>=35&&timeCode<55)` —— 属性一项项滚上去。 */
  addValueFrom: 35,
  addValueTo: 55,
  /** `if(timeCode==55)` —— 升级那条路在这里回地图。 */
  endAt: 55,
} as const

/**
 * `showNums` 那 15 项的下标。原版是一个裸的 `ArrayList<Integer>`，注释写
 * 「0--2 是各个英雄当前升级所需经验，3--6 是张小凡的数据，7--10 是文敏，
 * 11--14 是陆雪琪」；这里把那句注释变成常量，顺序一个不改。
 */
export const SHOW_EXP_INDEX: Readonly<Record<PartyKey, number>> = { zhang: 0, yu: 1, lu: 2 }
export const SHOW_ATTR_START: Readonly<Record<PartyKey, number>> = { zhang: 3, yu: 7, lu: 11 }

/**
 * `getInformation()`。在 `BattlePanel.initial()` 里就跑完了 —— 也就是**开场
 * 那一刻**，不是打赢之后：经验、金钱、掉落物按三个槽位算死，而三个人「还差
 * 多少经验升级」与四项属性抄的是开场值。
 *
 * 那三个 `showNums.get(i)` 读的是 `ZhangXiaoFan.exp` 这类**静态字段**，也就是
 * 说没出战的角色照样有值。这一层没有那份数据（`BattleConfig.levels` 只给出战
 * 名单），于是缺席的位置是 `null` —— 而原版从头到尾没有读过它们：三处
 * `drawString` 与 `addValue` 都被 `bp.zxf!=null` 这类判断挡着，只有扣经验那个
 * `for(i=0;i<=2;i++)` 会碰到，而碰到的结果没人看得见。
 */
export function victoryInformation(
  heroes: Readonly<Record<PartyKey, Hero | null>>,
  enemies: readonly { spec: { exp: number; money: number; thing: string } }[],
): VictoryReminderState {
  const showNums: (number | null)[] = new Array<number | null>(15).fill(null)
  for (const [key, hero] of Object.entries(heroes) as [PartyKey, Hero | null][]) {
    if (hero === null) continue
    // `Integer i=expToLevelUp-exp; if(i<0){i=0;}`
    showNums[SHOW_EXP_INDEX[key]] = Math.max(0, hero.expToLevelUp - hero.exp)
    const at = SHOW_ATTR_START[key]
    showNums[at] = hero.physicalPower
    showNums[at + 1] = hero.sprit
    showNums[at + 2] = hero.agile
    showNums[at + 3] = hero.strength
  }
  return {
    isDraw: false,
    isStop: true,
    // 构造函数里那八个会动的坐标。另外那些（dx1/dy1/sx1/sy1、levelUpX…）
    // 从头到尾不变，只被 drawVictoryReminder 读，归渲染。
    dy2: 80,
    sy2: 0,
    thingDx1: 710,
    thingDy1: 155,
    thingDx2: 710,
    thingDy2: 155,
    thingSx1: VICTORY.thingSx1Start,
    thingSy1: 75,
    thingSx2: VICTORY.thingSx1Start,
    thingSy2: 75,
    timeCode: 0,
    // 三项都按 `bp.enemies` 的顺序累 —— 那个顺序是 em2 → em1 → em3，
    // 前两项是和，顺序无所谓；`things` 是**要按这个顺序画出来的**。
    expToGet: enemies.reduce((sum, e) => sum + e.spec.exp, 0),
    moneyToGet: enemies.reduce((sum, e) => sum + e.spec.money, 0),
    things: enemies.map((e) => e.spec.thing),
    showNums,
    firstIsDraw: false,
    secondIsDraw: false,
    levelUpIsDraw: false,
    getThingIsDraw: false,
    firstString: false,
    secondString: false,
    thirdString: false,
  }
}

/** `addValue(start, hero)`：四项各自每拍 +1，追到英雄当前值为止。 */
function addValue(v: VictoryReminderState, start: number, hero: Hero): void {
  const targets = [hero.physicalPower, hero.sprit, hero.agile, hero.strength]
  targets.forEach((target, i) => {
    const now = v.showNums[start + i]
    if (now === null || now === undefined) {
      throw new Error(
        `showNums[${start + i}] 是空的，可这一位对应的角色正在出战 —— ` +
          'victoryInformation 与出战名单对不上了。',
      )
    }
    if (now < target) v.showNums[start + i] = now + 1
  })
}

/**
 * `thing_sx1==4` 那一拍：物品与钱**在这里真的发出去**。
 *
 * 三个收件人今天全是假货（`web/src/fakes/`，登记在 ADR-0005 的册子里）：
 * 背包与装备包归 xl-6lo.1，钱包归 xl-knp.1。原版的 `addDrug` / `addEqupment`
 * 在出厂表里按名字找，**找不到什么都不做**。药包那一份已经照做（xl-03x.3）；装备包
 * 仍然来者不拒 —— 差别写在 `fakes/registry.ts` 那一行里。
 *
 * 那个 `switch` 原版**没有 default**：`名字/3` 这种会被悄悄丢掉。照抄。
 */
function awardLoot(v: VictoryReminderState): void {
  for (const s of v.things) {
    const parts = s.split('/')
    switch (parts[1]) {
      case '1':
        addDrug(parts[0]!, 1)
        break
      case '2':
        addEqupment(parts[0]!, 1)
        break
    }
  }
  addCoins(v.moneyToGet)
}

/**
 * 两处收尾（`timeCode==15` 没人升级、`timeCode==55` 有人升级）共用的那五句。
 *
 * 原版读的是 `GameLauncher.zhangXiaoFan/yuJie/luXueQi` 三个**静态引用**，
 * 它们由 `GameLauncher.init()` 无条件建出来，所以那三句不判空。这一层只有
 * 出战的人，缺席的那份数据不存在 —— 而 `isLevelUp` 是打赢时才置位的，没出战
 * 的人不可能是 true。
 */
function finishVictory(w: BattleWorld): void {
  for (const h of [w.zxf, w.yj, w.lxq]) {
    if (h !== null) h.isLevelUp = false
  }
  w.heroes.length = 0
  // `GameLauncher.switchTo("scene")` —— 面板切回场景，并且置 `SCENE_SIGNAL=1`。
  // 「回到地图上原来的位置」是**场景面板自己留着的**：它的 `role` 的 x/y 从来
  // 没被战斗动过，切回去就还在那儿。战斗这边只欠这一个信号，而场景那边收到它
  // 之后做的唯一一件事是把该场景的 BGM 重新放上（`ScenePanel.step()`）。
  w.exitPanel = 'scenePanel'
  w.sceneSignal = true
}

/**
 * `VictoryReminder.update()`。逐句照抄，分支顺序就是规格。
 *
 * 特别留意两处**顺序敏感**的地方，换个位置每一拍看上去都还很正常：
 *
 * - `if(thing_sx1==4)` 写在**扣完之后**，所以发奖是第 14 拍不是第 15 拍；
 * - `if(expToGet<=0){expToGet=0;timeCode++;}` 写在 `if(timeCode==10)` **外面**，
 *   于是把经验扣到 0 的那一拍同时把 `timeCode` 推到 11 —— 少这一拍，后面每个
 *   阈值都晚一拍到。
 */
export function updateVictoryReminder(w: BattleWorld): void {
  const v = w.victoryReminder
  if (v.isStop) return

  if (v.sy2 < VICTORY.scrollTarget) {
    v.dy2 += VICTORY.scrollStep
    v.sy2 += VICTORY.scrollStep
  }
  if (v.thingSx1 > 0) {
    v.thingDx1 -= VICTORY.thingStepX
    v.thingDx2 += VICTORY.thingStepX
    v.thingSx1 -= VICTORY.thingStepX
    v.thingSx2 += VICTORY.thingStepX
    v.thingDy1 -= VICTORY.thingStepY
    v.thingDy2 += VICTORY.thingStepY
    v.thingSy1 -= VICTORY.thingStepY
    v.thingSy2 += VICTORY.thingStepY
  }
  if (v.thingSx1 === VICTORY.thingAwardAt) awardLoot(v)
  if (v.thingSx1 === 0) {
    v.getThingIsDraw = true
    v.thirdString = true
  }
  // 卷轴还没拉满，下面一整段都不跑。拉满之后 sy2 就钉在 480 上不再变。
  if (v.sy2 !== VICTORY.scrollTarget) return

  if (!v.secondIsDraw && !v.secondString) {
    v.firstIsDraw = true
    v.firstString = true
  }
  if (v.timeCode < VICTORY.warmup) v.timeCode++
  if (v.timeCode === VICTORY.warmup) {
    // 经验条往下滚：总经验与三个人「还差多少」同步扣。
    if (v.expToGet > 0) {
      v.expToGet -= VICTORY.expStep
      for (let i = 0; i <= 2; i++) {
        const n = v.showNums[i]
        // 缺席的角色在这一位上是 null。原版这里读的是静态字段（总有值），
        // 但扣出来的结果从头到尾没有一处读得到 —— 三处 drawString 都被
        // `bp.zxf!=null` 挡着。所以跳过，而不是编一个值出来。
        if (n === null || n === undefined) continue
        v.showNums[i] = n > 0 ? n - VICTORY.expStep : 0
      }
    }
  }
  if (v.expToGet <= 0) {
    v.expToGet = 0
    v.timeCode++
  }
  if (v.timeCode === VICTORY.levelCheckAt) {
    for (const h of w.heroes) {
      if (h.isLevelUp) v.levelUpIsDraw = true
    }
    // 没有人升级就不翻第二页，直接回地图。
    if (!v.levelUpIsDraw) finishVictory(w)
  }
  if (v.timeCode === VICTORY.secondPageAt) {
    v.firstIsDraw = false
    v.firstString = false
    v.secondIsDraw = true
    v.secondString = true
  }
  if (v.timeCode >= VICTORY.addValueFrom && v.timeCode < VICTORY.addValueTo) {
    if (w.zxf !== null) addValue(v, SHOW_ATTR_START.zhang, w.zxf)
    if (w.yj !== null) addValue(v, SHOW_ATTR_START.yu, w.yj)
    if (w.lxq !== null) addValue(v, SHOW_ATTR_START.lu, w.lxq)
  }
  if (v.timeCode === VICTORY.endAt) {
    v.levelUpIsDraw = false
    finishVictory(w)
  }
}
