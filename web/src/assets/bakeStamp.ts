import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

/**
 * 烘焙指纹（xl-23y）：让「产物是当前烘焙器烘出来的」与「产物是上一批的」
 * **长得不一样**。
 *
 * 起因：三条门禁 `pnpm typecheck` / `pnpm test` / `pnpm build`（CI 里也是这
 * 三条）没有一条会重跑 `pnpm bake`。而 `src/assets/roleSpriteSize.test.ts`
 * 核的是**产物**，于是改了 `scripts/bake.ts` 却不重烘，它拿的是上一批产物
 * 得出的结论 —— 绿得和「改对了」一模一样。任何断言产物内容的测试都在这个
 * 洞里。
 *
 * 补法：**烘焙时把输入指纹化，测试时重算一遍比对**。烘焙器每跑一次就写下
 * 它自己的源码摘要与它读过的每一个源文件的摘要（`src/generated/bakeStamp.json`），
 * `bakeStamp.test.ts` 现场重算：对不上就是「产物不是这批输入烘出来的」。
 *
 * 两件事**故意不做**，理由都在于「失败的样子要跟成功不一样」：
 *
 * - **不指纹化产物本身。** `afconvert` 每次都把当前时间写进 MP4 的
 *   mvhd/tkhd/mdhd 三处（每个 `.m4a` 恰好 12 个字节随时间变），音频数据一个
 *   字节没动。拿产物做摘要，正常的「烘完 git checkout 掉无意义 churn」流程
 *   会立刻把判据变红 —— 一条天天喊狼来了的判据等于没有。产物被手改这件事
 *   由「产物入库、diff 就是信号」兜着。
 * - **不由这里去数应该有多少个输入。** 分母抄一份在测试里，加一个脚本就得
 *   记得改两处；忘了的表现是判据悄悄少验一块。名单由烘焙器现场记录，测试
 *   只负责「记下的每一条今天还对得上」。新增输入必然伴随脚本或烘焙器的改动，
 *   而那两样都在指纹里。
 */

/** 烘焙器入口，仓库相对路径。图从这里开始爬。 */
export const BAKER_ENTRY = 'web/scripts/bake.ts'

/** `src/generated/bakeStamp.json` 的形状：仓库相对路径 → 文件的 sha256。 */
export interface BakeStamp {
  /** 烘焙器自己的源码闭包（入口 + 它静态 import 到的每一个本仓库模块）。 */
  readonly baker: Readonly<Record<string, string>>
  /** 烘焙器读过的每一个源文件：脚本、地图、精灵、头像、背景图、BGM。 */
  readonly inputs: Readonly<Record<string, string>>
}

/**
 * 产物目录。爬源码闭包时**到这里为止**：`src/generated/**` 是烘焙器的输出，
 * 不是它的源码。把产物当源码摘要，指纹就会因为「烘了一次」而变，而它本该
 * 只因为「烘焙器变了」而变——那样谁都读不懂它红在哪。
 */
const GENERATED = 'web/src/generated/'

/** 一个文件的 sha256（十六进制）。 */
export function hashFile(absolute: string): string {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex')
}

/** 一批文件的 `仓库相对路径 → sha256`，键有序。 */
export function hashFiles(repoRoot: string, paths: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of [...paths].sort()) out[path] = hashFile(resolve(repoRoot, path))
  return out
}

/**
 * 烘焙器的源码闭包：从 `entry` 出发，顺着**相对路径的 import** 递归，
 * 返回仓库相对路径的有序名单。
 *
 * 为什么不写死名单：`bake.ts` 今天 import 六个模块，明天多一个；名单抄在
 * 这里，多出来的那个就悄悄不在指纹里 —— 改它不重烘，判据照绿。
 *
 * **解析不到的相对 import 一律抛。** 这条路上最容易出的错是正则一个都没
 * 匹配上：那样闭包退化成入口一个文件，而「只有一个文件的闭包」和「爬全了」
 * 在结果上长得一样。抛出来才看得见。
 */
