import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { JavaRandom } from './javaRandom'

/**
 * 黄金测试：手写的 {@link JavaRandom} 与**真的** `java.util.Random` 逐位相同。
 *
 * 期望值不是这里写的，是 `tools/export-random.sh` 从 JDK 自己的
 * `java.util.Random` 导出来的（`tools/src/devtools/ExportRandom.java`），
 * 所以不是自己出题自己判卷。
 *
 * 判据要挡住三种"看起来通过"：
 *
 * 1. **黄金数据读不到 / 是空的**。文件缺了 `readFileSync` 会抛（红）；文件被改成
 *    `{}` 或 `{"seeds":[]}` 则由「必须覆盖的种子」那条挡着 —— 它的分母是从
 *    `tools/traces/scripts/` 数出来的，不是写死的常量，所以空文件必红。
 * 2. **只对十进制、没对位模式**。`doubles` 与 `doubleBits` 都比，后者是 IEEE-754
 *    的原始位，"逐位相同"是字面意义上验过的。
 * 3. **用 Number 硬算 48 位状态**。83 位乘法丢精度时前几个值可能还是对的，
 *    所以逐次比对 `state`，并且有一个种子的起始状态就是 48 个 1。
 */

type SeedEntry = {
  seed: number
  note: string
  doubles: number[]
  doubleBits: string[]
  states: string[]
  ints: Record<string, number[]>
}
type Golden = {
  doubleCount: number
  intCount: number
  intBounds: number[]
  seeds: SeedEntry[]
}

const GOLDEN_PATH = 'tools/random-golden/java-random.json'
const golden = JSON.parse(readFileSync(repoPath(GOLDEN_PATH), 'utf8')) as Golden

/** double 的 IEEE-754 位模式，与 Java 的 `Long.toHexString(doubleToRawLongBits(d))` 同形。 */
const bitsOf = (d: number): string => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, d)
  return `0x${view.getBigUint64(0).toString(16)}`
}

/**
 * 行为真值的剧本里声明过的每一个种子。
 *
 * 名单**从剧本目录推导**，不抄：新加一份带种子的剧本却忘了重跑
 * `tools/export-random.sh`，这里就会红，而不是安静地少覆盖一个种子。
 */
const seedsUsedByTraceScripts = (): { seed: number; where: string }[] => {
  const dir = repoPath('tools/traces/scripts')
  const out: { seed: number; where: string }[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const name = file.replace(/\.json$/, '')
    const script = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as {
      seed?: number
      setup?: { seed?: number }
    }
    if (typeof script.seed === 'number') out.push({ seed: script.seed, where: name })
    if (typeof script.setup?.seed === 'number')
      out.push({ seed: script.setup.seed, where: `${name}.setup` })
  }
  return out
}

const TRACE_SEEDS = seedsUsedByTraceScripts()

describe('JavaRandom 对 java.util.Random 的黄金数据', () => {
  it('黄金数据覆盖每一份剧本用的种子，外加 0 这个边界', () => {
    // 分母是数出来的：剧本目录里有几个种子就要求几个。空的黄金数据在这里必红。
    expect(TRACE_SEEDS.length).toBeGreaterThan(0)
    const covered = new Set(golden.seeds.map((s) => s.seed))
    for (const { seed, where } of TRACE_SEEDS) {
      expect(covered, `剧本 ${where} 的种子 ${seed} 没有黄金数据`).toContain(seed)
    }
    expect(covered).toContain(0)
    // 每个种子的取值都得是满的，长度不许是 0 —— 否则下面的逐个对会一次都不跑。
    expect(golden.doubleCount).toBeGreaterThan(0)
    expect(golden.intCount).toBeGreaterThan(0)
    expect(golden.intBounds.length).toBeGreaterThan(0)
    for (const s of golden.seeds) {
      expect(s.doubles).toHaveLength(golden.doubleCount)
      expect(s.doubleBits).toHaveLength(golden.doubleCount)
      expect(s.states).toHaveLength(golden.doubleCount + 1)
      expect(Object.keys(s.ints).sort()).toEqual(golden.intBounds.map(String).sort())
    }
  })

  it.each(golden.seeds.map((s) => [s.seed, s.note, s] as const))(
    '种子 %d（%s）：nextDouble 的值、位模式与 48 位状态逐个相同',
    (_seed, _note, entry) => {
      const rng = new JavaRandom(entry.seed)
      expect(`0x${rng.state.toString(16)}`).toBe(entry.states[0])
      for (let i = 0; i < entry.doubles.length; i++) {
        const d = rng.nextDouble()
        expect(d, `第 ${i} 个 nextDouble`).toBe(entry.doubles[i])
        expect(bitsOf(d), `第 ${i} 个 nextDouble 的位模式`).toBe(entry.doubleBits[i])
        expect(`0x${rng.state.toString(16)}`, `第 ${i} 次取值后的内部状态`).toBe(
          entry.states[i + 1],
        )
      }
    },
  )

  it.each(golden.seeds.map((s) => [s.seed, s] as const))(
    '种子 %d：每个上界的 (int)(Math.random()*N) 逐个相同',
    (_seed, entry) => {
      for (const bound of golden.intBounds) {
        const expected = entry.ints[String(bound)]
        expect(expected, `上界 ${bound} 没有黄金数据`).toBeDefined()
        // 每个上界各起一条新流 —— 与导出器同一个写法，不共用上面那条。
        const rng = new JavaRandom(entry.seed)
        const got = Array.from({ length: golden.intCount }, () => rng.scaledInt(bound))
        expect(got, `上界 ${bound}`).toEqual(expected)
      }
    },
  )
})

describe('48 位回绕', () => {
  /** 播种后状态是 48 个 1 的那个种子，由导出器构造：`mask ^ multiplier`。 */
  const ALL_ONES = golden.seeds.find((s) => s.states[0] === '0xffffffffffff')

  it('黄金数据里有一个种子的起始状态就是 48 个 1', () => {
    expect(ALL_ONES, '导出器该构造这个边界种子').toBeDefined()
  })

  it('第一次推进就跨过 48 位：83 位的乘积截回 48 位', () => {
    const entry = ALL_ONES
    if (!entry) throw new Error('缺少起始状态为 48 个 1 的种子')
    const rng = new JavaRandom(entry.seed)
    const before = rng.state
    rng.nextDouble()
    // 未截断的乘积确实超出 48 位（否则这条测的就不是回绕）。
    const untruncated = before * 0x5deece66dn + 0xbn
    expect(untruncated).toBeGreaterThan((1n << 48n) - 1n)
    expect(`0x${rng.state.toString(16)}`).toBe(entry.states[1])
  })

  it('连续取值走遍 48 位的高低两端', () => {
    // 只测一个状态无法区分"算对了"和"高位一直是 0"。要求上面逐个比过的那批状态
    // 里既有最高位为 1 的，也有最高 6 位全 0 的 —— 两端都比过，宽度才算覆盖到。
    // 两个阈值是实测出来的，不是估的：六个种子的状态最小值落在 2^34～2^41。
    for (const entry of golden.seeds) {
      const states = entry.states.map((s) => BigInt(s))
      expect(states.some((s) => s >= 1n << 47n), `种子 ${entry.seed} 没有最高位为 1 的状态`).toBe(
        true,
      )
      expect(states.some((s) => s < 1n << 42n), `种子 ${entry.seed} 没有最高 6 位全 0 的状态`).toBe(
        true,
      )
    }
  })
})
