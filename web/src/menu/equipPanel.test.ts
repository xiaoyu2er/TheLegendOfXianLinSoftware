import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { DEFAULT_WEAPONS } from './defaultWeapons'
import { EQUIPMENT_LISTS, EQUIP_SLOTS } from './equipment'
import {
  ABANDON_BUTTON_X,
  ABANDON_BUTTON_Y,
  CURRENT_IMAGE_X,
  CURRENT_IMAGE_Y,
  EQUIP_ROW_H,
  EQUIP_X_START,
  EQUIP_Y_START,
  SLOT_BUTTON_H,
  SLOT_BUTTON_W,
  SLOT_BUTTON_X,
  SLOT_BUTTON_Y,
  USE_BUTTON_H,
  USE_BUTTON_W,
  USE_BUTTON_X,
  USE_BUTTON_Y,
  WORN_IMAGE_X,
  equipList,
} from './equipPanel'
import { MENU_HERO_ORDER } from './heroes'
import { snapshotMenu } from './snapshot'
import { stepMenu } from './step'
import { SCOLL_HEROES } from './types'
import { createMenuWorld } from './world'
import type { MenuWorld } from './types'

/**
 * 装备页里**行为真值今天盖不住的那几处**。
 *
 * 逐字段的正本判据在 `menuTrace.test.ts`（`equip × menu-equip` / `× menu-magic`
 * 两格，期望值零手写）。这个文件补的是那两条剧本走不到的地方 —— 每一条都写明
 * 为什么真值盖不到，以及哪张票会把它变成真值判据。
 *
 * ⚠️ 这里的期望值**不是凭空手写的数**：几何从 GBK 源码现解，换人那一段的期望
 * 全部从 `DEFAULT_WEAPONS` / `EQUIPMENT_LISTS` 推 —— 那两份自己各有判据
 * （`defaultWeapons.test.ts` 读 Java 源码 + `sources/Shop/武器.txt`，
 * `equipment.test.ts` 逐行读那六份 GBK 数据）。
 */

