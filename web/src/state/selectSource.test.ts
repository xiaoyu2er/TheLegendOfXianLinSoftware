import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import type { SceneScript } from '../data/types'
import { javaSource } from '../test/javaSource'
import {
  ABCD_FIRST_FROM_END,
  ABCD_LAST_FROM_END,
  MAX_LINE,
  QUESTION_IMAGE_MS,
  QUESTION_MAX_LENGTH,
  SELECT_IMAGE_MS,
  SELECT_MAX_LENGTH,
  WORDS_MS,
  createSelect,
  selectKeyPressed,
  showSelectQuestion,
  tickSelectTimers,
  tickSelectWords,
  toSelectDraft,
} from './select'
import type { SelectDraft, SelectHost } from './select'
import { TICK_MS } from './step'
import { SCENE_TRACE_NAMES, readTrace, tickSceneName } from './trace'
import type { TraceTick } from './trace'

/**
 * 答题这一支（xl-yg6.9）里**判据回到 GBK 源码上取**的两件事。
 *
 * 1. 逐字吐的那几个数 —— 一行多少字、缓存有几行、每拍吐几个、多久吐一拍 ——
 *    **全部从 `SelectEvent.java` 现读**，不在测试里再抄一遍。`select.ts` 里的
 *    常量是抄来的，这里拿源码撞它：改了其中任何一个，这里红。
 * 2. `SelectEvent.keyPressed` 的每一个段落（叶子块）。**分母是从源码解析出来的
 *    段落名单**；真值走过哪几段是拿真值逐 tick 现算的；真值没走到的那几段各有
 *    一条回到源码上取的用例。最后一条用例把这三样对撞（dispatch.md §「真值盖不到
 *    那个分支」的第二条出路，外加「分母现扫、登记手签」）。
 */

const SELECT_EVENT = 'src/scene/SelectEvent.java'

/**
 * 读 `SelectEvent.java`，去掉行注释、挤掉空白。
 *
 * 行注释只认**前面是空白**的 `//`：构造函数里有一句
 * `Reader.readImage("dialogue//选择框.png");// 500*150`，字符串里那两个斜杠
 * 不能当成注释切掉。`.` 两侧的空白也挤掉 —— 原文是 Eclipse 自动折的行，
 * `question\n\t\t\t\t\t\t\t\t.get(...)` 这种写法挤完才与同一个表达式的另一处写法相同。
 */
function squeezed(): string {
  const source = javaSource(SELECT_EVENT)
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '.')
  // 空转要响（`test/javaSource.ts` 的规矩）：解码坏了会让下面每一个"没解析出来"
  // 都读成"原版里没有这一段"。
  if (!source.includes('class SelectEvent')) throw new Error(`${SELECT_EVENT} 没读出 class SelectEvent`)
  return source
}

/** 恰好一处匹配，取第 1 组。零处或多处都抛 —— 两种都是"读到的不是想读的那个"。 */
function readOne(source: string, re: RegExp, what: string): string {
  const all = [...source.matchAll(new RegExp(re.source, 'g'))]
  if (all.length !== 1) throw new Error(`${what}：源码里匹配到 ${all.length} 处，应为 1 处（${re}）`)
  return all[0]![1]!
}

// ——— 一个只认得这个文件的 Java 语句解析器 ———
//
// 只认三种语句：`if (…) S [else S]`、`{ … }`、以 `;` 结尾的简单语句。只拿它解
// `keyPressed`，那里没有别的形状（没有 for / while / switch）；真出现了，简单语句
// 那一支读到 `}` 就抛 —— 实测：拿它去解带 `for` 的 `showSelectBattlePanel`，
// 报的正是「简单语句没有以 ; 结尾」。

type Stmt =
  | { readonly kind: 'if'; readonly cond: string; readonly then: Stmt; readonly else: Stmt | null }
  | { readonly kind: 'block'; readonly body: readonly Stmt[] }
  | { readonly kind: 'simple'; readonly text: string }

