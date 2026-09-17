import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { BUTTON_BITS, bitOf } from './mouseButtons'

/**
 * `MouseEvent.button` → `buttons` 的换算，以及「它只有一份」这件事（xl-dnj）。
 *
 * 这张表与 `bitOf` 原先在 `app/App.tsx` 与 `start/StartPanel.tsx` 里各有一份字面量副本，
 * 而两边的 `bitOf` 兜底还不一样（`1 << button` vs `?? 0`）—— 下半个 describe 守的就是
 * 「别再变回两份」。
 *
 * ⚠️ 位图那一半（`grabRelease` 的 `taken` / `StartPanelView` 的 `takenRef`）**本来就是两份**，
 * 生命周期不同，这里不守它们「只有一份」，理由写在 `mouseButtons.ts` 的模块注释里。
 */
describe('鼠标按键位换算（xl-dnj）', () => {
  /** DOM 规范里 `buttons` 定死的五位：左 1、中 4、右 2、后退 8、前进 16。中键与右键是反着的。 */
  it('前五只键按 DOM 规范换算 —— 中键 4、右键 2，不是顺着来的', () => {
    expect(BUTTON_BITS).toEqual([1, 4, 2, 8, 16])
    expect([0, 1, 2, 3, 4].map((button) => bitOf({ button }))).toEqual([1, 4, 2, 8, 16])
  })

  /**
   * `bitOf` 的兜底那一半。判据不是「等于 1 << button」（那是照抄实现），而是位图真正**靠**的两条
   * 性质：每只键都拿到**非零**的一位，且**两两不撞**。`?? 0` 那种写法两条一起破。
   */
  it('第 6 只键往后：每只都拿到非零的一位，且与前五只、彼此都不撞', () => {
    const KEYS = 16
    const bits = Array.from({ length: KEYS }, (_, button) => bitOf({ button }))
    expect(bits.filter((b) => b === 0), '有键换出了 0 —— 它的按下记不进位图，松手就配不上').toEqual([])
    // 分母是 `KEYS` 本身：撞一对，去重后就少一个。
    expect(new Set(bits).size, `${KEYS} 只键换出来的位有重复 —— 两只键会被当成同一只`).toBe(KEYS)
    expect(bits.length, '上一条的分母塌了').toBe(KEYS)
  })
})

/**
 * 两处 grab 都从这儿取换算，各自不再留副本。
 *
 * 判据先立分母（两个文件都真读到了、都非空），再查缺失 —— 不然「文件读空了」与「没有副本」
 * 长得一模一样。
 */
describe('换算只有一份：两处 grab 都从 stage/mouseButtons.ts 取（xl-dnj）', () => {
  const HOSTS = ['web/src/app/App.tsx', 'web/src/start/StartPanel.tsx'] as const
  const SOURCES = HOSTS.map((path) => ({ path, text: readFileSync(repoPath(path), 'utf8') }))

  it('空转要响：两个文件都读得出来，而且都真在讲 grab', () => {
    expect(SOURCES.map((s) => s.path)).toEqual([...HOSTS])
    for (const { path, text } of SOURCES) {
      expect(text.length, `${path} 读空了 —— 下面两条就成了「找不到即通过」`).toBeGreaterThan(1000)
      expect(text, `${path} 里没有 grab 那一段了，这个 describe 该改`).toContain('grabRef')
    }
  })

  it('两边都 import 了共用的 bitOf', () => {
    const missing = SOURCES.filter(({ text }) => !/import \{[^}]*\bbitOf\b[^}]*\} from '\.\.\/stage\/mouseButtons'/.test(text))
    expect(missing.map((s) => s.path), '这个文件没从共用模块取 bitOf').toEqual([])
  })

  it('两边都不再自己声明 BUTTON_BITS / bitOf —— 再出现一份就是 Shotgun Surgery', () => {
    const offenders = SOURCES.flatMap(({ path, text }) =>
      [
        /^const BUTTON_BITS\b/m.test(text) ? `${path} 又声明了自己的 BUTTON_BITS` : null,
        /^const bitOf\b/m.test(text) ? `${path} 又声明了自己的 bitOf` : null,
        /\[\s*1\s*,\s*4\s*,\s*2\s*,\s*8\s*,\s*16\s*\]/.test(text) ? `${path} 里又出现了 [1, 4, 2, 8, 16] 这张表` : null,
      ].filter((m) => m !== null),
    )
    expect(offenders).toEqual([])
  })
})
