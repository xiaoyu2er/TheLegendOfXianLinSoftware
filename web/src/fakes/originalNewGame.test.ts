import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PartyKey } from '../battle/units'
import { javaSource } from '../test/javaSource'
import { javaStaticInt } from '../test/javaStaticInt'
import { repoPath } from '../test/repoPath'

/**
 * **原版点「起」对队伍做了什么**（xl-lly）。
 *
 * ADR-0001 说 web 端复刻原版缺陷；`app/App.tsx` 的 `onNewGame` 是**明写的
 * 例外** —— 它调 `view.restart()`，队伍回出厂状态（1 / 3 / 1 级、满血、
 * 经验 0），而原版不回。`fakes/party.test.ts` 钉住的是**例外那一半**
 * （出厂状态到底是什么），这份文件钉的是**被例外掉的那一半**：原版实际
 * 做了什么。两半都在，"web 端抄错了"与"web 端故意不抄"才分得开。
 *
 * 不然这条例外只活在注释里，而注释与判据长得一样（见 docs/agents/dispatch.md）。
 *
 * ## 原版那条路，两道关卡各拦一次
 *
 * 1. **`GameLauncher.init()` 是死代码。** 它是原版唯一会重建队伍的地方，而
 *    唯一指向它的调用点 `src/start/StartPanel.java:336` 是注释掉的。
 *
 *    量的是 `src/`，说的也只能是 `src/` —— `tools/` 下那些是本仓库自己写的
 *    开发工具，它们调不调 `init()` 与"原版点「起」会发生什么"无关。**别把
 *    这句话说成"全仓库"**：那就说得比量到的宽了。
 * 2. **就算把那行注释去掉，队伍也回不到出厂状态。** 三个人的 `level` /
 *    `exp` / `angryValue` 是 `static`，而三个构造函数一个都不赋值 ——
 *    它们只按**现有等级**重算四项属性、把 hp/mp 填满。所以原版「起」的
 *    上限是"满血复活、等级经验照旧"，`init()` 活过来也给不出 1 / 3 / 1 级。
 *
 *    这一条是本票实测补的：票面原写"`init()` 会把三个人整个重建"，读起来
 *    像"它会重置"。`new` 一个对象与"字段回到初值"在 `static` 字段上不是
 *    一回事。
 */

/** `src/` 下所有 `.java` 的仓库相对路径，排过序。 */
function javaFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(repoPath(dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : entry.name.endsWith('.java')
          ? [`${dir}/${entry.name}`]
          : [],
    )
  return walk('src').sort()
}

/**
 * 一行里出现的 `init()`（有没有前缀都算）。
 *
 * **不能只找 `.init()`**：同一个名字还有一处**不带点**的调用
 * （`Narratage.java` 里 `init();` 调的是它自己那个同名方法）。只找带点的
 * 那种，会把"没有别的调用点"这句话说得比量到的宽 —— 而漏掉的那一处恰好
 * 是个真的调用。
 */
const INIT_MENTION = /\binit\s*\(\s*\)/

