/**
 * 取图页按**驱动器判别名**装配（xl-1vu.2）。
 *
 * 真值头里的 `driver` 字段说这份 trace 是原版哪个面板导出来的（场景 = `scene`，
 * 战斗 = `battle`、菜单 = `menu`，商店还没接）。取图页据此决定装配哪一套：建什么世界、用哪个
 * 渲染器、叠哪些 DOM 层。没有这个字段之前，回放端只能假定"都是场景"——而假定
 * 错了的表现是画出一屏看着正常的东西，不是报错。
 *
 * 这个模块是**纯的**（不 import 渲染器、不碰 DOM），因为它唯一要保证的那件事
 * 必须能被单元测试直接验：**遇到未实现的驱动器要响亮失败并点名**。装配表由
 * 调用方给，这里不记名单 —— 记两份必然分家。
 */

/** 装不出来时抛的错。分出一个类型是为了让测试断言的是判据本身，不是一句文案。 */
export class UnknownDriverError extends Error {
  constructor(
    readonly driver: unknown,
    readonly implemented: readonly string[],
    message: string,
  ) {
    super(message)
    this.name = 'UnknownDriverError'
  }
}

/**
 * 按判别名从装配表里取一套。取不到 —— **抛**，并把是哪个驱动器点出来。
 *
 * 为什么不能容错（比如缺字段就当 `scene`、不认识就跳过这条剧本）：这条流水线
 * 判的是"两端画得一不一样"，而一份没被装配的剧本比出来的是**零帧差异**，
 * 长得和"完全一致"一模一样。本仓库最贵的那类教训就是这个形状。所以未实现的
 * 驱动器只有一种结局：整条流水线非零退出，并说出是哪个。
 *
 * @param driver 真值头里的 `driver` 字段，**不预设它是字符串**（老真值里根本没有）。
 * @param table  判别名 → 装配。名单的唯一来源。
 * @param where  出错时报给人看的上下文，一般是剧本名。
 */
export function pickAssembly<T>(
  driver: unknown,
  table: Readonly<Record<string, T>>,
  where: string,
): T {
  const implemented = Object.keys(table).sort()
  if (typeof driver !== 'string' || driver.length === 0) {
    throw new UnknownDriverError(
      driver,
      implemented,
      `${where}：真值没有报驱动器判别名（driver = ${JSON.stringify(driver)}）。` +
        `重导一遍真值 —— 装配哪一套不能靠猜。本页实现了：${implemented.join('、')}。`,
    )
  }
  const assembly = table[driver]
  if (assembly === undefined) {
    throw new UnknownDriverError(
      driver,
      implemented,
      `${where}：驱动器 ${driver} 在取图页还没有实现，装配不出来。` +
        `本页实现了：${implemented.join('、')}。`,
    )
  }
  return assembly
}
