import { menuAssetId } from '../../assets/menuAssets'
import { skillAnimId } from '../../battle/render/assets'
import { MAGIC_ANIMATION_LENGTHS, MAGIC_HEROES, magicHero } from '../magic'
import type { AssetId } from '../../assets/ids'
import type { ButtonImage, ScollHero } from '../types'

/**
 * 奇术页画得出来的那批东西：**十五颗技能按钮的贴图名**、**十五条技能动画的
 * 说明文字**，以及动画那一帧图在哪。判据在 `magicSkills.test.ts`（从 GBK
 * 源码里现读，三张表逐条对）。
 *
 * ## 为什么名字与说明必须各自照抄，不能相互推
 *
 * 按钮贴图叫 `横剑摆渡1.png`，说明写的是「单体攻击，消耗灵力70点」，两者
 * 之间**没有任何关系**：一个在 `MagicPanel.addMagicButton()` 里，一个在
 * `magicDiscription` 的构造函数里，第三处（动画目录 `张小凡技能1/`）又是
 * 另一套拼法。三处任意一处抄错，画面上都只是"少了一张图"或"说明串了行"，
 * 而两者与"这一招本来就长这样"分不开。
 *
 * ⚠️ `sources/菜单/奇术/` 下同时躺着 `浪里寻花*.png` 与 `浪里探花*.png`，
 * 差一个字。原版读的是**寻**那一个，别按印象改。
 */

/**
 * 每个人五颗按钮的贴图词干，逐个对应 `addMagicButton()` 里那三组
 * `Reader.readImage("sources/菜单/奇术/<词干>1.png")`。
 *
 * 宋大仁那五个（碎金削玉 / 剑心如意 / 猛虎出关 / 鬼斧神工 / 开山破海）
 * 源码里读了，但那一组开局就 `isDraw=0`、卷轴上也到不了 3 号，所以这一层
 * 不列（同 `magic.ts` 的理由）。
 */
export const MAGIC_SKILL_STEMS: Readonly<Record<ScollHero, readonly string[]>> = {
  1: ['横剑摆渡', '浪里寻花', '银鹰掠地', '龙翔九天', '神剑傲州'],
  2: ['灵凤吐珠', '踏月无痕', '星火乾坤圈', '亟电崩离', '劈云追月'],
  4: ['伏虎冲天', '追星破月', '苍龙盖天', '妙手回春', '蝶影神灵'],
}

/**
 * 十五条技能动画的两行说明（`menu.magicDiscription` 那三个 `String[5][2]`）。
 *
 * **第二行可以是空串**，而空串是原版写下的，不是"没抄到"：张小凡的第 1、4 招
 * 与玉洁的第 3 招都只有一行。这一层照留空串 —— 换成 `null` 或者干脆少一行，
 * 绘制清单上就少一条 `drawString`，而原版那一句是照发的（画的是空字符串）。
 */
export const MAGIC_SKILL_DESCRIPTIONS: Readonly<Record<ScollHero, readonly (readonly [string, string])[]>> = {
  1: [
    ['单体攻击，消耗灵力70点', ''],
    ['单体攻击，消耗灵力120点', '敌方体力下降两回合'],
    ['单体攻击，消耗灵力150点', '我方武力上升两回合'],
    ['群体攻击，消耗灵力160点', ''],
    ['群体攻击，消耗灵力200点', '软件堂武艺的最终奥义，力量强大'],
  ],
  2: [
    ['辅助技能，消耗灵力120点', '我方敏捷上升两回合'],
    ['辅助技能，消耗灵力达60%。我方进入攻击态', '敌方进入等待态并可能敏捷下降'],
    ['群体攻击，消耗灵力150点', '80%概率敌方附上中毒状态两回合'],
    ['单体加辅助技能，消耗灵力160点', '使敌方附上麻痹状态两回合，无法攻击'],
    ['群体加辅助攻击，消耗灵力200点', '我方附上增益状态，敌方附上有害状态'],
  ],
  4: [
    ['单体攻击，消耗灵力70点', '敌方80%附上中毒状态两回合'],
    ['单体攻击，消耗灵力120点', '自身敏捷上升两回合'],
    ['群体攻击，消耗灵力150点', ''],
    ['群体恢复技能，消耗灵力160点，回复', '生命值的40%，且使濒临死亡的人复活'],
    ['单体攻击，消耗灵力200点', '使用者同时武力上升三回合'],
  ],
}

/** 三态 → 文件名末尾那个数字，同 `assets.ts` 的 `STATE_SUFFIX`。 */
const SUFFIX: Readonly<Record<ButtonImage, 1 | 2 | 3>> = { normal: 1, waitclick: 2, pressed: 3 }

/** 一颗技能按钮的贴图。`skill` 是 **1 基**的。 */
export function magicSkillButtonId(hero: ScollHero, skill: number, image: ButtonImage): AssetId {
  const stem = MAGIC_SKILL_STEMS[hero][skill - 1]
  if (stem === undefined) throw new Error(`${hero} 号没有第 ${skill} 招`)
  return menuAssetId(`sources/菜单/奇术/${stem}${SUFFIX[image]}.png`)
}

/**
 * 技能动画的一帧。**它不是菜单素材** —— `MagicAnimation.importImage()` 拼的是
 * `image/技能动画/<张小凡技能|陆雪琪技能|文敏技能><招号>/<帧号>.png`，与战斗
 * 那批同一个目录、同一条按需加载的边界。所以这里转手 `battle` 那个构造器，
 * 而不是在菜单侧另造一套 ID：两套 ID 指同一个文件时，烘焙名单会漏掉其中一套，
 * 而漏掉的表现是"那一页的动画不显示"。
 */
export function magicAnimationFrameId(hero: ScollHero, skill: number, frame: number): AssetId {
  return skillAnimId(`${magicHero(hero).animationStem}${skill}`, frame)
}

/** 一条动画整条的帧 ID，1 基。预取与测试用。 */
export function magicAnimationFrameIds(hero: ScollHero, skill: number): AssetId[] {
  const length = MAGIC_ANIMATION_LENGTHS[hero][skill - 1]
  if (length === undefined) throw new Error(`${hero} 号没有第 ${skill} 招`)
  return Array.from({ length }, (_, i) => magicAnimationFrameId(hero, skill, i + 1))
}

/** 奇术页那一页要用到的全部按钮贴图（十五颗 × 三态）。 */
export function magicButtonIds(): AssetId[] {
  const ids: AssetId[] = []
  for (const { hero } of MAGIC_HEROES) {
    for (let skill = 1; skill <= MAGIC_SKILL_STEMS[hero].length; skill++) {
      for (const image of Object.keys(SUFFIX) as ButtonImage[]) {
        ids.push(magicSkillButtonId(hero, skill, image))
      }
    }
  }
  return ids
}
