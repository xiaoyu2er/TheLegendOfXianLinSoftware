import type { SceneScript } from '../data/types'
import type { SaveFile, SceneRecord } from '../save/format'
import { createDialogue } from './dialogue'
import { TILE } from './role'
import { initiate } from './step'
import type { World } from './types'

/**
 * 读档的场景那一半（xl-i06.10）：`SaveAndLoad.loadSceneInfo(sceneInfo)`，外加
 * `Loader.load` 末三行的队伍开关。**纯函数**。
 *
 * 原版逐句（`src/scene/SaveAndLoad.java` 的 `loadSceneInfo`）：
 *
 * 1. `isLoad = true`；
 * 2. `isScript` ← 存档第 0 项（**手写的** `equals("true")`，见 `save/test/originalSave.ts`
 *    的 `loaderReadBack` —— 这里收的是已经解好的布尔，解法的差别只活在读原版文本的那一侧）；
 * 3. `isInitiateOver = false` → `initiation(fileName)` —— **重建整个场景**；
 * 4. `narratage.narratageOver = true` —— **跳过旁白**。`initiation` 刚新建了一个
 *    `Narratage`，有旁白段的脚本它的 `narratageOver` 是 false，这一句把它压掉：
 *    读档进场景不再播一遍开场白；
 * 5. 对话结束旗标、对话编号、主角格子坐标（`setX(x)` 是 `x * 32`）、剧情三元组
 *    （`split(" ")`）、两个战斗计数。
 *
 * ## `initiation` 里被 `isLoad` 改掉的那一处
 *
 * 普通进场景时，新脚本**没有** `Dialogue` 段就不新建 `DialogueEvent`，上一个场景
 * 的那份原样留着（`state/step.ts` 的 `carryDialogue`）。读档时 `isLoad` 为真，走
 * `else if (sal.isLoad)` 那一支：照样新建一个（对话编号为 null），并把 `isLoad` 清掉。
 * 于是**读档之后对话状态一律是新的**，只有结束旗标与编号由第 5 步填回去。
 *
 * ⚠️ 有 `Dialogue` 段的脚本走第一支，`isLoad` **不清**、一直留到之后第一个没有
 * `Dialogue` 段的场景，那里不沿用上一份对话事件而是新建一份 —— 读档之后的残留（xl-1dv.33，
 * xl-i06.11 复刻，`World.isLoad`）。
 *
 * ## 读档**不碰**的
 *
 * `initiate(prev, …)` 本来就从上一个场景带过来的那几样照带：答题记录那两张 static 表
 * （`recorder`，原版写了但从不读回，见 `save/format.ts`）、世界时间、`showing`、
 * `Reader` 的 `Task` 段缺席时留着的任务。`prev` 为 `null` 就是开机读档 —— 原版此时
 * `ScenePanel` 已经构造、从没 `initiation` 过，与这一层「没有上一个世界」同一个样子。
 */
export function loadSceneInfo(
  prev: World | null,
  rec: SceneRecord,
  party: SaveFile['party'],
  scene: SceneScript,
): World {
  if (scene.script !== rec.fileName) {
    throw new Error(`存档要读进 ${rec.fileName}，交进来的场景却是 ${scene.script}`)
  }
  const base = initiate(prev, scene)
  // 读档时两支都新建 DialogueEvent（见文件头），所以不要 `carryDialogue` 带过来的那份。
  const dialogue = createDialogue(base.script)
  return {
    ...base,
    isScript: rec.isScript,
    narratage: { ...base.narratage, over: true },
    dialogue: { ...dialogue, eventOver: rec.dialogueEventOver, groupOrder: rec.dialogueOrder },
    role: { ...base.role, px: rec.x * TILE, py: rec.y * TILE },
    currentScript: [...rec.currentScript],
    nextScript: [...rec.nextScript],
    fight: { ...base.fight, battle1Over: rec.battle1Over, countOfBattle1: rec.countOfBattle1 },
    // `Loader.load` 末三行：`SaveAndLoad.zhang/lu/wen = Boolean.parseBoolean(...)`，排在
    // `loadSceneInfo` 之后，所以压过 `initiation` 里 `Reader` 从 `Role` 段写进去的那三个。
    readerStatics: { ...base.readerStatics, zhang: party.zhang, lu: party.lu, wen: party.wen },
    // 第 1 步 `isLoad = true`，第 3 步的 `initiation` 在无对话编号的场景里当场清掉它。
    isLoad: base.script.code !== null,
  }
}

/**
 * 读档那一下交给场景的世界：`LoadAndSavePanel.setButton()` 读档分支的三句
 * `loader.load(i)` → `t.start()` → `switchTo("scene")` 里，第一句是 {@link loadSceneInfo}，
 * 第三句的 `SCENE_SIGNAL=1` 让下一拍场景把自己的曲子放上（`World.sceneSignal`）。
 *
 * 第二句（多起一条场景循环，于是中途读档之后双倍速）**不复刻**：这一层没有线程模型。
 * 那条例外与它的判据归 xl-i06.11。
 */
export function worldAfterLoad(
  prev: World | null,
  rec: SceneRecord,
  party: SaveFile['party'],
  scene: SceneScript,
): World {
  return { ...loadSceneInfo(prev, rec, party, scene), sceneSignal: true }
}
