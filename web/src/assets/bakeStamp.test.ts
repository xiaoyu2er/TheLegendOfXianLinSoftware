import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { posix, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import manifest from '../generated/assets.json'
import stamp from '../generated/bakeStamp.json'
import { BAKER_ENTRY, bakerSources, hashFile, hashFiles } from './bakeStamp'
import { listFiles } from './listFiles'
import { SFX_ROOT } from './sfxAssets'
import { IMAGE_ROOT } from './battleAssets'
import { MENU_ROOT } from './menuAssets'
import { END_PICTURE_DIR } from '../end/assets'
import { EQUIP_PICTURE_ROOT, isBakedEquipPicture } from '../menu/equipmentPictures'
import { SHOP_ROOT, shopAssetOwner } from '../shop/shopAssets'
import type { BakeStamp } from './bakeStamp'

/**
 * 入库的**资源产物**有没有陈旧（xl-23y）。
 *
 * `src/data/scenes.test.ts` 已经把场景 JSON 这一层钉住了 —— 它现场重烘源脚本
 * 再比对。资源那一层（WebP / m4a / 映射表）没法这么办：重烘要 `cwebp` 与
 * `afconvert`，CI 上都没有。于是三条门禁（`typecheck` / `test` / `build`，
 * CI 里也是这三条）没有一条会重跑 `pnpm bake`，而 `roleSpriteSize.test.ts`
 * 这类核产物的测试就拿着上一批产物在下结论 —— 绿得和「改对了」一模一样。
 *
 * 这里补的是那个洞：**烘焙时把输入指纹化，跑测试时重算一遍比对**。判据只用
 * 到 `readFileSync` 与 `createHash`，所以它在 CI 上跑得动 —— 见文件末尾
 * 「这条判据进不进 CI」。
 */

const STAMP = stamp as BakeStamp
const REPO = repoPath()
/** 只为解析符号（常量、import、参数）建程序：不要标准库与类型，`node:fs` 解析不到也无妨。 */
const PROGRAM_OPTIONS: ts.CompilerOptions = {
  noLib: true,
  types: [],
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

describe('烘焙指纹', () => {
  it('烘焙器的源码闭包与烘焙时逐字节一致', () => {
    // 名单两边都是现爬的（`bakerSources` 顺着 import 走），不是抄的：
    // `bake.ts` 明天多 import 一个模块，这里立刻多一条，用不着谁记得改。
    const files = bakerSources(REPO)
    expect(files).toContain(BAKER_ENTRY)
    expect(files).toEqual(Object.keys(STAMP.baker).sort())
    expect(hashFiles(REPO, files)).toEqual(STAMP.baker)
  })

  it('烘焙器读过的每一个输入都还是烘焙时那一份', () => {
    const changed: string[] = []
    for (const [path, digest] of Object.entries(STAMP.inputs)) {
      // 文件没了要说人话：直接算摘要会抛一个 ENOENT，堆栈里看不出「哪个判据
      // 在管这件事」。
      if (!existsSync(resolve(REPO, path))) changed.push(`${path}（文件已不在）`)
      else if (hashFile(resolve(REPO, path)) !== digest) changed.push(path)
    }
    expect(changed).toEqual([])
  })

  /**
   * 上面那条只能验「记下的还对得上」—— 名单是烘焙器现场记录的，不重烘就
   * 推不出「今天应该有哪些输入」，所以**新增的输入它一条都看不见**，而
   * 「没验到」和「验过了」长得一样。
   *
   * 分母数得出来的那些（`script/` 下有几个 `.txt`、音效目录下有几个文件……）
   * 由下面「按目录现读的输入源」逐目录数。其余素材（地图 / NPC / 头像 / 背景图 /
   * BGM）的分母要跑一遍烘焙器才知道，但它们**只可能由三样东西引进来**：脚本数据、
   * 烘焙器自己的规则、以及决定烘哪几首 BGM 的行为真值 `tools/traces/out/`
   * —— 三样都在指纹里，改了必红，红了就得重烘，重烘时名单自己补齐。
   */

  /**
   * **按目录现读**的输入源（xl-bnf；`script/` 与音效两处原本各自单列，xl-de7 并进来）。
   *
   * 洞是实测撞到的：`tools/traces/out/shop-party.trace.json` 进了真值目录却
   * 没重烘，一直不在 inputs 里，`pnpm test` 照绿 —— 上面「输入还是那一份」只
   * 核记下了的。烘焙器从这些目录**现扫**分母，多一个文件就可能多一份产物。
   *
   * **分母是磁盘那一侧**：先照烘焙器的扫法（`scan`）扫目录、按烘焙器的规则挑出它会读的，
   * 再与名单里同一前缀、同一规则下的条目比相等 —— 两个方向都红：磁盘上多一个名单里没有的，
   * 名单里有一个磁盘上没了的。反过来「拿名单去扫磁盘」是让被守的东西自己给自己签字。
   *
   * 规则不手抄（xl-de7）：`filter` 是烘焙器在扫描调用上**直接链着的** `.filter(…)` 的原文，
   * 下面的对账从语法树里现读出来逐字比，这里的判法就是把这段原文编译出来用 —— 烘焙器改了过滤，
   * 对账先红。`downstream` 是烘焙器扫完之后另用自己的函数挑的（装备、商店），这里直接用同一个
   * 函数；**它是不是真被用在这批扫描结果上，对账看不见**（见下面对账的头注）。
   *
   * 这张表本身是**登记**（烘焙器扫了哪几个目录、怎么扫），由人来签；新加一处
   * `readdirSync` / `listFiles` 就得在这里加一行 —— 忘了加由下面「每一处目录扫描都在
   * 登记表里」那条判红（xl-cn3）。
   */
  const DIR_SOURCES: readonly {
    dir: string
    /** 烘焙器用哪个函数扫：`readdirSync` 只一层，`listFiles` 递归。对账逐条核。 */
    scan: Scan
    /** 扫描调用上直接链着的 `.filter(…)` 实参原文（空白压成一个空格）；没有就不写。对账逐字核。 */
    filter?: string
    /** 烘焙器扫完之后另用来挑文件的函数（不在调用链上，对账不核）。 */
    downstream?: (relative: string) => boolean
    /** 这一处扫描写在闭包里哪个文件 —— 下面「扫描点与登记对账」按「文件 → 目录」逐条对。 */
    site: string
  }[] = [
    // `tracedFromTruth`，决定烘哪几首 BGM。手抄的三个路径（这一行、`src`、药品）没导出 ——
    // 导出会改闭包、迫使重烘 —— 由下面的对账从扫描实参里现解析出来核。
    { dir: 'tools/traces/out', scan: 'readdirSync', filter: "(f) => f.endsWith('.trace.json')", site: BAKER_ENTRY },
    { dir: 'script', scan: 'readdirSync', filter: "(f) => f.endsWith('.txt')", site: BAKER_ENTRY },
    // `bakeSfx`（xl-03x.5）。
    { dir: SFX_ROOT, scan: 'readdirSync', filter: "(f) => !f.startsWith('.')", site: BAKER_ENTRY },
    { dir: IMAGE_ROOT, scan: 'listFiles', site: BAKER_ENTRY },
    { dir: MENU_ROOT, scan: 'listFiles', site: BAKER_ENTRY },
    // `scanShopReferences` 的 `JAVA_ROOT`（没导出：导出它会改烘焙器闭包，指纹就得重烘）。
    { dir: 'src', scan: 'listFiles', filter: "(f) => f.endsWith('.java')", site: 'web/src/shop/shopReferences.ts' },
    { dir: END_PICTURE_DIR, scan: 'readdirSync', filter: "(f) => !f.startsWith('.')", site: BAKER_ENTRY },
    { dir: EQUIP_PICTURE_ROOT, scan: 'listFiles', downstream: isBakedEquipPicture, site: BAKER_ENTRY },
    // 装备图与药品介绍图两个子目录 `shopAssetOwner` 判 'elsewhere'，不在这一行里，
    // 各自单列（药品那一行漏过一次：篡改抹掉它一条，这张表照绿）。
    { dir: SHOP_ROOT, scan: 'listFiles', downstream: (f) => shopAssetOwner(f) === 'baked', site: BAKER_ENTRY },
    // `bake.ts` 的 `DRUG_PICTURE_DIR`，`readdirSync` 不过滤（没导出，理由同 `src`）。
    { dir: 'sources/Shop/药品/回复类', scan: 'readdirSync', site: BAKER_ENTRY },
  ]
  const keepOf = ({ filter, downstream }: (typeof DIR_SOURCES)[number]): ((relative: string) => boolean) => {
    const chained = filter === undefined ? () => true : compileFilter(filter)
    return (f) => chained(f) && (downstream === undefined || downstream(f))
  }

  it.each(DIR_SOURCES.map((s) => [s.dir, s] as const))('%s/ 下烘焙器会读的每一个文件都在输入名单里，反之亦然', (_, source) => {
    const { dir, scan } = source
    const keep = keepOf(source)
    const root = repoPath(dir)
    const onDisk = (scan === 'listFiles' ? listFiles(root) : readdirSync(root)).filter(keep).map((f) => `${dir}/${f}`)
    expect(onDisk.length, `${dir}/ 下一个烘焙器会读的文件都没扫到`).toBeGreaterThan(0)
    const recorded = Object.keys(STAMP.inputs)
      .filter((p) => p.startsWith(`${dir}/`))
      .filter((p) => keep(p.slice(dir.length + 1)))
    expect(recorded.sort()).toEqual(onDisk.sort())
  })

  // 上一条在名单那一侧也套了 `keep`，于是名单里一条落在某个目录下、却不合任何
  // 一行规则的条目会被滤掉、两边都不比 —— 这一条把它捡回来（/code-review 逮到的）。
  it('名单里落在这些目录下的每一条都被某一行认领', () => {
    const unclaimed = Object.keys(STAMP.inputs).filter((p) => {
      const rows = DIR_SOURCES.filter(({ dir }) => p.startsWith(`${dir}/`))
      return rows.length > 0 && !rows.some((row) => keepOf(row)(p.slice(row.dir.length + 1)))
    })
    expect(unclaimed).toEqual([])
  })

  /**
   * 登记表的**反向对账**（xl-cn3，xl-pcg）：上面几条只核「登记了的目录」，`bake.ts` 或
   * 它闭包里任何一个模块新加一处 `readdirSync` / `listFiles`，表不会自己变红。
   *
   * 分母是**烘焙器闭包的语法树**（`bakerSources` 现爬，TypeScript 解析，注释与
   * 字符串里的同名字样不算）：找出每一处目录扫描调用，再把它的**第一个实参
   * 解析回仓库里的目录**（见 `scannedDirs`）；分子是登记表的 `site → dir`。两边
   * 按「文件 → 目录」逐条相等 —— 同一文件里「删一处、换一处扫别的目录」会红，
   * 一个函数拿参数扫几个目录就按调用它的实参数成几条。`listFiles.ts` 是扫描原语
   * 本身，它肚子里那两处不是「又一个输入目录」，不数 —— 但它必须还在闭包里，
   * 否则这条豁免就是在豁免一个不存在的文件。
   *
   * 数不到的写法要响，不要漏：扫描函数的名字出现在「直接调用」与「原名导入」
   * 以外的任何位置 —— 别名导入、解构改名、`fs['readdirSync']`、存进变量、
   * `.call(…)`、再导出 —— 那处调用这里认不出，所以名字本身就判红。实参解析不回
   * 常量（算出来的、从外面读进来的）同样判红，不猜。
   *
   * 每一条不只是「文件 → 目录」，还带着**怎么扫**（xl-de7）：扫描函数（`readdirSync`
   * 一层 / `listFiles` 递归，其余扫描函数与带第二个实参的调用没建模，判红）与调用上直接链着的
   * `.filter(…)` 原文（中间隔着 `.sort()` 也算；遇到别的方法就停）。所以 `readdirSync` 改成
   * `listFiles`、过滤条件改一个字，都与登记行对不上。
   *
   * **这一条的分母**：闭包语法树里每一处扫描调用，逐条核（文件、目录、扫描函数、链上的过滤）。
   * **仍然绕得过的写法**：扫描结果先存进变量、过一道 `.map`、或者在循环里 `continue` 掉
   * 一部分 —— 调用链之外的过滤这里看不见，登记行照旧按「全读」或 `downstream` 判。装备与商店
   * 两行的 `downstream` 就是这种：烘焙器是不是真拿那个函数挑这批扫描结果，这里不核。
   */
  it('烘焙器闭包里的每一处目录扫描都在登记表里，反之亦然', () => {
    const PRIMITIVE = 'web/src/assets/listFiles.ts'
    const closure = bakerSources(REPO)
    expect(closure).toContain(PRIMITIVE)
    const program = ts.createProgram(closure.map((f) => resolve(REPO, f)), PROGRAM_OPTIONS)
    const { sites, escaped } = scanSites(program, REPO, closure.filter((f) => f !== PRIMITIVE))
    expect(escaped, '扫描函数以数不到的写法出现了').toEqual([])
    const found = sites.map(siteKey)
    const registered = DIR_SOURCES.map((row) => siteKey({ ...row, filters: row.filter === undefined ? [] : [row.filter] }))
    expect(found.length, '闭包里一处目录扫描都没数到 —— 数法坏了').toBeGreaterThan(0)
    expect(found.sort()).toEqual(registered.sort())
  })

  /**
   * 映射表与产物目录必须**互相盖满**。
   *
   * 烘焙器开头会 `rmSync` 整个产物目录，中途失败就留下半套产物加一张旧的
   * 映射表；那时候取图的表现是「某张图偶尔不见了」，没人看得出来。两个方向
   * 都查：映射表指到的文件要在，目录里的文件要有人指。
   *
   * **这里不核产物的字节。** `afconvert` 每次都把当前时间写进 MP4 的
   * mvhd/tkhd/mdhd（每个 `.m4a` 恰好 12 个字节随时间变，音频数据一个字节
   * 没动），拿字节做指纹会让「烘完 git checkout 掉无意义 churn」这个正常
   * 流程立刻变红。产物被手改由「产物入库、git diff 就是信号」兜着。
   */
  it('映射表与产物目录互相盖满', () => {
    const root = repoPath('web/src/generated/assets')
    const onDisk = new Set(listFiles(root).sort())
    const mapped = new Set(Object.values(manifest as Record<string, string>))
    expect(mapped.size).toBeGreaterThan(0)
    expect([...mapped].filter((p) => !onDisk.has(p)).sort()).toEqual([])
    expect([...onDisk].filter((p) => !mapped.has(p)).sort()).toEqual([])
  })

  /**
   * CI 的触发路径要盖住烘焙器的**每一个输入文件**。
   *
   * `.github/workflows/web.yml` 有 `paths:` 过滤：改动不落在名单里，这条流水线
   * **根本不跑**。那是最难看见的一种哑 —— PR 上没有红叉，跟跑过并通过长得
   * 一模一样。上面那条「输入还是烘焙时那一份」再灵，遇上一次不触发也白搭。
   *
   * 所以名单不靠人记：分母是**指纹里的 703 个输入本身**（数目也不写死，
   * 用 `Object.keys(...).length`），逐个问「YAML 里有没有一条 glob 罩得住
   * 它」。写这条的时候它逮到两回手写名单漏项：先是 `dialogue/`（对话框的四张
   * 固定素材），后是 `tools/traces/out/`（决定烘哪几首 BGM 的行为真值）——
   * 后者的漏法尤其像没事：`tools/ground-truth/**` 就在名单里，看着像盖住了。
   *
   * 匹配只认 YAML 里实际用到的两种写法：`前缀/**` 与逐字路径。别的通配写法
   * 一律**不算盖住**（宁可误报），因为「我以为它匹配上了」正是这一条要防的。
   */
  it('CI 的触发路径盖住烘焙器的每一个输入文件', () => {
    const yaml = readFileSync(repoPath('.github/workflows/web.yml'), 'utf8')
    const lists = [...yaml.matchAll(/^\s*paths:\s*\[([^\]]*)\]/gm)].map((m) =>
      (m[1] ?? '').split(',').map((entry) => entry.trim().replace(/^'|'$/g, '')),
    )
    // 一条都没匹配上就说明这个文件的写法变了（比如改成了多行列表）。那时候
    // 「盖住了」会因为分子分母都是空的而恒真 —— 宁可在这里抛。
    expect(
      lists.length,
      `${repoPath('.github/workflows/web.yml')} 里没找到 paths: [...]`,
    ).toBeGreaterThan(0)

    const inputs = Object.keys(STAMP.inputs)
    expect(inputs.length).toBeGreaterThan(0)
    for (const list of lists) {
      const covered = (path: string) =>
        list.some((glob) => (glob.endsWith('/**') ? path.startsWith(glob.slice(0, -2)) : glob === path))
      // 报的是没盖住的那些的**顶层目录**：703 条路径全喷出来没法读，而漏
      // 的时候漏的总是一整类。
      const uncovered = [...new Set(inputs.filter((p) => !covered(p)).map((p) => p.split('/')[0] ?? p))]
      expect(uncovered.sort()).toEqual([])
    }
  })
})

/**
 * 把一处目录扫描的第一个实参解析回仓库里的目录（相对仓库根的正斜杠路径），
 * 供上面「每一处目录扫描都在登记表里」按「文件 → 目录」对账（xl-pcg）。
 *
 * 只认这几种写法，其余一律抛 —— 解析不回就判红，不猜：
 *
 * - 字符串字面量、不带插值的模板；
 * - `const` 常量，顺着 import 跨文件（导出的 `IMAGE_ROOT` 与没导出的 `DRUG_PICTURE_DIR`
 *   一样，读的都是扫描实参真正指向的那个定义，不是手抄的原文）；
 * - 具名函数的参数：回到程序里**每一处直接调用它的地方**取那个位置的实参（没传就取默认值），
 *   所以一个函数拿参数扫两个目录会解析成两条。那个函数要是还被当成值用了（`dirs.forEach(f)`、
 *   存进变量、再导出），经那条路扫到的目录这里数不到 —— 抛；
 * - 从 `node:path` / `node:url` 导入的 `resolve` / `dirname` / `fileURLToPath`，以及
 *   `import.meta.url` —— 烘焙器的 `REPO` 就是从它自己的文件位置这么算出来的。
 *
 * 路径在一个以 `/` 为仓库根的虚拟文件系统里算。`resolve` 的实参里一个绝对路径都没有，
 * 运行时就是相对 cwd 的 —— 抛；最后算出来的不落在根下（裸相对路径同理）或正好是根，也抛。
 */
function scannedDirs(program: ts.Program, repo: string): (arg: ts.Expression, at: string) => string[] {
  const checker = program.getTypeChecker()
  const target = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(node)
    return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  }
  const locate = (node: ts.Node): string => {
    const file = node.getSourceFile()
    return `${relative(repo, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1} \`${node.getText()}\``
  }
  const calls: ts.CallExpression[] = []
  const names: ts.Identifier[] = []
  for (const file of program.getSourceFiles()) {
    const collect = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node)
      if (ts.isIdentifier(node)) names.push(node)
      ts.forEachChild(node, collect)
    }
    collect(file)
  }
  const PATH_FUNCTIONS: Record<string, (...args: string[]) => string> = {
    resolve: (...args) => {
      if (!args.some((a) => a.startsWith('/'))) throw new Error(`resolve(${args.join(', ')}) 没有绝对路径，运行时相对 cwd`)
      return posix.resolve(...args)
    },
    dirname: (path = '') => posix.dirname(path),
    fileURLToPath: (url = '') => {
      if (!url.startsWith('file://')) throw new Error(`fileURLToPath 拿到的不是 file: 地址：${url}`)
      return decodeURIComponent(url.slice('file://'.length))
    },
  }
  // 被调用的是不是 `node:path` / `node:url` 里那个函数：看导入声明，不看名字 —— 本地一个
  // 叫 `resolve` 的函数不该被当成路径拼接。
  const pathFunction = (callee: ts.Expression): ((...args: string[]) => string) | undefined => {
    if (!ts.isIdentifier(callee)) return undefined
    const decl = checker.getSymbolAtLocation(callee)?.declarations?.[0]
    if (decl === undefined || !ts.isImportSpecifier(decl)) return undefined
    const from = decl.parent.parent.parent.moduleSpecifier
    if (!ts.isStringLiteral(from) || !['node:path', 'path', 'node:url', 'url'].includes(from.text)) return undefined
    return PATH_FUNCTIONS[(decl.propertyName ?? decl.name).text]
  }
  const product = (lists: string[][]): string[][] =>
    lists.reduce<string[][]>((acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])), [[]])

  const evaluate = (expr: ts.Expression, depth: number): string[] => {
    const where = () => locate(expr)
    if (depth > 20) throw new Error(`解析太深（递归？）：${where()}`)
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return evaluate(expr.expression, depth + 1)
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text]
    if (
      ts.isPropertyAccessExpression(expr) && expr.name.text === 'url' &&
      ts.isMetaProperty(expr.expression) && expr.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      return [`file:///${encodeURI(relative(repo, expr.getSourceFile().fileName).split(sep).join('/'))}`]
    }
    if (ts.isCallExpression(expr)) {
      const fn = pathFunction(expr.expression)
      if (fn === undefined) throw new Error(`认不出的调用：${where()}`)
      return product(expr.arguments.map((a) => evaluate(a, depth + 1))).map((args) => fn(...args))
    }
    if (ts.isIdentifier(expr)) {
      const decl = target(expr)?.valueDeclaration
      if (
        decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined &&
        ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const
      ) {
        return evaluate(decl.initializer, depth + 1)
      }
      if (decl !== undefined && ts.isParameter(decl) && ts.isFunctionDeclaration(decl.parent) && decl.parent.name !== undefined) {
        const index = decl.parent.parameters.indexOf(decl)
        const owner = target(decl.parent.name)
        // 名字只许出现在三处：它自己的声明、原样导入、被直接调用。别处出现就是被当值传走了。
        const asValue = names.filter((id) => {
          if (id === decl.parent.name || target(id) !== owner) return false
          const parent = id.parent
          if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return false
          return !(ts.isCallExpression(parent) && parent.expression === id)
        })
        if (asValue.length > 0) throw new Error(`扫描参数所在的函数被当值用了，经那条路扫的目录数不到：${asValue.map(locate).join('；')}`)
        const callers = calls.filter((call) => target(call.expression) === owner)
        if (callers.length === 0) throw new Error(`参数所在的函数在闭包里没人调用：${where()}`)
        return callers.flatMap((call) => {
          if (call.arguments.slice(0, index + 1).some(ts.isSpreadElement)) throw new Error(`调用处用了展开实参：${locate(call)}`)
          const arg = call.arguments[index] ?? decl.initializer
          if (arg === undefined) throw new Error(`调用处没传这个参数、也没有默认值：${where()}`)
          return evaluate(arg, depth + 1)
        })
      }
    }
    throw new Error(`解析不回常量：${where()}`)
  }

  return (arg, at) =>
    evaluate(arg, 0).map((path) => {
      if (!path.startsWith('/') || path === '/') throw new Error(`${at} 扫的不是仓库里的一个目录：${path}`)
      return path.slice(1)
    })
}

