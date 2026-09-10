import { EQUIP_SLOTS, type EquipSlot } from '../menu/equipment'

/**
 * 存档格式（xl-i06.7）：全新的、带版本号的结构化格式。**写**不兼容原版。
 *
 * ## 存全套，读一半
 *
 * 字段集合与原版**存**的那一套一一对应（`start.Recorder.writeInfo` 写的每一个
 * 列表都有一个去处）——包括原版写进了文件、却永远回不到游戏状态里的那几组。
 * 它们收在 {@link SaveFile.neverReadBack} 底下，名字就是说明：**原版写了但从不
 * 读回**，不是我们漏了。是哪几组、各自为什么读不回，是 2026-09-10 从源码现读、
 * 再用原版 `Loader.load` 真跑一遍定下来的：
 *
 * - `equipmentStock`（背包里各件装备有几件）：读的一侧写进装备店面板**自建**的
 *   那六张表、且下标跳着走，全局那份 `EquipmentPack` 一格都没被写到（xl-1dv.32）；
 * - `questionMaps` / `answers`（答题记录）：回填方法 `SaveAndLoad.loadQuestion` /
 *   `loadAnswer` 全仓零调用点（xl-1dv.20）；而且读取器还错一行读（写 9 行、读
 *   10 行，xl-1dv.19）—— 错位与零调用点叠在一起，今天没有观测后果。
 *
 * **读回来之后它们是什么**：原版那几份都是 static，读档既不回填也不清空，所以是
 * **读档前的值**，不是「回到初值」（xl-i06.4 的订正）。实测：探针先把
 * `SelectEvent.mapName` / `answeredRecorder` / 全部头盔库存写成别的值，再
 * `Loader.load(0)`，三样原样留着，而钱被读回了（正对照）。开机直接读档时「读档前
 * 的值」恰好就是初值，于是两者只在中途读档时分得开 —— {@link readBack} 让调用方
 * 把「读档前的值」交进来，两种情形用同一句话表达。
 *
 * 另有两个字段**只给槽位摘要用**、同样不回填状态：{@link SaveFile.summary} 的
 * `mapName` 与 `task`（存档第 1 行后两项；读的一侧只有 `LoadAndSavePanel.
 * prepareScenes` 读它们来画槽位）。读档时这两样由重建场景现推 —— 实测三个样例
 * 的场景脚本都带 `Task` 段，读档后的 `Reader.task` 等于脚本里那句，探针预先写进去
 * 的值被盖掉了。它们不进 {@link ReadBack}。
 *
 * 原版文本格式的那些毛病（`A` 分隔符劈开含 A 的字段、`split` 丢末尾空串，
 * xl-1dv.22）**只抄进测试侧的原版存档解析器，不抄进这里** —— 这里是 JSON。
 *
 * ## 版本号
 *
 * 遇到不认识的版本号**硬失败**，没有默认值、没有尽力而为（同真值读取器对驱动器
 * 判别名的处置）。今天认识哪些版本是 `format.test.ts` 里的一份**手写登记**，与
 * {@link SAVE_VERSION} 对撞。**没有迁移框架** —— 今天没有第二个版本。
 */

/** 当前、也是唯一认识的版本号。 */
export const SAVE_VERSION = 1

/** 三个英雄，按原版存档第 2–4 行的次序（`Recorder.save` 里三次 `saveRoleInfo()`）。 */
export type HeroKey = 'zhangXiaoFan' | 'luXueQi' | 'yuJie'
export const HERO_KEYS: readonly HeroKey[] = ['zhangXiaoFan', 'luXueQi', 'yuJie']

/** 一个英雄的 `saveRoleInfo()`。字段名就是原版字段名。 */
export interface HeroRecord {
  readonly level: number
  readonly hp: number
  readonly mp: number
  readonly angryValue: number
  readonly isAngry: boolean
  readonly isDead: boolean
  readonly exp: number
}

/** `currentScript` / `nextScript`：原版是 `String[3]`，存成空格拼接、读时 `split(" ")`。 */
export type ScriptTriple = readonly [string, string, string]