/** 一份源码里 `int name=<表达式>;` 的右边，原样取出。与 `layout.test.ts` 同一个。 */
function intField(source: string, name: string): string {
  const matches = [...source.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*([^;]+);`, 'g'))]
  if (matches.length !== 1) {
    throw new Error(`源码里 ${name} 的初始化式解出了 ${matches.length} 处，应为 1 处`)
  }
  return matches[0]![1]!.trim()
}

describe('装备页的几何，对回原版的字段初始化式', () => {
  const src = javaSource('src/menu/EquipPanel.java')

  it('列表起点与那八颗按钮', () => {
    expect(String(EQUIP_X_START)).toBe(intField(src, 'x_start_point'))
    expect(String(EQUIP_Y_START)).toBe(intField(src, 'y_start_point'))
    expect(intField(src, 'x_currentImage')).toBe('790+32')
    expect(String(CURRENT_IMAGE_X)).toBe('822')
    expect(String(CURRENT_IMAGE_Y)).toBe(intField(src, 'y_currentImage'))
    expect(intField(src, 'x_heroEquipment_image')).toBe('300+32')
    expect(String(WORN_IMAGE_X)).toBe('332')

    // `addButton()` 里那七行局部变量。
    expect(intField(src, 'x_equipButton')).toBe('x_start_point-16')
    expect(intField(src, 'y_equipButton')).toBe('y_start_point-42')
    expect(String(SLOT_BUTTON_W)).toBe(intField(src, 'width_button'))
    expect(String(SLOT_BUTTON_H)).toBe(intField(src, 'height_button'))
    expect(intField(src, 'x_useButton')).toBe('x_currentImage+5+25')
    expect(intField(src, 'y_useButton')).toBe('y_currentImage+250')
    expect(intField(src, 'x_abandonButton')).toBe('x_heroEquipment_image+23')
    expect(intField(src, 'y_abandonButton')).toBe('y_useButton')
    expect(String(USE_BUTTON_W)).toBe(intField(src, 'width'))
    expect(String(USE_BUTTON_H)).toBe(intField(src, 'height'))

    expect([SLOT_BUTTON_X, SLOT_BUTTON_Y]).toEqual([532, 135])
    expect([USE_BUTTON_X, USE_BUTTON_Y]).toEqual([852, 430])
    expect([ABANDON_BUTTON_X, ABANDON_BUTTON_Y]).toEqual([355, 430])
  })

  it('六颗槽位按钮的次序，从 buttonlist[] 那六行解出来', () => {
    const stem: Readonly<Record<string, string>> = {
      weaponButton: 'weapon',
      armorButton: 'armor',
      helmetButton: 'helmet',
      shoeButton: 'shoe',
      gloveButton: 'glove',
      decorationButton: 'decoration',
    }
    const order = [...src.matchAll(/buttonlist\[(\d)\]=(\w+);/g)].map((m) => [
      Number(m[1]),
      stem[m[2]!],
    ])
    // 零匹配与"次序全对"长得一样（GBK 源码被当二进制、那一段被挪走）。
    expect(order, 'buttonlist[] 那六行一行都没解出来').toHaveLength(EQUIP_SLOTS.length)
    expect(order).toEqual(EQUIP_SLOTS.map((slot, i) => [i, slot]))
  })

  it('列表行高 22 —— isMoveIn() 与 drawEquipment() 用的是同一个数', () => {
    // `originalY += 22;`（命中带）与 `y += 22;`（画字）。两处都要有，
    // 只解到一处说明其中一处被改成了别的数。
    expect(src).toContain(`originalY += ${EQUIP_ROW_H};`)
    expect(src).toContain(`y += ${EQUIP_ROW_H};`)
  })
})

describe('三个人的次序：卷轴编号与 heroes[] 必须同序', () => {
  it('SCOLL_HEROES 与 MENU_HERO_ORDER 一一对应', () => {
    // 错位的表现是"给张小凡穿的东西加到了陆雪琪身上"，而两个人的属性都是
    // 合法数字。⚠️ 玉洁在出战名单里的键是 `wen`、在 `PartyKey` 里是 `yu`。
    expect(SCOLL_HEROES.map((h) => h.hero)).toEqual([1, 2, 4])
    expect(MENU_HERO_ORDER.map((h) => h.key)).toEqual(['zhang', 'lu', 'yu'])
    expect(SCOLL_HEROES.map((h) => h.party)).toEqual(['zhang', 'lu', 'wen'])
    expect(SCOLL_HEROES).toHaveLength(MENU_HERO_ORDER.length)
  })
})

/** 一个开在装备页、三个人都在队里的世界。 */
function worldOnEquipPage(equipment: readonly { name: string; count: number }[] = []): MenuWorld {
  const w = createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true, equipment })
  w.panel = 'equipPanel'
  return w
}

/** 点一颗按钮：按下一步、松开一步，与真值里每条指令展开的那两步同形。 */
function click(w: MenuWorld, x: number, y: number): void {
  stepMenu(w, [{ e: 'press', x, y }])
  stepMenu(w, [{ e: 'release', x, y }])
}

/**
 * 把鼠标移到当前列表里那一件所在的行 —— 落点算法与 `MenuDriver.move()` 同一套
 * （行高 22，命中带从 `y_start_point-22` 起）。
 */
function selectRow(w: MenuWorld, name: string): void {
  const e = w.panels.equipPanel.equip!
  const index = equipList(e).findIndex((i) => i.name === name)
  if (index < 0) throw new Error(`当前列表里没有「${name}」`)
  stepMenu(w, [
    {
      e: 'move',
      x: EQUIP_X_START + 1,
      y: EQUIP_Y_START - EQUIP_ROW_H + EQUIP_ROW_H * index + Math.floor(EQUIP_ROW_H / 2),
    },
  ])
  if (e.currentEquipment !== name) {
    throw new Error(`想选「${name}」，实际选中的是「${e.currentEquipment}」`)
  }
}

/** 按钮中心。命中框比画出来的位置偏左 15、偏上 6（`buttons.ts` 第 1 条）。 */
function center(b: { x: number; y: number; width: number; height: number }): [number, number] {
  return [b.x - 15 + Math.floor(b.width / 2), b.y - 6 + Math.floor(b.height / 2)]
}

describe('两条 menu 真值今天盖不到的路径', () => {
  /**
   * ⚠️ **换人这一整段零真值覆盖**：`menu-equip` 与 `menu-magic` 全程
   * `hero` 都是 1，一次头像都没点过。补一条「换人看属性」的真值是
   * **xl-6lo.7**，那之后这一条应当被 `menuTrace.test.ts` 的逐字段比对取代。
   * 在那之前它是这一段唯一会红的东西。
   */
  it('点头像换人：背包换成那个人的，列表拨回武器，身上那件跟着换', () => {
    const w = worldOnEquipPage()
    const scoll = w.panels.equipPanel.scoll!
    const e = w.panels.equipPanel.equip!

    // 先切到盔甲页，好看出"换人一律把列表拨回武器"这件事。
    click(w, ...center(e.slots.armor))
    expect(e.currentList).toBe('armor')

    // ⚠️ 二号与四号的头像开局 `isDraw=No`，`Scoll.checkMoveIn()` 才按出战名单
    // 把它们打开 —— 不先移一下鼠标，`isPressedButton` 整个跳过，这一点就是空的。
    const [hx, hy] = center(scoll.hero2)
    stepMenu(w, [{ e: 'move', x: hx, y: hy }])
    click(w, hx, hy)

    expect(scoll.whichHero).toBe(2)
    expect(e.currentPackHero).toBe(2)
    expect(e.currentList).toBe('weapon')
    // 期望值从 `DEFAULT_WEAPONS` 推，不手写名字 —— 那一份自己有判据。
    expect(e.heroEquipment).toBe(DEFAULT_WEAPONS.lu.name)
    expect(e.abandon.isDraw).toBe(true)
    expect(snapshotMenu(w)['equip']).toMatchObject({
      packHero: 2,
      tab: 'weapon',
      worn: DEFAULT_WEAPONS.lu.name,
      equipped: { weapon: DEFAULT_WEAPONS.lu.name, armor: null },
    })
  })

  /**
   * ⚠️ **「被 CardLayout 盖住的那一页不跑 paint」这条今天也观测不到**：
   * 装备页被盖住的那几步（`menu-equip` 第 19..27 步）里，跑不跑
   * `paintEquip` 的结果**完全相同** —— 身上有东西、`signal` 是 0，三笔副作用
   * 一笔都改不动任何东西（实测：把 `paintCurrentPanel` 改成四页全跑，
   * 整套判据全绿）。
   *
   * 所以这里造一个只有 paint 才改得动的差：直接把「身上那件」摘掉，
   * 再推一步。当前页不是装备页，`abandon.isDraw` 就不许被拨回去。
   * 这是**构造出来的探针**，不是原版走得到的一步 —— 但它守的规矩是原版的：
   * `drawHeroStuff()` 只在那一页真的被画时才跑。
   */
  it('被盖住的那一页不跑 paint 的状态副作用', () => {
    const w = worldOnEquipPage()
    const e = w.panels.equipPanel.equip!
    expect(e.abandon.isDraw, '开局身上有武器，「弃用」该画着').toBe(true)

    w.panel = 'thingPanel'
    e.heroEquipment = null
    stepMenu(w, [{ e: 'tick' }])
    expect(e.abandon.isDraw, '装备页被盖住时不该跑 drawHeroStuff').toBe(true)

    // 正向控制：翻回装备页，同一笔副作用立刻生效。没有这一条的话，
    // 上面那句在"paintEquip 根本没被接上"的情况下也是绿的。
    w.panel = 'equipPanel'
    stepMenu(w, [{ e: 'tick' }])
    expect(e.abandon.isDraw, '翻回装备页之后 drawHeroStuff 该跑了').toBe(false)
  })

  /**
   * ⚠️ **「鼠标事件只送当前页」这条今天也观测不到**：真值里人在物品页的那几步
   * （第 19..23 步），落点恰好都不落在装备页任何一颗**画着的**按钮上 ——
   * 第 22 步那下 `use` 其实正落在装备页「使用」按钮的命中框里，只是那时它
   * `isDraw=No`，`isPressedButton` 整个跳过（实测：把派发改成"不管当前是哪一页
   * 都送给装备页"，整套判据全绿）。
   *
   * 这里把那个巧合拆掉：先在装备页选中一件（「使用」于是画着了），再翻到
   * 物品页去点同一个落点。原版 `MenuPanel` 的 `mousePressed` 只有一句
   * `currentPanel.mousePressed(...)`，所以什么都不该发生。
   */
  it('鼠标事件只送当前页 —— 别的页上同一个落点点不动', () => {
    const w = worldOnEquipPage([{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }])
    const e = w.panels.equipPanel.equip!
    click(w, ...center(e.slots.weapon))
    selectRow(w, DEFAULT_WEAPONS.zhang.name)
    expect(e.use.isDraw, '选中之后「使用」该画着了').toBe(true)

    const [ux, uy] = center(e.use)
    const before = snapshotMenu(w)['equip']
    w.panel = 'thingPanel'
    stepMenu(w, [{ e: 'press', x: ux, y: uy }])
    expect(snapshotMenu(w)['equip'], '在物品页上点，装备页不该有任何反应').toEqual(before)
    stepMenu(w, [{ e: 'release', x: ux, y: uy }])

    // 正向控制：同一个落点，翻回装备页就点得动。没有它的话，上面那句在
    // "这个落点本来就点不中"的情况下也是绿的。
    // ⚠️ 要在**按下那一步**看：拒绝旗标只活这一步，松开那一步就清了。
    w.panel = 'equipPanel'
    stepMenu(w, [{ e: 'press', x: ux, y: uy }])
    expect(snapshotMenu(w)['equip']).not.toEqual(before)
  })

  /**
   * **「重复装备已经穿着的东西」这条拒绝路径，真值里一次都没走到。**
   *
   * 两条现有剧本里 `warnEquipped` 全程是 false（实测：`menu-equip` 只在第 6 与
   * 第 10 步亮过 `warnCannotUse`）。原因是原版把两条判据串成了先后：先判
   * 使用者，**通过了**才进 `doUseButton()` 去判槽位空不空 —— 而 `menu-equip`
   * 那件 藏璎环 是 `user=2`，头一道就被拦下了。
   *
   * 要走到第二条，得**用张小凡能用的那把武器，去顶他身上已经穿着的那把**。
   * 补一条真值走这一路值得单开一张票；在那之前这条是它唯一会红的东西。
   */
  it('拒绝路径二：槽位上已经有东西了，「使用」按下去只出提示', () => {
    // 开局张小凡身上就穿着 `DEFAULT_WEAPONS.zhang`，再给背包放一把同样的。
    const w = worldOnEquipPage([{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }])
    const e = w.panels.equipPanel.equip!
    click(w, ...center(e.slots.weapon))
    selectRow(w, DEFAULT_WEAPONS.zhang.name)
    expect(e.heroEquipment, '武器槽本来就满着').toBe(DEFAULT_WEAPONS.zhang.name)
    const zhangBefore = { ...w.heroes[0]! }

    const [ux, uy] = center(e.use)
    stepMenu(w, [{ e: 'press', x: ux, y: uy }])
    expect(snapshotMenu(w)['equip']).toMatchObject({
      warnEquipped: true,
      // 另一条不许跟着亮 —— 两条是互斥的。
      warnCannotUse: false,
      // 拒绝就是什么都没发生：存货没少、身上没换。
      worn: DEFAULT_WEAPONS.zhang.name,
      list: [{ name: DEFAULT_WEAPONS.zhang.name, count: 1 }],
    })
    // 原版 `drawWarning()` 那一声。
    expect(w.music).toContain('禁止.wav')
    expect(w.heroes[0], '被拒绝了，属性一个字都不该动').toEqual(zhangBefore)

    // 旗标只活这一步。
    stepMenu(w, [{ e: 'release', x: ux, y: uy }])
    expect(snapshotMenu(w)['equip']).toMatchObject({ warnEquipped: false })
  })

  /**
   * ⚠️ **`equipped` 那六个键里，只有 `weapon` 与 `armor` 有真值覆盖**
   * （`menu-equip` 只走了这两槽）。其余四槽由这一条守着：六个槽位各自
   * 独立、穿在哪个槽由 `CURRENTLIST` 决定。真正的逐字段判据要等有人补一条
   * 走满六槽的真值。
   */
  it('六个槽位各穿各的，互不串槽', () => {
    // 每一槽拿它那张表里**张小凡用得了的**第一件 —— 名字从表里取，不手写。
    // ⚠️ 武器表前六件全是 `user=2`（只有陆雪琪能用），直接取 `[0]` 会撞上
    // 「不是这个人能用的」那条拒绝路径 —— 第一版就是这么红的。
    const usable = Object.fromEntries(
      EQUIP_SLOTS.map((slot) => {
        const spec = EQUIPMENT_LISTS[slot].find((i) => i.user === 0 || i.user === 1)
        if (!spec) throw new Error(`${slot} 表里没有张小凡用得了的东西`)
        return [slot, spec.name]
      }),
    ) as Record<(typeof EQUIP_SLOTS)[number], string>
    const w = worldOnEquipPage(EQUIP_SLOTS.map((slot) => ({ name: usable[slot], count: 1 })))
    const e = w.panels.equipPanel.equip!

    for (const slot of EQUIP_SLOTS) {
      click(w, ...center(e.slots[slot]))
      // 武器槽开局就穿着东西，先弃用；`abandon.isDraw` 说明它画不画得出来。
      if (e.abandon.isDraw) click(w, ...center(e.abandon))
      selectRow(w, usable[slot])
      click(w, ...center(e.use))
    }

    expect(snapshotMenu(w)['equip']).toMatchObject({ equipped: usable })
    // 反向：串槽的话某一槽会是别人的东西，而六个名字都合法。所以再核一遍
    // 六件东西两两不同（六张表里没有重名）。
    expect(new Set(Object.values(usable)).size).toBe(EQUIP_SLOTS.length)
  })
})
