import { describe, expect, it } from 'vitest'
import { ANIMATION_FRAMES, ANIMATION_INTERVAL_MS } from './layout'
import { PREVIEW_CONFIG, SHOP_PREVIEW_CHOICES, previewFrame } from './preview'
import { createShopWorld } from './world'

describe('开发用的商店预览', () => {
  it('0ms 就在第 0 格上 —— 原版是先赋值后睡', () => {
    expect(previewFrame(0)).toBe(0)
    expect(previewFrame(ANIMATION_INTERVAL_MS - 1)).toBe(0)
    expect(previewFrame(ANIMATION_INTERVAL_MS)).toBe(1)
  })

  it('八格一圈', () => {
    expect(previewFrame(ANIMATION_INTERVAL_MS * (ANIMATION_FRAMES - 1))).toBe(ANIMATION_FRAMES - 1)
    expect(previewFrame(ANIMATION_INTERVAL_MS * ANIMATION_FRAMES)).toBe(0)
  })

  it('⚠️ 负数与非有限值顶回第 0 格 —— 越界帧号算出来的是一张不存在的图', () => {
    for (const bad of [-1, -1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const frame = previewFrame(bad)
      expect(Number.isInteger(frame), String(bad)).toBe(true)
      expect(frame >= 0 && frame < ANIMATION_FRAMES, String(bad)).toBe(true)
    }
  })

  // ⚠️ 「这一局画得出清单」那一条在 `render/drawList.test.ts` 里，不在这里：
  // `shopTrace.test.ts` 那条「状态层整个目录都不碰渲染」是**连测试文件一起
  // 扫**的，而它扫的正是这个目录。放在这里会把那条判据扫红 —— 一条真判据，
  // 不是误伤。
  it('预览那一局建得出来，三个人都在', () => {
    const w = createShopWorld(PREVIEW_CONFIG)
    expect(w.party).toEqual({ zhang: true, lu: true, wen: true })
    expect(w.coins).toBe(PREVIEW_CONFIG.coins)
  })

  it('选择器的取值域正好盖住两家店，外加一个「不看」', () => {
    expect(SHOP_PREVIEW_CHOICES.map((c) => c.value)).toEqual(['none', 'drug', 'equipment'])
  })
})
