import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { bakeScript } from './bakeScript'
import { SCENE_NAMES, START_SCENE, getScene } from './scenes'

/**
 * 入库的烘焙产物有没有陈旧 —— 现场重烘一遍源脚本来判定。
 *
 * 产物入库是为了让 CI 与构建不依赖 Java / cwebp / 原始素材，代价就是它可能
 * 落后于源数据。这条测试把那个代价钉住：改了脚本或烘焙器却忘了 `pnpm bake`，
 * 这里会红。
 */
describe('已烘焙的场景', () => {
  it('注册表正好是 M1 需要的两个场景', () => {
    // 分母：M1 = 宿舍 →（出口）→ 大地图。扩到 96 个是 xl-9bd.4 / xl-9bd.5。
    expect([...SCENE_NAMES].sort()).toEqual(['大地图', '宿舍'])
    expect(SCENE_NAMES).toContain(START_SCENE)
  })

  it.each(SCENE_NAMES)('%s 的产物与现场重烘的结果一致', (name) => {
    const fresh = bakeScript(readFileSync(repoPath(`script/${name}.txt`)), `${name}.txt`)
    expect(getScene(name)).toEqual(fresh)
  })

  it('取一个没烘焙过的场景会报出它有哪些', () => {
    expect(() => getScene('食堂')).toThrowError(/没有烘焙过的场景 食堂/)
  })
})
