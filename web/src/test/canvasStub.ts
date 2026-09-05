/**
 * 一个只记账、不画画的 2D context。
 *
 * 它不验证画出来的像素（那是 xl-9bd 的逐帧比对要干的事），只保证绘制代码
 * **真的被跑过一遍** —— 语法错误、读空对象、非法参数都会在这里炸出来。
 */
export interface StubContext {
  calls: Array<{ method: string; args: unknown[] }>
}

const NOOP_METHODS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo',
  'lineTo', 'arc', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate',
  'scale', 'rotate', 'fillText', 'strokeText', 'drawImage', 'setTransform',
  'clip', 'setLineDash', 'createLinearGradient', 'measureText',
] as const

export function createStubContext(): CanvasRenderingContext2D & StubContext {
  const calls: StubContext['calls'] = []
  const ctx: Record<string, unknown> = { calls }
  for (const method of NOOP_METHODS) {
    ctx[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      if (method === 'measureText') return { width: 0 }
      return undefined
    }
  }
  return ctx as unknown as CanvasRenderingContext2D & StubContext
}

export function installCanvasStub(): void {
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    return contextId === '2d' ? createStubContext() : null
  } as HTMLCanvasElement['getContext']
}
