import { readdirSync, readFileSync } from 'node:fs'
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
 * 这里不守它们「只有一份」—— 理由在 `mouseButtons.ts` 的模块注释里，只有那一份。
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
    // 分母是 `KEYS` 本身：撞一对，去重后就少一个。`bits.length === KEYS` 不必断言 —— 它由
    // `Array.from({ length: KEYS })` 按构造成立，一次都不可能红（/code-review 逮到的）。
    expect(new Set(bits).size, `${KEYS} 只键换出来的位有重复 —— 两只键会被当成同一只`).toBe(KEYS)
  })
})

/**
 * 每一处 DOM grab 都从这儿取换算，各自不再留副本。
 *
 * **分母是现扫的，不是手写的**（dispatch.md 纪律 3）：「一处 DOM grab」= 生产代码里
 * `window.addEventListener('mouseup', …)` 那一句 —— 按下之后把松手挂到 window 上，正是
 * Swing mouse grab 在这一层的对应物。第三块宿主哪天也这么干，它自动进这张表，而不是
 * 悄悄绕过一份手写名单。判定（该不该共享）仍然是人签的，写在 `mouseButtons.ts` 的注释里。
 *
 * 判据先立分母（真扫到了、每份都非空），再查缺失 —— 不然「一个文件都没扫到」与「没有副本」
 * 长得一模一样。
 */
describe('换算只有一份：每一处 DOM grab 都从 stage/mouseButtons.ts 取（xl-dnj）', () => {
  /** `web/src` 下的生产代码（跳过测试与生成物），与 `test/webPrimitives.test.ts` 同一个口径。 */
  const SRC = readdirSync(repoPath('web/src'), { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.|(?:^|\/)(?:test|generated|fakes)\//.test(f))
    .sort()
  const HOSTS = SRC.map((f) => ({ path: `web/src/${f}`, text: readFileSync(repoPath('web/src', f), 'utf8') })).filter(
    ({ text }) => /window\.addEventListener\(\s*'mouseup'/.test(text),
  )

  it('空转要响：真扫到了 DOM grab，每一处都读得出内容', () => {
    expect(SRC.length, 'web/src 一个生产文件都没扫到 —— 下面三条全成了「找不到即通过」').toBeGreaterThan(100)
    expect(HOSTS.length, '一处 DOM grab 都没扫到（正则死了？）').toBeGreaterThan(1)
    // 只问「读到内容了没有」。**不设字数下限** —— 一块小宿主是合法的，拿字数当门槛会把
    // 「新宿主进来了」误报成「文件读空了」（实测：塞一个 202 字节的第三块宿主，原先那句
    // `> 1000` 当场红，而它想守的根本不是这件事）。
    for (const { path, text } of HOSTS) {
      expect(text.length, `${path} 读空了 —— 下面两条对它就成了「找不到即通过」`).toBeGreaterThan(0)
    }
  })

  it('每一处都 import 了共用的 bitOf', () => {
    const missing = HOSTS.filter(({ text }) => !/import \{[^}]*\bbitOf\b[^}]*\} from '[^']*\/stage\/mouseButtons'/.test(text))
    expect(missing.map((s) => s.path), '这个文件握着 DOM grab，却没从共用模块取 bitOf').toEqual([])
  })

  /**
   * ⚠️ 三条正则都**不锚行首、不要求 `const`**：`/code-review` 的 Spec 轴逮到过 —— 原来写的
   * `/^const BUTTON_BITS\b/m` 只认顶格的那一种，`export const` 与缩进在组件里的副本照样漏过，
   * 正是「找不到即通过」的形状。
   */
  it('每一处都不再自己声明 BUTTON_BITS / bitOf —— 再出现一份就是 Shotgun Surgery', () => {
    const offenders = HOSTS.flatMap(({ path, text }) =>
      [
        /\bBUTTON_BITS\s*(?::[^=\n]*)?=/.test(text) ? `${path} 又声明了自己的 BUTTON_BITS` : null,
        /\bbitOf\s*(?::[^=\n]*)?=/.test(text) ? `${path} 又声明了自己的 bitOf` : null,
        /\[\s*1\s*,\s*4\s*,\s*2\s*,\s*8\s*,\s*16\s*\]/.test(text) ? `${path} 里又出现了 [1, 4, 2, 8, 16] 这张表` : null,
      ].filter((m) => m !== null),
    )
    expect(offenders).toEqual([])
  })
})
