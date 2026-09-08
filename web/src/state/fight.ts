import type { SceneScript } from '../data/types'

/**
 * `scene.FightEvent` —— 场景这一侧的**战斗触发器**（xl-rh9.17）。
 *
 * 原版一个场景有三种进战斗的路，这里做前两种（第三种 `battle2` 走
 * `SelectEvent` 的选择框，归 M4 的商店/选择那张票）：
 *
 * - **计步战斗** `battle0`：`ScenePanel.step()` 的第 7 步每拍调一次
 *   `checkBattle0()`，主角**换了一格**就 `count++`，数到 `count_battle0`
 *   就从 `battle0` 里随机挑一场打。阈值只有两个取值，由地图大小决定。
 * - **剧情固定战** `battle1`：对话正文里的 `@` 把 `dialogueFight` 置真，
 *   玩家按空格把那段对话按完的那一刻 `startBattle1()`，按 `countOfBattle1`
 *   一场一场往下打；打完最后一场 `battle1Over` 置真，**这个场景的出口这时
 *   才打开**（见 `state/exit.ts` 与 `step.ts` 第 4 步）。
 *
 * ## 这一层只产出「打哪一场」，不建战斗世界
 *
 * `FightEvent.fight()` 在原版里做四件事：解那个 7 元组、`new Enemy(...)`、
 * `battlePanel.initial(...)`、`switchTo("battle")`。后三件跨面板，属于
 * `game/session.ts`。留在这里的只有**解元组之前的那一步**：这一拍该不该打、
 * 打的是哪一行。于是这一整个模块是纯的，没有一行认识战斗世界。
 *
 * ⚠️ **这一段没有行为真值覆盖。** 96 个场景里只有 4 个有 `battle0`
 * （`脚本6` / `脚本10` / `脚本20` / `迷宫1`），而五份 `driver=scene` 的真值
 * 走的是 `宿舍` / `大地图` / `脚本1` —— 三个都既没有 `battle0` 也没有
 * `battle1`。也就是说这个文件抄错了和抄对了，**五份场景真值的每一个字段都
 * 相同**。凭什么算过，写在 `fight.test.ts` 的开头。
 */

/**
 * `count_battle0` 的两个取值与那道门槛。
 *
 * 原版：`if (scene.getMapSet().length > 20) count_battle0 = 50; else 30;`
 * —— 比的是**行数**（`mapSet.length`），不是列数，也不是格子总数。
 */
export const BATTLE0_ROWS_THRESHOLD = 20
export const BATTLE0_STEPS_BIG = 50
export const BATTLE0_STEPS_SMALL = 30

/**
 * 打赢之后要**把剧情推进一段**的那八个一号位怪物（`FightEvent.fight()` 里
 * 那一长串 `enemy1.equals(...)`）。逐字照抄，顺序照抄。
 *
 * 它比的是**整个第 5 列**（`名字/编号`），不是只比名字 —— 所以同名但编号不是
 * 5 的（例如 `李洵/6`）不算。照抄这一点：改成只比名字，`商塔弟子` 那种同名
 * 出现在 2/3 号位的场次就会误推剧情，而画面上看起来只是"打完这一架剧情跳了"。
 */
export const NEXT_SCRIPT_ENEMIES: readonly string[] = [
  '物理阁堂主/5',
  '罹年居士/5',
  '缘铭道者/5',
  '大刀/5',
  '蒙面怪人/5',
  '商塔堂主/5',
  '最终李洵/5',
  '李洵/5',
]

/**
 * 一场战斗的 7 元组（`Fight` 段的一行），原样递出去，由会话层去解。
 *
 * 保持成裸数组是**照抄**：原版 `FightEvent.fight(String[] battleInfo)` 收的
 * 就是它，七个 `battleInfo[i]` 逐位取用。但**列号只许写在下面这几个常量与
 * 取用函数里** —— 之前 `session.ts` / `enemySprites.ts` / `advancesScript`
 * 三处各写各的下标与各自的 `'null'` 判断，而"某一处漏了一列"的表现是
 * "打某几场时贴图没预取到"，跟"这一场本来就没那只怪"长得一样。
 */
export type BattleInfo = readonly string[]

/** 7 元组的列号。`FightEvent.fight()` 开头那七行 `String x = battleInfo[i]`。 */
export const BATTLE_INFO_COLUMNS = 7
/** 第 0 列：背景图。 */
export const COL_BACKGROUND = 0
/** 第 1/2/3 列：三个人出没出战，值是 `zhang` / `yu` / `lu`，别的词一律没出战。 */
export const COL_PARTY: Readonly<Record<'zhang' | 'yu' | 'lu', number>> = { zhang: 1, yu: 2, lu: 3 }
/** 第 4/5/6 列：三个怪物槽位，空槽位逐字写作 `null`。 */
export const COL_ENEMIES: readonly number[] = [4, 5, 6]

/**
 * 三个槽位，空的是 `null`。**`"null"` 是逐字的那四个字母**
 * （原版 `if(!enemy1.equals("null"))`），不是缺列，也不是空串。
 */
export function enemySlots(info: BattleInfo): readonly (string | null)[] {
  return COL_ENEMIES.map((i) => {
    const spec = info[i]
    return spec === undefined || spec === 'null' ? null : spec
  })
}

