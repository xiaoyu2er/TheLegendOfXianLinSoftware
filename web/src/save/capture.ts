import { DRUGS } from '../battle/drugs'
import type { PartyKey } from '../battle/units'
import type { PartyMemberState } from '../fakes/party'
import type { EquipPackState } from '../menu/equipPanel'
import { EQUIP_SLOTS } from '../menu/equipment'
import type { EquipSlot } from '../menu/equipment'
import type { ScollHero } from '../menu/types'
import { roleTileX, roleTileY } from '../state/role'
import type { World } from '../state/types'
import { SAVE_VERSION } from './format'
import type { HeroKey, HeroRecord, SaveFile, ScriptTriple, WornRecord } from './format'

/**
 * 写档装置（xl-i06.9）：原版 `start.Recorder.save(i)` 那十个列表，从这一层的
 * 状态里一项一项取出来，拼成一份 {@link SaveFile}。
 *
 * **纯函数**：来源全是入参（{@link CaptureSources}），不碰模块级单例 ——
 * 那几处单例（队伍 / 钱包 / 药包）由会话层现读了交进来（`game/session.ts` 的
 * `captureSession`）。
 *
 * ## 判据在哪
 *
 * - 第 1 行（队伍三开关 + 地图名 + 任务）有一个**免费的回声**：原版存完档
 *   当场 `prepareScenes()` 重读一遍，saveload 真值里那几格摘要就是原版自己从
 *   刚写下的档里读出来的。存读档面板回放那条判据（`saveload/saveloadTrace.test.ts`）
 *   走的正是这个函数。
 * - 其余九行**没有真值**：导出器写出来的档不进每步快照（规格：存档内容一个字
 *   都不进快照），而数据层真值是三个手工存下来的样例、复现不出它们当时的状态。
 *   所以那九行的判据是逐项的单元测试（`capture.test.ts`），各自对着「原版那一项
 *   读的是哪个字段」—— **弱在它锚的是我们对原版的阅读，不是原版的输出**，写明。
 */
export interface CaptureSources {
  /** 场景那一侧（`ScenePanel` 与 `Reader` 的那几个静态字段）。 */
  readonly world: World
  /** 三个英雄（`GameLauncher.zhangXiaoFan / luXueQi / yuJie`）。 */
  readonly party: Readonly<Record<PartyKey, PartyMemberState>>
  /** 装备页三个人身上的六格（`EquipPanel.equipPack_hero1/2/4`）。 */
  readonly worn: Readonly<Record<ScollHero, EquipPackState>>
  /** 六张装备表的持有量（`EquipmentPack` 那六个 static list 的 `numberGOT`）。 */
  readonly owned: Readonly<Record<EquipSlot, readonly number[]>>
  /** 各种药有几瓶，按 `DRUGS` 的次序（`DrugPack.drugList`）。 */
  readonly drugs: readonly number[]
  /** `Money.getCoins()`。 */
  readonly coins: number
}

/** 存档的三个英雄 ↔ 队伍的键。次序是存档第 2–4 行（`Recorder.save` 三次 `saveRoleInfo()`）。 */
export const HERO_OF_PARTY: Readonly<Record<HeroKey, PartyKey>> = {
  zhangXiaoFan: 'zhang',
  luXueQi: 'lu',
  yuJie: 'yu',
}

/** `EquipPanel.heroEquipPack` 的三格：`add(equipPack_hero1)`、`hero2`、`hero4`。 */
export const WORN_HEROES: readonly [ScollHero, ScollHero, ScollHero] = [1, 2, 4]

export function captureSave(src: CaptureSources): SaveFile {
  const { world } = src
  const statics = world.readerStatics
  if (src.drugs.length !== DRUGS.length) {
    throw new Error(`药包给了 ${src.drugs.length} 项，DRUGS 有 ${DRUGS.length} 项 —— 次序对不上就是记到了别的药上`)
  }
  const hero = (key: HeroKey): HeroRecord => {
    const m = src.party[HERO_OF_PARTY[key]]
    return {
      level: m.level,
      hp: m.hp,
      mp: m.mp,
      angryValue: m.angryValue,
      isAngry: m.isAngry,
      isDead: m.isDead,
      exp: m.exp,
    }
  }
  const worn = (h: ScollHero): WornRecord => {
    const pack = src.worn[h]
    return Object.fromEntries(EQUIP_SLOTS.map((s) => [s, pack[s]])) as WornRecord
  }
  return {
    version: SAVE_VERSION,
    // `roleAndMapInfo`：三个开关、`SaveAndLoad.mapName`、`Reader.task`。
    party: { zhang: statics.zhang, lu: statics.lu, wen: statics.wen },
    summary: { mapName: statics.mapName, task: statics.task },
    heroes: { zhangXiaoFan: hero('zhangXiaoFan'), luXueQi: hero('luXueQi'), yuJie: hero('yuJie') },
    // `SaveAndLoad.saveSceneInfo()` 那十项。
    scene: {
      isScript: world.isScript,
      fileName: world.scene,
      dialogueEventOver: world.dialogue.eventOver,
      // `DialogueEvent.dialogueOrder` —— 这一层叫 `groupOrder`（第几段主线对话）。
      dialogueOrder: world.dialogue.groupOrder,
      // `role.getX()` 是 `x / 32`：格坐标，不是像素。
      x: roleTileX(world.role),
      y: roleTileY(world.role),
      currentScript: triple(world.currentScript, 'currentScript'),
      nextScript: triple(world.nextScript, 'nextScript'),
      battle1Over: world.fight.battle1Over,
      countOfBattle1: world.fight.countOfBattle1,
    },
    // `EquipPanel.saveEquipInfo()`：`heroEquipPack` 的三格。
    worn: [worn(WORN_HEROES[0]), worn(WORN_HEROES[1]), worn(WORN_HEROES[2])],
    // `ShopPanel.saveShopInfo()`：各药 `numberGOT`，末尾一个 `Money.getCoins()`。
    drugs: [...src.drugs],
    coins: src.coins,
    neverReadBack: {
      // `EquipmentShopPanel.saveEquipmentShopInfo()` —— 读的是全局 `EquipmentPack`。
      equipmentStock: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, [...src.owned[s]]])) as Record<
        EquipSlot,
        number[]
      >,
      // `SaveAndLoad.saveQuestion()` / `saveAnswer()`：`SelectEvent` 那两张 static 表。
      questionMaps: world.recorder.map((r) => r.scene),
      answers: world.recorder.map((r) => [...r.answered]),
    },
  }
}

/**
 * `scene.currentScript[0] + " " + [1] + " " + [2]`。原版的 `String[3]` 开局是
 * `new String[3]`（三个 `null`），拼出来就是字面量 `"null null null"` —— 这一层
 * `nextScript` 的 `null` 就是那个状态，照样落成三个 `"null"`。
 */
function triple(t: readonly string[] | null, what: string): ScriptTriple {
  if (t === null) return ['null', 'null', 'null']
  if (t.length !== 3) throw new Error(`${what} 应当是三段，实际 ${t.length} 段：${JSON.stringify(t)}`)
  return [t[0]!, t[1]!, t[2]!]
}
