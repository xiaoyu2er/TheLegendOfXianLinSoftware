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
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
