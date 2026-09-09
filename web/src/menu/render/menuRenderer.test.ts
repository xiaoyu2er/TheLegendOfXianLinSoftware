import { beforeEach, describe, expect, it } from 'vitest'
import deferredBattle from '../../generated/battleAnimations.json'
import deferredMenu from '../../generated/menuContent.json'
import { resetDeferredBattleCache } from '../../assets/deferredBattle'
import { resetDeferredMenuCache } from '../../assets/deferredMenu'
import manifest from '../../generated/assets.json'
import { MENU_BACKGROUND, drugPictureId, mouseId } from './assets'
import { DRUGS } from '../../battle/drugs'
import { magicAnimationFrameId, magicSkillButtonId } from './magicSkills'
import { menuAssetUrl } from './menuRenderer'

/**
 * `menuAssetUrl` 的**分流**这一条 —— 这个文件其余部分没有测试缝（见
 * `menuRenderer.ts` 的头注），分流是唯一一个"做决定"的地方，所以它单独有缝。
 *
 * ⚠️ **它曾经是个闭包里的局部函数，那时把 `battle:` 那一支错接到主包上是绿的**
 * （xl-6lo.11 的篡改矩阵 R11）。当时菜单那条逐帧比对流水线还没接，所以真接错了
 * 也只表现为"奇术页动画 404"，没有任何判据碰得到。xl-6lo.14 把流水线接上之后
 * 这一条**仍然只有这里守着** —— 404 在浏览器里是抛异常，逐帧比对拿不到帧、
 * 报的是"页面里抛了异常"，那是另一件事。
 */
describe('菜单素材的 URL 分流', () => {
  beforeEach(() => {
    // 两份名单都缓存 Promise，跨用例留着会让"第二次其实没重新加载"藏起来。
    resetDeferredBattleCache()
    resetDeferredMenuCache()
  })

  it('奇术页动画的帧走**战斗那份按需名单**，不走主包', async () => {
    const id = magicAnimationFrameId(1, 1, 1)
    const product = (deferredBattle as { files: Record<string, string> }).files[id]
    // 空转要响：名单里根本没有它的话，下面那条 `toContain` 会拿 undefined 去比。
    expect(product, `${id} 不在按需战斗名单里 —— 先跑 pnpm bake`).toBeTruthy()
    const url = await menuAssetUrl(id)
    expect(url).toContain(encodeURI(product!))
    expect(url).toContain(`?v=${(deferredBattle as { version: string }).version}`)
  })

  it('奇术页的按钮走**菜单那份按需名单**（`奇术/` 在内容那一半）', async () => {
    const id = magicSkillButtonId(1, 1, 'normal')
    const product = (deferredMenu as { files: Record<string, string> }).files[id]
    expect(product, `${id} 不在按需菜单名单里`).toBeTruthy()
    const url = await menuAssetUrl(id)
    expect(url).toContain(encodeURI(product!))
  })

  it('骨架那批走主包映射表 —— 两条路真的不是同一条', async () => {
    const skeleton = await menuAssetUrl(mouseId(0))
    const deferred = await menuAssetUrl(MENU_BACKGROUND.magicPanel)
    // 主包那批不在按需名单里；按需那批不在主包产物目录下。两者长得不一样，
    // 否则"分流写反了"与"分对了"看不出差别。
    expect((deferredMenu as { files: Record<string, string> }).files[mouseId(0)]).toBeUndefined()
    expect(skeleton).not.toBe(deferred)
  })

  it('药品插图走主包映射表 —— 它既不在 sources/菜单/ 也不在 image/ 下', async () => {
    const id = drugPictureId(DRUGS[0]!)
    // 空转要响：它要是根本没烘进主包，下面拿到的会是一条查不到的 URL。
    expect((manifest as Record<string, string>)[id], `${id} 不在主包映射表里 —— 先跑 pnpm bake`)
      .toBeTruthy()
    const url = await menuAssetUrl(id)
    expect(url).toContain(encodeURI((manifest as Record<string, string>)[id]!))
    // 它**不在**两份按需名单里的任何一份 —— 分流走错一支就是 404。
    expect((deferredMenu as { files: Record<string, string> }).files[id]).toBeUndefined()
    expect((deferredBattle as { files: Record<string, string> }).files[id]).toBeUndefined()
  })

  it('认不出来的前缀是抛，不是猜', async () => {
    await expect(menuAssetUrl('scene:宿舍/1.png')).rejects.toThrow(/只认 menu: \/ battle: \/ drug:/)
    // 手写的 drug: ID（算回去对不上）也要抛 —— 反斜杠会被 `normalizePath`
    // 规范成正斜杠，于是算回去与手写的那条不一样。
    await expect(menuAssetUrl('drug:回复类\\金创药.png')).rejects.toThrow(/不是从文件名/)
    // 手写的 menu: ID（算回去对不上）也要抛 —— 这里用一条反斜杠路径：
    // `menuAssetId` 会把它规范化成正斜杠，于是算回去与手写的那条不一样。
    await expect(menuAssetUrl('menu:奇术\\横剑摆渡1.png')).rejects.toThrow(/不是从 sources\/菜单\//)
  })
})
