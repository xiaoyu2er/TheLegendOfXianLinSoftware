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
export function hashFile(absolute: string, read: (p: string) => Buffer = readFileSync): string {
  return createHash('sha256').update(read(absolute)).digest('hex')
}

/** 一批文件的 `仓库相对路径 → sha256`，键有序。 */
export function hashFiles(
  repoRoot: string,
  paths: Iterable<string>,
  read: (p: string) => Buffer = readFileSync,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of [...paths].sort()) out[path] = hashFile(resolve(repoRoot, path), read)
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
export function bakerSources(
  repoRoot: string,
  entry: string = BAKER_ENTRY,
  read: (p: string) => Buffer = readFileSync,
): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop() as string
    if (seen.has(current)) continue
    seen.add(current)
    if (current.startsWith(GENERATED)) continue
    const absolute = resolve(repoRoot, current)
    const source = read(absolute).toString('utf8')
    for (const specifier of relativeSpecifiers(source)) {
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
 * **先去注释再匹配。** 头一版没去，于是这个文件自己的头注里那句「`from './x'`」
 * 被当成了一条 import，`bakerSources` 直接抛 `import './x' 解析不到文件`——
 * 这次是好事（严格解析把它喊了出来），但注释里出现示例路径是常事，不能靠
 * 「以后别那么写」兜。去掉的是块注释与整行的 `//`，行尾注释留着：`//` 也可能
 * 出现在字符串里（`https://…`），从那里截断反而会造出假的 import。
 */
function relativeSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const out: string[] = []
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]*)['"]/g
  for (const m of code.matchAll(pattern)) {
    const specifier = m[1]
    // 正则里那一组不是可选的，匹配上就一定有值。写 `!` 或 `as string` 也能
    // 过类型，但那是把「这里不可能」变成「这里不检查」；抛一次的代价是零。
    if (specifier === undefined) throw new Error(`匹配到 import 却取不到路径：${m[0]}`)
    out.push(specifier)
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