describe('原版点「起」不重置队伍（xl-lly）', () => {
  it('原版 src/ 下提到 init() 的一共四处，唯一指向 GameLauncher 的那处是注释掉的', () => {
    const files = javaFiles()
    // 分母先自证：扫空了目录（路径错、withFileTypes 用法错）与"源码里真的
    // 没有 init()"长得一样，都是零处。这两条把"扫到了东西"钉死。
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('src/main/GameLauncher.java')

    const mentions = files.flatMap((path) =>
      javaSource(path)
        .split(/\r?\n/)
        .map((line, i) => ({ where: `${path}:${i + 1}`, text: line.trim() }))
        .filter((row) => INIT_MENTION.test(row.text)),
    )
    // 整张表比一次，而不是只数个数：多出来一处调用时，看得见它在哪一行。
    expect(mentions).toEqual([
      { where: 'src/main/GameLauncher.java:91', text: 'public  void init(){' },
      { where: 'src/scene/Narratage.java:62', text: 'public void init() {' },
      // 旁白自己调自己的那个同名方法，与队伍无关。
      { where: 'src/scene/Narratage.java:93', text: 'init();' },
      // 唯一指向 GameLauncher.init() 的一处，在注释里（`Game.game` 就是那个
      // GameLauncher，见 src/main/Game.java）。
      { where: 'src/start/StartPanel.java:336', text: '//	Game.game.init();' },
    ])

    const call = mentions.find((m) => m.text.includes('Game.game.init()'))
    expect(call?.text.startsWith('//')).toBe(true)
    // 它就在「起」那条路上：`startLoadAction()` 的 case 0，紧挨着
    // switchTo("scene") 与 initiation("脚本1.txt")。
    const startPanel = javaSource('src/start/StartPanel.java')
    expect(startPanel).toMatch(/\/\/\s*Game\.game\.init\(\);[\s\S]{0,400}?initiation\("脚本1\.txt"\)/)
  })

  it('init() 重建的是三个人与四个面板 —— 它确实是那个会重置的地方', () => {
    const body = methodBody(javaSource('src/main/GameLauncher.java'), 'public  void init(){')
    const created = [...body.matchAll(/new\s+([A-Za-z]+)\s*\(/g)].map((m) => m[1]!).sort()
    expect(created).toEqual([
      'BattlePanel',
      'EquipmentShopPanel',
      'LuXueQi',
      'MenuPanel',
      'ShopPanel',
      'YuJie',
      'ZhangXiaoFan',
    ])
  })

  /**
   * 逻辑名 → 原版类名。**分母由类型给**：写成 `Record<PartyKey, string>`，
   * 队伍里多一个人时 typecheck 就逼着这里也多一条 —— 写成一个三元素数组的话，
   * 多出来的那个人只会**少跑一条 `it.each`**，而少跑一条和全绿长得一样。
   * （`fakes/party.test.ts` 的 `CLASSES` 同样的理由、同样的形状。）
   */
  const CLASSES: Readonly<Record<PartyKey, string>> = {
    zhang: 'ZhangXiaoFan',
    yu: 'YuJie',
    lu: 'LuXueQi',
  }

  it.each(Object.values(CLASSES))(
    '%s：level / exp / angryValue 是 static，而构造函数一个都不赋 —— 重建给不出出厂状态',
    (className) => {
      const source = javaSource(`src/battle/${className}.java`)
      // 三个字段都是 static，才谈得上"new 一个新对象也带着上一局的值"。
      // 找不到（或找到两处）由 `javaStaticInt` 抛 —— 这里要的就是"恰好一处
      // static 初值"这件事本身，值是多少下面用不上。
      //
      // ⚠️ **这一条的分辨力整个寄存在 `javaStaticInt` 的抛上**，所以断言写成
      // `not.toThrow()` —— 直说被验的是"抛不抛"。原先写的是
      // `expect(javaStaticInt(...)).toBeGreaterThanOrEqual(0)`，那是**恒真**的
      // （正则只吃 `\d+`，解出来必 ≥ 0），一条永远绿的 expect 冒充判据，正是
      // 这个仓库最怕的形状。
      //
      // 实测过这条判据的边界：把源码里 `angryValue=0;` 的初值去掉，它立刻红；
      // 但同时把 helper 改成"抓不到就返回 0"，它就绿了 —— 那一步红的是
      // `javaStaticInt.test.ts`。真正的判据是 helper 自己那 7 条。
      for (const field of ['level', 'exp', 'angryValue']) {
        expect(() => javaStaticInt(source, field, `${className}.java`)).not.toThrow()
      }

      const body = methodBody(source, `public ${className}(int x,int y,BattlePanel bp){`)
      // 先证明这段体真的取到了：它确实做了"填满 hp/mp"与"按等级重算属性"
      // 这两件事。取空了的话，下面那条"没有赋值"是恒真的。
      expect(body).toMatch(/\bhp\s*=\s*hpMax\s*;/)
      expect(body).toMatch(/\bmp\s*=\s*mpMax\s*;/)
      expect(body).toMatch(/\bphysicalPower\s*=\s*\d+\s*\+\s*\(level\s*-\s*\d+\)/)

      // 而这三个一个都没被赋值。**`=` 一种写法不够**：`exp++` 与 `level+=1`
      // 同样是赋值，而只找 `=` 的选择器对它们一声不吭 —— 选择器比断言窄一档，
      // 就是"找不到"当了通过条件。所以自增自减与复合赋值一并数。
      //
      // `expToLevelUp=` 不算：`\bexp` 后面跟的是 `T`，`\s*` 之后要的是运算符，
      // 匹配不上（这不是巧合，是挑这个写法的理由）。
      for (const field of ['level', 'exp', 'angryValue']) {
        const assigned = [...body.matchAll(assignmentTo(field))].map((m) => m[0])
        expect(assigned, `${className} 构造函数里对 ${field} 的赋值`).toEqual([])
      }
    },
  )

  it.each(Object.values(CLASSES))(
    '%s：「承」走的 intialFromInfo() 把 level / hp / mp / angryValue / exp 全写一遍 —— 原版「起」与「承」根本不一致',
    (className) => {
      // 对照组，而且是**这条判据分不分得开的关键**：上一条说「构造函数一个
      // 都不赋」，可"选择器抓不到赋值"与"真的没有赋值"长得一样。同一个
      // `assignmentTo()` 在读档那条路上一抓一个准，才说明它会抓。
      const body = methodBody(javaSource(`src/battle/${className}.java`), 'public void intialFromInfo(){')
      for (const field of ['level', 'hp', 'mp', 'angryValue', 'exp']) {
        const assigned = [...body.matchAll(assignmentTo(field))].map((m) => m[0])
        expect(assigned.length, `${className}.intialFromInfo() 里对 ${field} 的赋值处数`)
          .toBeGreaterThan(0)
      }
    },
  )
})

/**
 * 「给 `field` 赋值」的所有写法：`=`（但不是 `==`）、`+=` 那一族、`++` / `--`。
 *
 * 断言说的是"一个都没赋"，选择器就得覆盖所有赋值写法。只写 `=` 的话
 * `exp++` 漏掉，而漏掉的样子与"真的没有"一模一样。
 */
function assignmentTo(field: string): RegExp {
  return new RegExp(`\\b${field}\\s*(?:[+\\-*/%]?=(?!=)|\\+\\+|--)`, 'g')
}

/**
 * 从 `header` 那一行起，配对花括号取出方法体。
 *
 * 用配对而不是"到下一个 `}`"：构造函数里有 `if`、有 `switch`，第一个 `}`
 * 落在方法中间，取出来的半截体照样能让上面那些断言过 —— 而它漏掉的正是
 * 后半段里可能有的赋值。
 */
function methodBody(source: string, header: string): string {
  const start = source.indexOf(header)
  expect(start, `找不到 ${header}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${header} 的花括号没配上`)
}
