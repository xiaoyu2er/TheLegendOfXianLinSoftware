/**
 * 位精确复刻 `java.util.Random`。
 *
 * 原版战斗里到处是随机 —— 伤害是 `基础 - 防御 + (int)(Math.random()*15)`，
 * 敌人选招是 `(int)(Math.random()*技能数)+1`，选目标是一个会消耗**不定次数**
 * 随机数的拒绝采样循环。行为真值靠给 Java 那个全局 `Random` 播种来保证确定性，
 * 用的就是规范里写死的 48 位 LCG，所以 web 端必须有一份逐位相同的同款。
 * 理由见 `docs/adr/0004-bit-exact-java-random.md`。
 *
 * 判据是 `tools/random-golden/java-random.json`（由 `tools/export-random.sh`
 * 从真的 `java.util.Random` 导出），对法见 `javaRandom.test.ts`。
 *
 * ## 两条容易踩的
 *
 * **不要用 `Math.random()`。** 它是浏览器自己的 xorshift128+，与这里毫无关系；
 * 战斗里一处漏用就会让整条序列错位，而错位的表现是"某一拍之后全线崩"，
 * 不是"某个数字偏了一点"。
 *
 * **不要加 `nextInt(bound)`。** 原版一次都没调过它。原版要整数时写的是
 * `(int)(Math.random()*N)` —— 乘完截尾；而 `Random.nextInt(N)` 是带拒绝采样的
 * 另一个算法，消耗的随机数个数都不一样。这里对应的方法叫
 * {@link JavaRandom.scaledInt}，名字刻意不叫 `nextInt`。
 *
 * ## 调用顺序也是规格
 *
 * 只有数值对是不够的：**取随机数的调用顺序要与原版逐字一致**，多取一次或少取
 * 一次整条序列就错位。所以一场战斗应当共用**一个**实例（原版共用的是
 * `Math.random()` 背后那唯一一个全局 `Random`），而不是各处各起一条流。
 */

const MULTIPLIER = 0x5deece66dn
const ADDEND = 0xbn
/** 48 位掩码。LCG 的状态就是 48 位，`java.util.Random` 的类注释写死了这三个常量。 */
const MASK = (1n << 48n) - 1n

export class JavaRandom {
  #state: bigint

  constructor(seed: number | bigint) {
    this.#state = scramble(seed)
  }

  /** 与 `Random.setSeed(long)` 相同：重新播种，等价于新建一个实例。 */
  setSeed(seed: number | bigint): void {
    this.#state = scramble(seed)
  }

  /**
   * 48 位内部状态，只读。
   *
   * 暴露它是为了让"跨 48 位回绕"这条边界有判据可对 —— JS 没有 64 位整数，
   * 48 位状态乘 35 位乘数是 83 位，用 `Number` 硬算会在这里悄悄丢精度，
   * 而丢了精度的序列**前几个值可能还是对的**，只看输出的测试抓不住。
   */
  get state(): bigint {
    return this.#state
  }

  /**
   * 与 `Random.next(int)` 相同：推进一次状态，取高 `bits` 位，按有符号 32 位整数返回。
   */
  next(bits: number): number {
    this.#state = (this.#state * MULTIPLIER + ADDEND) & MASK
    return Number(BigInt.asIntN(32, this.#state >> BigInt(48 - bits)))
  }

  /**
   * 与 `Random.nextDouble()` 相同，也就是 `Math.random()` 的实现：
   * `(((long) next(26) << 27) + next(27)) * 2^-53`。
   *
   * 一次调用推进**两次**状态 —— 这就是"少取一次就错位"的来源。
   */
  nextDouble(): number {
    const hi = BigInt(this.next(26))
    const lo = BigInt(this.next(27))
    // 和不超过 53 位，转 Number 无损。
    return Number((hi << 27n) + lo) * 2 ** -53
  }

  /**
   * 原版 `(int)(Math.random() * bound)`：取一个小数、乘上界、**向零截尾**。
   *
   * 刻意不叫 `nextInt` —— 见本文件顶上那条。`bound` 为 0 时原版会得到 0，
   * 这里照样得到 0（且照样消耗一个随机数），不做任何"贴心"的校验。
   */
  scaledInt(bound: number): number {
    return Math.trunc(this.nextDouble() * bound)
  }
}

function scramble(seed: number | bigint): bigint {
  return (BigInt(seed) ^ MULTIPLIER) & MASK
}
