import { readFileSync } from 'node:fs'
import { repoPath } from '../test/repoPath'

/**
 * 把 `src/battle/Enemy.java`（GBK）里的怪物出厂数据解出来，给 `units.test.ts`
 * 当判据用。**只在测试里被 import**，不进任何一条运行时的路。
 *
 * ## 为什么要有这个东西
 *
 * `units.ts` 的 `ENEMIES` 是一张抄来的表。它大多数列被五份 driver=battle 的
 * 行为真值逐字段盖着（抄错了会红），但有几列**一个读者都没有** ——
 * `skillHurt` / `money`，以及 `hurtMax` / `skillHurtMax` / `defenseMax`
 * 那三个在 `world.ts` 里写进去就再没人读的派生值。没有读者的那几列，
 * **抄错了和抄对了长得一模一样**。
 *
 * 于是把整张表逐列对回原版源码。这一步的风险是"解析器本身成为新的错处"：
 * 解不出来却安静地返回空，于是逐行对比恒真地通过 —— 这个仓库最贵的那种失败。
 * 所以**这里的每一步解不出来就当场抛**，没有默认值、没有"跳过这一行"：
 *
 * - 文件里找不到那两个方法 → 抛（用 UTF-8 读 GBK 源码就是这个下场）；
 * - 某个 case 里少了任何一个必填字段 → 抛；
 * - 某个字段被赋值两次 → 抛（否则"取第一个"会悄悄丢掉后一次）；
 * - 表达式不是下面认得的那几种形状 → 抛，并把原文带出来。
 *
 * 唯一有默认值的是 `skillNum`：原版 25 个 case 里只有一半写了它，其余用的是
 * 字段声明处的初值。那个初值也是**从源码里解出来的**（`int skillNum=1;`），
 * 不是写死的 1。
 */

/** 速度那一列：24 行是常量，罹年居士那行是 `ZhangXiaoFan.speed+6`。 */
export type SourceSpeed =
  | { kind: 'const'; value: number }
  | { kind: 'zhangSpeedPlus'; delta: number }

/** `this.skillHurt=hurt;`（同一个数）与 `this.skillHurt=600;`（恰好相等）不是一回事。 */
export type SourceSkillHurt = { kind: 'sameAsHurt' } | { kind: 'const'; value: number }

export interface SourceSkill {
  name: string
  length: number
  /** `setSkill` 的第 3 个参数 `this.x-50` 里的那个 `-50`。 */
  offsetX: number
  /** 第 4 个参数 `this.y-235` 里的 `-235`。 */
  offsetY: number
  beAttackedCode: number
  beAttackedTimes: number
  runCode: number
  attackCode: number
  withdrawCode: number
  /** `this.y-ZhangXiaoFan.showY+40` 里的 `+40`；没写常数项就是 0。 */
  toZhang: number
  toYu: number
  toLu: number
}

export interface SourceEnemy {
  length: number
  beAttackedLength: number
  speed: SourceSpeed
  hurt: number
  skillHurt: SourceSkillHurt
  defense: number
  hp: number
  exp: number
  money: number
  skillNum: number
  /** 战利品。`units.ts` 的表今天没有这一列（没有读者，也没有 M2 的用途）， */
  /** 解出来是为了让"少解了一个字段"与"这个 case 本来就没有"分得开。 */
  thing: string
  /** `this.beAttackedX=x-125;` 里的 `-125`；写 `x` 就是 0。 */
  beAttackedOffsetX: number
  beAttackedOffsetY: number
  skill: SourceSkill
}

/**
 * GBK 源码要显式解码。按 UTF-8 读出来的中文全是乱码，而**乱码与"源码里没有
 * 这个 case"在正则下长得一样** —— 匹配不到就是 0 行，0 行的逐行对比恒真。
 * 下面每个 `slice` 前的 `indexOf` 检查就是拦这个的第一道。
 */
function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}

/** 截出 `from` 与 `to` 之间那一段；任何一头找不到就抛。 */
function sliceBetween(src: string, what: string, from: string, to: string): string {
  const a = src.indexOf(from)
  if (a < 0) throw new Error(`Enemy.java 里找不到 ${what} 的开头 ${JSON.stringify(from)}`)
  const b = src.indexOf(to, a)
  if (b < 0) throw new Error(`Enemy.java 里找不到 ${what} 的结尾 ${JSON.stringify(to)}`)
  return src.slice(a, b)
}

