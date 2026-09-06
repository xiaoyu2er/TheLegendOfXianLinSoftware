import { readFileSync, readdirSync } from 'node:fs'
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
  it('注册表正好是 script/ 下的那 96 个场景', () => {
    // 分母不是"注册表里有几个"，是 script/ 下有几个脚本 —— 拿一个数不出来的
    // 分母做断言，等于没断言。
    const scripts = readdirSync(repoPath('script'))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => f.replace(/\.txt$/, ''))
      .sort()
    expect(scripts.length).toBe(96)
    expect([...SCENE_NAMES].sort()).toEqual(scripts)
    expect(SCENE_NAMES).toContain(START_SCENE)
  })

  it.each(SCENE_NAMES)('%s 的产物与现场重烘的结果一致', (name) => {
    const fresh = bakeScript(readFileSync(repoPath(`script/${name}.txt`)), `${name}.txt`)
    expect(getScene(name)).toEqual(fresh)
  })

  it('取一个没烘焙过的场景会报错，并说清楚烘了多少个', () => {
    // 用一个 script/ 下不会有的名字：'食堂' 从 xl-9bd.4 起是真场景了。
    expect(() => getScene('不存在的场景')).toThrowError(
      /没有烘焙过的场景 不存在的场景；已烘焙 96 个/,
    )
  })
})