export function bakerSources(repoRoot: string, entry: string = BAKER_ENTRY): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop() as string
    if (seen.has(current)) continue
    // 守卫必须排在 `seen.add` 前面：排在后面的话，产物虽然不再往下爬，却已经
    // 落进返回值里被当成烘焙器源码摘要了 —— 那正是这个守卫要防的事。
    if (current.startsWith(GENERATED)) continue
    seen.add(current)
    const absolute = resolve(repoRoot, current)
    const source = readFileSync(absolute).toString('utf8')
    const specifiers = relativeSpecifiers(source)
    // **换一种数法再数一遍。** 上面那个扫描器要认字符串与注释的边界，它错过
    // 一条的表现是「闭包悄悄少一个模块，指纹照样对得上」—— 头一版就是这么
    // 错的（见 `relativeSpecifiers` 的头注）。这里用一个完全不同的、只认
    // 行首 `import` 的粗读法当交叉验证：两种数法不一致就抛。粗读法认不出
    // 函数体里的动态 `import('./x')`，所以只单向要求「它找到的，扫描器也得
    // 有」。
    for (const declared of lineAnchoredImports(source)) {
      if (!specifiers.includes(declared)) {
        throw new Error(
          `${current} 的行首 import 里有 '${declared}'，但扫描器没扫到它 —— ` +
            `relativeSpecifiers 漏了，闭包会悄悄缩水`,
        )
      }
    }
    for (const specifier of specifiers) {
      const resolved = resolveModule(resolve(dirname(absolute), specifier))
      if (resolved === null) {
        throw new Error(`${current} 里的 import '${specifier}' 解析不到文件`)
      }
      queue.push(relative(repoRoot, resolved).split('\\').join('/'))
    }
  }
  return [...seen].sort()
}

/**
 * `from '<相对路径>'`、`import '<相对路径>'`、`import('<相对路径>')`。
 *
 * **逐字符扫，认字符串与注释的边界**，不是拿一条正则把块注释整段削掉。
 * 头一版就是那么削的，code-review 量出来它在 `bake.ts` 上把 581 行削成
 * 348 行（我自己复现过）：某条日志字符串里有 `npcs` 加两个星号加 `.webp`，
 * 那个斜杠星号被当成块注释起头，一路吞到九十行外的下一个注释收尾符，整块
 * 主角精灵 / 对话框 / 头像 / 旁白背景的烘焙代码都被当成了注释。
 *
 * **今天没出事纯属侥幸**：`bake.ts` 的相对 import 全在被吞的那一段之前。哪天
 * 有一条落进去，那个模块就悄悄退出闭包 —— 指纹照样对得上，只是覆盖得更少了。
 * 这正是这个函数自己的头注说必须响的那种失败，而它当时一声不吭。
 * 交叉验证见 `lineAnchoredImports`。
 *
 * 已知边界（都不出现在本仓库，且失败时是抛而不是漏）：模板串里嵌套模板串，
 * 以及正则字面量里出现注释起头符或引号。
 */
function relativeSpecifiers(source: string): string[] {
  const out: string[] = []
  let code = '' // 到目前为止的"非字符串非注释"文本，用来看这个字符串前面是不是 import
  let i = 0
  while (i < source.length) {
    const c = source[i] as string
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const { value, end } = readString(source, i, c)
      // `from` / `import` / `import(` 紧挨着的那个字符串才是模块路径。
      if (/(?:\bfrom|\bimport\s*\(?)\s*$/.test(code) && value.startsWith('.')) out.push(value)
      code += ' '
      i = end
      continue
    }
    code += c
    i++
  }
  return out
}

/** 从 `start` 处的引号读一个字符串字面量，返回它的值与结束后的下标。 */
function readString(source: string, start: number, quote: string): { value: string; end: number } {
  let value = ''
  let i = start + 1
  while (i < source.length) {
    const c = source[i] as string
    if (c === '\\') {
      value += source[i + 1] ?? ''
      i += 2
      continue
    }
    if (c === quote) return { value, end: i + 1 }
    value += c
    i++
  }
  // 没闭合的引号：与其猜，不如抛 —— 猜出来的"路径"要么解析不到（还好），
  // 要么恰好解析到别的文件（更糟）。
  throw new Error(`源码里有一个没闭合的字符串（从下标 ${start} 起）`)
}

/**
 * 只认**行首**的 `import … from '<相对路径>'` / `import '<相对路径>'`。
 * 粗，但它的粗法与 `relativeSpecifiers` 完全不同：不去注释、不认字符串，
 * 只赌"import 语句写在行首"。两种错法不重叠，这就是交叉验证的全部意义。
 */
function lineAnchoredImports(source: string): string[] {
  const out: string[] = []
  const pattern = /^import\s+(?:[\s\S]*?\bfrom\s*)?['"](\.[^'"]+)['"]/gm
  for (const m of source.matchAll(pattern)) {
    const specifier = m[1]
    if (specifier !== undefined) out.push(specifier)
  }
  return out
}

/** TypeScript 的省略后缀：`./x` 可能是 `x.ts`、`x.tsx`、`x.json`、`x/index.ts`。 */
function resolveModule(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}
