import { STAGE_HEIGHT, STAGE_WIDTH } from './constants'

/**
 * 占位画面。真正的场景渲染在 xl-9bd.3 接进来，在那之前舞台需要画点东西，
 * 让"等比缩放 / 居中 / 平滑与锐利"这几件事**用眼睛就能判定对不对**：
 *
 * - 边框贴着 1024×640 的四条边 —— 少一条就是尺寸算错了
 * - 正方形网格 —— 长宽比变了会立刻变成长方形
 * - 1 像素棋盘格 —— 平滑放大糊成灰块，锐利放大是清楚的黑白格
 */
export function drawPlaceholder(ctx: CanvasRenderingContext2D): void {
  const w = STAGE_WIDTH
  const h = STAGE_HEIGHT

  ctx.clearRect(0, 0, w, h)

  ctx.fillStyle = '#141018'
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = '#2c2536'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 32; x < w; x += 32) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, h)
  }
  for (let y = 32; y < h; y += 32) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()

  ctx.strokeStyle = '#c8a45c'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2 - 24)
  ctx.lineTo(w / 2, h / 2 + 24)
  ctx.moveTo(w / 2 - 24, h / 2)
  ctx.lineTo(w / 2 + 24, h / 2)
  ctx.stroke()

  // 1 像素棋盘格：两种插值方式下长得完全不一样。
  const patch = 64
  const px = w / 2 - patch / 2
  const py = h / 2 + 64
  ctx.fillStyle = '#0b0910'
  ctx.fillRect(px, py, patch, patch)
  ctx.fillStyle = '#efe6d2'
  for (let y = 0; y < patch; y += 1) {
    for (let x = (y % 2); x < patch; x += 2) {
      ctx.fillRect(px + x, py + y, 1, 1)
    }
  }

  ctx.fillStyle = '#efe6d2'
  ctx.textAlign = 'center'
  ctx.font = '600 28px system-ui, sans-serif'
  ctx.fillText('仙林软件奇侠传', w / 2, h / 2 - 48)
  ctx.font = '16px ui-monospace, monospace'
  ctx.fillStyle = '#8e839f'
  ctx.fillText(`逻辑画布 ${w} × ${h}`, w / 2, h / 2 - 20)
}
