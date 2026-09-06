import { getScene } from '../src/data/scenes'
import { advance, createTicker } from '../src/state/loop'
import { createWorld } from '../src/state/step'
import type { InputEvent } from '../src/state/types'

/**
 * 量 Web 侧的时间加速到底线不线性 —— 拿真实的墙钟量。
 *
 * `src/state/loop.test.ts` 已经证明了加速在**算术上**严格线性（k× 跑 T 毫秒
 * 与 1× 跑 k·T 毫秒得到逐字段相同的世界）。这里量的是另一件事：真的按真实时钟
 * 驱动起来，倍率还成不成立。两者会分开的地方是驱动器本身 —— 每个 tick 都要
 * 真的算一遍 `step()`，倍率越大、同样一段真实时间里要算的 tick 越多，
 * 算不过来时倍率就会**悄悄封顶**。封顶了游戏只是"跑得没那么快"，不报错。
 *
 * 判据：实测倍率与设定倍率的相对偏差不超过 `MAX_DEVIATION`，否则非零退出。
 * 分母是倍率的条数，开跑前就数得出来。
 */

const FACTORS = [1, 2, 5, 10]
const REAL_MS = 400
const MAX_DEVIATION = 0.2
const TICK_INTERVAL_MS = 10

const scene = getScene('宿舍')
const walkRight: InputEvent[] = [{ e: 'press', k: 'right', ctrl: false }]

function measure(scale: number): Promise<{ scale: number; realMs: number; gameMs: number }> {
  return new Promise((resolve) => {
    let ticker = createTicker(createWorld(scene), scale)
    let last = performance.now()
    const started = last
    let first = true
    const id = setInterval(() => {
      const now = performance.now()
      ticker = advance(ticker, first ? walkRight : [], now - last)
      first = false
      last = now
      if (now - started >= REAL_MS) {
        clearInterval(id)
        resolve({ scale, realMs: now - started, gameMs: ticker.world.timeMs })
      }
    }, TICK_INTERVAL_MS)
  })
}

const rows = []
for (const f of FACTORS) rows.push(await measure(f))

process.stdout.write(`Web 侧（state/loop.ts 的推进器，每个倍率量 ${REAL_MS} 真实毫秒）\n`)
let worst = 0
for (const r of rows) {
  const measured = r.gameMs / r.realMs
  const deviation = Math.abs(measured - r.scale) / r.scale
  worst = Math.max(worst, deviation)
  process.stdout.write(
    `  scale=${String(r.scale).padEnd(5)} 真实 ${r.realMs.toFixed(1).padStart(7)} ms  ` +
      `游戏 ${r.gameMs.toString().padStart(6)} ms  实测倍率 ${measured.toFixed(2).padStart(5)}×  ` +
      `偏差 ${(deviation * 100).toFixed(1)}%\n`,
  )
}
if (worst > MAX_DEVIATION) {
  process.stderr.write(
    `\n${FACTORS.length} 个倍率里最大偏差 ${(worst * 100).toFixed(1)}%，超过 ${MAX_DEVIATION * 100}% —— 加速不再线性。\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `  ${FACTORS.length}/${FACTORS.length} 个倍率的偏差都在 ${MAX_DEVIATION * 100}% 以内（最大 ${(worst * 100).toFixed(1)}%）。\n`,
)