class Cursor {
  constructor(
    readonly s: string,
    public i: number,
  ) {}
  ws(): void {
    while (this.s[this.i] === ' ') this.i++
  }
  /** 从一个开括号读到与它配对的闭括号，返回括号里面的文本。跳过字符串字面量。 */
  balanced(open: string, close: string): string {
    if (this.s[this.i] !== open) throw new Error(`第 ${this.i} 个字符应为 ${open}：${this.s.slice(this.i, this.i + 40)}`)
    const start = ++this.i
    let depth = 1
    while (this.i < this.s.length) {
      const ch = this.s[this.i]!
      if (ch === '"') this.skipString()
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) return this.s.slice(start, this.i++)
      this.i++
    }
    throw new Error(`${open} 没有配对的 ${close}`)
  }
  skipString(): void {
    this.i++
    while (this.s[this.i] !== '"') {
      if (this.s[this.i] === '\\') this.i++
      if (this.i >= this.s.length) throw new Error('字符串没闭合')
      this.i++
    }
  }
  keyword(word: string): boolean {
    return this.s.startsWith(word, this.i) && !/\w/.test(this.s[this.i + word.length] ?? '')
  }
}

function parseStmt(c: Cursor): Stmt {
  c.ws()
  if (c.keyword('if')) {
    c.i += 2
    c.ws()
    const cond = c.balanced('(', ')').trim()
    const then = parseStmt(c)
    c.ws()
    let otherwise: Stmt | null = null
    if (c.keyword('else')) {
      c.i += 4
      otherwise = parseStmt(c)
    }
    return { kind: 'if', cond, then, else: otherwise }
  }
  if (c.s[c.i] === '{') {
    const inner = c.balanced('{', '}')
    return { kind: 'block', body: parseBody(inner) }
  }
  const start = c.i
  let depth = 0
  while (c.i < c.s.length) {
    const ch = c.s[c.i]!
    if (ch === '"') c.skipString()
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ';' && depth === 0) return { kind: 'simple', text: c.s.slice(start, ++c.i).trim() }
    c.i++
  }
  throw new Error(`简单语句没有以 ; 结尾：${c.s.slice(start, start + 60)}`)
}

function parseBody(text: string): Stmt[] {
  const c = new Cursor(text, 0)
  const body: Stmt[] = []
  for (c.ws(); c.i < text.length; c.ws()) body.push(parseStmt(c))
  return body
}

/**
 * 一个方法（或内部类）的方法体原文：`{` 与配对的 `}` 之间。签名按挤过空白之后的
 * 样子写。只要拿正则数东西的地方用它 —— 那些方法里有 `for`，解析器不认。
 */
function methodText(source: string, signature: string): string {
  const at = source.indexOf(signature)
  if (at < 0) throw new Error(`源码里没有 ${signature}`)
  return new Cursor(source, source.indexOf('{', at)).balanced('{', '}')
}

/** 同上，解析成语句。只给 `keyPressed` 用：它里面只有 if / 块 / 简单语句三种形状。 */
function methodBody(source: string, signature: string): Stmt[] {
  return parseBody(methodText(source, signature))
}

/** 一个段落：从方法入口走到它要经过的每一个条件（取真还是取假），以及段里的简单语句。 */
interface Leaf {
  readonly path: readonly { readonly cond: string; readonly taken: boolean }[]
  readonly statements: readonly string[]
}

/**
 * 段落 = 一个块里**直接**写着的那几条简单语句。一个块里既有简单语句又有嵌套
 * `if` 时，简单语句归这个块自己那一段，嵌套的各自再成段；没有简单语句的块
 * （只是一层 `if` 的外壳）不成段。
 */
function leavesOf(body: readonly Stmt[], path: Leaf['path'] = []): Leaf[] {
  const out: Leaf[] = []
  const simple = body.flatMap((s) => (s.kind === 'simple' ? [s.text] : []))
  if (simple.length > 0) out.push({ path, statements: simple })
  for (const s of body) {
    if (s.kind === 'block') out.push(...leavesOf(s.body, path))
    if (s.kind === 'if') {
      out.push(...leavesOf([s.then], [...path, { cond: s.cond, taken: true }]))
      if (s.else !== null) out.push(...leavesOf([s.else], [...path, { cond: s.cond, taken: false }]))
    }
  }
  return out
}

/** 段落的名字：沿途每个条件，取假的写成 `!(…)`。**这就是下面那张登记表的键**。 */
function labelOf(leaf: Leaf): string {
  return leaf.path.map((p) => (p.taken ? p.cond : `!(${p.cond})`)).join(' / ')
}

