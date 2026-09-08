/**
 * 从原版 GBK 源码里读一个 `public static int <字段> = <数>;` 的初值。
 *
 * 这件事本来在**四处**各写一遍、且写法各不相同（`match` 一次 / `matchAll`
 * 两次 / `new RegExp` 拼字段名一次，三种对「抓不到」的反应也不一样）。抽到
 * 这里之后**所有调用点共用同一条正则和同一套失败判据**，而这个函数自己有
 * `javaStaticInt.test.ts` 守着。
 *
 * ⚠️ **那个「四处」是怎么数出来的，写在这里，因为重数一次会踩同一个坑。**
 * 字面量 grep（`grep -rn 'public\\s+static\\s+int' web/src`）只得到 3 处 ——
 * `fakes/originalNewGame.test.ts` 那一处是模板字符串拼出来的，字面量匹配不到，
 * **而漏掉的那一处和「不存在」长得一模一样**。可靠的量法是先 `grep -rn 'static'
 * web/src --include='*.ts'` 拿一份宽的候选再逐条看。（票面转抄的「三处」也少了
 * 一处：`fakes/party.test.ts` 里是 `level` 与 `exp` 两处，不是一处。）
 *
 * 数出来但**故意不收**的一处：`assets/backgroundAnimCrop.test.ts` 里的
 * `static final int (WIDTH|HEIGHT)\s*=\s*([^;]+);`。三道都对不上 —— 它没有
 * `public`、字段名是个选择集（这里只吃单个标识符）、值是**表达式**（`32*32`）
 * 而不是十进制字面量。那条用例要的正是「照抄表达式再自己算」，收进来会把它
 * 弄丢。它要是哪天也想用这个 helper，得先决定表达式怎么求值，那是另一张票。
 *
 * ⚠️ 这里**只抛不返空**，是刻意的。原先那几处里有的只 `not.toBeNull()`、
 * 有的 `toHaveLength(1)`，而最容易出的错是「解析器空转」：源码没按 GBK 解出来
 * （满屏乱码）、字段被改了名、初值被挪去了构造函数 —— 三种情况下匹配数都是
 * **0**，与「这一行不存在」长得一模一样，而 0 条结果喂给 `toEqual([])` 之类的
 * 断言恰好是绿的。所以零匹配在这里是硬失败，不是一个空数组。
 *
 * 同样地，**两处以上也是硬失败**：那时候「读的是哪一处」说不清，随便取一处
 * 等于让判据自己挑一个能过的答案。
 */
export function javaStaticInt(source: string, field: string, label: string): number {
  // 字段名要直接进正则，先证明它是个标识符。拼进去一个 `.` 或 `|` 会让这条
  // 正则匹配到别的字段上去，而那种错误的表现是「读出了一个数」—— 看起来正常。
  if (!/^[A-Za-z_$][\w$]*$/.test(field)) {
    throw new Error(`javaStaticInt: 字段名 ${JSON.stringify(field)} 不是合法的 Java 标识符`)
  }
  // `int\s+` 那一段保证左边界（`myexp` 匹配不上），`\s*=\s*(\d+)\s*;` 保证
  // 右边界，顺带把没有初值的声明（`public static int expToLevelUp;`）挡在外面。
  //
  // ⚠️ 挡在外面**不等于静默跳过**：它落到下面那条零匹配的硬失败上，所以
  // `javaStaticInt(src, 'expToLevelUp', …)` 是抛，不是返回什么。这是对的 ——
  // 没有初值的声明读不出「出厂值」，而"读不出"必须响。
  //
  // 这条右边界比原先 `originalNewGame.test.ts` 那一版**窄**：那一版只要
  // `…int <字段>\s*=`，不管等号右边是什么。当前三个类的 level / exp /
  // angryValue 都是十进制字面量，两者无差；但初值哪天写成表达式
  // （`= HP_BASE*2;`），这里会按零匹配抛，而那一版会放行。抛是更安全的
  // 一侧——它逼着人来看，而不是悄悄读出个数。
  const found = [...source.matchAll(new RegExp(`public\\s+static\\s+int\\s+${field}\\s*=\\s*(\\d+)\\s*;`, 'g'))]
  if (found.length !== 1) {
    throw new Error(
      `${label} 里 \`public static int ${field}=<数>;\` 匹配到 ${found.length} 处，要的是恰好 1 处` +
        (found.length === 0
          ? ' —— 解析器空转：源码没按 GBK 解出来、字段改了名、或者初值被挪走了'
          : ' —— 两处以上就说不清读的是哪一处了'),
    )
  }
  return Number(found[0]![1])
}
