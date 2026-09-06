import '@testing-library/jest-dom/vitest'
import { installCanvasStub } from './canvasStub'

// jsdom 没有 canvas 实现，`getContext('2d')` 会返回 null 并往 stderr 打一条
// "Not implemented"。放着不管有两个坏处：真正的报错淹没在噪音里，而且所有
// 绘制代码在测试里从不执行 —— 里面写错什么都不会被发现。
installCanvasStub()

/**
 * jsdom 也没有 `HTMLMediaElement` 的实现：`play()` / `pause()` 会往 stderr 打
 * "Not implemented"，而背景音乐播放器（`audio/bgmPlayer.ts`）在游戏循环里
 * 每换一次场景就调一次。噪音本身是次要的，主要是它会把真正的报错淹掉。
 *
 * 桩只做到"不抛、不出声"为止：播放器**能不能放**由它自己的单元测试拿一个
 * 假的播放对象验（那里连断言都是逐次操作的），这里不替它表态。
 */
Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: () => Promise.resolve(),
})
Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: () => undefined,
})
