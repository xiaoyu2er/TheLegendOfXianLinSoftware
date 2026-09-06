import { describe, expect, it } from 'vitest'
import { EXPECTED, expectationOf, scriptNames } from './expected'

/**
 * 期望表本身的体检。跑得起来不需要 Java、不需要 Chrome，所以它在 CI 里，
 * 而整条比对流水线不在。
 */
describe('跨端比对的期望表', () => {
  it('磁盘上的每条剧本都表过态，表里也没有多余的条目', () => {
    // 分母从 tools/traces/scripts/ 现数，不写死数量：别人加一条剧本，
    // 这里会因为"它没表态"而红，而不是因为一个过期的数字。
    const onDisk = scriptNames()
    expect(onDisk.length).toBeGreaterThan(0)
    expect(Object.keys(EXPECTED).sort()).toEqual(onDisk)
  })

  it('每条 gap 都写清楚差在哪、归哪张票 —— 否则它就只是一句"先这样"', () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (e.status !== 'gap') continue
      expect(e.why, `${name} 的 gap 没写原因`).toBeTruthy()
      expect(e.issue, `${name} 的 gap 没挂 issue`).toMatch(/^xl-/)
    }
  })

  it('没表过态的剧本是硬失败，不是默认放行', () => {
    expect(() => expectationOf('还没有的剧本')).toThrow(/没有在/)
  })
})
