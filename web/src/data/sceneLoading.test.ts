import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { SCENE_NAMES, START_SCENE, loadScene } from './scenes'
import { getScene } from './scenesEager'

/**
 * 场景 JSON 按需加载（xl-9bd.15）。这里钉住两件事：**取出来的东西没变**，
 * 以及**没人偷偷把它们又拖回主 chunk**。
 */
describe('按需加载场景', () => {
  it('名单是同步的 —— 一份 JSON 都不用等', () => {
    // 场景选择器（App 的开发入口）在任何一份场景到位之前就要能列出全部名字。
    // 分母是名单自己的长度：将来烘多烘少都不用改这里。
    expect(SCENE_NAMES.length).toBeGreaterThan(0)
    expect(SCENE_NAMES).toContain(START_SCENE)
  })

  it.each(SCENE_NAMES)('%s 异步取到的与同步取到的完全一致', async (name) => {
    expect(await loadScene(name)).toEqual(getScene(name))
  })

  it('同一个场景并发要两次，只取一次', async () => {
    // 渲染器和 useGame 在同一帧里各要一次同一个场景。缓存结果（而不是缓存
    // Promise）在这里是看不出来的——两边都能拿到对的数据，只是取了两遍。
    const [a, b] = await Promise.all([loadScene(START_SCENE), loadScene(START_SCENE)])
    expect(a).toBe(b)
    expect(loadScene(START_SCENE)).toBe(loadScene(START_SCENE))
  })

  it('取一个没烘焙过的场景会 reject，并说清楚烘了多少个', async () => {
    // 用一个 script/ 下不会有的名字：'食堂' 从 xl-9bd.4 起是真场景了。
    await expect(loadScene('不存在的场景')).rejects.toThrowError(
      new RegExp(`没有烘焙过的场景 不存在的场景；已烘焙 ${SCENE_NAMES.length} 个`),
    )
  })
})

/**
 * `scenesEager.ts` 一次性把 96 份场景 JSON 读进来。测试与 node 工具用它没问题，
 * **应用代码用了就等于把这一票做的事整个撤销**，而且撤销得悄无声息：功能全对，
 * 只是主 chunk 又胖了 gzip 86 kB，除非有人去量产物大小，否则没人会发现。
 *
 * 所以这条用例数的是"谁在 import 它"的名单，而不是"有没有发现问题"——
 * 扫描器自己失灵时（路径错了、后缀没覆盖到），名单会变空而不是变绿。
 */
describe('eager 场景注册表的使用范围', () => {
  const WEB = repoPath('web')
  const ROOTS = ['src', 'scripts']

  function sourceFiles(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'generated' && entry.name !== 'node_modules') walk(full)
        } else if (/\.tsx?$/.test(entry.name)) {
          out.push(relative(WEB, full))
        }
      }
    }
    for (const root of ROOTS) walk(join(WEB, root))
    return out
  }

  it('只有测试和 scripts/ 下的 node 工具 import 它', () => {
    const files = sourceFiles()
    // 扫到的文件本身要是个能数出来的数：扫描器指错了地方，这里先响。
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('src/data/scenesEager.ts')

    const importers = files.filter(
      (f) =>
        f !== 'src/data/scenesEager.ts' &&
        /from '[^']*scenesEager'/.test(readFileSync(join(WEB, f), 'utf-8')),
    )
    // 名单不能为空：一个都扫不到，说明扫的是别的东西，而不是"没人违规"。
    expect(importers.length).toBeGreaterThan(0)
    expect(
      importers.filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('scripts/')),
    ).toEqual([])
  })
})