// ——— 拿真值里那一拍之前的状态，求这些条件 ———

/** 条件里读得到的那几个字段，用真值的字段名（`OBSERVERS.select` 的那套翻译）。 */
type Pre = Pick<
  TraceTick['select'],
  | 'active'
  | 'shop'
  | 'equipShop'
  | 'battle'
  | 'question'
  | 'asking'
  | 'answering'
  | 'yesNo'
  | 'abcd'
  | 'questionNo'
>

interface Ctx {
  readonly pre: Pre
  readonly key: string
  readonly scene: SceneScript
}

/**
 * 源码里的量 → 这一层的值。**只登记条件里真出现的**；源码的条件里冒出一个
 * 这里没有的量，`term` 当场抛 —— 悄悄当成 false 的话，那一段会被判成"没走到"，
 * 而那与"真值确实没走到"长得一样。
 */
const TERMS: Readonly<Record<string, (c: Ctx) => number | string | boolean>> = {
  keyCode: (c) => c.key,
  'KeyEvent.VK_DOWN': () => 'down',
  'KeyEvent.VK_UP': () => 'up',
  'KeyEvent.VK_ENTER': () => 'enter',
  'KeyEvent.VK_SPACE': () => 'space',
  count_selectYesNo: (c) => c.pre.yesNo,
  count_selectABCD: (c) => c.pre.abcd,
  shopSelect: (c) => c.pre.shop,
  equipmentSelect: (c) => c.pre.equipShop,
  battleSelect: (c) => c.pre.battle,
  questionSelect: (c) => c.pre.question,
  isQuestion: (c) => c.pre.asking,
  isAnswer: (c) => c.pre.answering,
  'question.get(count_questionAndAnswer).size()': (c) => {
    const lines = c.scene.question?.[c.pre.questionNo]
    if (lines === undefined) throw new Error(`${c.scene.script} 没有第 ${c.pre.questionNo} 道题`)
    return lines.length
  },
  'Integer.parseInt(answer.get(count_questionAndAnswer)[0])': (c) => {
    const row = c.scene.answer?.[c.pre.questionNo]
    if (row === undefined) throw new Error(`${c.scene.script} 没有第 ${c.pre.questionNo} 道题的答案`)
    return Number.parseInt(row[0] ?? '', 10)
  },
}

function term(expr: string, c: Ctx): number | string | boolean {
  const e = expr.trim()
  if (/^\d+$/.test(e)) return Number(e)
  const arith = /^(.*) ([-+]) (\d+)$/.exec(e)
  if (arith !== null) {
    const base = term(arith[1]!, c)
    if (typeof base !== 'number') throw new Error(`${e}：${arith[1]} 不是数`)
    return arith[2] === '-' ? base - Number(arith[3]) : base + Number(arith[3])
  }
  const read = TERMS[e]
  if (read === undefined) throw new Error(`条件里有一个没登记的量：${e}`)
  return read(c)
}

function holds(cond: string, c: Ctx): boolean {
  if (cond.includes('&&')) throw new Error(`没教过它 &&：${cond}`)
  return cond.split(' || ').some((atom) => {
    const cmp = /^(.*?) (==|!=|<=|>=|<|>) (.*)$/.exec(atom.trim())
    if (cmp === null) return term(atom, c) === true
    const [l, r] = [term(cmp[1]!, c), term(cmp[3]!, c)]
    switch (cmp[2]) {
      case '==':
        return l === r
      case '!=':
        return l !== r
      case '<':
        return l < r
      case '>':
        return l > r
      case '<=':
        return l <= r
      default:
        return l >= r
    }
  })
}

function reaches(leaf: Leaf, c: Ctx): boolean {
  return leaf.path.every((p) => holds(p.cond, c) === p.taken)
}

const KEY_PRESSED = leavesOf(methodBody(squeezed(), 'public void keyPressed(int keyCode) {'))

