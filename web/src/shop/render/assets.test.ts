import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { resolveAsset } from '../../assets/resolve'
import { SLOT_FILE } from '../../menu/equipment'
import { KNOWN_MISSING_EQUIP_PICTURES } from '../../menu/equipmentPictures'
import { equipPictureAssetId } from '../../assets/ids'
import { ANIMATION_FRAMES, SHOP_CATEGORIES } from '../layout'
import type { ShopButtonLabel } from '../buttons'
import { createShopWorld } from '../world'
import {
  CATEGORY_IMAGE_NAME,
  KEEPER_ROLE,
  PARTY_ROLES,
  animationFrameId,
  buttonImages,
  categoryImages,
  mouseId,
  pictureTextureId,
  shopTextureIds,
} from './assets'

const drugShop = javaSource('src/shop/ShopPanel.java')
const equipShop = javaSource('src/shop/EquipmentShopPanel.java')

/** 两份源码里所有 `Reader.readImage("...")` 的实参。 */
function readImages(source: string): string[] {
  const m = [...source.matchAll(/Reader\.readImage\("([^"]+)"\)/g)].map((x) => x[1]!)
  if (m.length === 0) throw new Error('一条 readImage 都没解出来 —— 多半是 GBK 解码错了')
  return m
}

describe('商店素材的逻辑 ID', () => {
  it('这一帧要的每一张都在映射表里 —— 两家店各推一遍', () => {
    const w = createShopWorld({ party: ['zhang', 'lu', 'wen'], coins: 10000, seed: 1 })
    for (const active of ['drug', 'equipment'] as const) {
      w.active = active
      const ids = shopTextureIds(w)
      expect(ids.length, `${active} 店的载入名单`).toBeGreaterThan(0)
      for (const id of ids) expect(() => resolveAsset(id), id).not.toThrow()
    }
  })

  it('队伍名单是分母：少一个人就少八帧', () => {
    const one = createShopWorld({ party: ['zhang'], coins: 10000, seed: 1 })
    const three = createShopWorld({ party: ['zhang', 'lu', 'wen'], coins: 10000, seed: 1 })
    expect(shopTextureIds(three).length - shopTextureIds(one).length).toBe(2 * ANIMATION_FRAMES)
  })

  it('⚠️ 鼠标那八张走 battle: 前缀（在 image/ 下），不是菜单那份同名的', () => {
    // ⚠️ 这一句是**拼出来的**，不是字面量：`readImage("image/鼠标图/"+i+".png")`。
    // 拿 `readImages` 去找它一条都找不到，而"找不到"与"它不在 image/ 下"
    // 长得一样 —— 所以这里认的是那条拼接本身。
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const m = [...source.matchAll(/Reader\.readImage\("([^"]*)"\+i\+"([^"]*)"\)/g)]
      expect(m, `${what} 的鼠标图拼接`).toHaveLength(1)
      expect([m[0]![1], m[0]![2]]).toEqual(['image/鼠标图/', '.png'])
    }
    for (let i = 0; i < ANIMATION_FRAMES; i++) {
      expect(mouseId(i)).toBe(`battle:鼠标图/${i + 1}.png`)
      // 菜单那一份是另一批文件，两条都在映射表里 —— 拿错一份画出来几乎一样。
      expect(() => resolveAsset(mouseId(i))).not.toThrow()
    }
  })

  it('人物动画的路径逐字对回 ShopAnimation 的拼接，帧号从 1 起', () => {
    const animation = javaSource('src/shop/ShopAnimation.java')
    expect(animation).toContain('"sources/Shop/商店人物/"+s+"/"+s+" ("+i+").png"')
    expect(animationFrameId('店主', 0)).toBe('shop:商店人物/店主/店主 (1).png')
    // 四条动画的角色名对回两个构造函数里的 `new ShopAnimation("<名字>", …)`。
    const roles = (source: string) =>
      [...source.matchAll(/new ShopAnimation\("([^"]+)"/g)].map((m) => m[1])
    expect(roles(drugShop)).toEqual([...PARTY_ROLES.map((r) => r.role), KEEPER_ROLE.drug])
    expect(roles(equipShop)).toEqual([...PARTY_ROLES.map((r) => r.role), KEEPER_ROLE.equipment])
    // ⚠️ 第四条两家店不是同一个人。
    expect(KEEPER_ROLE.drug).not.toBe(KEEPER_ROLE.equipment)
  })

  it('⚠️ 分类按钮的图片名与数据文件名不是同一套字', () => {
    // 四个词不一样：helmet 头/头盔、glove 手/护臂、shoe 脚/靴子、armor 盔甲/盔甲。
    const differ = SHOP_CATEGORIES.filter((c) => CATEGORY_IMAGE_NAME[c] !== SLOT_FILE[c])
    expect(differ.sort()).toEqual(['glove', 'helmet', 'shoe'])
    // 每一张都得在源码里真出现过，且在映射表里。
    const paths = readImages(equipShop)
    for (const c of SHOP_CATEGORIES) {
      const images = categoryImages(c)
      expect(paths, `${c} 的常态图`).toContain(`sources/Shop/按钮组件/${CATEGORY_IMAGE_NAME[c]}1.png`)
      expect(paths, `${c} 的按下图`).toContain(`sources/Shop/按钮组件/${CATEGORY_IMAGE_NAME[c]}2.png`)
      // ⚠️ 常态与悬停传的是**同一张** —— 悬停在分类栏上画面纹丝不动，照抄。
      expect(images.normal).toBe(images.waitclick)
      expect(images.pressed).not.toBe(images.normal)
      for (const id of Object.values(images)) expect(() => resolveAsset(id), id).not.toThrow()
    }
  })

  it('⚠️ 加减按钮只有两张图：waitclick 与 pressed 是同一张 2.png', () => {
    // 原版那两句 `new GameButton(..., 减少1, 减少2, 减少2, this)`。
    const m = [
      ...drugShop.matchAll(
        /Reader\.readImage\("sources\/Shop\/(减少|增加)1\.png"\),\s*\r?\n?\s*Reader\.readImage\("sources\/Shop\/\1(\d)\.png"\),\s*\r?\n?\s*Reader\.readImage\("sources\/Shop\/\1(\d)\.png"\)/g,
      ),
    ]
    expect(m, '加减按钮那两组图没解出来').toHaveLength(2)
    for (const x of m) expect([x[2], x[3]]).toEqual(['2', '2'])
    for (const label of ['minus:0', 'plus:0'] as const) {
      const images = buttonImages(label)
      expect(images.waitclick).toBe(images.pressed)
      expect(images.normal).not.toBe(images.waitclick)
    }
  })

  it('买 / 卖 / 返回三颗各有三张不同的图', () => {
    for (const label of ['buy', 'sell', 'back'] as const) {
      const images = buttonImages(label)
      expect(new Set(Object.values(images)).size, label).toBe(3)
      for (const id of Object.values(images)) expect(() => resolveAsset(id), id).not.toThrow()
    }
  })

  it('⚠️ 数据点名了、仓库里却没有的那三张：不画，但**身份还在**', () => {
    expect(KNOWN_MISSING_EQUIP_PICTURES.length).toBeGreaterThan(0)
    const w = createShopWorld({ party: ['zhang'], coins: 10000, seed: 1 })
    for (const m of KNOWN_MISSING_EQUIP_PICTURES) {
      const id = equipPictureAssetId(SLOT_FILE[m.slot], m.picture)
      // 画不出来 —— 载入名单与绘制清单里都不该有它。
      expect(pictureTextureId(id), m.picture).toBeNull()
      // ⚠️ 而 `ShopRow.picture` 照旧是那条不存在的路径：它同时是"图标框里
      // 那张图"的身份。抹成 null 的话，三件缺图的装备会全部认成"框里没图"。
      const row = w.equipment.rows[m.slot].find((r) => r.picture === id)
      expect(row, `${m.slot} 那一栏里没有 ${m.picture} 这一行`).toBeTruthy()
    }
    w.active = 'equipment'
    const ids = shopTextureIds(w)
    for (const m of KNOWN_MISSING_EQUIP_PICTURES) {
      expect(ids).not.toContain(equipPictureAssetId(SLOT_FILE[m.slot], m.picture))
    }
    // 名单外的那批照旧在。
    expect(ids.filter((id) => id.startsWith('equip:')).length).toBeGreaterThan(0)
  })

  it('认不出的按钮名一律抛，不猜', () => {
    // `category:<不存在的分类>` 落在 `ShopButtonLabel` 的模板字面量里 ——
    // 类型收不住它，运行时才分得出。
    expect(() => buttonImages('category:grocery')).toThrow(/认不出来/)
    // ⚠️ 这一个类型已经收住了（`ShopButtonLabel` 里没有 `use`），所以要
    // `as` 一下才试得出来。**留着它**：这个函数从渲染层收名字，而渲染层的
    // 名字来自 `ShopButtonState.label` —— 哪天有人给它加一种按钮而忘了加图，
    // 拦住的是这个 `throw`，不是类型。
    expect(() => buttonImages('use' as ShopButtonLabel)).toThrow(/认不出来/)
  })
})
