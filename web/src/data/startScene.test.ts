import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { SCENE_NAMES, START_SCENE } from './scenes'

/**
 * `START_SCENE` 的依据是原版「新游戏」那条路径，不是谁记得的场景名。
 *
 * 这条判据从 Java 源码现场抽出 `initiation("…")` 的参数来做分母 —— 原来
 * 没有任何测试守着这个常量的**取值**（`SCENE_NAMES` 只管它存不存在，
 * `App.test` 拿它自己当期望值），于是 `宿舍` 这个错值绿了一路。
 *
 * 源文件是 GBK，所以从 `javaSource()` 读（它显式按 GBK 解码）：按 UTF-8 读会把
 * 中文场景名读成乱码，正则匹配不到，测试红 —— 这正是我们要的失败样子，而不是
 * 「找不到就通过」。
 */
const START_PANEL = 'src/start/StartPanel.java'

describe('起手场景', () => {
  it(`就是 ${START_PANEL} 里 initiation() 传的那个脚本`, () => {
    const source = javaSource(START_PANEL)
    const calls = [...source.matchAll(/scenePanel\.initiation\("([^"]+)"\)/g)].map((m) => m[1])

    // 分母：原版只有这一处进场调用。多出一处就说明有别的入口，得重新想。
    expect(calls).toEqual([`${START_SCENE}.txt`])
  })

  it('起手场景已经烘焙过', () => {
    expect(SCENE_NAMES).toContain(START_SCENE)
  })
})