/**
 * 真值走过的段落：每一份场景真值里，**选择框开着的那一拍之前**有按键的每一拍，
 * 拿上一拍记下的状态求一遍每个段落的条件。
 *
 * 为什么是上一拍：一拍里是"输入 → 定时器"（`state/step.ts`），而定时器只动
 * 游标与框的尺寸，条件里读的那几个旗标与光标它们一个都不碰；于是上一拍记下的
 * 那几个值，就是 `keyPressed` 进门那一刻读到的值。
 *
 * 为什么只看 `active`：`ScenePanel.keyPressed` 只在 `selectEvent.isSelect` 为真
 * 时才把键交给它。⚠️ 那个 `isSelect` 读的是**同一下空格里刚被 `checkNPCOral`
 * 打开的**那个（`state/step.ts` 的 `applyInput` 末尾），所以上一拍不开、这一拍
 * 打开的那下空格也进了 `keyPressed`。跳过它丢不掉任何段落：刚打开的框只会是
 * 四个 `*Select` 之一，而空格那一段要的是 `isAnswer`。
 */
function walkedByTruth(): Map<string, string[]> {
  const walked = new Map<string, string[]>()
  for (const name of SCENE_TRACE_NAMES) {
    const ticks = readTrace(name).ticks
    for (let i = 1; i < ticks.length; i++) {
      const prev = ticks[i - 1]!
      const presses = ticks[i]!.input.filter((e) => e.e === 'press')
      if (!prev.select.active || presses.length === 0) continue
      // 同一拍两个键：第二个键进门时的状态真值里没有。今天一次都没有（实测），
      // 真出现了要响，而不是拿上一拍的状态硬求。
      if (presses.length > 1) throw new Error(`${name} t=${ticks[i]!.t} 选择框开着时一拍按了 ${presses.length} 个键`)
      const c: Ctx = { pre: prev.select, key: presses[0]!.k, scene: getScene(tickSceneName(prev)) }
      for (const leaf of KEY_PRESSED) {
        if (!reaches(leaf, c)) continue
        const label = labelOf(leaf)
        walked.set(label, [...(walked.get(label) ?? []), `${name}@t=${ticks[i]!.t}`])
      }
    }
  }
  return walked
}

// ——— 真值没走到的段落：各自回到源码上取 ———

const host: SelectHost = {
  fight: () => {
    throw new Error('答题这一支不该起战斗')
  },
  switchTo: () => {
    throw new Error('答题这一支不该切面板')
  },
  present: () => {},
  random: () => 0.5,
}

/** 把选择框的三个定时器推到都停下来。 */
function settle(d: SelectDraft, from: number): number {
  let now = from
  for (let i = 0; i < 4000; i++) {
    if (!d.selectImageMove.running && !d.questionImageMove.running && !d.wordsRun.running) return now
    tickSelectTimers(d, now)
    now += TICK_MS
  }
  throw new Error('选择框的三个定时器 4000 拍还没停下来')
}

/** 大活第 `questionNo` 道题的问题框，吐完、光标停在初值上。 */
function asking(questionNo: number): { d: SelectDraft; now: number; size: number } {
  const built = createSelect(getScene('大活'), [])
  const d = toSelectDraft(built.select, built.recorder)
  showSelectQuestion(d, questionNo, 0)
  let now = settle(d, 0)
  selectKeyPressed(d, 'enter', now, host)
  now = settle(d, now)
  if (!d.asking) throw new Error('夹具没走到问题框')
  return { d, now, size: getScene('大活').question![questionNo]!.length }
}

function preOf(d: SelectDraft): Pre {
  return {
    active: d.isSelect,
    shop: d.shop,
    equipShop: d.equipShop,
    battle: d.battle,
    question: d.question,
    asking: d.asking,
    answering: d.answering,
    yesNo: d.yesNo,
    abcd: d.abcd,
    questionNo: d.questionNo,
  }
}

interface SourceCase {
  /** 造一个能走进这一段的状态，返回要按的键。 */
  readonly arrange: () => { readonly d: SelectDraft; readonly now: number; readonly key: string }
  /** 按下之后该是什么样。**期望值是照这一段的语句写的**，每条注明是哪一句。 */
  readonly check: (d: SelectDraft, size: number) => void
}

const DOWN_OR_UP = 'keyCode == KeyEvent.VK_DOWN || keyCode == KeyEvent.VK_UP'

/**
 * **真值没走到的段落 —— 手写登记。** 键是段落名（`labelOf`），与解析出来的名单
 * 对撞：少登记一段、多登记一段、登记了一段真值其实走过的，最后一条用例都红。
 *
 * 今天剩下的三段全在问题框的上下键里：两条答题剧本只按过两下下键（3→4→5），
 * 没有一次到过底、也没有一次按过上键。
 */
