import type { ReadBack, SaveFile } from '../save/format'
import { loaderReadBack, readSample } from '../save/test/originalSave'
import { draftSlots } from '../saveload/test/replayTrace'
import type { SaveLoadSetup } from '../saveload/replay'

/**
 * 取图页起手要的**原版存档**，由比对器在 Node 那一半解好、随剧本一起送进浏览器
 * （xl-i06.12）。
 *
 * 为什么是这里解、而不是给取图页另写一份浏览器侧的原版存档读取器：原版存档有**两种**
 * 读法（`save/test/originalSave.ts` 的文件头），而两种都已经有一份被判据钉住的实现 ——
 * 读档那一路是 `loaderReadBack`（与 GBK 源码对撞、逐项篡改钉行为），写档装置那一路是
 * `fromRecorderText`（布局从 Java 源码现读，这一步在浏览器里做不了）。在浏览器里另写
 * 一份，就是第二份会与判据分家的读取器；而状态层判据（`traceReplay.test.ts` /
 * `saveloadTrace.test.ts`）用的正是这两个函数 —— 取图页收它们的产出，画面与状态两侧
 * 的起手就是同一份。
 *
 * 送进去的是**起手的输入**（草稿区里躺着的那几份档），不是真值里的状态字段：
 * 导出器读的就是草稿区（与真值目录逐字节相同，由 Java 侧 `SaveDraftIntactTest` 守着），
 * 这与剧本头的 `setup` 同一个性质。
 *
 * - 场景剧本带 `load`（读档剧本）→ 那一份档按原版读取器**实际的**读法解出来的一半；
 * - `saveload` 剧本 → 草稿区三个槽，按写档装置的写法解析，`emptySlots` 那几个是 `null`；
 * - 别的 → `undefined`（`JSON.stringify` 会把键整个去掉，送进去的字节与从前相同）。
 */
export type SaveFixture =
  | { readonly kind: 'readBack'; readonly slot: number; readonly readBack: Omit<ReadBack, 'neverReadBack'> }
  | { readonly kind: 'slots'; readonly slots: readonly (SaveFile | null)[] }

/** 只读剧本头：判别名与 `script` 那一段。 */
export interface FixtureHeader {
  readonly driver: string
  readonly script: {
    readonly name: string
    readonly scene?: string
    readonly load?: number
    readonly setup?: SaveLoadSetup
  }
}

export function saveFixtureOf(trace: FixtureHeader): SaveFixture | undefined {
  const { name, load, scene, setup } = trace.script
  if (trace.driver === 'scene' && load !== undefined) {
    const readBack = loaderReadBack(readSample(`存档${load}.txt`))
    // 与 `state/trace.ts` 的 `replayWorld` 同一条核对：真值头的 `scene` 是导出器读完档
    // **核对过**的值，读出来不是它就是样例被换过。
    if (readBack.scene.fileName !== scene) {
      throw new Error(`${name}：真值头写 scene=${scene}，存档${load} 读出来是 ${readBack.scene.fileName}`)
    }
    return { kind: 'readBack', slot: load, readBack }
  }
  if (trace.driver === 'saveload') {
    if (!setup) throw new Error(`${name} 是 saveload 真值，剧本头却没有 setup`)
    return { kind: 'slots', slots: draftSlots(setup.emptySlots) }
  }
  return undefined
}
