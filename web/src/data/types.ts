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
  /**
   * 主角进场时站的格子。**恒为 (12, 8)**：`tools.Reader` 把这两个字段初始化成
   * 12 / 8，而 96 个脚本里没有一处给它们赋值（实测 96 份真值全是 12 / 8）。
   * 真正的进场位置来自上一个场景的 `entrance`（出口事件，另一张票）。
   */
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
  /**
   * 每段对话的触发方式，与 `dialogue` 一一对应（同一个 `Dialogue` 段读出来的）。
   * 原版 `DialogueEvent` 按长度分两种读法：长度 ≤ 2 是 NPC 序号，`-1` 表示
   * 进场自动播放；长度 > 2 是一串 `,` 分隔的 `x y` 格子，走到其中一格触发。
   */
  dialogueCode: string[] | null
  /**
   * `dialogue[段][句]` = 一句话按 `/` 切开的字段：`[样式, 头像号或说话人, 正文]`。
   * 样式 0 是带头像的对话框（第 2 位是头像编号），1 是带名字的窄框
   * （第 2 位是名字）—— 见原版 `Dialogue.showSentence`。
   */
  dialogue: string[][][] | null
  /** 旁白，一行一句，进场时逐句播。 */
  narratage: string[] | null
  /**
   * 计步遇敌的战斗配置，一行一场，随机抽一场打。
   *
   * 三个 battle 字段每条都是同一个 7 元组，原版 `FightEvent.fight` 逐位取用：
   * `[战斗背景图路径, zhang, yu, lu, 敌1, 敌2, 敌3]`。第 1 位那张图既是战斗
   * 背景、又决定放哪首 BGM（`BattlePanel.initial` 的 switch）；第 2..4 位写成
   * `zhang`/`yu`/`lu` 表示该角色上场，写别的（数据里是 `null`）表示不上场；
   * 敌人写成 `名字/等级`，`null` 表示这个位置空着。
   */
  battle0: string[][] | null
  /** 剧情固定战，按顺序一场一场打（`Fight` 段的 `1` 分支）。元组同 `battle0`。 */
  battle1: string[][] | null
  /** 选择式战斗的配置，与 `selectBattlePanel` 一一对应。元组同 `battle0`。 */
  battle2: string[][] | null
  /**
   * "要不要进商店"的确认框，恒为 4 行：第 1 行是触发它的 NPC 序号，
   * 随后 3 行是文案（一句招呼 + 两个选项）。原版把这 4 行整体交给逐字打印。
   */
  selectShopPanel: string[] | null
  /** 装备商店的确认框，形状与 `selectShopPanel` 相同。 */
  selectEquipmentShopPanel: string[] | null
  /** 选择式战斗的确认框，每组 4 行，含义同 `selectShopPanel`。 */
  selectBattlePanel: string[][] | null
  /** 答题的确认框，每组 4 行，含义同 `selectShopPanel`。 */
  selectQuestion: string[][] | null
  /**
   * 题面，与 `selectQuestion` / `answer` 一一对应。一组是 `Question` 那行起、
   * 到 `Answer` 为止的原文，末尾若干行是选项 —— 行数不固定，长句会在显示时
   * 折行，所以"第几行"与"第几个选项"不是一回事。
   */
  question: string[][] | null
  /**
   * 答案，每组恒为 4 行：`[正确答案的光标下标, 答案说明, 答错的回应, 答对的回应]`。
   * 第 1 位是原版拿去跟光标下标比的那个数，因为折行的缘故它不等于"第几个选项"
   * （`SelectEvent` 的 `count_selectABCD`）。
   */
  answer: string[][] | null
  /** 宝箱，一行一个，空格切开：`[x/y, 物品名]`（见原版 `TreasureBox` 的构造函数）。 */
  treasureBox: string[][] | null
  /**
   * 碰撞网格：`mapSet[y][x]`，**0 = 可走，非 0 = 挡住**。
   *
   * 极性跟直觉是反的，别记反了：原版 `RoleEvent.isAllow` 写的是
   * `if (mapSet[y][x] != 0) return false;`。（这行注释此前写反了，
   * 说的是"1 = 可走"；数据也证伪它——宿舍 (15, 8) 那面墙在网格里是 1。）
   */
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
