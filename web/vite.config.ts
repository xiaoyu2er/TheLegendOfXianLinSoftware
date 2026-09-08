import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对路径产物：dist/ 可以直接丢到任意静态托管的任意子目录下。
  base: './',
  build: {
    /**
     * **一个字节都不内联。** Vite 默认把小于 4096 字节的资产转成 base64 塞进
     * 引用它的 chunk。NPC 精灵有 369 帧，**每一帧都小于 4 KB**（实测 369/369），
     * 于是整批会连人带图进主 chunk。三次 `pnpm build` 实测的 index chunk：
     *
     *     xl-9bd.9 之前（主角 48 帧被内联）        642.24 kB / gzip 257.34 kB
     *     加上 369 帧 NPC，仍按默认内联         1,643.59 kB / gzip 856.54 kB
     *     加上 369 帧 NPC，本条改动之后           543.10 kB / gzip 160.41 kB
     *
     * 第三行比第一行还小 99 kB（gzip 97 kB）：主角那 48 帧原本也在主 chunk 里，
     * 现在一并出去了。
     *
     * 这跟 xl-9bd.15 那条"场景 JSON 按需加载"是同一件事的两面：素材要按场景
     * 取，内联就把"按需"变成了"开局全下"。它不会报错、也不会变慢一点点，
     * 只是首屏多下几百 KB —— 没有任何东西会响。
     */
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    /**
     * **一条用例允许跑多久。** vitest 的默认值是 5000ms，而本仓库最慢的那条
     * 用例在空闲机器上就已经接近它的五分之一 —— 于是机器一忙，它会**因为慢而
     * 变红**，和"实现错了"长得一模一样（xl-9c7）。
     *
     * 这个数不是拍的，是从三组实测推的（2026-09-07，openjdk 17 那台 mac）：
     *
     *     单独跑 viewport.test.ts，最慢的一条          696 ms
     *     全量 923 条一起跑，同一条                  1276 ms
     *     全量 + 一个跨端比对同时在跑，同一条   5266 / 6051 ms  ← 撞 5000 超时
     *
     * 最后那一行是 xl-rh9.12 跑篡改矩阵时真撞到的两次。它的坏处正是本仓库最
     * 在意的那一类：篡改验证读的是"这次篡改让几条判据变红"，多一条与篡改无关
     * 的红会高估影响面，下一次它恰好没超时又会低估。
     *
     * 30000 是**实测最慢那条（1276ms）的 23 倍、最坏观测（6051ms）的 5 倍**。
     * 定这么宽是故意的：超时该拦的是**真的挂住**（死循环、永不 resolve 的
     * promise），那种情况多等 25 秒不花什么钱；而"机器忙"不该由它来表态。
     *
     * 这一行没了会怎样，有判据看着：`src/test/testTimeout.test.ts` 读的是
     * **运行时生效的**那个值（`ctx.task.timeout`），不是这个文件的字面量。
     *
     * `hookTimeout` 保持默认的 10000，**不是漏了**：全套 923 条里只有一个
     * 钩子（`checkAssets.test.ts` 的 `afterAll`，一句 `rmSync`），没有任何
     * 实测支持去动它。哪天有了慢钩子，那是另一张票。
     */
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
