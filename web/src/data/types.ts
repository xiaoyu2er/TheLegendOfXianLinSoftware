/**
 * 一个场景脚本经解析后的形状。**这就是原版 `tools.Reader` 的字段集**，
 * 一字不多一字不少：26 个字段，与 `tools/ground-truth/*.json` 逐字段对应
 * （导出器见 `tools/src/devtools/ExportGroundTruth.java`）。
 *
 * 它刻意保留原版的原始形状（一堆 `string[]`），**不是** World 的形状。
 * 把它整理成游戏状态是状态层的事（缝 2），在这里做转换会让"与冻结真值
 * 逐字段相等"这条唯一的客观判据失去着力点。
 *
 * `null` 表示该段在脚本里**不存在**（原版对应字段保持未初始化的 null），
 * 与"存在但为空"是两回事。
 */
export interface SceneScript {
  /** 脚本文件名，如 `宿舍.txt`。不来自文件内容，由调用方传入。 */
  script: string
  /** 地图图片文件名，如 `宿舍.png`；相对 `maps/` 目录。 */
  mapName: string
  /** 地图列数（瓦片） */
  col: number
  /** 地图行数（瓦片） */
  row: number
  /** 主角精灵的帧宽高，原版恒为 12 / 8，96 个脚本无一例外（实测） */
  roleX: number
  roleY: number
  sceneMusic: string | null
  /** 剧情推进：[条件, 脚本, ?]，恒为 3 个元素 */
  nextScript: string[] | null
  /** NPC 群，每条是按空格切开的原始字段，字段数随状态码 0/1/2 而不同 */
  npcList: string[][] | null
  /** 每个出口的瓦片坐标集合，与 `nextScene` / `entrance` 一一对应 */
  exits: string[][] | null
  nextScene: string[] | null
  entrance: string[][] | null
  dialogueCode: string[] | null
  dialogue: string[][][] | null
  narratage: string[] | null
  battle0: string[][] | null
  battle1: string[][] | null
  battle2: string[][] | null
  selectShopPanel: string[] | null
  selectEquipmentShopPanel: string[] | null
  selectBattlePanel: string[][] | null
  selectQuestion: string[][] | null
  question: string[][] | null
  answer: string[][] | null
  treasureBox: string[][] | null
  /** 碰撞网格：`mapSet[y][x]`，1 = 可走，0 = 挡住 */
  mapSet: number[][]
}

/** 真值里的 26 个字段名，用于"字段集完全一致"这条断言的分母。 */
export const SCENE_SCRIPT_FIELDS = [
  'script',
  'mapName',
  'col',
  'row',
  'roleX',
  'roleY',
  'sceneMusic',
  'nextScript',
  'npcList',
  'exits',
  'nextScene',
  'entrance',
  'dialogueCode',
  'dialogue',
  'narratage',
  'battle0',
  'battle1',
  'battle2',
  'selectShopPanel',
  'selectEquipmentShopPanel',
  'selectBattlePanel',
  'selectQuestion',
  'question',
  'answer',
  'treasureBox',
  'mapSet',
] as const satisfies readonly (keyof SceneScript)[]

/**
 * 26 个字段切成两半：**基础段**与**剧情段**。切法照 xl-9bd 的拆票方式——
 * 基础段（地图头 + Music / Exit / NextScript / NPC / Role / Task）是
 * xl-9bd.4，剧情段（Dialogue / Narratage / Fight / Select* / TreasureBox）
 * 是 xl-9bd.5。
 *
 * `Role` 与 `Task` 两段原版存进静态字段，不在这 26 个之内，烘焙器只把那一行
 * 吃掉（见 `bakeScript.ts` 的 `readSection`）。
 *
 * 两张表**必须凑齐 26 个且互不重叠**，`bakeScript.test.ts` 断言了这一点：
 * 否则"基础段全部逐字段相等"可以靠把不合的字段挪去另一半来通过。
 */
export const BASE_SECTION_FIELDS = [
  'script',
  'mapName',
  'col',
  'row',
  'roleX',
  'roleY',
  'mapSet',
  'sceneMusic',
  'nextScript',
  'npcList',
  'exits',
  'nextScene',
  'entrance',
] as const satisfies readonly (keyof SceneScript)[]

export const STORY_SECTION_FIELDS = [
  'dialogueCode',
  'dialogue',
  'narratage',
  'battle0',
  'battle1',
  'battle2',
  'selectShopPanel',
  'selectEquipmentShopPanel',
  'selectBattlePanel',
  'selectQuestion',
  'question',
  'answer',
  'treasureBox',
] as const satisfies readonly (keyof SceneScript)[]