/** 建了模的扫描函数：`readdirSync` 只扫一层，`listFiles` 递归。 */
type Scan = 'readdirSync' | 'listFiles'
const MODELLED: readonly string[] = ['readdirSync', 'listFiles'] satisfies Scan[]
/** 认得出名字就数，不管建没建模 —— 没建模的出现就判红，不能当它不存在。 */
const SCANNERS = new Set([...MODELLED, 'readdir', 'opendirSync', 'opendir', 'globSync', 'glob'])

type ScanSite = { site: string; dir: string; scan: Scan; filters: string[] }
const siteKey = ({ site, dir, scan, filters }: ScanSite): string =>
  [`${site} → ${dir}`, scan, ...filters.map((f) => `.filter(${f})`)].join(' · ')
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** 登记行里的过滤原文编译成判法 —— 与对账逐字比的是同一段字，不另抄一份。 */
function compileFilter(source: string): (relative: string) => boolean {
  // `ts.transpile` 遇到语法错误照样吐一段 JS（`f.endsWith(` 变成 `f.endsWith()`），坏原文会编出
  // 一个「能跑」的错判法 —— 所以要诊断，有一条就抛。
  const { outputText, diagnostics = [] } = ts.transpileModule(`(${source})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  })
  if (diagnostics.length > 0) throw new Error(`过滤原文编不过：${source}（${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' ')}）`)
  const keep: unknown = new Function(`return ${outputText}`)()
  if (typeof keep !== 'function') throw new Error(`过滤原文不是一个函数：${source}`)
  return keep as (relative: string) => boolean
}

/**
 * 在 `files` 的语法树里找出每一处目录扫描调用（xl-cn3），各自解析回目录（xl-pcg）、
 * 记下扫描函数与调用上直接链着的 `.filter(…)`（xl-de7）。认不出的写法进 `escaped`。
 */
function scanSites(program: ts.Program, repo: string, files: readonly string[]): { sites: ScanSite[]; escaped: string[] } {
  const scanned = scannedDirs(program, repo)
  const sites: ScanSite[] = []
  const escaped: string[] = []
  // `x.filter(a).sort().filter(b)`：往外走，`.filter` 记下实参、`.sort` 跳过，别的方法就停。
  const chainedFilters = (call: ts.CallExpression): string[] => {
    const out: string[] = []
    let node: ts.Expression = call
    for (;;) {
      const access = node.parent
      if (!ts.isPropertyAccessExpression(access) || access.expression !== node) break
      const outer = access.parent
      if (!ts.isCallExpression(outer) || outer.expression !== access) break
      if (access.name.text === 'filter') out.push(squash(outer.arguments.map((a) => a.getText()).join(', ')))
      else if (access.name.text !== 'sort') break
      node = outer
    }
    return out
  }
  for (const file of files) {
    const tree = program.getSourceFile(resolve(repo, file))
    if (tree === undefined) throw new Error(`${file} 不在 TypeScript 程序里`)
    const line = (node: ts.Node) => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
    const visit = (node: ts.Node): void => {
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && SCANNERS.has(node.text)) {
        const parent = node.parent
        // `readdirSync(…)` 或 `fs.readdirSync(…)`：名字就是被调用的那个。
        const called =
          (ts.isCallExpression(parent) && parent.expression === node) ||
          (ts.isPropertyAccessExpression(parent) && parent.name === node &&
            ts.isCallExpression(parent.parent) && parent.parent.expression === parent)
        // `import { readdirSync } from 'node:fs'` / `function listFiles(`：原名，不带 `as`。
        const declared =
          (ts.isImportSpecifier(parent) && parent.propertyName === undefined) ||
          (ts.isFunctionDeclaration(parent) && parent.name === node)
        if (called) {
          const call = (ts.isCallExpression(parent) ? parent : parent.parent) as ts.CallExpression
          const at = line(node)
          const first = call.arguments[0]
          // 第二个实参会改扫法（`{ recursive: true }`、`withFileTypes`、`listFiles` 的前缀），没建模。
          if (!MODELLED.includes(node.text)) escaped.push(`${at} ${node.text}() 这个扫描函数没建模`)
          else if (first === undefined) escaped.push(`${at} ${node.text}() 没有实参`)
          else if (call.arguments.length > 1) escaped.push(`${at} ${node.text}() 带了第二个实参，扫法没建模`)
          else {
            const filters = chainedFilters(call)
            for (const dir of scanned(first, at)) sites.push({ site: file, dir, scan: node.text as Scan, filters })
          }
        } else if (!declared && ts.isIdentifier(node)) escaped.push(`${line(node)} ${node.text}`)
        else if (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(parent)) escaped.push(`${file} ['${node.text}']`)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return { sites, escaped }
}

/**
 * 判据自己也要验 —— 一个恒真的指纹和一个管用的指纹长得一样。下面两条不碰
 * 仓库，在临时目录里造一个最小的模块图，把「改一个字节」与「爬不到 import」
 * 两种失败真的做出来。
 */
describe('指纹本身不是空转', () => {
  it('输入改一个字节，摘要就变', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(resolve(dir, 'a.bin'), 'hello')
    const before = hashFiles(dir, ['a.bin'])
    writeFileSync(resolve(dir, 'a.bin'), 'hellp')
    expect(hashFiles(dir, ['a.bin'])).not.toEqual(before)
  })

  it('闭包顺着 import 递归，而不是只有入口一个文件', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(resolve(dir, 'entry.ts'), "import { x } from './mid'\nexport const y = x\n")
    writeFileSync(resolve(dir, 'mid.ts'), "import { z } from './leaf'\nexport const x = z\n")
    writeFileSync(resolve(dir, 'leaf.ts'), 'export const z = 1\n')
    expect(bakerSources(dir, 'entry.ts')).toEqual(['entry.ts', 'leaf.ts', 'mid.ts'])
  })

  it('解析不到的 import 是抛，不是当作没有', () => {
    // 「爬不到」必须响：不响的话闭包会悄悄缩水，而缩了水的指纹照样能对上，
    // 只是不再覆盖那个模块。
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(resolve(dir, 'entry.ts'), "import './nope'\n")
    expect(() => bakerSources(dir, 'entry.ts')).toThrowError(/import '\.\/nope' 解析不到文件/)
  })

  it('字符串里的斜杠星号不会把后面的 import 吞掉', () => {
    // 这一条是 code-review 逮到的真 bug 的回归：头一版用一条正则削块注释，
    // `bake.ts` 里一句含 `npcs` 加两个星号的日志字符串把它带偏，581 行削成
    // 348 行，整块烘焙代码连同其中的 import 一起进了"注释"。**它当时一声
    // 不吭**——闭包少一个模块，指纹照样对得上，只是覆盖得更少。
    // 复现要三样齐全，缺一样旧实现就"碰巧对"：字符串里的斜杠星号、**它后面
    // 的 import**、以及**再后面某处真正的注释收尾符**（就是它去闭合那个假注释
    // 的）。头一版 fixture 少了第三样，旧实现因为整条正则匹配不上而什么都没
    // 削 —— 用例照绿，看起来像"这个 bug 不存在"。
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(
      resolve(dir, 'entry.ts'),
      'const log = `npcs/**.webp`\n' +
        "import { z } from './leaf'\n" +
        '/** 后面这段真注释里的收尾符，正是去闭合上面那个假注释的。 */\n' +
        'export const y = [log, z]\n',
    )
    writeFileSync(resolve(dir, 'leaf.ts'), 'export const z = 1\n')
    expect(bakerSources(dir, 'entry.ts')).toEqual(['entry.ts', 'leaf.ts'])
  })

  it('函数体里的动态 import 也算，行首粗读法看不见它不影响', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(
      resolve(dir, 'entry.ts'),
      "export async function f() {\n  return await import('./leaf')\n}\n",
    )
    writeFileSync(resolve(dir, 'leaf.ts'), 'export const z = 1\n')
    expect(bakerSources(dir, 'entry.ts')).toEqual(['entry.ts', 'leaf.ts'])
  })

  it('没闭合的字符串是抛，不是猜一个路径出来', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(resolve(dir, 'entry.ts'), "const s = 'no end\n")
    expect(() => bakerSources(dir, 'entry.ts')).toThrowError(/没闭合的字符串/)
  })

  /**
   * `scannedDirs` 的参数分支，今天烘焙器里没有一处走得到（每处扫描的实参都是常量），
   * 所以在临时目录里造出来验，不靠烘焙器碰巧长什么样（xl-pcg，/code-review 点到）。
   */
  const sitesIn = (files: Record<string, string>): ReturnType<typeof scanSites> => {
    const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'bake-scan-')))
    for (const [name, text] of Object.entries(files)) writeFileSync(resolve(dir, name), text)
    const program = ts.createProgram(Object.keys(files).map((f) => resolve(dir, f)), PROGRAM_OPTIONS)
    return scanSites(program, dir, Object.keys(files))
  }
  const scansIn = (files: Record<string, string>): string[] => sitesIn(files).sites.map((s) => s.dir).sort()
  const HEADER =
    "import { readdirSync } from 'node:fs'\nimport { listFiles } from './listFiles'\nimport { resolve } from 'node:path'\n" +
    "import { fileURLToPath } from 'node:url'\nconst ROOT = resolve(fileURLToPath(import.meta.url), '..')\n"

  it('每一处扫描记下扫描函数与链上的过滤：换扫描函数、改过滤，键就变（xl-de7）', () => {
    const keys = (body: string) => sitesIn({ 'entry.ts': `${HEADER}${body}\n` }).sites.map(({ scan, filters }) => [scan, ...filters].join(' '))
    expect(keys("readdirSync(resolve(ROOT, 'a')).filter((f) => f.endsWith('.txt')).sort()")).toEqual(["readdirSync (f) => f.endsWith('.txt')"])
    expect(keys("listFiles(resolve(ROOT, 'a')).filter((f) => f.endsWith('.txt'))")).toEqual(["listFiles (f) => f.endsWith('.txt')"])
    // 隔着 `.sort()` 的第二道过滤也算；`.map` 之后的就不是在挑文件名了，停。
    expect(keys("readdirSync(resolve(ROOT, 'a')).filter(p).sort().filter(q).map(r).filter(s)")).toEqual(['readdirSync p q'])
    expect(keys("const all = readdirSync(resolve(ROOT, 'a'))")).toEqual(['readdirSync'])
  })

  it('没建模的扫描函数、带第二个实参的扫描，进 escaped，不当成一层扫（xl-de7）', () => {
    const escapedIn = (body: string) => sitesIn({ 'entry.ts': `${HEADER}${body}\n` }).escaped
    expect(escapedIn("readdirSync(resolve(ROOT, 'a'), { recursive: true })")).toEqual([expect.stringMatching(/带了第二个实参/)])
    expect(escapedIn("listFiles(resolve(ROOT, 'a'), 'sub')")).toEqual([expect.stringMatching(/带了第二个实参/)])
    expect(escapedIn("import { globSync } from 'node:fs'\nglobSync(resolve(ROOT, 'a'))")).toEqual([expect.stringMatching(/没建模/)])
  })

  it('登记行的过滤原文编译出来就是那个判法', () => {
    const keep = compileFilter("(f) => f.endsWith('.trace.json')")
    expect(['a.trace.json', 'a.json'].filter(keep)).toEqual(['a.trace.json'])
    expect(() => compileFilter('(f) => f.endsWith(')).toThrowError(/编不过/)
    expect(() => compileFilter("'.txt'")).toThrowError(/不是一个函数/)
  })

  it('一个函数拿参数扫两个目录，解析成两条（跨文件导入的调用也算）', () => {
    expect(
      scansIn({
        'scan.ts': `${HEADER}export function scan(dir: string) { return readdirSync(resolve(ROOT, dir)) }\n`,
        'entry.ts': "import { scan } from './scan'\nscan('a')\nscan('b/c')\n",
      }),
    ).toEqual(['a', 'b/c'])
  })

  it('扫描参数所在的函数被当值传走，是抛，不是只数直接调用', () => {
    expect(() =>
      scansIn({
        'entry.ts': `${HEADER}function scan(dir: string) { return readdirSync(resolve(ROOT, dir)) }\nscan('a')\n;['b'].forEach(scan)\n`,
      }),
    ).toThrowError(/被当值用了/)
  })

  it('相对 cwd 的扫描是抛，不是当成仓库根下', () => {
    expect(() => scansIn({ 'entry.ts': `${HEADER}readdirSync('a')\n` })).toThrowError(/扫的不是仓库里的一个目录/)
    expect(() => scansIn({ 'entry.ts': `${HEADER}readdirSync(resolve('a'))\n` })).toThrowError(/运行时相对 cwd/)
  })

  it('注释里的示例路径不算 import', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bake-stamp-'))
    writeFileSync(
      resolve(dir, 'entry.ts'),
      "/** 形如 `from './nope'` 的写法。 */\n// import './nope-either'\nexport const y = 1\n",
    )
    expect(bakerSources(dir, 'entry.ts')).toEqual(['entry.ts'])
  })
})

