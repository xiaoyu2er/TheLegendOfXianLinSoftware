import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../../generated/assets.json'
import menuContent from '../../generated/menuContent.json'
import bakeStamp from '../../generated/bakeStamp.json'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { EQUIPMENT_LISTS, EQUIP_SLOTS } from '../equipment'
import {
  CURRENT_IMAGE_X,
  CURRENT_IMAGE_Y,
  EQUIP_ROW_H,
  EQUIP_X_START,
  EQUIP_Y_START,
  WORN_IMAGE_X,
} from '../equipPanel'
import { DEFAULT_WEAPONS } from '../defaultWeapons'
import { stepMenu } from '../step'
import { createMenuWorld } from '../world'
import {
  clickScollHead,
  pressButtonOnly,
  releaseButtonOnly,
  selectEquipRow,
} from '../../test/menuClicks'
import { menuDrawList } from './drawList'
import {
  CURRENT_PICTURE_ANCHOR,
  WORN_PICTURE_ANCHOR,
  equipIntroText,
  showValueDigits,
} from './equipDraw'
import type { EquipButtonKey } from './assets'
import {
  equipButtonId,
  equipTextureIds,
  menuTextureIds,
  showValueArrowId,
  showValueDigitId,
  warningId,
} from './assets'
import type { MenuDrawOp } from './drawList'
import type { MenuWorld } from '../types'

/**
 * 装备页那一层的绘制清单。
 *
 * 这一层是纯函数（世界 → 一串「把哪张图贴在哪」），所以顺序、坐标、贴哪一张图
 * 都能在这里逐条断言；**真实像素**由跨端逐帧比对兜底，而 menu 那条流水线由
 * xl-6lo.14 接。也就是说这里核的是"照着原版那几行写的没有"，不是"看起来对"。
 */

function world(equipment: readonly { name: string; count: number }[] = []): MenuWorld {
  const w = createMenuWorld({ party: ['zhang'], fullHeal: true, equipment })
  w.panel = 'equipPanel'
  // 推一步，让那一页的 paint 副作用（差值 / 「弃用」的 isDraw）先跑一遍。
  stepMenu(w, [{ e: 'tick' }])
  return w
}

/** 一个 `menu:装备/…` 的 ID 去掉前缀，也就是原版那句 `new ImageIcon` 里的相对路径。 */
function stem(id: string): string {
  return id.replace('menu:装备/', '')
}

/** 三态贴图的**词干** —— 去掉前缀再去掉末尾那个 `1.png`。 */
function buttonStem(key: Parameters<typeof equipButtonId>[0]): string {
  return stem(equipButtonId(key, 'normal')).replace('1.png', '')
}

function pageOps(w: MenuWorld): MenuDrawOp[] {
  return menuDrawList(w).filter((op) => op.layer === 'page')
}

function texts(ops: MenuDrawOp[]): { text: string; x: number; y: number; size: number; color: string }[] {
  return ops.flatMap((op) =>
    op.kind === 'text' ? [{ text: op.text, x: op.x, y: op.y, size: op.size, color: op.color }] : [],
  )
}

