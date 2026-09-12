import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'

/**
 * 页面标题 == 原版窗口标题（xl-03x.20）。
 *
 * 原版 `GameLauncher` 构造时 `setTitle("仙林奇侠传")`；web 的 `<title>` 在脚手架那一版
 * （xl-9bd.1）写成了「仙林软件奇侠传」，没有任何一处说过为什么 —— 现扫原版的 `setTitle`
 * 调用点时才被看见。两边都从源头现读，不在这里手抄那个字符串：手抄的话，这条判据等于
 * 拿 index.html 跟一份它自己的副本比。
 */
describe('页面标题', () => {
  it('与原版 GameLauncher.setTitle 的参数逐字相同', () => {
    const titles = [...javaSource('src/main/GameLauncher.java').matchAll(/setTitle\("([^"]*)"\)/g)].map((m) => m[1])
    // 零处与「标题是空串」在下一条断言里长得不一样，但两处的话就不知道该比哪一个。
    expect(titles, 'GameLauncher.java 里 setTitle 应当恰好一处').toHaveLength(1)
    const page = /<title>([^<]*)<\/title>/.exec(readFileSync(repoPath('web/index.html'), 'utf8'))?.[1]
    expect(page).toBe(titles[0])
  })
})
