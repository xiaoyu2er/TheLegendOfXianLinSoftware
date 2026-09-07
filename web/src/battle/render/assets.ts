import { battleAssetId } from '../../assets/battleAssets'
import type { AssetId } from '../../assets/ids'
import { drugPictureAssetId } from '../../assets/ids'
import { normalizePath } from '../../assets/path'
import { DRUGS } from '../drugs'
import { SKILLS, SKILL_MENU, SKILL_NUMBER } from '../skills'
import type { BattleWorld } from '../types'
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

/** `image/` 下的一条相对路径 → 逻辑 ID。**只在本文件里用** —— 别处要 ID 就调
 * 下面那些各自有名字的函数，那样拼错一个字会在这里被一次改掉，不会散在各处。 */
function battleId(relative: string): AssetId {
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
export const CLOUD_ID = battleId('其他/云雾.png')
export const GAME_OVER_LEFT_ID = battleId('全灭图/全灭图1.png')
export const GAME_OVER_RIGHT_ID = battleId('全灭图/全灭图2.png')

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

// ===== 技能菜单 / 药品菜单 / 提示图 / 战斗状态图标（xl-rh9.12）=====

/** `SkillMenu` 的背板（`image/技能菜单/技能显示框.png`）。 */
export const SKILL_MENU_BACK_ID = battleId('技能菜单/技能显示框.png')
/** `DrugMenu` 的背板（`image/药品菜单/药品显示框.png`）。 */
export const DRUG_MENU_BACK_ID = battleId('药品菜单/药品显示框.png')

/**
 * 技能菜单里第 `index` 颗按钮（0 基）现在贴的那一张。
 *
 * 原版 `SkillMenu.getImage()` 拼的是
 * `image/技能菜单/技能按钮/<角色>/技能<i>按钮<j>.png`，`i` 从 1 起、
 * `j` 是 1 常态 / 2 待点 / 3 按下 —— 与 `GameButton` 那三张一一对应。
 */
export function skillButtonId(key: PartyKey, index: number, variant: 1 | 2 | 3): AssetId {
  return battleId(`技能菜单/技能按钮/${HERO_DIR[key]}/技能${index + 1}按钮${variant}.png`)
}

/** 技能菜单的返回按钮（`SkillMenu.checkRound()` 现建的那一颗）。 */
export function skillReturnId(variant: 1 | 2 | 3): AssetId {
  return battleId(`技能菜单/技能按钮/返回/返回${variant}.png`)
}

/**
 * 技能说明图。入参就是真值里 `menus.skill.introImage` 那个串（`"文敏/2"`），
 * 它由 `step.ts` 拼成 `<SKILL_INTRO_DIR[key]>/<i+1>`。
 */
export function skillIntroId(introImage: string): AssetId {
  return battleId(`技能说明/${introImage}.png`)
}

/**
 * 药品菜单里第 `index` 颗按钮（0 基）。**第七颗是返回**，它跟前六颗不在同一
 * 个命名规则上（`返回1.png` 而不是 `药品7按钮1.png`）—— 原版
 * `DrugMenu.getImage()` 就是两个循环读进同一个 `buttonImages` 的。
 */
export function drugButtonId(index: number, variant: 1 | 2 | 3): AssetId {
  if (index < 0 || index > DRUGS.length) {
    throw new Error(`药品菜单只有 ${DRUGS.length + 1} 颗按钮（六种药 + 返回），要第 ${index} 颗`)
  }
  return index === DRUGS.length
    ? battleId(`药品菜单/返回${variant}.png`)
    : battleId(`药品菜单/药品${index + 1}按钮${variant}.png`)
}

/**
 * 药品的介绍图。**不在 `image/` 下** —— 它是商店那一摊的数据
 * （`sources/Shop/药品/回复类/`），见 `assets/ids.ts` 的 `drugPictureAssetId`。
 */
export function drugPictureId(index: number): AssetId {
  const drug = DRUGS[index]
  if (!drug) throw new Error(`药品菜单要第 ${index} 种药的介绍图，而一共只有 ${DRUGS.length} 种`)
  return drugPictureAssetId(drug.picture)
}

/** 提示图。`file` 是**文件号**（1..22），不是 `show(i)` 的入参，见 `types.ts`。 */
export function reminderId(file: number): AssetId {
  if (!Number.isInteger(file) || file < 1 || file > REMINDER_COUNT) {
    throw new Error(`提示图只有 1..${REMINDER_COUNT} 号，要的是 ${file}`)
  }
  return battleId(`提示图/${file}.png`)
}

/** `Reminder.loadImage()` 那个 `for(int i=1;i<=22;i++)`。 */
export const REMINDER_COUNT = 22

/**
 * `BattleState.getImage()` 那个 12 路 switch：`type` → `image/状态/<名>.png`。
 *
 * 抄的是一张表，所以**有人核**：`assets.test.ts` 打开 GBK 的
 * `src/battle/BattleState.java`，把那个 switch 的 `case N: … 状态/<名>.png`
 * 逐条解出来再对。抄错一条的表现是"挂了状态，图标是另一个" —— 画面上完全
 * 正常，只有逐帧比对量得出来。
 */
const STATE_ICON_NAME: Readonly<Record<number, string>> = {
  1: '敏捷提升',
  2: '武力提升',
  3: '精气提升',
  4: '体力提升',
  5: '敏捷下降',
  6: '武力下降',
  7: '精气下降',
  8: '体力下降',
  9: '中毒',
  10: '麻痹',
  11: '金钟罩',
  12: '潜能爆发',
}

/** 这 12 个 `type` —— `battleTextureIds` 与判据都拿它当分母。 */
export const STATE_ICON_TYPES: readonly number[] = Object.keys(STATE_ICON_NAME).map(Number)

/** 战斗状态图标（`BattleState.getImage()` 那个 12 路 switch）。 */
export function stateIconId(type: number): AssetId {
  const name = STATE_ICON_NAME[type]
  if (name === undefined) {
    throw new Error(
      `战斗状态 ${type} 没有图标 —— 原版 BattleState.getImage() 的 switch 只有 1..12，` +
        `落到 default 时 stateImage 还是上一次那张（或 null）。挂上这个 type 的是状态层。`,
    )
  }
  return battleId(`状态/${name}.png`)
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
export function battleTextureIds(w: Pick<BattleWorld, 'background' | 'party' | 'slots'>): AssetId[] {
  const ids = new Set<AssetId>()
  ids.add(backgroundId(w.background))
  ids.add(CLOUD_ID)
  ids.add(HP_BAR_ID)
  ids.add(MP_BAR_ID)
  ids.add(ANGRY_BACK_ID)
  ids.add(PROGRESS_BAR_ID)
  ids.add(GAME_OVER_LEFT_ID)
  ids.add(GAME_OVER_RIGHT_ID)
  for (let i = 0; i < 4; i++) ids.add(angryId(i))
  for (let i = 0; i < 5; i++) ids.add(instructId(i))
  for (let i = 0; i < 8; i++) ids.add(mouseId(i))
  for (const key of ['attack', 'skill', 'defend', 'thing'] as const) {
    for (const variant of [1, 2, 3] as const) ids.add(commandButtonId(key, variant))
  }
  for (const type of [1, 2]) for (let d = 0; d <= 9; d++) ids.add(hurtDigitId(type, d))
  // 菜单 / 提示图 / 状态图标（xl-rh9.12）。这几批**与出场阵容无关的**部分
  // 全量载：原版三个构造函数就是无条件读全的（`Reminder` 读 22 张、
  // `BattleState.getImage()` 那 12 路 switch 谁都可能走到、药品菜单六种药
  // 与返回按钮各三张）。按"这一场会用到哪几张"筛，等于在这里再实现一遍
  // 状态层的分支，而筛错一条的表现是"某一帧少一个精灵"。
  ids.add(SKILL_MENU_BACK_ID)
  ids.add(DRUG_MENU_BACK_ID)
  for (let f = 1; f <= REMINDER_COUNT; f++) ids.add(reminderId(f))
  for (const type of STATE_ICON_TYPES) ids.add(stateIconId(type))
  for (const variant of [1, 2, 3] as const) {
    ids.add(skillReturnId(variant))
    for (let i = 0; i <= DRUGS.length; i++) ids.add(drugButtonId(i, variant))
  }
  for (let i = 0; i < DRUGS.length; i++) ids.add(drugPictureId(i))
  // 技能菜单那几颗**按出战名单**：原版 `SkillMenu.getImage()` 三段各套着
  // `if(bp.zxf!=null)`，没出战的人一张都不读。
  for (const h of w.party) {
    const key = h.spec.key
    for (let i = 0; i < SKILL_NUMBER[key]; i++) {
      for (const variant of [1, 2, 3] as const) ids.add(skillButtonId(key, i, variant))
      ids.add(skillIntroId(`${HERO_DIR[key]}/${i + 1}`))
      // 菜单上点得到的那几招，各自的技能动画与**背景动画**（xl-rh9.12）。
      //
      // 原先这里只有 `h.spec.attack` 那一套普攻的帧 —— 五条老剧本一次技能都
      // 没用过，所以少推这一批的表现是"什么都没发生"。`battle-menus` 一点
      // 「技」就撞上了：`textureOf` 当场报「这一场没有载入它」。
      //
      // 分母是**菜单上真有几颗按钮**（`SKILL_NUMBER`），不是表里写满的五颗：
      // 点不到的那几招这一场一帧都取不到。
      //
      // **陆雪琪那几招今天不在 `SKILLS` 里**（一条都没抄，归 xl-rh9.14），
      // 所以这里查不到就跳过 —— 而这不是静默：真点下去，`step.ts` 那一头会
      // 当场抛并点名 xl-rh9.14，比"少载几张图"早得多。
      const entry = SKILLS[key][SKILL_MENU[key][i]!.pattern]
      if (!entry) continue
      for (let f = 1; f <= entry.animation.length; f++) ids.add(skillAnimId(entry.animation.name, f))
      for (let f = 1; f <= entry.background.length; f++) {
        ids.add(backgroundAnimId(entry.background.name, f))
      }
    }
  }
  for (const h of w.party) {
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
