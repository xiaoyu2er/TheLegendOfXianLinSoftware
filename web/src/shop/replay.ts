import { SHOP_KINDS } from './layout'
import type { ShopKind } from './layout'
import { createShopWorld } from './world'
import type { ShopConfig } from './world'
import type { ShopInput } from './step'
import type { ShopWorld } from './types'

/**
 * 照真值头部的**剧本回显**（`script.setup`）把商店世界建出来。
 * **只读 `setup`，一个状态字段都不从真值里读。**
 *
 * 为什么单开一个文件而不留在 `./trace.ts` 里：那个模块转手 `state/trace.ts`
 * 的 `node:fs`，进不了浏览器包，而取图页（`replay/main.ts`）将来要在浏览器
 * 里把同一件事做一遍（xl-knp.10）。这个文件是**纯的** —— 不碰 `node:fs`
 * 也不碰 DOM，于是 Node 上的 `shopTrace.test.ts` 与浏览器里的取图页读的是
 * 同一份实现。抄两份的表现是两端各自建出一个世界、逐帧比对却比得挺像，
 * 那是这条流水线最不能有的形状。
 */
export function replayShopSetup(setup: ShopConfig): ShopWorld {
  // ⚠️ **五个字段是挑出来的，不是把 `setup` 整个转手**（与 `menu/replay.ts`
  // 同一个规矩）：整个转手的话，哪天剧本多写一个状态字段，这里会悄悄把它
  // 接上，而那正是这一层唯一要挡住的事。
  return createShopWorld({
    party: setup.party,
    coins: setup.coins,
    seed: setup.seed,
    drugs: setup.drugs,
    equipment: setup.equipment,
  })
}

/** 剧本里的一条指令 —— 这里只关心 `op` 与 `open` 那个 `name`。 */
export interface ShopScriptStep {
  readonly op: string
  readonly name?: string
}

/** 真值一行里回放要用的那两列（都在 `NON_STATE_COLUMNS` 里）。 */
export interface ShopReplayTick {
  readonly ip: number
  readonly input: readonly ShopInput[]
}

/**
 * 把真值的 `input` 那一列还原成喂给状态层的输入。
 *
 * **一步一组，逐步同序**，其中只有一种要还原：`open`。原版进店走的是场景里的
 * 选择事件（`GameLauncher.switchTo`），面板收不到任何鼠标事件，所以那一步的
 * `input` 是**空数组** —— 真值里"换了一家店"这件事只体现在 `shop` 那一列上，
 * 而那是状态，喂进去等于让真值给自己打分。
 *
 * 所以这里从**剧本**（回显）把它取回来：那一步的 `ip` 指着剧本第几条指令，
 * 那条指令的 `op` 与 `name` 就是答案。
 *
 * 两个方向都核一遍，因为**认错了的样子和认对了长得一样**：
 *
 * - 空输入的那一步，它的指令必须真是 `open`（否则是某条指令一个事件都没
 *   派发出去，那是导出器坏了，不该被这里当成一次换店悄悄吞掉）；
 * - 非空输入的那一步，它的指令**不许**是 `open`（否则换店被漏掉了，而漏掉
 *   之后剩下的事件照样能跑完，只是全派给了另一家店）。
 */
export function shopInputsOfTicks(
  steps: readonly ShopScriptStep[],
  ticks: readonly ShopReplayTick[],
): ShopInput[][] {
  return ticks.map((tick, t) => {
    const step = steps[tick.ip]
    if (!step) {
      throw new Error(`第 ${t} 步的 ip=${tick.ip} 指向剧本第 ${tick.ip} 条，而剧本只有 ${steps.length} 条`)
    }
    if (tick.input.length > 0) {
      if (step.op === 'open') {
        throw new Error(`第 ${t} 步是 open，却带了 ${tick.input.length} 个输入事件`)
      }
      return [...tick.input]
    }
    if (step.op !== 'open') {
      throw new Error(
        `第 ${t} 步一个输入事件都没有，而它对应的剧本指令是 ${step.op} 不是 open —— ` +
          `导出器那边有一条指令什么都没派发`,
      )
    }
    return [{ e: 'open', shop: shopKindOf(step.name) }]
  })
}

function shopKindOf(name: string | undefined): ShopKind {
  const kind = SHOP_KINDS.find((k) => k === name)
  if (!kind) throw new Error(`open 的 name 是 ${String(name)}，只认 ${SHOP_KINDS.join(' / ')}`)
  return kind
}
