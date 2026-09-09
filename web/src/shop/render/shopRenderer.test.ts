import { describe, expect, it } from 'vitest'
import { drugPictureAssetId, equipPictureAssetId } from '../../assets/ids'
import { resolveAsset } from '../../assets/resolve'
import { createShopWorld } from '../world'
import { shopTextureIds } from './assets'
import { shopAssetUrl } from './shopRenderer'

/**
 * 渲染器整体没有测试缝（"把纹理贴到 (x,y)"），**只有分流那一处有** ——
 * 它是个决定，不是贴图。把 `battle:` 那一支错接过去，表现是鼠标图 404，
 * 而 shop 的逐帧比对还没接上（xl-knp.10），一个判据都碰不到它。
 */
describe('商店素材的 URL 分流', () => {
  it('四个前缀都认得，且四种都真的出现在载入名单里', () => {
    const w = createShopWorld({
      party: ['zhang', 'lu', 'wen'],
      coins: 10000,
      seed: 1,
    })
    w.active = 'equipment'
    const ids = shopTextureIds(w)
    const prefixes = new Set(ids.map((id) => id.slice(0, id.indexOf(':') + 1)))
    // 药店那一边才有 `drug:`，所以两家店都推一遍。
    w.active = 'drug'
    // 悬停过才有图标框那一条，但载入名单是"这一帧**可能**用得到"的全集，
    // 所以药品图不必悬停就在名单里。
    for (const id of shopTextureIds(w)) prefixes.add(id.slice(0, id.indexOf(':') + 1))
    expect([...prefixes].sort()).toEqual(['battle:', 'drug:', 'equip:', 'shop:'])
    for (const id of ids) expect(shopAssetUrl(id), id).toBe(resolveAsset(id))
  })

  it('认不出的前缀一律抛，不猜', () => {
    expect(() => shopAssetUrl('menu:鼠标图/1.png')).toThrow(/只认 shop:/)
    expect(() => shopAssetUrl('map:宿舍')).toThrow(/只认 shop:/)
    expect(() => shopAssetUrl('鼠标图/1.png')).toThrow(/只认 shop:/)
  })

  it('反向自检：手写出来的 ID 算不回它那条路径就抛', () => {
    // 正着来的都过。
    expect(() => shopAssetUrl('shop:按钮组件/钱.png')).not.toThrow()
    expect(() => shopAssetUrl(drugPictureAssetId('金创药.png'))).not.toThrow()
    expect(() => shopAssetUrl(equipPictureAssetId('武器', '月苗刀.png'))).not.toThrow()
    // 反斜杠是 `normalizePath` 会抹平的那一种，所以它算不回自己。
    expect(() => shopAssetUrl('shop:按钮组件\\钱.png')).toThrow(/不是从 sources\/Shop/)
    expect(() => shopAssetUrl('drug:药品\\金创药.png')).toThrow(/不是从文件名/)
    // 装备图少了「类」那一段 —— 两个目录里的同名文件会算出同一个 ID。
    expect(() => shopAssetUrl('equip:月苗刀.png')).toThrow(/不是从 <类>\/<文件名>/)
  })
})
