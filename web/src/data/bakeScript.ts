import { javaSplit } from './javaSplit'
import type { SceneScript } from './types'

/**
 * 缝 1 · 数据层：把一份 GBK 的 `script/*.txt` 解析成 `SceneScript`。
 *
 * 规格是原版的 `src/tools/Reader.java`，判据是 `tools/ground-truth/*.json`
 * ——那批 JSON 由原版解析器自己导出、已冻结，本函数的产物必须与之逐字段相等。
 *
 * 与 spec 里那句签名 `bakeScript(raw: Uint8Array)` 的差别：多一个 `scriptName`。
 * 真值的 26 个字段里第一个就是脚本文件名，而文件内容里没有它 —— 不传进来就
 * 只能在外面补一个字段，那样"一个函数产出完整的 SceneScript"就不成立了。
 *
 * 纯函数：不碰文件系统，不缓存。读文件的是 `scripts/bake.ts`。
 */
export function bakeScript(raw: Uint8Array, scriptName: string): SceneScript {
  const lines = splitLines(decodeGbk(raw))
  const r = new LineCursor(lines, scriptName)

  // 1. 地图名称
  const mapName = r.next()
  // 2. 地图规格 `列/行`，随后是 row 行、每行 col 个 0/1
  const spec = javaSplit(r.next(), '/')
  const col = r.int(spec[0], '地图列数')
  const row = r.int(spec[1], '地图行数')
  const mapSet: number[][] = []
  for (let y = 0; y < row; y += 1) {
    const cells = javaSplit(r.next(), ' ')
    const line: number[] = []
    for (let x = 0; x < col; x += 1) line.push(r.int(cells[x], `网格 (${x}, ${y})`))
    mapSet.push(line)
  }

  const s: SceneScript = {
    script: scriptName,
    mapName,
    col,
    row,
    // 原版 Reader 的字段初值，没有任何脚本段会改写它们（96 个真值全是 12 / 8）。
    roleX: 12,
    roleY: 8,
    sceneMusic: null,
    nextScript: null,
    npcList: null,
    exits: null,
    nextScene: null,
    entrance: null,
    dialogueCode: null,
    dialogue: null,
    narratage: null,
    battle0: null,
    battle1: null,
    battle2: null,
    selectShopPanel: null,
    selectEquipmentShopPanel: null,
    selectBattlePanel: null,
    selectQuestion: null,
    question: null,
    answer: null,
    treasureBox: null,
    mapSet,
  }

  // 其余的段：逐行读，认得的关键字进对应的读法，认不得的**静默跳过**
  // （原版 switch 没有 default 分支，行为一致）。
  while (r.hasMore()) {
    readSection(r.next().trim(), r, s)
  }
  return s
}