/** `SaveAndLoad.saveSceneInfo()` 那十项。 */
export interface SceneRecord {
  readonly isScript: boolean
  readonly fileName: string
  readonly dialogueEventOver: boolean
  readonly dialogueOrder: number
  readonly x: number
  readonly y: number
  readonly currentScript: ScriptTriple
  readonly nextScript: ScriptTriple
  readonly battle1Over: boolean
  readonly countOfBattle1: number
}

/** 一个英雄身上六格装备的名字；空格子是 null（原版写字面量 `"null"`）。 */
export type WornRecord = Readonly<Record<EquipSlot, string | null>>

/** **原版写了但从不读回**的那几组。为什么读不回、读回来是什么，见文件头。 */
export interface NeverReadBack {
  /** 各件装备有几件，按槽位、表内按 `EquipmentPack` 那六张表的次序。 */
  readonly equipmentStock: Readonly<Record<EquipSlot, readonly number[]>>
  /** `SelectEvent.mapName`：答过题的地图（脚本文件名）。 */
  readonly questionMaps: readonly string[]
  /** `SelectEvent.answeredRecorder`：每张地图各题答对没有。 */
  readonly answers: readonly (readonly boolean[])[]
}

export interface SaveFile {
  readonly version: typeof SAVE_VERSION
  /** `SaveAndLoad.zhang / lu / wen`：队伍里有谁。读档回填（`Loader.load` 末三行）。 */
  readonly party: { readonly zhang: boolean; readonly lu: boolean; readonly wen: boolean }
  /** 只给槽位摘要用，读档不回填状态（见文件头）。`task` 为 null 即原版 `Reader.task` 的初值。 */
  readonly summary: { readonly mapName: string; readonly task: string | null }
  readonly heroes: Readonly<Record<HeroKey, HeroRecord>>
  readonly scene: SceneRecord
  /** 三个英雄身上的装备，按 `EquipPanel.heroEquipPack` 的次序。 */
  readonly worn: readonly [WornRecord, WornRecord, WornRecord]
  /** 各种药有几瓶，按 `DrugPack.drugList` 的次序。 */
  readonly drugs: readonly number[]
  readonly coins: number
  readonly neverReadBack: NeverReadBack
}

/** 读档能交回游戏状态的那一半。 */
export interface ReadBack {
  readonly party: SaveFile['party']
  readonly heroes: SaveFile['heroes']
  readonly scene: SceneRecord
  readonly worn: SaveFile['worn']
  readonly drugs: readonly number[]
  readonly coins: number
  /** 照抄「读不回来」：就是交进来的读档前的值，一个字都不取自存档。 */
  readonly neverReadBack: NeverReadBack
}

/** 格式层的一切拒绝都抛这个。 */
export class SaveFormatError extends Error {
  override name = 'SaveFormatError'
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save)
}

/**
 * 把一份存档文本读成 {@link SaveFile}。版本号不认识、形状不对都**抛**，不修补、
 * 不补默认值。
 */
export function parseSave(text: string): SaveFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new SaveFormatError(`存档不是合法的 JSON：${(e as Error).message}`)
  }
  if (!isRecord(raw)) throw new SaveFormatError('存档顶层不是对象')
  if (raw.version !== SAVE_VERSION) {
    throw new SaveFormatError(
      `不认识的存档版本号 ${JSON.stringify(raw.version) ?? 'undefined'}：这一版只认 ${SAVE_VERSION}。` +
        '不许默认、不许尽力而为 —— 当成别的版本读等于把一份来路不明的档当成另一种档回放',
    )
  }
  checkShape(raw)
  return raw as unknown as SaveFile
}

/**
 * 读一半：把存档里原版读得回来的那一半交出去；原版读不回来的那几组**原样用
 * `before`**（读档前的值，开机时即初值），存档里的那几组一个字都不取。
 */
