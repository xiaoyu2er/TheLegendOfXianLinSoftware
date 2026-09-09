/**
 * 取图页**装配得出来**的驱动器判别名（xl-1vu.7）。
 *
 * 为什么要把这一行单独拿出来：判断"这条剧本现在能不能比"的有两方 —— 浏览器
 * 里的取图页（`replay/main.ts` 的 `ASSEMBLIES`）与跑在 Node 上的比对器
 * （`scripts/compare.ts`）。比对器要在**开浏览器之前**就知道哪些剧本注定装不
 * 起来，否则它只能一条一条撞上去，撞到第一条就整轮中断 —— 于是后面那些**能
 * 比**的场景剧本一帧都比不成，`--self-check` 也跟着不跑。实测过：默认全跑时
 * 第一条按字典序是 `battle-em3-box`，整条流水线在那里就停了。
 *
 * 名单只有这一份，两道守着它：
 *
 * - **常开的那道是类型**。`main.ts` 的装配表用
 *   `Record<ImplementedDriver, Assembly>` 声明，**少一个键或多一个键都是编译错**，
 *   `pnpm typecheck` 每次都过一遍。
 * - **另一道是运行时**：取图页把 `Object.keys(ASSEMBLIES)` 挂在
 *   `window.__xlDrivers` 上，比对器开了浏览器就核一次（`scripts/compare.ts`
 *   的 `assertPageAgrees`）。它**只在这一轮真的要取图时才跑** —— 一轮里全是
 *   装配不出来的剧本时压根不开浏览器（`tools/compare-frames.sh menu-equip`
 *   就是这种），那一轮里守着的只有上面那道类型。
 *
 * 一份"抄在两个地方的名单"迟早分家，而分家的表现是比对器安安静静地跳过一条
 * 剧本，那正是这条流水线最不能有的东西。
 *
 * **加一个驱动器要动的就是这里**：web 侧把那个面板做出来、在 `main.ts` 里加一
 * 套装配、把名字加进这个数组，然后 `web/src/compare/expected.ts` 里那条剧本的
 * `unassembled` 表态**必须**同时改成 `match` 或量出来的 `gap` —— 不改的话
 * `unassembled.ts` 的双向检查会红（"页面已经装得出来了，表却还说比不了"）。
 */
export const IMPLEMENTED_DRIVERS = ['scene', 'battle', 'menu', 'shop'] as const

export type ImplementedDriver = (typeof IMPLEMENTED_DRIVERS)[number]

export function isImplementedDriver(driver: string): driver is ImplementedDriver {
  return (IMPLEMENTED_DRIVERS as readonly string[]).includes(driver)
}