function readSection(keyword: string, r: LineCursor, s: SceneScript): void {
  switch (keyword) {
    // 队伍在场状态。只写原版的三个全局开关，不属于真值的 26 个字段，
    // 但那一行必须吃掉，否则会被当成段关键字重新分派。
    case 'Role':
      r.next()
      break

    // NPC 群：一整行，`/` 分组，组内空格分字段。字段数由第一位的状态码决定
    // （0 静止 / 1 单向 / 2 原地 / 3 四向），这里不解释，原样保留。
    case 'NPC':
      s.npcList = javaSplit(r.next(), '/').map((npc) => javaSplit(npc, ' '))
      break

    // 对话：一行对话类型（`/` 分组），每组随后是若干行、以 `#` 收尾。
    case 'Dialogue': {
      const codes = javaSplit(r.next(), '/')
      s.dialogueCode = codes
      s.dialogue = codes.map(() => r.until('#').map((line) => javaSplit(line, '/')))
      break
    }

    case 'Narratage':
      s.narratage = r.until('#')
      break

    // 出口：一行数量 n，随后每个出口三行 —— 出口坐标 / 入口坐标 / 目标脚本。
    case 'Exit': {
      const n = r.int(r.next(), '出口数量')
      const exits: string[][] = []
      const entrance: string[][] = []
      const nextScene: string[] = []
      for (let i = 0; i < n; i += 1) {
        exits.push(javaSplit(r.next(), '/'))
        entrance.push(javaSplit(r.next(), '/'))
        nextScene.push(r.next())
      }
      s.exits = exits
      s.entrance = entrance
      s.nextScene = nextScene
      break
    }

    case 'NextScript':
      s.nextScript = [r.next(), r.next(), r.next()]
      break

    // 战斗：一行 `0`（随机遇敌）或 `1`（固定战），随后若干行、`#` 收尾。
    // 其它值原版两个分支都不进，只吃掉那一行。
    case 'Fight': {
      const kind = r.next()
      if (kind === '0') s.battle0 = r.until('#').map((line) => javaSplit(line, ' '))
      else if (kind === '1') s.battle1 = r.until('#').map((line) => javaSplit(line, ' '))
      break
    }

    case 'SelectShopPanel':
      s.selectShopPanel = [r.next(), r.next(), r.next(), r.next()]
      break

    case 'SelectEquipmentShopPanel':
      s.selectEquipmentShopPanel = [r.next(), r.next(), r.next(), r.next()]
      break

    // 选择式战斗：每组 4 行文案 + 1 行战斗配置，`#` 收尾。
    // 两个字段一一对应，原版就是在同一个循环里成对 add 的。
    case 'SelectBattlePanel': {
      const panels: string[][] = []
      const battles: string[][] = []
      for (const first of r.eachUntil('#')) {
        panels.push([first, r.next(), r.next(), r.next()])
        battles.push(javaSplit(r.next(), ' '))
      }
      s.selectBattlePanel = panels
      s.battle2 = battles
      break
    }

    // 答题：每组 4 行文案 + 题面若干行（`Answer` 收尾）+ 4 行答案，`#` 收尾。
    case 'SelectQuestion': {
      const selects: string[][] = []
      const questions: string[][] = []
      const answers: string[][] = []
      for (const first of r.eachUntil('#')) {
        selects.push([first, r.next(), r.next(), r.next()])
        questions.push(r.until('Answer'))
        answers.push([r.next(), r.next(), r.next(), r.next()])
      }
      s.selectQuestion = selects
      s.question = questions
      s.answer = answers
      break
    }

    case 'TreasureBox':
      s.treasureBox = r.until('#').map((line) => javaSplit(line, ' '))
      break

    case 'Music':
      s.sceneMusic = r.next()
      break

    // 任务文本。原版存进一个静态字段，不在真值的 26 个字段里，吃掉那一行。
    case 'Task':
      r.next()
      break
  }
}

/**
 * 行游标。原版用 `BufferedReader.readLine()`：`\r\n` / `\n` / `\r` 都算行尾，
 * 到文件末尾返回 null —— 那些 `while (!s.equals("#"))` 的段在数据缺 `#` 时会
 * 直接 NPE。这里改成抛一条**说得出是哪个脚本、哪一行、在读什么**的错误：
 * 烘焙是构建期的事，静默产出半份数据比失败更糟。
 */
class LineCursor {
  private i = 0

  constructor(
    private readonly lines: string[],
    private readonly scriptName: string,
  ) {}

  hasMore(): boolean {
    return this.i < this.lines.length
  }

  next(): string {
    const line = this.lines[this.i]
    if (line === undefined) this.fail('文件已到末尾，还想再读一行')
    this.i += 1
    return line
  }

  /** 读到 `terminator` 那一行为止（不含），并吃掉它。 */
  until(terminator: string): string[] {
    const out: string[] = []
    for (;;) {
      const line = this.next()
      if (line === terminator) return out
      out.push(line)
    }
  }

  /**
   * 逐条产出直到 `terminator`：段体是多行一组、组长不固定的段用它。
   * 每次迭代交出该组的第一行，组内其余行由调用方自己 `next()` 取走。
   */
  *eachUntil(terminator: string): Generator<string> {
    for (;;) {
      const line = this.next()
      if (line === terminator) return
      yield line
    }
  }

  /** Java `Integer.parseInt` 的语义：只认可选正负号加十进制数字。 */
  int(text: string | undefined, what: string): number {
    if (text === undefined || !/^[+-]?\d+$/.test(text)) {
      this.fail(`${what} 不是整数: ${JSON.stringify(text)}`)
    }
    return Number.parseInt(text, 10)
  }

  private fail(message: string): never {
    throw new Error(`${this.scriptName} 第 ${this.i + 1} 行: ${message}`)
  }
}

/**
 * GBK → 字符串。`TextDecoder('gbk')` 是 WHATWG Encoding 标准的一部分，
 * 浏览器与 Node（完整 ICU）都有；仓库里的脚本、商店数据、存档全是 GBK。
 */
function decodeGbk(raw: Uint8Array): string {
  return new TextDecoder('gbk').decode(raw)
}

/** 按 `BufferedReader.readLine()` 的行尾定义切行。 */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/)
  // 末尾的行终止符不产生"最后一个空行"：Java 那里直接就是 EOF。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