/**
 * 把一段 `switch` 的正文切成 `case "名字": …` 若干块。
 *
 * 名字重复要抛：否则 `Map` 会让后一个悄悄盖掉前一个，而"两个 case 同名"在
 * 原版里是个真正的错，不该被解析器抹平。
 */
function casesOf(body: string, what: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of body.matchAll(/case "([^"]+)":([\s\S]*?)break;/g)) {
    const name = m[1]!
    if (out.has(name)) throw new Error(`${what} 里出现了两个同名的 case "${name}"`)
    out.set(name, m[2]!)
  }
  if (out.size === 0) throw new Error(`${what} 里一个 case 都没解出来 —— 解析器该改了`)
  return out
}

/** 取 `[this.]<字段>=<表达式>;` 的右边。没有、或有两个，都抛。 */
function assign(block: string, field: string, where: string): string {
  const hits = [...block.matchAll(new RegExp(`(?:this\\.)?\\b${field}\\s*=([^;]+);`, 'g'))]
  if (hits.length === 0) throw new Error(`${where} 里没有 ${field}= —— 解析器该改了`)
  if (hits.length > 1) throw new Error(`${where} 里的 ${field} 被赋值了 ${hits.length} 次`)
  return hits[0]![1]!.trim()
}

function int(expr: string, where: string): number {
  if (!/^-?\d+$/.test(expr)) throw new Error(`${where} 期望一个整数字面量，实际 ${JSON.stringify(expr)}`)
  return Number(expr)
}

/** `<基名>` / `<基名>+12` / `<基名>-125` → 那个常数项。别的形状一律抛。 */
function offsetFrom(expr: string, base: string, where: string): number {
  const m = expr.match(new RegExp(`^${base}\\s*(?:([+-])\\s*(\\d+))?$`))
  if (!m) throw new Error(`${where} 期望 ${base}±N 的形状，实际 ${JSON.stringify(expr)}`)
  if (!m[1]) return 0
  return m[1] === '-' ? -Number(m[2]) : Number(m[2])
}

function parseSpeed(expr: string, where: string): SourceSpeed {
  if (/^-?\d+$/.test(expr)) return { kind: 'const', value: Number(expr) }
  const m = expr.match(/^ZhangXiaoFan\.speed\s*([+-])\s*(\d+)$/)
  if (!m) throw new Error(`${where} 的 speed 不认得：${JSON.stringify(expr)}`)
  return { kind: 'zhangSpeedPlus', delta: m[1] === '-' ? -Number(m[2]) : Number(m[2]) }
}

function parseSkillHurt(expr: string, where: string): SourceSkillHurt {
  if (expr === 'hurt') return { kind: 'sameAsHurt' }
  if (/^-?\d+$/.test(expr)) return { kind: 'const', value: Number(expr) }
  throw new Error(`${where} 的 skillHurt 不认得：${JSON.stringify(expr)}`)
}

/** `"金创药/1"` → `金创药/1`。 */
function str(expr: string, where: string): string {
  const m = expr.match(/^"([^"]*)"$/)
  if (!m) throw new Error(`${where} 期望一个字符串字面量，实际 ${JSON.stringify(expr)}`)
  return m[1]!
}

/** `setSkill(…)` 的十二个实参，按顶层逗号切开。 */
function skillArgs(block: string, name: string): string[] {
  const hits = [...block.matchAll(/setSkill\(([\s\S]*?)\);/g)]
  if (hits.length !== 1) {
    throw new Error(`loadAnimation 的 case "${name}" 里有 ${hits.length} 个 setSkill(…)，期望 1 个`)
  }
  const args = hits[0]![1]!.split(',').map((s) => s.trim())
  if (args.length !== 12) {
    throw new Error(`case "${name}" 的 setSkill 有 ${args.length} 个参数，期望 12 个`)
  }
  return args
}

/**
 * 一次解出整张表：`initial()` 的字段赋值 + `loadAnimation()` 的 `setSkill`。
 *
 * `sourceText` 只给篡改验证用 —— 传一份改坏的源码文本进来，看这里的每一道门
 * 是不是真的会抛。默认读的是仓库里那份 GBK 源码。
 */
