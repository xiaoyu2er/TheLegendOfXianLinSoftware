import { battleAssetId } from '../../assets/battleAssets'
import type { AssetId } from '../../assets/ids'
import { normalizePath } from '../../assets/path'
import type { PartyKey } from '../units'

/**
 * 战斗渲染要用到的**逻辑 ID**（xl-rh9.9）。
 *
 * 每个函数对应原版某一处写死的路径拼接，一处一处抄过来 —— 拼错一个字的表现
 * 是 `resolveAsset` 当场抛并报出同前缀有哪些，不是"这个精灵没画出来"。
 *
 * 素材的**打包边界**不在这里：`技能动画` 与 `背景动画` 走 `public/` 按需加载，
 * 其余进主包，规矩与理由都在 `assets/battleAssets.ts`。这一层只管名字，取哪
 * 一条路由渲染器按 `isDeferredBattleAsset` 判（见 `battleRenderer.ts`）。
 */

/** `image/` 下的一条相对路径 → 逻辑 ID。 */
export function battleId(relative: string): AssetId {
  return battleAssetId(`image/${relative}`)
}

/**
 * 我方三人在素材目录里的名字。
 *
 * **不放进 `units.ts` 的 `HeroSpec`**：那个文件正被 xl-rh9.8 改（补怪物出厂
 * 数据），往它的类型里加字段是现成的冲突；而这三个名字只有渲染要用。
 */
const HERO_DIR: Readonly<Record<PartyKey, string>> = {
  zhang: '张小凡',
  yu: '文敏',
  lu: '陆雪琪',
}

/** `roleCode` → 走图目录（`image/主角1`…）。原版三个类各写各的。 */
const HERO_WALK_DIR: Readonly<Record<1 | 2 | 3, string>> = {
  1: '主角1',
  2: '主角2',
  3: '主角3',
}

export function heroName(key: PartyKey): string {
  return HERO_DIR[key]
}

/** `image/主角N/<1 基帧号>.png`。 */
export function heroWalkId(roleCode: 1 | 2 | 3, frame: number): AssetId {
  return battleId(`${HERO_WALK_DIR[roleCode]}/${frame + 1}.png`)
}

/** 行动条上那颗小头像（`ZhangXiaoFan.headImage`）。 */
export function heroHeadId(roleCode: 1 | 2 | 3): AssetId {
  return battleId(`${HERO_WALK_DIR[roleCode]}/小头.png`)
}

/** 底部状态栏的那张背板（`image/状态栏/张小凡.png`…）。 */
export function heroPanelId(key: PartyKey): AssetId {
  return battleId(`状态栏/${HERO_DIR[key]}.png`)
}

export const HP_BAR_ID = battleId('状态栏/生命值.png')
export const MP_BAR_ID = battleId('状态栏/灵力.png')
export const ANGRY_BACK_ID = battleId('怒气槽/底.png')
export const PROGRESS_BAR_ID = battleId('进度条/进度条.png')
export const PET_HEAD_ID = battleId('小精灵/头像.png')
export const CLOUD_ID = battleId('其他/云雾.png')

/** 怒气槽那四张（0 基）。 */
export function angryId(frame: number): AssetId {
  return battleId(`怒气槽/${frame + 1}.png`)
}

/** 指示图五张（0 基）。 */
export function instructId(frame: number): AssetId {
  return battleId(`指示图/${frame + 1}.png`)
}

/** 游标图八张（0 基）。 */
export function mouseId(frame: number): AssetId {
  return battleId(`鼠标图/${frame + 1}.png`)
}

/** 提示图二十二张。原版 `Reminder.show(i)` 传的是 **0 基下标**。 */
export function reminderId(index: number): AssetId {
  return battleId(`提示图/${index + 1}.png`)
}

/** 四个指令按钮，`variant` 是 1 常态 / 2 待点 / 3 按下。 */
export type CommandButtonKey = 'attack' | 'skill' | 'defend' | 'thing'
const BUTTON_CHAR: Readonly<Record<CommandButtonKey, string>> = {
  attack: '击',
  skill: '技',
  defend: '防',
  thing: '物',
}
export function commandButtonId(key: CommandButtonKey, variant: 1 | 2 | 3): AssetId {
  return battleId(`按钮图/${BUTTON_CHAR[key]}${variant}.png`)
}

/** `image/怪物/<名字>/<1 基帧号>.png`。 */
export function enemyWalkId(name: string, frame: number): AssetId {
  return battleId(`怪物/${name}/${frame + 1}.png`)
}
export function enemyHeadId(name: string): AssetId {
  return battleId(`怪物/${name}/小头.png`)
}
/** 鼠标移到怪物身上时换的那张（`EnemySlector.checkMoveIn`）。 */
export function enemySelectedId(name: string): AssetId {
  return battleId(`怪物/${name}/选中.png`)
}

