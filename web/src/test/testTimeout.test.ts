import { describe, expect, it } from 'vitest'

/**
 * 「一条用例允许跑多久」这件事本身的判据（xl-9c7）。
 *
 * 起因：`scene/viewport.test.ts` 那条逐拍断言空闲时 696ms、全量并跑 1276ms，
 * 而 vitest 的默认 `testTimeout` 是 **5000ms**。机器一忙（实测 5266 / 6051ms）
 * 它就超时变红 —— 而**因为慢而红，和因为算错而红长得一模一样**。篡改验证读的
 * 是「这次篡改让几条判据变红」，多一条无关的红会高估影响面。
 *
 * 所以配置里把它放宽到了 30000。这个文件守的就是「放宽这件事还在」。
 *
 * **它读的是运行时生效的值，不是 `vite.config.ts` 的字面量**：
 * `ctx.task.timeout` 是 vitest 自己算完各级默认与覆盖之后交给这条用例的那个
 * 数。配置里那一行被删掉，这里立刻读到 5000（实测过：加这行之前探针读的正是
 * 5000），而不是「文件里那个常量还在，所以绿」。
 *
 * **下面这个 30000 是手写的，故意不从 `vite.config.ts` import。** 两个数各写
 * 一处才叫对撞：共用一个常量的话，把它从 30000 改成 1000 会让配置和判据一起
 * 降下去，测试照样全绿 —— 那正是 `docs/agents/dispatch.md` 纪律 3 记的那种
 * 「造出一个恒真判据」。这里的分工是：配置那一行是**设置**，这里这个数是
 * **签下的政策**（「任何一条正确的用例都不该需要超过这么久」）。
 */
describe('用例超时', () => {
  /** 手写的下限，见上面为什么不 import。 */
  const FLOOR_MS = 30_000

  it('生效的 testTimeout 至少有 30 秒，而不是 vitest 默认的 5 秒', (ctx) => {
    expect(ctx.task.timeout).toBeGreaterThanOrEqual(FLOOR_MS)
  })

  /**
   * 上面那条靠 `ctx.task.timeout` 说话，所以得先证明这个读数**会动**。
   * 它要是哪天变成 `undefined` 或者恒返回全局值，上面那条就成了摆设 ——
   * 而摆设和判据长得一样。这里给一条用例单独传一个第三参数，读回来必须
   * 正好是它，且**不等于**全局那个。
   */
  it('这个读数确实是逐条生效的，不是一个读不出变化的常量', (ctx) => {
    expect(ctx.task.timeout).toBe(1234)
    expect(ctx.task.timeout).toBeLessThan(FLOOR_MS)
  }, 1234)
})
