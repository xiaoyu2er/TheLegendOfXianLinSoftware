import '@testing-library/jest-dom/vitest'
import { installCanvasStub } from './canvasStub'

// jsdom 没有 canvas 实现，`getContext('2d')` 会返回 null 并往 stderr 打一条
// "Not implemented"。放着不管有两个坏处：真正的报错淹没在噪音里，而且所有
// 绘制代码在测试里从不执行 —— 里面写错什么都不会被发现。
installCanvasStub()