describe('装备页的贴图 ID，对回原版那几处读图', () => {
  const src = javaSource('src/menu/EquipPanel.java')

  /**
   * ⚠️ **这一条不许写成"这批文件名都在源码里出现过"。**
   * `toContain` 一批路径是 permutation-invariant：「哪一张图归哪一颗按钮」一个字
   * 都没核，而抄错的那个名字本来就在那一批里。实测：把「弃用」的词干抄成
   * 「使用」，那种写法**全绿**（xl-6lo.8 也栽过同一个形状两次）。
   *
   * 所以这里从 `addButton()` 里**逐颗解出配对**：那段代码是「连着给 image1/2/3
   * 赋值 → 紧接着 `xxxButton=new MenuButton(…, image1, image2, imageN, this)`」，
   * 顺着读一遍就知道每一颗读的是哪三张。
   */
  it('八颗按钮各自读哪三张，对回 addButton() 里的**配对**', () => {
    const FIELD_OF: Readonly<Record<string, EquipButtonKey>> = {
      weaponButton: 'weapon',
      armorButton: 'armor',
      helmetButton: 'helmet',
      shoeButton: 'shoe',
      gloveButton: 'glove',
      decorationButton: 'decoration',
      use_button: 'use',
      abandon_button: 'abandon',
    }
    // 顺着源码走：记住 image1/2/3 现在各指哪张，碰到 `new MenuButton` 就结账。
    const loaded: Record<string, string> = {}
    const pairs = new Map<EquipButtonKey, string[]>()
    for (const line of src.split(/\r?\n/)) {
      const load = /(\w+)\s*=\s*new ImageIcon\("sources\/菜单\/装备\/([^"]+)"\)/.exec(line)
      if (load) loaded[load[1]!] = load[2]!
      const build = /(\w+)\s*=\s*new MenuButton\((.*)$/.exec(line)
      if (!build) continue
      const key = FIELD_OF[build[1]!]
      if (!key) continue
      const args = [...build[2]!.matchAll(/\b(image[123])\b/g)].map((m) => loaded[m[1]!]!)
      pairs.set(key, args)
    }
    // 零匹配与"全对"长得一样：八颗一颗都不许少。
    expect([...pairs.keys()].sort(), 'addButton() 里没把八颗按钮都解出来').toEqual(
      Object.values(FIELD_OF).sort(),
    )
    for (const [key, [normal, waitclick, pressed]] of pairs) {
      expect(stem(equipButtonId(key, 'normal')), `${key} 的常态图`).toBe(normal)
      expect(stem(equipButtonId(key, 'waitclick')), `${key} 的待点图`).toBe(waitclick)
      expect(stem(equipButtonId(key, 'pressed')), `${key} 的按下图`).toBe(pressed)
    }
  })

  it('两张拒绝提示图，按变量名对回构造函数里那两句', () => {
    // 同样不核集合：`Equiped` 与 `can_not_use` 两句一旦对调，集合完全不变。
    const of = (field: string) => {
      const m = new RegExp(`${field}\\s*=\\s*new ImageIcon\\("sources/菜单/装备/([^"]+)"\\)`).exec(src)
      expect(m, `构造函数里没解出 ${field} 那一句`).not.toBeNull()
      return m![1]!
    }
    expect(stem(warningId('equipped'))).toBe(of('Equiped'))
    expect(stem(warningId('cannotUse'))).toBe(of('can_not_use'))
  })

  it('⚠️ 六颗槽位按钮按下时贴的是常态图 —— 它们根本没有第三张', () => {
    // `new MenuButton(…, image1, image2, image1, this)`：第三个参数是 image1。
    // 六段各一行，一行都不许少。
    const twoImage = [
      ...src.matchAll(
        /new MenuButton\([^;]*?,\s*image1,\s*image2,\s*image1,\s*this\)/g,
      ),
    ]
    expect(twoImage, '那六行「第三张传 image1」一行都没解出来').toHaveLength(EQUIP_SLOTS.length)
    for (const slot of EQUIP_SLOTS) {
      expect(equipButtonId(slot, 'pressed')).toBe(equipButtonId(slot, 'normal'))
      // 反面：磁盘上真的没有那张 `<词干>3.png`。写成"三态三张"的话这里会
      // 去要一个不存在的文件，而表现只是"按下去那颗按钮消失了"。
      const name = `${buttonStem(slot)}3.png`
      expect(
        existsSync(repoPath('sources/菜单/装备', name)),
        `${name} 居然存在了 —— 那这条照抄的依据就变了`,
      ).toBe(false)
    }
    // 正向控制：使用 / 弃用那两颗确实有第三张。
    for (const key of ['use', 'abandon'] as const) {
      expect(equipButtonId(key, 'pressed')).not.toBe(equipButtonId(key, 'normal'))
      expect(existsSync(repoPath('sources/菜单/装备', `${buttonStem(key)}3.png`))).toBe(true)
    }
  })

  it('升降数字：上升用「伤害」那套图、下降用「回复」那套', () => {
    // `switchNum(num, offset)` —— case 1 传 0（前十张，`伤害/`），
    // case 2 传 10（后十张，`回复/`）。`loadImage()` 的读入顺序决定了这件事。
    const show = javaSource('src/menu/ShowValue.java')
    const dirs = [...show.matchAll(/image\/伤害值数字\/([^/]+)\//g)].map((m) => m[1]!)
    expect(dirs, 'ShowValue.loadImage() 里那两行没解出来').toEqual(['伤害', '回复'])
    expect(showValueDigitId(3, false)).toBe('battle:伤害值数字/伤害/3.png')
    expect(showValueDigitId(3, true)).toBe('battle:伤害值数字/回复/3.png')
    expect(showValueArrowId(false)).toBe('menu:装备/上升.png')
    expect(showValueArrowId(true)).toBe('menu:装备/下降.png')
    expect(() => showValueDigitId(10, false)).toThrow()
  })

  it('这一页要的贴图：`装备/` 那批走按需，升降数字在主包里', () => {
    const ids = equipTextureIds()
    expect(ids.length).toBeGreaterThan(0)
    const menuIds = ids.filter((i) => i.startsWith('menu:'))
    const battleIds = ids.filter((i) => i.startsWith('battle:'))
    expect(menuIds.length).toBeGreaterThan(0)
    expect(battleIds.length).toBeGreaterThan(0)
    for (const id of menuIds) {
      expect(menuContent.files, `${id} 不在按需名单里`).toHaveProperty(id)
      expect(manifest, `${id} 跑进主包了 —— 那条边界破了`).not.toHaveProperty(id)
    }
    for (const id of battleIds) {
      expect(manifest, `${id} 不在主包映射表里`).toHaveProperty(id)
    }
    // 翻到这一页才要，别的页不要 —— 否则"按需"就名存实亡。
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    expect(w.panel).not.toBe('equipPanel')
  })
})

describe('⚠️ 登记：两张装备图今天烘不出来', () => {
  it('`sources/Shop/装备/` 整个没进烘焙管线，而药品那批进了', () => {
    // 分母现扫：那批图确实存在于仓库里，只是没人烘。
    const dirs = readdirSync(repoPath('sources/Shop/装备'))
    expect(dirs.length, 'sources/Shop/装备 下一个目录都没有').toBeGreaterThan(0)

    const inputs = Object.keys(bakeStamp.inputs)
    // **正向控制**：药品介绍图走的是同一条路（`sources/Shop/` 下、不在 `image/`
    // 里），它在指纹里 —— 没有这一条，下面那句在"指纹里什么都没有"时也是绿的。
    expect(
      inputs.filter((p) => p.startsWith('sources/Shop/药品/回复类/')).length,
      '药品介绍图不在烘焙指纹里 —— 这条正向控制自己坏了',
    ).toBeGreaterThan(0)
    expect(
      inputs.filter((p) => p.startsWith('sources/Shop/装备/')),
      '装备图标已经进烘焙了（xl-234）—— 把 equipDraw.ts 里那两个落点接上真的贴图，并删掉这条登记',
    ).toEqual([])
  })

  it('落点与原版那两句 drawImage 对得上，只是没有纹理', () => {
    const src = javaSource('src/menu/EquipPanel.java')
    // ⚠️ 源码是 CRLF，跨行的那一句不能写成字面量去 `toContain`（用 `\n` 拼
    // 出来的串永远匹配不上，而"匹配不上"与"这一句没了"长得一样）。
    const draws = [...src.matchAll(/g\.drawImage\((\w+)\.getPicture\(\),\s*([\w_]+),\s*([\w_]+),\s*this\)/g)]
    // 按字段名对，不按出现顺序：源码里 `drawHeroStuff` 写在 `drawEquipment`
    // 上面，而**调用**顺序正好相反 —— 拿文本顺序当调用顺序会错。
    expect(Object.fromEntries(draws.map((m) => [m[1]!, [m[2], m[3]]]))).toEqual({
      currentEquipment: ['x_currentImage', 'y_currentImage'],
      heroEquipment: ['x_heroEquipment_image', 'y_currentImage'],
    })
    expect(CURRENT_PICTURE_ANCHOR).toEqual({ x: CURRENT_IMAGE_X, y: CURRENT_IMAGE_Y })
    expect(WORN_PICTURE_ANCHOR).toEqual({ x: WORN_IMAGE_X, y: CURRENT_IMAGE_Y })
    // 缺的就是这两张：这一页画出来的图里，没有任何一张落在那两个点上。
    const w = world([{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }])
    const images = pageOps(w).filter((op) => op.kind === 'image')
    // ⚠️ **正向控制**：这一页真的画了图。少了这一句，`equipDrawOps` 整个返回
    // 空数组时下面那两条也是绿的 —— "缺口还在"与"这一层坏了"长得一模一样
    // （/code-review 的 Standards 轴提的）。
    expect(images.length, '这一页一张图都没画 —— 下面那两条就成了恒真').toBeGreaterThan(0)
    for (const anchor of [CURRENT_PICTURE_ANCHOR, WORN_PICTURE_ANCHOR]) {
      expect(images.some((op) => op.x === anchor.x && op.y === anchor.y)).toBe(false)
    }
  })
})

describe('装备页画出来的那几段', () => {
  it('次序就是 drawThisPanel() 那六行', () => {
    const w = world([{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }])
    const ops = pageOps(w)
    expect(ops.length).toBeGreaterThan(0)
    // 前几条必须是按钮（六颗槽位里画着的那几颗 + 使用 / 弃用），随后才是文字。
    const firstText = ops.findIndex((op) => op.kind === 'text')
    expect(firstText, '一条文字都没有').toBeGreaterThan(0)
    for (const op of ops.slice(0, firstText)) {
      expect(op.kind).toBe('image')
    }
    // 六颗槽位按钮开局全画着，接着是「弃用」（身上有武器）；「使用」这时
    // `isDraw=No`（背包里那件还没被选中），所以画不出来。
    expect(ops.slice(0, firstText).map((op) => (op.kind === 'image' ? op.id : ''))).toEqual([
      ...EQUIP_SLOTS.map((slot) => equipButtonId(slot, 'normal')),
      equipButtonId('abandon', 'normal'),
    ])
  })

  it('背包列表：名字与数量各一行，行距 22', () => {
    const item = EQUIPMENT_LISTS.weapon.find((i) => i.user === 0)!
    const w = world([
      { name: item.name, count: 2 },
      { name: DEFAULT_WEAPONS.lu.name, count: 1 },
    ])
    // 列表那几行的 y 带：起点与行高都从常量来，不写死 177/250。
    const rows = texts(pageOps(w)).filter(
      (t) => t.y >= EQUIP_Y_START && t.y < EQUIP_Y_START + 4 * EQUIP_ROW_H,
    )
    // 两件东西 × （名字 + 数量）= 四行。数量那一行的三个空格照抄原版。
    expect(rows.map((r) => r.text)).toEqual([
      DEFAULT_WEAPONS.lu.name,
      '   1',
      item.name,
      '   2',
    ])
    expect(rows.map((r) => [r.x, r.y])).toEqual([
      [EQUIP_X_START, EQUIP_Y_START],
      [EQUIP_X_START + 150, EQUIP_Y_START],
      [EQUIP_X_START, EQUIP_Y_START + EQUIP_ROW_H],
      [EQUIP_X_START + 150, EQUIP_Y_START + EQUIP_ROW_H],
    ])
    // 常量本身不是自证的：`equipPanel.test.ts` 把它们对回了 GBK 源码。
    expect([EQUIP_X_START, EQUIP_Y_START, EQUIP_ROW_H]).toEqual([548, 177, 22])
    expect(new Set(rows.map((r) => r.size))).toEqual(new Set([20]))
  })

  it('六个槽位的名字：标点与「无」的写法两种都照抄', () => {
    const w = world()
    const labels = texts(pageOps(w)).filter((t) => t.color === '#ff0000')
    expect(labels.map((t) => t.text)).toEqual([
      `武器：${DEFAULT_WEAPONS.zhang.name}`,
      '盔甲: 无',
      '头盔: 无 ',
      '战靴: 无 ',
      '护臂: 无',
      '饰品: 无',
    ])
    expect(labels.map((t) => t.y)).toEqual([270, 290, 310, 330, 350, 370])
    expect(new Set(labels.map((t) => [t.x, t.size].join()))).toEqual(new Set(['125,21']))
  })

  it('四项属性：跟着卷轴上那个人走', () => {
    const w = world()
    const bars = texts(pageOps(w)).filter((t) => t.color === '#0000ff')
    const h = w.heroes[0]!
    expect(bars.map((t) => t.text)).toEqual([
      `体力：${h.physicalPower}`,
      `敏捷：${h.agile}`,
      `武力：${h.strength}`,
      `精气：${h.spirit}`,
    ])
    expect(bars.map((t) => t.y)).toEqual([410, 436, 462, 488])
    expect(new Set(bars.map((t) => t.size))).toEqual(new Set([22]))
  })

  it('没选中东西时那两行说明是「无装备」—— 两句都从源码里现读', () => {
    const src = javaSource('src/menu/EquipPanel.java')
    const empty = [...src.matchAll(/message([12])="([^"]+)";/g)].map((m) => m[2]!)
    // 零匹配与"两句都对"长得一样。
    expect(empty, 'else 那一支的两句没解出来').toEqual(['无装备', '快去装备店购买吧~！'])
    const all = texts(pageOps(world())).map((t) => t.text)
    for (const line of empty) expect(all).toContain(line)
  })

  /**
   * ⚠️ 这一条曾经写成 `toContain(equipIntroText(spec))` —— **拿被测函数自己
   * 当期望值**，按构造成立。篡改矩阵里把 `" : 体力+"` 的头一个空格去掉，
   * 那一版是绿的。现在期望值从原版那句字符串拼接里现读。
   */
  it('装备说明那一行的格式，从原版那句拼接里现读', () => {
    const src = javaSource('src/menu/EquipPanel.java')
    // `message2=" : 体力+"+…getAddPhysicalPower()+" 敏捷+"+…` 直到分号。
    const stmt = /message2=(" : [^;]+?);\s/.exec(src)
    expect(stmt, '那句拼接没解出来').not.toBeNull()
    const parts = [...stmt![1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!)
    expect(parts, '拼接里的四段字面量没解全').toHaveLength(4)
    const spec = EQUIPMENT_LISTS.armor[0]!
    expect(equipIntroText(spec)).toBe(
      parts[0]! +
        spec.addPhysicalPower +
        parts[1]! +
        spec.addAgile +
        parts[2]! +
        spec.addStrength +
        parts[3]! +
        spec.addSpirit,
    )
  })

  it('画得出来的每一张，`menuTextureIds` 里都要有 —— 否则那一张是空的', () => {
    // ⚠️ 这一条是篡改矩阵逼出来的：原先只核 `equipTextureIds()` 自己，把它从
    // `menuTextureIds` 里摘掉照样全绿 —— 而那正是"载不到纹理"的样子。
    const w = world([{ name: DEFAULT_WEAPONS.lu.name, count: 1 }])
    selectEquipRow(w, DEFAULT_WEAPONS.lu.name)
    pressButtonOnly(w, w.panels.equipPanel.equip!.use)
    const used = new Set(
      menuDrawList(w).flatMap((op) => (op.kind === 'image' ? [op.id] : [])),
    )
    expect(used.size).toBeGreaterThan(0)
    const loaded = new Set(menuTextureIds(w))
    for (const id of used) {
      expect(loaded, `${id} 画得出来却不在 load 名单里`).toContain(id)
    }
  })

  it('四项属性跟着卷轴上选中的那个人换', () => {
    // ⚠️ 也是篡改矩阵逼出来的：改成永远画 `heroes[0]` 照样全绿 ——
    // 上面那条只有张小凡一个人在队里。
    const w = createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true })
    w.panel = 'equipPanel'
    const scoll = w.panels.equipPanel.scoll!
    clickScollHead(w, scoll.hero2)
    expect(scoll.whichHero).toBe(2)

    const bars = texts(pageOps(w)).filter((t) => t.color === '#0000ff')
    const lu = w.heroes[1]!
    expect(bars.map((t) => t.text)).toEqual([
      `体力：${lu.physicalPower}`,
      `敏捷：${lu.agile}`,
      `武力：${lu.strength}`,
      `精气：${lu.spirit}`,
    ])
    // 正向控制：两个人的读数真的不一样，否则这条恒真。
    expect(bars.map((t) => t.text)).not.toEqual([
      `体力：${w.heroes[0]!.physicalPower}`,
      `敏捷：${w.heroes[0]!.agile}`,
      `武力：${w.heroes[0]!.strength}`,
      `精气：${w.heroes[0]!.spirit}`,
    ])
  })

  it('选中之后：说明换成那件的，四个升降数字画出来', () => {
    const w = world([{ name: DEFAULT_WEAPONS.lu.name, count: 1 }])
    selectEquipRow(w, DEFAULT_WEAPONS.lu.name)
    const ops = pageOps(w)
    const spec = EQUIPMENT_LISTS.weapon.find((i) => i.name === DEFAULT_WEAPONS.lu.name)!
    expect(texts(ops).map((t) => t.text)).toContain(spec.name)
    expect(texts(ops).map((t) => t.text)).toContain(equipIntroText(spec))
    // 四行升降数字，每行一个箭头。身上穿着的是张小凡那把，所以是**差值**。
    const arrows = ops.filter(
      (op) => op.kind === 'image' && (op.id === showValueArrowId(true) || op.id === showValueArrowId(false)),
    )
    expect(arrows.map((op) => (op.kind === 'image' ? op.y : -1))).toEqual([388, 413, 438, 463])
    expect(arrows.map((op) => (op.kind === 'image' ? op.x : -1))).toEqual([185, 185, 185, 185])
    // 敏捷那一格是 0-1=-1 → 下降。
    expect(arrows[1]!.kind === 'image' && arrows[1]!.id).toBe(showValueArrowId(true))
  })

  it('拒绝提示只在置了旗标的那一步画，落点 (800,330)', () => {
    const w = world([{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }])
    const e = w.panels.equipPanel.equip!
    selectEquipRow(w, DEFAULT_WEAPONS.zhang.name)
    expect(pageOps(w).map((op) => (op.kind === 'image' ? op.id : ''))).not.toContain(
      warningId('equipped'),
    )
    pressButtonOnly(w, e.use)
    const shown = pageOps(w).filter((op) => op.kind === 'image' && op.id === warningId('equipped'))
    expect(shown).toHaveLength(1)
    expect([shown[0]!.kind === 'image' && shown[0]!.x, shown[0]!.kind === 'image' && shown[0]!.y]).toEqual([800, 330])
    releaseButtonOnly(w, e.use)
    expect(pageOps(w).map((op) => (op.kind === 'image' ? op.id : ''))).not.toContain(
      warningId('equipped'),
    )
  })
})

describe('ShowValue 的位数拆解', () => {
  it('前导零不画，个位无论如何都画', () => {
    expect(showValueDigits(0)).toEqual([0])
    expect(showValueDigits(7)).toEqual([7])
    expect(showValueDigits(-3)).toEqual([3])
    expect(showValueDigits(12)).toEqual([1, 2])
    expect(showValueDigits(105)).toEqual([1, 0, 5])
    expect(showValueDigits(1000)).toEqual([1, 0, 0, 0])
    expect(showValueDigits(-1234)).toEqual([1, 2, 3, 4])
  })
})