/** 三个槽位里那几只怪的名字（去掉 `/编号`），空槽位跳过。 */
export function enemyNames(info: BattleInfo): readonly string[] {
  const out: string[] = []
  for (const spec of enemySlots(info)) {
    if (spec === null) continue
    const slash = spec.lastIndexOf('/')
    if (slash > 0) out.push(spec.slice(0, slash))
  }
  return out
}

/** `FightEvent` 的字段。**跟着 `initiation` 一起重建**，见 `step.ts`。 */
export interface FightState {
  readonly battle0: readonly BattleInfo[] | null
  readonly battle1: readonly BattleInfo[] | null
  /** `countOfBattle1`：剧情固定战打到第几场。 */
  readonly countOfBattle1: number
  /** `battle1Over`：这个场景的剧情固定战全打完了。出口的那道门读它。 */
  readonly battle1Over: boolean
  /** `count`：换过几格。 */
  readonly count: number
  /** `x` / `y`：上一次数到的那一格。原版字段初值是 0，不是主角的出生格。 */
  readonly x: number
  readonly y: number
  /** `count_battle0`。`battle0` 为空时原版从不给它赋值，也就是 0。 */
  readonly stepsToBattle: number
}

/** 逐 tick 就地改的草稿，与 `role` / `dialogue` 那几份同一个形状。 */
export interface FightDraft {
  battle0: readonly BattleInfo[] | null
  battle1: readonly BattleInfo[] | null
  countOfBattle1: number
  battle1Over: boolean
  count: number
  x: number
  y: number
  stepsToBattle: number
}

export function createFight(scene: SceneScript): FightState {
  return {
    battle0: scene.battle0,
    battle1: scene.battle1,
    countOfBattle1: 0,
    battle1Over: false,
    count: 0,
    x: 0,
    y: 0,
    // `if (battle0 != null)` —— 没有计步战斗的场景，这个字段留在 0 上。
    stepsToBattle:
      scene.battle0 === null
        ? 0
        : scene.mapSet.length > BATTLE0_ROWS_THRESHOLD
          ? BATTLE0_STEPS_BIG
          : BATTLE0_STEPS_SMALL,
  }
}

export function toFightDraft(f: FightState): FightDraft {
  return { ...f }
}

export function fromFightDraft(d: FightDraft): FightState {
  return { ...d }
}

/**
 * `FightEvent.checkBattle0()` —— `ScenePanel.step()` 的第 7 步。
 *
 * 三处顺序敏感，换一处每一拍看上去都还正常：
 *
 * - 比的是**格子**坐标（`role.getX()`），所以走一格才 `count++`，不是每拍；
 * - `count == count_battle0` 是**相等**不是 `>=`。等价与否取决于 `count`
 *   永远逐一递增且只在这里清零 —— 是的，所以照抄；
 * - `startBattle0()` 在 `count = 0` **之前**跑。挑场次那句读不到 `count`，
 *   所以这一处今天观测不到，照抄是因为它是原版的次序。
 *
 * 返回这一拍要打的那一行，没到数就是 `null`。
 */
export function checkBattle0(
  f: FightDraft,
  x: number,
  y: number,
  random: () => number,
): BattleInfo | null {
  if (f.x !== x || f.y !== y) {
    f.count++
    f.x = x
    f.y = y
  }
  if (f.count !== f.stepsToBattle) return null
  const list = f.battle0
  if (list === null || list.length === 0) {
    // 调用方只在 `battle0 != null` 时才进来（原版第 7 步那道 `if`），
    // 空列表在 96 个场景里也不存在。真到了这里，原版是
    // `battle0.get((int)(Math.random()*0))` = `get(0)` 越界。
    throw new Error('checkBattle0 数到了，可这个场景的 battle0 是空的')
  }
  // `int i = (int)(Math.random()*battle0.size());`
  const i = Math.trunc(random() * list.length)
  f.count = 0
  return list[i] ?? null
}

/**
 * `FightEvent.startBattle1()` —— 一段带 `@` 的对话按完的那一刻。
 *
 * 照抄那三句的次序：**先打这一场，再决定是往下挪还是收尾**。所以最后一场
 * 打完的那一次同时把 `battle1Over` 置真，`countOfBattle1` 停在最后一位上。
 *
 * `battle1Over` 之后再触发一次（同一段对话被再按一遍）**什么都不打**，
 * 但下面那个 `if` 照跑 —— 原版就是这样，两句不在同一个 `if` 里。
 */
export function startBattle1(f: FightDraft): BattleInfo | null {
  const list = f.battle1
  if (list === null) {
    // 原版这里是 `battle1.get(...)` 的空指针。数据上不会发生：`@` 与
    // `Fight` 段的 `1` 分支是同一份脚本里配对写的。
    throw new Error('对话里的 @ 要起剧情固定战，可这个场景没有 battle1 段')
  }
  const info = f.battle1Over ? null : (list[f.countOfBattle1] ?? null)
  if (f.countOfBattle1 >= list.length - 1) f.battle1Over = true
  else f.countOfBattle1++
  return info
}

/**
 * 这一场打完要不要 `exitEvent.nextScript()`（剧情往前推一段）。
 *
 * 原版那串 `equals` 判的是 `battleInfo[4]`，也就是**一号位**那只怪。
 */
export function advancesScript(info: BattleInfo): boolean {
  return NEXT_SCRIPT_ENEMIES.includes(info[COL_ENEMIES[0]!] ?? '')
}
