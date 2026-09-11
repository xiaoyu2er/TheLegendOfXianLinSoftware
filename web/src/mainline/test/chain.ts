import { readFileSync, readdirSync } from 'node:fs'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import type { SceneScript } from '../../data/types'

/**
 * **只给判据用**的主线链与可达闭包分析器（xl-czb.4）。不进产品包 —— 它用 `node:fs`
 * 读盘，形状同 `save/test/originalSave.ts`。
 *
 * 它读的是**已经入库的数据层真值** `tools/ground-truth/*.json`（原版 `tools.Reader`
 * 自己导出的逐字段结果），不自己再解析一遍脚本；机制（起点、哪几个敌人会推剧情）
 * 从 GBK 源码现读，不手抄。
 *
 * ## 一跳是怎么发生的（`scene/ExitEvent.java` / `FightEvent.java` 现读）
 *
 * 场景面板带着两个三元组 `[落点 "x/y", 场景名, 脚本名]`：`currentScript` 与
 * `nextScript`。进一本带 `NextScript` 段的脚本就把 `nextScript` 换成它的；进一本
 * 不带的（自由走动的场景）**不换** —— 于是在自由场景里走动时，`nextScript` 还是
 * 上一本剧情的。一跳有三种：
 *
 * - **战斗**：`FightEvent.fight` 开打之前，敌 1 是那张写死的名单上的人，就调
 *   `exitEvent.nextScript()` 直接载入 `nextScript[2]`。出口段不参与。
 * - **出口**：对话走完之后踩一个出口，出口名等于 `nextScript[1]` 就载入
 *   `nextScript[2]`；否则载入那个出口名本身（自由场景），而那个场景里的出口名再等于
 *   `nextScript[1]` 时同样载入 `nextScript[2]`。所以出口目标**不一定在本脚本的出口段
 *   里** —— 它只要在「从本脚本的出口走得到的地方」就行（`roam`）。
 * - **结局**：对话里有 `$` 那一句（`Dialogue.java` 把它读成 `gameOver`），
 *   说完切到结局面板，那本脚本的 `nextScript` 不再被读。
 *
 * ## 出口名怎么变成文件：两种平台语义
 *
 * 原版 `new Reader(name)` 打开 `"script//" + name`，**名字原样拼进路径**。出口名是否
 * 打得开因此取决于文件系统：
 *
 * - `posix`：逐字相等才打得开。**实测**（2026-09-11，macOS + openjdk 17）：
 *   `new tools.Reader("仙二教学楼二楼夜.txt ")` 抛 `FileNotFoundException`，
 *   去掉行尾空格的同名文件打得开。Web 版的 `data/loadedScenes.ts` 也是逐字取
 *   （读代码读出来的，没跑过）。
 * - `win32`：Windows 的路径规范化会去掉末尾的空格与点。⚠️ **未验证**：这是 Win32
 *   文件 API 的文档行为，这台机器上跑不了；原版作者用的是 Windows 这件事也只是从
 *   数据里的反斜杠路径推的。
 *
 * 两种语义下链的形状不同（行尾空格那族缺陷 xl-1dv.11 正好落在链上），所以每个
 * 判据都显式说它用的是哪一种。
 */

/** 数据层真值，键是脚本文件名，如 `宿舍.txt`。 */
export type Truths = ReadonlyMap<string, SceneScript>

export type Platform = 'posix' | 'win32'

/** 读入全部脚本真值。分母现扫：目录里有几份 `*.json` 就是几本（`存档/` 子目录不算）。 */
export function loadTruths(): Truths {
  const dir = repoPath('tools/ground-truth')
  const out = new Map<string, SceneScript>()
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const s = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as SceneScript
    out.set(s.script, s)
  }
  return out
}

/** `[落点, 场景名, 脚本名]`，与原版 `ScenePanel.currentScript` 同形。 */
export type Triple = readonly [string, string, string]

/**
 * 起点，从源码现读：新游戏时 `StartPanel` 直接 `initiation("<脚本>")`，而那一刻的
 * `currentScript` 是 `ScenePanel` 构造函数写死的三元组。两者分开读 —— 前者决定第一本
 * 载入哪本，后者决定第一本里「对话没走完就踩出口」时认哪个场景名是「本段剧情」。
 */