/** `image/被击动画/<名字>/<1 基帧号>.png`。名字是「<单位名>被击」。 */
export function beAttackedId(unit: string, frame: number): AssetId {
  return battleId(`被击动画/${unit}被击/${frame + 1}.png`)
}
export function deadId(key: PartyKey, frame: number): AssetId {
  return battleId(`死亡动画/${HERO_DIR[key]}/${frame + 1}.png`)
}
export function victoryId(key: PartyKey, frame: number): AssetId {
  return battleId(`胜利动画/${HERO_DIR[key]}/${frame + 1}.png`)
}

/**
 * 伤害数字。`type` 1 是伤害、2 是回复 —— 原版是同一张 20 条的表加一个 10 的
 * 偏移（`switchNum(num, offset)`），这里写成两个目录名，读起来是同一回事。
 */
export function hurtDigitId(type: number, digit: number): AssetId {
  const dir = type === 2 ? '回复' : '伤害'
  return battleId(`伤害值数字/${dir}/${digit}.png`)
}

/**
 * 技能动画的一帧（**按需加载那一半**）。`frame` 是 1 基的，与原版拼接一致。
 * 名字里可能自带一层目录（怪物的招式是 `怪物/怪物1攻击`）。
 */
export function skillAnimId(name: string, frame: number): AssetId {
  return battleId(`技能动画/${name}/${frame}.png`)
}

/** 背景动画的一帧（按需加载，**扩展名是 `.jpg`**，原版就是这么拼的）。 */
export function backgroundAnimId(name: string, frame: number): AssetId {
  return battleId(`背景动画/${name}/${frame}.jpg`)
}

/**
 * 这一场的背景图。剧本里那一行**可能是反斜杠路径**（脚本数据里有 3 条，
 * xl-1dv.4），所以先规范化再当 ID —— `battleAssetId` 自己也规范化，这里再写
 * 一次是为了让"以 image/ 开头"这条前置条件明摆着。
 */
export function backgroundId(path: string): AssetId {
  return battleAssetId(normalizePath(path))
}

/**
 * **这一场用得到的全部纹理**，开打之前一次载齐。
 *
 * 为什么不按需载：`drawList` 是同步的，而取图页要求「推一拍、立刻截一张图」。
 * 一张图晚到一帧，表现是那一帧少画一个精灵 —— 逐帧比对会红，但红在一个跟
 * 时序无关的地方，查起来是最贵的那种。
 *
 * 名单是**从这一场的世界现推的**（出战名单、三个槽位、各自的招式），不写死
 * 一份清单：换一场仗就换一批图，而写死的清单在换场时不会响。
 */
export function battleTextureIds(w: {
  background: string
  heroes: readonly { roleCode: 1 | 2 | 3; spec: { key: PartyKey; frames: number; beAttackedFrames: number; victoryFrames: number; deadFrames: number; attack: { name: string; length: number } } }[]
  slots: readonly ({ name: string; spec: { length: number; beAttackedFrames: number }; skill: { name: string; length: number } } | null)[]
}): AssetId[] {
  const ids = new Set<AssetId>()
  ids.add(backgroundId(w.background))
  ids.add(CLOUD_ID)
  ids.add(HP_BAR_ID)
  ids.add(MP_BAR_ID)
  ids.add(ANGRY_BACK_ID)
  ids.add(PROGRESS_BAR_ID)
  ids.add(PET_HEAD_ID)
  for (let i = 0; i < 4; i++) ids.add(angryId(i))
  for (let i = 0; i < 5; i++) ids.add(instructId(i))
  for (let i = 0; i < 8; i++) ids.add(mouseId(i))
  for (const key of ['attack', 'skill', 'defend', 'thing'] as const) {
    for (const variant of [1, 2, 3] as const) ids.add(commandButtonId(key, variant))
  }
  for (const type of [1, 2]) for (let d = 0; d <= 9; d++) ids.add(hurtDigitId(type, d))
  for (const h of w.heroes) {
    ids.add(heroHeadId(h.roleCode))
    ids.add(heroPanelId(h.spec.key))
    for (let i = 0; i < h.spec.frames; i++) ids.add(heroWalkId(h.roleCode, i))
    for (let i = 0; i < h.spec.beAttackedFrames; i++) ids.add(beAttackedId(heroName(h.spec.key), i))
    for (let i = 0; i < h.spec.deadFrames; i++) ids.add(deadId(h.spec.key, i))
    for (let i = 0; i < h.spec.victoryFrames; i++) ids.add(victoryId(h.spec.key, i))
    for (let f = 1; f <= h.spec.attack.length; f++) ids.add(skillAnimId(h.spec.attack.name, f))
  }
  for (const e of w.slots) {
    if (e === null) continue
    ids.add(enemyHeadId(e.name))
    ids.add(enemySelectedId(e.name))
    for (let i = 0; i < e.spec.length; i++) ids.add(enemyWalkId(e.name, i))
    for (let i = 0; i < e.spec.beAttackedFrames; i++) ids.add(beAttackedId(e.name, i))
    for (let f = 1; f <= e.skill.length; f++) ids.add(skillAnimId(e.skill.name, f))
  }
  return [...ids].sort()
}