const SOURCE_CASES: Readonly<Record<string, SourceCase>> = {
  // `count_selectABCD = question.get(count_questionAndAnswer).size() - 5;`
  [`${DOWN_OR_UP} / isQuestion / keyCode == KeyEvent.VK_DOWN / !(count_selectABCD < question.get(count_questionAndAnswer).size() - 2)`]:
    {
      arrange: () => {
        const { d, now, size } = asking(1)
        d.abcd = size - ABCD_LAST_FROM_END
        return { d, now, key: 'down' }
      },
      check: (d, size) => expect(d.abcd, '到底再按下键：绕回第一项').toBe(size - ABCD_FIRST_FROM_END),
    },
  // `count_selectABCD--;`
  [`${DOWN_OR_UP} / isQuestion / !(keyCode == KeyEvent.VK_DOWN) / keyCode == KeyEvent.VK_UP / count_selectABCD > question.get(count_questionAndAnswer).size() - 5`]:
    {
      arrange: () => {
        const { d, now, size } = asking(1)
        d.abcd = size - ABCD_FIRST_FROM_END + 2
        return { d, now, key: 'up' }
      },
      check: (d, size) => expect(d.abcd, '不在顶上时按上键：往上一项').toBe(size - ABCD_FIRST_FROM_END + 1),
    },
  // `count_selectABCD = question.get(count_questionAndAnswer).size() - 2;`
  [`${DOWN_OR_UP} / isQuestion / !(keyCode == KeyEvent.VK_DOWN) / keyCode == KeyEvent.VK_UP / !(count_selectABCD > question.get(count_questionAndAnswer).size() - 5)`]:
    {
      arrange: () => {
        const { d, now, size } = asking(1)
        d.abcd = size - ABCD_FIRST_FROM_END
        return { d, now, key: 'up' }
      },
      check: (d, size) => expect(d.abcd, '在顶上按上键：绕到最后一项').toBe(size - ABCD_LAST_FROM_END),
    },
}

describe('逐字吐的那几个数：从 GBK 源码现读', () => {
  const source = squeezed()

  it('缓存几行（maxLine）与每拍吐几个字（count_word++ 恰好一处）', () => {
    expect(MAX_LINE).toBe(Number(readOne(source, /private int maxLine = (\d+);/, 'maxLine')))

    // "每次吐几个"：`WordsRun` 里 `count_word` 只有一处自增、一次加 1，没有别的
    // 写法往上加。源码那一头先核……
    const text = methodText(source, 'class WordsRun implements ActionListener {')
    expect(text.match(/count_word\+\+/g) ?? []).toHaveLength(1)
    expect(text).not.toMatch(/count_word \+=|count_word = count_word/)
    // ……这一层再核：推一拍，`wordNo` 恰好 +1、这一行恰好长一个字。
    const { d } = asking(0)
    d.sentences = [null, '一二三四五']
    d.sentenceNo = 1
    d.wordNo = 2
    d.lineNo = 0
    tickSelectWords(d)
    expect(d.wordNo).toBe(3)
    expect(d.text[0]).toBe('一二三')
  })

  /**
   * 一行几个字：字段初值一处，外加每个 `show*` 方法各自重设一次。**哪几个方法
   * 重设了它，是从源码里现扫的**；这张表是登记（这一层用哪个常量对应它），两者对撞。
   */
  it('一行几个字（maxLength）：每一处赋值都对得上这一层的常量', () => {
    expect(SELECT_MAX_LENGTH).toBe(Number(readOne(source, /private int maxLength = (\d+);/, 'maxLength 初值')))

    const REGISTERED: Readonly<Record<string, number>> = {
      showSelectShopPanel: SELECT_MAX_LENGTH,
      showSelectEquipmentShopPanel: SELECT_MAX_LENGTH,
      showSelectBattlePanel: SELECT_MAX_LENGTH,
      showSelectQuestion: SELECT_MAX_LENGTH,
      showQuestion: QUESTION_MAX_LENGTH,
      showAnswer: SELECT_MAX_LENGTH,
    }
    const assigned: Record<string, number> = {}
    for (const m of source.matchAll(/public void (\w+)\([^)]*\) \{/g)) {
      const body = methodText(source, m[0])
      const hits = [...body.matchAll(/maxLength = (\d+);/g)]
      if (hits.length === 0) continue
      expect(hits, `${m[1]} 里给 maxLength 赋了不止一次`).toHaveLength(1)
      assigned[m[1]!] = Number(hits[0]![1])
    }
    expect(Object.keys(assigned).length).toBeGreaterThan(0)
    expect(assigned).toEqual(REGISTERED)
  })

  it('多久吐一拍：三个定时器的间隔', () => {
    const delay = (listener: string) =>
      Number(readOne(source, new RegExp(`new Timer\\(tools\\.Clock\\.delay\\((\\d+)\\), new ${listener}\\(\\)\\)`), listener))
    expect(WORDS_MS).toBe(delay('WordsRun'))
    expect(SELECT_IMAGE_MS).toBe(delay('SelectImageMove'))
    expect(QUESTION_IMAGE_MS).toBe(delay('QuestionImageMove'))
  })

  it('A/B/C/D 光标的上下界：源码里的 size() - n 只有这两个 n', () => {
    const ns = [...source.matchAll(/\.size\(\) - (\d+)/g)].map((m) => Number(m[1]))
    expect(ns.length).toBeGreaterThan(0)
    expect([...new Set(ns)].sort()).toEqual([ABCD_LAST_FROM_END, ABCD_FIRST_FROM_END].sort())
  })
})

