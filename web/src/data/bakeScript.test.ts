import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { bakeScript } from './bakeScript'
import { SCENE_SCRIPT_FIELDS } from './types'

/**
 * 黄金测试：烘焙结果与**原版解析器自己导出**的冻结真值逐字段相等。
 *
 * 分母开跑前就能数清楚：2 个场景 × 26 个字段。真值不是这里写的期望值，
 * 是 `tools/export-truth.sh` 从 `tools.Reader` 导出来的
 * （`tools/src/devtools/ExportGroundTruth.java`），所以这不是自己出题自己判卷。
 *
 * M1 只烘焙宿舍与大地图两个场景；其余 94 个的真值也已冻结在
 * `tools/ground-truth/`，扩到全量是 xl-9bd.4 / xl-9bd.5。
 */
const SCENES = ['宿舍', '大地图'] as const

const readScript = (name: string) => readFileSync(repoPath(`script/${name}.txt`))
const readTruth = (name: string) =>
  JSON.parse(
    readFileSync(repoPath(`tools/ground-truth/${name}.json`), 'utf8'),
  ) as Record<string, unknown>

describe('bakeScript 对冻结真值', () => {
  it.each(SCENES)('%s 的烘焙结果与真值逐字段相等', (name) => {
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
