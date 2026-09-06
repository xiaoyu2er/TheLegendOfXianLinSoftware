import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { SECTION_KEYWORDS, type SectionEvent, bakeScript } from './bakeScript'
import { BASE_SECTION_FIELDS, SCENE_SCRIPT_FIELDS, STORY_SECTION_FIELDS } from './types'

/**
 * 黄金测试：烘焙结果与**原版解析器自己导出**的冻结真值逐字段相等。
 *
 * 分母开跑前就能数清楚：96 个脚本 × 26 个字段。真值不是这里写的期望值，
 * 是 `tools/export-truth.sh` 从 `tools.Reader` 导出来的
 * （`tools/src/devtools/ExportGroundTruth.java`），所以这不是自己出题自己判卷。
 *
 * "逐字段相等"这条判据有两个可以糊弄过去的方向，下面各有一条测试堵着：
 * 少比几个字段（字段集断言），以及某个字段在 96 个脚本里全是 null
 * （剧情段非空覆盖）。
 */

/** 96 个场景脚本。名单不手抄：script/ 下有什么就是什么。 */
const ALL_SCENES = readdirSync(repoPath('script'))
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''))
  .sort()

const readScript = (name: string) => readFileSync(repoPath(`script/${name}.txt`))
const readTruth = (name: string) =>
  JSON.parse(
    readFileSync(repoPath(`tools/ground-truth/${name}.json`), 'utf8'),
  ) as Record<string, unknown>

/** 把 96 个脚本全烘一遍，顺带把每一次段分派收下来。 */
const bakeAll = (): { scenes: Record<string, unknown>[]; events: SectionEvent[] } => {
  const events: SectionEvent[] = []
  const scenes = ALL_SCENES.map(
    (name) =>
      bakeScript(readScript(name), `${name}.txt`, (e) => events.push(e)) as unknown as Record<
        string,
        unknown
      >,
  )
  return { scenes, events }
}