/**
 * ## 这条判据进不进 CI
 *
 * **进，而且已经在里面了** —— 它是一个普通的 vitest 用例，CI 的 `pnpm test`
 * 会跑它。它只读文件、算 sha256，不需要 Java、`cwebp`、`afconvert`，也不需要
 * 仓库外的任何东西（原始素材全部入库）。实测这一档九条：单独跑 0.14 秒，
 * 在全量套件里与别人抢 CPU 时 0.6 秒（口径是 vitest 报的用例耗时）。
 *
 * 「在 CI 里」还差一步：`web.yml` 的 `paths:` 过滤原本不含素材目录，改一张
 * 头像根本不会触发这条流水线，而不触发在 PR 上跟通过长得一样。所以那两行
 * 补上了八个输入目录，并由上面那条用例拿指纹现算的目录名去核 —— 补的时候
 * 它当场逮到手写名单漏了 `dialogue/`。
 *
 * **进不了 CI 的是「重烘一遍再比对产物」那种做法**，那才是最直接的判据：
 * `cwebp` 要 `brew install webp`，`afconvert` 是 macOS 自带的（CI 是
 * ubuntu-latest，没有），而且 `afconvert` 的产物每次都不同（见上面那条用例的
 * 头注）。所以这里换成「指纹化输入」：**它证明的是「产物是这批输入烘出来的」，
 * 不是「产物是对的」**。产物本身对不对，靠 `roleSpriteSize.test.ts` 这类核
 * 产物的用例 —— 有了指纹，它们的结论才是关于今天这批输入的。
 *
 * **它兜不住的那一件事**：谁在本地改了 `bake.ts`、重烘、但只提交源码不提交
 * 产物 —— 那时指纹与产物一起旧，两边自洽。兜它的是 `git diff` 与 review：
 * 改了烘焙器的提交里没有 `src/generated/` 的改动，本身就是一个看得见的信号。
 *
 * **代价**：`bake.ts` 顺着 import 用到的每一个模块都在指纹里（今天 17 个，
 * 含 `src/state/*` 的几个常量与类型）。改动其中任何一个都得重跑一次
 * `pnpm bake`，哪怕产物一个字节都不变 —— 那种情况下 `git diff` 里只会多出
 * `bakeStamp.json` 里的一行。这是故意选的方向：宁可多红一次，也不要
 * 「改了可能影响产物的东西而判据不响」。
 */