export function parseEnemySource(
  sourceText: string = javaSource('src/battle/Enemy.java'),
): Map<string, SourceEnemy> {
  const src = sourceText

  // `skillNum` 的默认值从字段声明里解，不写死。
  const skillNumDefault = int(
    assign(sliceBetween(src, '字段声明', 'public class Enemy {', 'public void setSkill('), 'skillNum', '字段声明'),
    '字段声明的 skillNum',
  )

  const initial = casesOf(
    sliceBetween(src, 'initial(…)', 'public void initial(String name,int roleCode){', '//载入图片'),
    'initial(…)',
  )
  const animation = casesOf(
    sliceBetween(src, 'loadAnimation(…)', 'public void loadAnimation(String name,int beAttackedLength){', '//做出动作'),
    'loadAnimation(…)',
  )

  // 两个 switch 的 case 名单必须一模一样：少一边就意味着有怪物只有属性没有
  // 攻击动画（或反过来），那是原版的错，不该被解析器抹平成"这一行解不出来"。
  const onlyInitial = [...initial.keys()].filter((n) => !animation.has(n))
  const onlyAnimation = [...animation.keys()].filter((n) => !initial.has(n))
  if (onlyInitial.length > 0 || onlyAnimation.length > 0) {
    throw new Error(
      `initial(…) 与 loadAnimation(…) 的 case 名单对不上：` +
        `只在 initial 里的 [${onlyInitial}]，只在 loadAnimation 里的 [${onlyAnimation}]`,
    )
  }

  const out = new Map<string, SourceEnemy>()
  for (const [name, block] of initial) {
    const where = `initial 的 case "${name}"`
    const a = (f: string): string => assign(block, f, where)
    const args = skillArgs(animation.get(name)!, name)
    const at = (i: number): string => args[i]!
    const skillWhere = `loadAnimation 的 case "${name}"`

    out.set(name, {
      length: int(a('length'), `${where} 的 length`),
      beAttackedLength: int(a('beAttackedLength'), `${where} 的 beAttackedLength`),
      speed: parseSpeed(a('speed'), where),
      hurt: int(a('hurt'), `${where} 的 hurt`),
      skillHurt: parseSkillHurt(a('skillHurt'), where),
      defense: int(a('defense'), `${where} 的 defense`),
      hp: int(a('hp'), `${where} 的 hp`),
      exp: int(a('exp'), `${where} 的 exp`),
      money: int(a('money'), `${where} 的 money`),
      // 没写 skillNum 的 case 用字段声明处的初值 —— 那个值也是解出来的。
      skillNum: /(?:this\.)?\bskillNum\s*=/.test(block)
        ? int(a('skillNum'), `${where} 的 skillNum`)
        : skillNumDefault,
      thing: str(a('thing'), `${where} 的 thing`),
      beAttackedOffsetX: offsetFrom(a('beAttackedX'), 'x', `${where} 的 beAttackedX`),
      beAttackedOffsetY: offsetFrom(a('beAttackedY'), 'y', `${where} 的 beAttackedY`),
      skill: {
        name: str(at(0), `${skillWhere} 的技能名`),
        length: int(at(1), `${skillWhere} 的 length`),
        offsetX: offsetFrom(at(2), 'this\\.x', `${skillWhere} 的 skillX`),
        offsetY: offsetFrom(at(3), 'this\\.y', `${skillWhere} 的 skillY`),
        beAttackedCode: int(at(4), `${skillWhere} 的 beAttackedCode`),
        beAttackedTimes: int(at(5), `${skillWhere} 的 beAttackedTimes`),
        runCode: int(at(6), `${skillWhere} 的 runCode`),
        attackCode: int(at(7), `${skillWhere} 的 attackCode`),
        withdrawCode: int(at(8), `${skillWhere} 的 withdrawCode`),
        toZhang: offsetFrom(at(9), 'this\\.y-ZhangXiaoFan\\.showY', `${skillWhere} 的 offsetTo1`),
        toYu: offsetFrom(at(10), 'this\\.y-YuJie\\.showY', `${skillWhere} 的 offsetTo2`),
        toLu: offsetFrom(at(11), 'this\\.y-LuXueQi\\.showY', `${skillWhere} 的 offsetTo3`),
      },
    })
  }
  return out
}