describe('bakeScript 对冻结真值', () => {
  it('script/ 下正好 96 个脚本，每个都有冻结真值', () => {
    // 分母。少烘一个脚本、少一份真值，都要在这里而不是在别处发现。
    expect(ALL_SCENES.length).toBe(96)
    const truths = readdirSync(repoPath('tools/ground-truth'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
    expect(truths).toEqual(ALL_SCENES)
  })

  it.each(ALL_SCENES)('%s 的烘焙结果与真值逐字段相等（26 个字段）', (name) => {
    const baked = bakeScript(readScript(name), `${name}.txt`) as unknown as Record<string, unknown>
    const truth = readTruth(name)

    // 先钉死分母：字段集必须两边完全一致，多一个少一个都算失败。
    // 否则"逐字段相等"可以靠少写几个字段来通过。
    expect(Object.keys(baked).sort()).toEqual([...SCENE_SCRIPT_FIELDS].sort())
    expect(Object.keys(truth).sort()).toEqual([...SCENE_SCRIPT_FIELDS].sort())

    // 一个字段一条断言：不等时报出的是那个字段的差异，而不是整份场景的。
    for (const field of SCENE_SCRIPT_FIELDS) {
      expect(baked[field], `字段 ${field} 与真值不符`).toEqual(truth[field])
    }
  })

  it('两张字段表加起来正好是那 26 个，且互不重叠', () => {
    expect([...BASE_SECTION_FIELDS, ...STORY_SECTION_FIELDS].sort()).toEqual(
      [...SCENE_SCRIPT_FIELDS].sort(),
    )
    expect(BASE_SECTION_FIELDS.length + STORY_SECTION_FIELDS.length).toBe(26)
  })

  it('13 个剧情段字段，每个都至少在一个脚本里非 null', () => {
    // 没有这条，"逐字段相等"对一个永远是 null 的字段是自动成立的 ——
    // 整个剧情段忘了实现也能全绿，因为真值那边碰巧也是 null。
    const { scenes } = bakeAll()
    const 空的 = STORY_SECTION_FIELDS.filter((f) => scenes.every((s) => s[f] === null))
    expect(空的, '这些剧情段字段在 96 个脚本里全是 null，等于没被测到').toEqual([])
  })
})

describe('段类型的覆盖面', () => {
  it('认得的段类型，与原版 Reader.switchReader 的 case 标签一字不差', () => {
    // 分母来自规格本身，不是这里数出来的：漏实现一种段类型，或者原版将来
    // 多出一种，都在这里响。
    expect([...SECTION_KEYWORDS].sort()).toEqual(readerCaseLabels().sort())
    expect(SECTION_KEYWORDS.length).toBe(14)
  })

  it('14 种段类型每一种都在 96 个脚本里真的出现过', () => {
    // "支持"若只停留在代码里没被数据碰过，等于没验证过。
    const { events } = bakeAll()
    const 用过 = new Set(events.filter((e) => e.known).map((e) => e.keyword))
    const 没用过 = SECTION_KEYWORDS.filter((k) => !用过.has(k))
    expect(没用过, '这些段类型写了读法，但没有任何脚本用到').toEqual([])
  })

  it('96 个脚本里被静默跳过的行，正好是这 3 行', () => {
    // 原版 switch 没有 default 分支：拼错的段关键字会连同整段数据一起消失，
    // 而产物看着完好。这里把跳过的行逐条钉死 —— 多一行少一行都要有人来看。
    // 这三行不是缺陷，是脏数据，原版同样跳过它们，真值可以作证。
    const { events } = bakeAll()
    expect(events.filter((e) => !e.known)).toEqual([
      // 地图规格说的行数比实际少一行，多出来的这行网格落到了段位置上。
      { script: '大迷宫1.txt', line: 23, keyword: '1 0 0 1 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 0 0', known: false },
      // 手滑打上去的两个字母。
      { script: '脚本40.txt', line: 87, keyword: 'uu', known: false },
      // 一个空行。
      { script: '食堂夜.txt', line: 25, keyword: '', known: false },
    ])
  })
})

describe('烘焙器的边角', () => {
  it('大地图那条行尾带空格的 NPC 是 6 个字段，不是 7 个', () => {
    // javaSplit 的尾部截断在真实数据上的落点。这条要是回归了，
    // 上面的逐字段比对当然也会红，但报错会指向一整个 npcList，看不出所以然。
    const baked = bakeScript(readScript('大地图'), '大地图.txt')
    const wei = baked.npcList?.find((npc) => npc[4] === '商塔阿威哥')
    expect(wei).toEqual(['2', '37', '38', '11', '商塔阿威哥', '我大商塔天下无敌!'])
  })

  it('缺段的场景对应字段是 null，而不是空数组', () => {
    // 宿舍没有 Dialogue / Fight / Narratage 段。"不存在"与"存在但为空"
    // 在原版是两种状态，烘焙不能把它们抹平。
    const baked = bakeScript(readScript('宿舍'), '宿舍.txt')
    expect(baked.dialogue).toBeNull()
    expect(baked.battle0).toBeNull()
    expect(baked.narratage).toBeNull()
  })

  it('数据缺 # 收尾时报出脚本名与行号，而不是产出半份数据', () => {
    const broken = new TextEncoder().encode('x.png\n1/1\n1\nNarratage\n没有收尾\n')
    expect(() => bakeScript(broken, 'x.txt')).toThrowError(/x\.txt 第 6 行/)
  })

  it('段分派报出的行号，指得住原文里的那一行', () => {
    // 这份 fixture 走 ASCII：`TextEncoder` 出的是 UTF-8，而烘焙器按 GBK 解，
    // 非 ASCII 的字在这里会变成乱码，跟本条要验的行号无关。
    const raw = new TextEncoder().encode('x.png\n1/1\n1\nMusic\na.mp3\nnot-a-section\n')
    const events: SectionEvent[] = []
    bakeScript(raw, 'x.txt', (e) => events.push(e))
    expect(events).toEqual([
      { script: 'x.txt', line: 4, keyword: 'Music', known: true },
      { script: 'x.txt', line: 6, keyword: 'not-a-section', known: false },
    ])
  })
})

/**
 * 原版 `Reader.switchReader` 里的 `case` 标签集合 —— 段类型名单的源头。
 * 从 GBK 的 Java 源码里现抽，不抄进这个文件：抄一份就意味着两边可以对不上
 * 而没人知道。只截 `switchReader` 那一段，免得把别处的 `case` 也算进来。
 */
function readerCaseLabels(): string[] {
  const java = new TextDecoder('gbk').decode(readFileSync(repoPath('src/tools/Reader.java')))
  const from = java.indexOf('public void switchReader')
  const to = java.indexOf('public static String getType')
  expect(from, 'Reader.java 里找不到 switchReader').toBeGreaterThan(-1)
  expect(to, 'Reader.java 里找不到 switchReader 的下界').toBeGreaterThan(from)
  return [...java.slice(from, to).matchAll(/case "([^"]+)":/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  )
}