export function readBack(save: SaveFile, before: NeverReadBack): ReadBack {
  return {
    party: save.party,
    heroes: save.heroes,
    scene: save.scene,
    worn: save.worn,
    drugs: save.drugs,
    coins: save.coins,
    neverReadBack: before,
  }
}

// ---------------------------------------------------------------- 形状检查

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

const isBool = (x: unknown): boolean => typeof x === 'boolean'
const isInt = (x: unknown): boolean => Number.isInteger(x)
const isStr = (x: unknown): boolean => typeof x === 'string'
const arrayOf =
  (item: (x: unknown) => boolean, length?: number) =>
  (x: unknown): boolean =>
    Array.isArray(x) && (length === undefined || x.length === length) && x.every(item)

function need(ok: boolean, path: string, what: string): void {
  if (!ok) throw new SaveFormatError(`存档字段 ${path} 不是${what}`)
}

function obj(x: unknown, path: string): Record<string, unknown> {
  need(isRecord(x), path, '对象')
  return x as Record<string, unknown>
}

function checkFields(o: Record<string, unknown>, path: string, spec: Record<string, [(x: unknown) => boolean, string]>): void {
  for (const [k, [ok, what]] of Object.entries(spec)) need(ok(o[k]), `${path}.${k}`, what)
}

const HERO_SPEC: Record<keyof HeroRecord, [(x: unknown) => boolean, string]> = {
  level: [isInt, '整数'],
  hp: [isInt, '整数'],
  mp: [isInt, '整数'],
  angryValue: [isInt, '整数'],
  isAngry: [isBool, '布尔'],
  isDead: [isBool, '布尔'],
  exp: [isInt, '整数'],
}

const SCENE_SPEC: Record<keyof SceneRecord, [(x: unknown) => boolean, string]> = {
  isScript: [isBool, '布尔'],
  fileName: [isStr, '字符串'],
  dialogueEventOver: [isBool, '布尔'],
  dialogueOrder: [isInt, '整数'],
  x: [isInt, '整数'],
  y: [isInt, '整数'],
  currentScript: [arrayOf(isStr, 3), '三个字符串'],
  nextScript: [arrayOf(isStr, 3), '三个字符串'],
  battle1Over: [isBool, '布尔'],
  countOfBattle1: [isInt, '整数'],
}

function checkShape(raw: Record<string, unknown>): void {
  checkFields(obj(raw.party, 'party'), 'party', {
    zhang: [isBool, '布尔'],
    lu: [isBool, '布尔'],
    wen: [isBool, '布尔'],
  })
  const summary = obj(raw.summary, 'summary')
  need(isStr(summary.mapName), 'summary.mapName', '字符串')
  need(summary.task === null || isStr(summary.task), 'summary.task', '字符串或 null')
  const heroes = obj(raw.heroes, 'heroes')
  for (const k of HERO_KEYS) checkFields(obj(heroes[k], `heroes.${k}`), `heroes.${k}`, HERO_SPEC)
  checkFields(obj(raw.scene, 'scene'), 'scene', SCENE_SPEC)
  need(Array.isArray(raw.worn) && raw.worn.length === 3, 'worn', '三个英雄的装备')
  ;(raw.worn as unknown[]).forEach((w, i) => {
    const o = obj(w, `worn[${i}]`)
    for (const s of EQUIP_SLOTS) need(o[s] === null || isStr(o[s]), `worn[${i}].${s}`, '字符串或 null')
  })
  need(arrayOf(isInt)(raw.drugs), 'drugs', '整数数组')
  need(isInt(raw.coins), 'coins', '整数')
  const never = obj(raw.neverReadBack, 'neverReadBack')
  const stock = obj(never.equipmentStock, 'neverReadBack.equipmentStock')
  for (const s of EQUIP_SLOTS) need(arrayOf(isInt)(stock[s]), `neverReadBack.equipmentStock.${s}`, '整数数组')
  need(arrayOf(isStr)(never.questionMaps), 'neverReadBack.questionMaps', '字符串数组')
  need(arrayOf(arrayOf(isBool))(never.answers), 'neverReadBack.answers', '布尔数组的数组')
}
