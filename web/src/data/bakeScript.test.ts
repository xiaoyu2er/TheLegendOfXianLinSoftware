import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { bakeScript } from './bakeScript'
import { BASE_SECTION_FIELDS, SCENE_SCRIPT_FIELDS, STORY_SECTION_FIELDS } from './types'

/**
 * 黄金测试：烘焙结果与**原版解析器自己导出**的冻结真值逐字段相等。
 *
 * 分母开跑前就能数清楚：2 个场景 × 26 个字段。真值不是这里写的期望值，
 * 是 `tools/export-truth.sh` 从 `tools.Reader` 导出来的
 * （`tools/src/devtools/ExportGroundTruth.java`），所以这不是自己出题自己判卷。
 *
 * 分两层：M1 链路上那两个场景对**全部 26 个字段**，96 个脚本对**基础段的
 * 13 个字段**（xl-9bd.4；剩下 13 个剧情段字段是 xl-9bd.5）。
 */
const M1_SCENES = ['宿舍', '大地图'] as const

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

describe('bakeScript 对冻结真值', () => {
  it.each(M1_SCENES)('%s 的烘焙结果与真值逐字段相等（26 个字段）', (name) => {
    const baked = bakeScript(readScript(name), `${name}.txt`)
    const truth = readTruth(name)

    // 先钉死分母：字段集必须两边完全一致，多一个少一个都算失败。
    // 否则"逐字段相等"可以靠少写几个字段来通过。
    expect(Object.keys(baked).sort()).toEqual([...SCENE_SCRIPT_FIELDS].sort())
    expect(Object.keys(truth).sort()).toEqual([...SCENE_SCRIPT_FIELDS].sort())

    for (const field of SCENE_SCRIPT_FIELDS) {
      expect(baked[field], `字段 ${field} 与真值不符`).toEqual(truth[field])
    }
  })

  it('两张字段表加起来正好是那 26 个，且互不重叠', () => {
    // 这条先跑：下面"96 个脚本的基础段全部相等"的可信度全靠它。
    // 没有它，把一个对不上的字段挪进剧情段就能让那条测试变绿。
    expect([...BASE_SECTION_FIELDS, ...STORY_SECTION_FIELDS].sort()).toEqual(
      [...SCENE_SCRIPT_FIELDS].sort(),
    )
    expect(BASE_SECTION_FIELDS.length + STORY_SECTION_FIELDS.length).toBe(26)
  })

  it('script/ 下正好 96 个脚本，每个都有冻结真值', () => {
    // 分母。少烘一个脚本、少一份真值，都要在这里而不是在别处发现。
    expect(ALL_SCENES.length).toBe(96)
    const truths = readdirSync(repoPath('tools/ground-truth'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
    expect(truths).toEqual(ALL_SCENES)
  })

  it.each(ALL_SCENES)('%s 的基础段与真值逐字段相等（13 个字段）', (name) => {
    const baked = bakeScript(readScript(name), `${name}.txt`) as unknown as Record<string, unknown>
    const truth = readTruth(name)
    for (const field of BASE_SECTION_FIELDS) {
      expect(baked[field], `字段 ${field} 与真值不符`).toEqual(truth[field])
    }
  })

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
})