export function readStart(): { script: string; currentScript: Triple } {
  const start = javaSource('src/start/StartPanel.java')
  const inits = [...start.matchAll(/scenePanel\.initiation\("([^"]+)"\)/g)].map((m) => m[1]!)
  if (inits.length !== 1) throw new Error(`StartPanel 里 initiation("…") 应恰好一处，读到 ${inits.length} 处`)
  const panel = javaSource('src/scene/ScenePanel.java')
  const cur = [0, 1, 2].map((i) => {
    const m = panel.match(new RegExp(`currentScript\\[${i}\\] = "([^"]+)";`))
    if (!m) throw new Error(`ScenePanel 构造函数里读不到 currentScript[${i}]`)
    return m[1]!
  })
  return { script: inits[0]!, currentScript: [cur[0]!, cur[1]!, cur[2]!] }
}

/** 开打前会推剧情的敌 1，从 `FightEvent.fight` 那一串 `enemy1.equals("…")` 现读。 */
export function readPlotBosses(): ReadonlySet<string> {
  const src = javaSource('src/scene/FightEvent.java')
  const guard = src.match(/if \((enemy1\.equals\("[^"]+"\)[\s|]*)+\)\s*scene\.exitEvent\.nextScript\(\);/)
  if (!guard) throw new Error('FightEvent 里读不到「敌 1 在名单上就 nextScript()」那一句')
  const names = [...guard[0].matchAll(/enemy1\.equals\("([^"]+)"\)/g)].map((m) => m[1]!)
  if (names.length === 0) throw new Error('那一句里一个名字都没读到')
  return new Set(names)
}

/** 一个出口名在给定平台上打开的是哪本脚本；打不开是 `undefined`。 */
export function resolve(truths: Truths, name: string, platform: Platform): string | undefined {
  const file = platform === 'win32' ? name.replace(/[ .]+$/, '') : name
  return truths.has(file) ? file : undefined
}

/** 一本脚本的出口目标（`nextScene`），没有出口段是空表。 */
export const exitsOf = (s: SceneScript): readonly string[] => s.nextScene ?? []

const get = (truths: Truths, file: string): SceneScript => {
  const s = truths.get(file)
  if (!s) throw new Error(`数据层真值里没有 ${file}`)
  return s
}

/** 从若干个出口名出发，能走进的所有**文件**（广度优先，只跟打得开的出口名走）。 */
export function roam(truths: Truths, from: readonly string[], platform: Platform): Set<string> {
  const files = new Set<string>()
  const queue = [...from]
  for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
    const file = resolve(truths, n, platform)
    if (file === undefined || files.has(file)) continue
    files.add(file)
    queue.push(...exitsOf(get(truths, file)))
  }
  return files
}

/** 对话里有没有 `$` 那一句（结局开关）。 */
export const endsGame = (s: SceneScript): boolean =>
  (s.dialogue ?? []).some((seg) => seg.some((sentence) => sentence.some((f) => f.includes('$'))))

/** 剧情固定战里第一场敌 1 在推剧情名单上的那个敌人。 */
export const plotBattle = (s: SceneScript, bosses: ReadonlySet<string>): string | undefined =>
  (s.battle1 ?? []).map((b) => b[4] ?? '').find((e) => bosses.has(e))

export type HopKind =
  /** 开打前推剧情。 */
  | { kind: 'battle'; boss: string }
  /** 出口目标就在本脚本的出口段里。 */
  | { kind: 'exit' }
  /** 出口目标不在本脚本的出口段里，要先走进自由场景 `via`，在那里踩到它。 */
  | { kind: 'roam'; via: string }

export interface Hop {
  /** 链上第几跳，从 1 数。 */
  index: number
  from: string
  triple: Triple
  how: HopKind
}

export type ChainBreak =
  | { reason: 'missing'; index: number; from: string; target: string }
  | { reason: 'unreachable'; index: number; from: string; target: string }
  | { reason: 'cycle'; index: number; from: string; target: string }
  | { reason: 'dead-end'; index: number; from: string }

export interface Chain {
  platform: Platform
  /** 链上各本，起点在前；走到结局时结局那本在末。 */
  scripts: string[]
  hops: Hop[]
  /** 走到结局就没有；断了就是断在哪。 */
  broken?: ChainBreak
}

/** 一跳怎么发生；三种都不成立就是 `undefined`（这一跳走不过去）。 */
export function hopKind(
  truths: Truths,
  s: SceneScript,
  next: Triple,
  bosses: ReadonlySet<string>,
  platform: Platform,
): HopKind | undefined {
  const boss = plotBattle(s, bosses)
  if (boss !== undefined) return { kind: 'battle', boss }
  if (exitsOf(s).includes(next[1])) return { kind: 'exit' }
  const via = [...roam(truths, exitsOf(s), platform)]
    .sort()
    .find((f) => exitsOf(get(truths, f)).includes(next[1]))
  return via === undefined ? undefined : { kind: 'roam', via }
}

/** 顺着 `nextScript` 从起点走到结局，或走到断处。 */
export function walkChain(
  truths: Truths,
  platform: Platform,
  start: string = readStart().script,
  bosses: ReadonlySet<string> = readPlotBosses(),
): Chain {
  const scripts = [start]
  const hops: Hop[] = []
  const done = (broken?: ChainBreak): Chain => (broken ? { platform, scripts, hops, broken } : { platform, scripts, hops })
  if (!truths.has(start)) return done({ reason: 'missing', index: 0, from: '(起点)', target: start })
  for (let cur = start; ; ) {
    const s = get(truths, cur)
    if (endsGame(s)) return done()
    const index = hops.length + 1
    if (!s.nextScript) return done({ reason: 'dead-end', index, from: cur })
    const [pos = '', scene = '', target = ''] = s.nextScript
    const triple: Triple = [pos, scene, target]
    if (!truths.has(target)) return done({ reason: 'missing', index, from: cur, target })
    if (scripts.includes(target)) return done({ reason: 'cycle', index, from: cur, target })
    const how = hopKind(truths, s, triple, bosses, platform)
    if (!how) return done({ reason: 'unreachable', index, from: cur, target: scene })
    hops.push({ index, from: cur, triple, how })
    scripts.push(target)
    cur = target
  }
}

/** 断点的人话，测试失败时直接打出来。 */
export function describeBreak(b: ChainBreak): string {
  switch (b.reason) {
    case 'missing':
      return `主线断在第 ${b.index} 跳：${b.from} 的下一段剧情指向 ${b.target}，数据层真值里没有这本脚本`
    case 'unreachable':
      return `主线断在第 ${b.index} 跳：${b.from} 要踩的出口 ${b.target} 既不在它的出口段里、也不在从它走得到的场景里，而它也没有推剧情的战斗`
    case 'cycle':
      return `主线在第 ${b.index} 跳绕回来了：${b.from} → ${b.target}`
    case 'dead-end':
      return `主线断在第 ${b.index} 跳：${b.from} 既没有下一段剧情、也不是结局`
  }
}

/**
 * **可达闭包**：链上各本，加上从它们的出口一路走得进的所有文件。
 *
 * 只跟打得开的出口名走（占位名在两种平台上都打不开，什么都载不进来）。自由场景里
 * 名为 `nextScript[1]` 的出口会改载剧情脚本，而那本已经在链上，不必单独处理。
 */
export function reachable(truths: Truths, chain: Chain): Set<string> {
  const out = new Set(chain.scripts)
  const exits = chain.scripts.flatMap((c) => exitsOf(get(truths, c)))
  for (const f of roam(truths, exits, chain.platform)) out.add(f)
  return out
}

/** 全库里够不着的那几本。 */
export const unreachable = (truths: Truths, closure: ReadonlySet<string>): string[] =>
  [...truths.keys()].filter((k) => !closure.has(k)).sort()

/**
 * 占位名出口（xl-1dv.13）的精确表述：**踩的顺序不对才断**。
 *
 * 那个名字同时是本脚本的 `nextScript[1]`：对话走完踩上去，`ExitEvent` 走「载入
 * `nextScript[2]`」那一支，不碰这个名字；对话没走完踩上去，只要它不等于进场时的
 * `currentScript[1]`，就走 `initiation(出口名)` 那一支，去找一个不存在的文件。
 *
 * 本脚本自己**没有**对话编号时，`initiation` 不新建 `DialogueEvent`，沿用上一本的
 * （xl-1dv.7）—— 上一跳是出口跳（含走自由场景）的话，那个对象的 `dialogueEventOver`
 * 必为真（出口跳要求对话走完），于是这种占位名**永远不会**走到断的那一支。
 */
export interface Placeholder {
  script: string
  name: string
  /** 等于本脚本 `nextScript[1]`：对话走完踩上去是一跳，不是崩溃。 */
  isOwnNext: boolean
  /** 进场时的 `currentScript[1]`（不在链上是 `undefined`）。 */
  entryScene: string | undefined
  /** 本脚本有自己的对话编号（否则沿用上一本的对话对象）。 */
  ownDialogue: boolean
  /** 进这本的那一跳的类型（起点、不在链上都是 `undefined`）。 */
  enteredBy: HopKind['kind'] | undefined
  verdict: 'breaks-if-early' | 'never-breaks' | 'always-breaks'
}

/** 占位名：打不开，去掉行尾空白也打不开，而且不像文件名（不带 `.txt`）。 */
export const isPlaceholder = (truths: Truths, name: string): boolean =>
  !truths.has(name.trimEnd()) && !name.trimEnd().endsWith('.txt')

/** 出口名带行尾空白、去掉就打得开（xl-1dv.11）。 */
export const isTrailingSpace = (truths: Truths, name: string): boolean =>
  name !== name.trimEnd() && truths.has(name.trimEnd())

/** 像文件名、却没有这个文件（xl-1dv.12）。 */
export const isMissingFile = (truths: Truths, name: string): boolean =>
  !truths.has(name.trimEnd()) && name.trimEnd().endsWith('.txt')

export function placeholders(truths: Truths, chain: Chain, closure: ReadonlySet<string>, startCurrent: Triple): Placeholder[] {
  const out: Placeholder[] = []
  for (const f of [...closure].sort()) {
    const s = get(truths, f)
    for (const name of exitsOf(s)) {
      if (!isPlaceholder(truths, name)) continue
      const i = chain.scripts.indexOf(f)
      const entered = i > 0 ? chain.hops[i - 1] : undefined
      const entryScene = i < 0 ? undefined : entered ? entered.triple[1] : startCurrent[1]
      const enteredBy = entered?.how.kind
      const isOwnNext = s.nextScript?.[1] === name
      const ownDialogue = s.dialogueCode !== null
      let verdict: Placeholder['verdict']
      if (i < 0 || !isOwnNext) verdict = 'always-breaks'
      else if (entryScene === name) verdict = 'never-breaks'
      else if (!ownDialogue && enteredBy !== undefined && enteredBy !== 'battle') verdict = 'never-breaks'
      else verdict = 'breaks-if-early'
      out.push({ script: f, name, isOwnNext, entryScene, ownDialogue, enteredBy, verdict })
    }
  }
  return out
}

/** 全库里出口名满足 `pred` 的那几本脚本。 */
export const filesWithExit = (truths: Truths, pred: (name: string) => boolean): string[] =>
  [...truths.values()].filter((s) => exitsOf(s).some(pred)).map((s) => s.script).sort()

/**
 * 段落类别的选择器：一本脚本有没有这一类段。「走路」每本都有、「存读档」是菜单
 * 不是数据，都不在这里 —— 这里只收数据里查得出来的。
 */
export const SEGMENT_KINDS: Readonly<Record<string, (s: SceneScript, bosses: ReadonlySet<string>) => boolean>> = {
  对话: (s) => s.dialogueCode !== null,
  旁白: (s) => s.narratage !== null,
  剧情战: (s) => s.battle1 !== null && s.battle1.length > 0,
  推剧情的剧情战: (s, b) => plotBattle(s, b) !== undefined,
  随机遭遇: (s) => s.battle0 !== null && s.battle0.length > 0,
  选择战: (s) => s.selectBattlePanel !== null,
  宝箱: (s) => s.treasureBox !== null,
  药店: (s) => s.selectShopPanel !== null,
  装备店: (s) => s.selectEquipmentShopPanel !== null,
  答题: (s) => s.selectQuestion !== null,
  结局: (s) => endsGame(s),
}

/** 每一类段落落在哪几本里：分链上 / 只在闭包里两栏。 */
export function segmentReport(
  truths: Truths,
  chain: Chain,
  closure: ReadonlySet<string>,
  bosses: ReadonlySet<string>,
): Record<string, { chain: string[]; closureOnly: string[] }> {
  const out: Record<string, { chain: string[]; closureOnly: string[] }> = {}
  for (const [kind, has] of Object.entries(SEGMENT_KINDS)) {
    const hit = [...closure].filter((f) => has(get(truths, f), bosses)).sort()
    out[kind] = {
      chain: hit.filter((f) => chain.scripts.includes(f)),
      closureOnly: hit.filter((f) => !chain.scripts.includes(f)),
    }
  }
  return out
}
