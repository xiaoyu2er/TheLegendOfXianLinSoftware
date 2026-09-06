import type { SceneScript } from '../data/types'
import { normalizePath } from './path'

/**
 * 一个场景脚本**引用到的全部仓库资源**。
 *
 * 存在的意义只有一条：原版的资源加载在路径错误时**不报错**
 * （`ImageIcon` 给一个宽度 −1 的空壳，`readImage` 加诊断前谁也看不见），
 * 于是 27 帧 NPC 素材缺了十三年、3 场战斗的背景白了十三年。烘焙期把每一条
 * 路径 stat 一遍是把这类失败搬到构建时的唯一办法。
 *
 * 路径怎么拼**不是这里发明的**，逐条对着原版：
 *
 * | kind             | 原版出处                                    | 拼法 |
 * |------------------|---------------------------------------------|------|
 * | map              | `scene/Map.java:23`                         | `maps/<mapName>` |
 * | bgm              | `media/MusicReader.java:4` + `Music` 段     | `sources/BGM/<sceneMusic>` |
 * | npc              | `scene/NPC.java:40,54,71`                   | `NPCs/…`（三种构造函数三种拼法） |
 * | battleBackground | `battle/BattlePanel.java:165` ← Fight 段第 0 列 | 路径就写在数据里，相对仓库根 |
 * | script           | `tools/Reader.java:57`（`Exit` 段的目标脚本） | `script/<nextScene>` |
 *
 * 分母因此是可数的：96 个脚本 × 各自的引用条数（实测 1602 条，互异 523 条）。
 */
export type SceneAssetKind = 'map' | 'bgm' | 'npc' | 'battleBackground' | 'script'

export interface SceneAssetRef {
  kind: SceneAssetKind
  /** 仓库根目录下的相对路径，一律正斜杠 —— 已过 `normalizePath`。 */
  path: string
  /** 拼好但**未规范化**的写法。与 `path` 不同即说明这条走了反斜杠规范化。 */
  raw: string
  /** 出处，形如 `迷宫1.txt battle0[0]`。报错要说得出是哪一条。 */
  where: string
}

/**
 * 数据本身不成形，连路径都拼不出来的地方。
 *
 * 与"路径拼出来了但文件不在"是两回事，所以单列：前者在原版是
 * `ArrayIndexOutOfBoundsException`（走到那个场景直接崩），后者只是画面上
 * 少了点东西。
 */
export interface SceneDefect {
  where: string
  detail: string
}

export interface SceneAssetScan {
  refs: SceneAssetRef[]
  defects: SceneDefect[]
}

/** NPC 三种构造函数各自需要的字段数，见 `tools/Reader.java:128-147`。 */
const NPC_ARITY: Record<string, number> = { '0': 5, '1': 8, '2': 6 }

export function scanSceneAssets(scene: SceneScript): SceneAssetScan {
  const refs: SceneAssetRef[] = []
  const defects: SceneDefect[] = []
  const at = (field: string, i?: number) =>
    `${scene.script} ${field}${i === undefined ? '' : `[${i}]`}`
  const push = (kind: SceneAssetKind, raw: string, where: string) =>
    refs.push({ kind, path: normalizePath(raw), raw, where })

  push('map', `maps/${scene.mapName}`, at('mapName'))
  if (scene.sceneMusic !== null) push('bgm', `sources/BGM/${scene.sceneMusic}`, at('sceneMusic'))

  scene.npcList?.forEach((npc, i) => {
    const where = at('npcList', i)
    const type = npc[0] ?? ''
    const arity = NPC_ARITY[type]
    if (arity === undefined) {
      // 原版的 if/else 链没有第四个分支：状态码 3（四向运动）在注释里写了，
      // 代码里没有，那样的 NPC 根本不会被创建。96 个脚本里一条都没有（实测），
      // 所以这不是"跳过"，是"数据里出现了原版处理不了的东西"。
      defects.push({ where, detail: `NPC 状态码 ${JSON.stringify(type)} 原版没有对应分支` })
      return
    }
    if (npc.length < arity) {
      // 原版在这里是 ArrayIndexOutOfBoundsException——走到这个场景就崩。
      defects.push({
        where,
        detail: `状态码 ${type} 需要 ${arity} 个字段，只有 ${npc.length} 个: ${npc.join(' ')}`,
      })
      return
    }
    if (type === '0') {
      // 构造函数一（静止）：字段 3 是**文件名**，扩展名写在数据里。
      push('npc', `NPCs/${npc[3]}`, where)
      return
    }
    // 构造函数二（原地运动）/ 三（单向走动）：字段是目录名，帧是 <n>.png。
    const folder = type === '2' ? npc[4] : npc[6]
    const frames = type === '2' ? int(npc[3]) : int(npc[5])
    const first = type === '2' ? 1 : int(npc[3]) // 单向走动的首帧号 = 方向
    if (frames === null || first === null) {
      defects.push({ where, detail: `帧数或方向不是整数: ${npc.join(' ')}` })
      return
    }
    for (let f = 0; f < frames; f += 1) push('npc', `NPCs/${folder}/${first + f}.png`, where)
  })

  for (const field of ['battle0', 'battle1', 'battle2'] as const) {
    scene[field]?.forEach((row, i) => {
      const background = row[0]
      if (background === undefined) {
        defects.push({ where: at(field, i), detail: '战斗配置为空行，取不到背景图' })
        return
      }
      // 这一列就是那 3 条反斜杠数据的所在地。
      push('battleBackground', background, at(field, i))
    })
  }

  scene.nextScene?.forEach((name, i) => push('script', `script/${name}`, at('nextScene', i)))

  return { refs, defects }
}

function int(text: string | undefined): number | null {
  if (text === undefined || !/^[+-]?\d+$/.test(text)) return null
  return Number.parseInt(text, 10)
}