describe('keyPressed 的段落：真值走过的与回到源码上取的，对撞', () => {
  it('解析器读得出这个方法：段落不为空，且答对 / 答错两段都在', () => {
    expect(KEY_PRESSED.length).toBeGreaterThan(0)
    const answerLeaves = KEY_PRESSED.filter((l) => l.statements.some((s) => s.includes('haveAnswered.add')))
    // 答对答错那两段各写一次 `haveAnswered.add(...)`：少一段是解析器吞了 else。
    expect(answerLeaves).toHaveLength(2)
    expect(answerLeaves.map((l) => l.statements.some((s) => s.includes('Money.addCoins')))).toEqual([true, false])
  })

  for (const [label, c] of Object.entries(SOURCE_CASES)) {
    it(`真值没走到：${label.split(' / ').slice(-2).join(' / ')}`, () => {
      const leaf = KEY_PRESSED.find((l) => labelOf(l) === label)
      expect(leaf, '登记的段落名不在解析出来的名单里').toBeDefined()
      const { d, now, key } = c.arrange()
      // 夹具先过同一套条件求值：它确实走进的是这一段，而不是隔壁那段。
      expect(reaches(leaf!, { pre: preOf(d), key, scene: getScene('大活') })).toBe(true)
      selectKeyPressed(d, key, now, host)
      c.check(d, getScene('大活').question![d.questionNo]!.length)
    })
  }

  /**
   * **最后一条：对撞。** 分母是解析出来的段落名单；真值走过的那几段现算；
   * 其余每一段都必须在 `SOURCE_CASES` 里有一条用例 —— 而且只有那几段。
   */
  it('每一段要么真值走过，要么回到源码上取，二者恰好覆盖、互不重叠', () => {
    const all = KEY_PRESSED.map(labelOf)
    expect(new Set(all).size, '两个段落同名：labelOf 分不开它们').toBe(all.length)
    const walked = walkedByTruth()
    expect(walked.size).toBeGreaterThan(0)
    const bySource = Object.keys(SOURCE_CASES)

    expect(bySource.filter((l) => walked.has(l)), '登记成"真值没走到"，可真值走过').toEqual([])
    expect(bySource.filter((l) => !all.includes(l)), '登记了源码里不存在的段落').toEqual([])
    expect(
      all.filter((l) => !walked.has(l) && !bySource.includes(l)),
      '这几段真值没走到，也没有回到源码上取的用例',
    ).toEqual([])
    // 答对与答错两段都必须是**真值**走过的 —— 那是这张票的正题，不许退到源码上。
    const answered = KEY_PRESSED.filter((l) => l.statements.some((s) => s.includes('haveAnswered.add'))).map(labelOf)
    for (const label of answered) {
      expect(walked.get(label), `${label} 真值没走到`).toBeDefined()
    }
  })
})
