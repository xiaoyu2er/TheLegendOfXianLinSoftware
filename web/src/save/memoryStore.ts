import { declareFake } from '../fakes/fake'
import type { SaveFile } from './format'
import { SAVE_SLOT_COUNT, checkSlot } from './store'
import type { SaveStore } from './store'

/**
 * 存档仓库的**内存版**（xl-i06.8）：给测试与真值回放用。
 *
 * 它是假货（ADR-0005）：不落盘，页面一关就没了；生来就绪 —— 没有「还在从盘上
 * 读」那一段，所以就绪标志那条判据在它身上**观测不到**，要拿 `browserStore.ts`
 * 去验。登记在 `fakes/registry.ts`。
 */
export const FAKE = declareFake('memorySaveStore')

/** `initial[i]` 是第 i 个槽的档，缺省或 `null` 即空槽。 */
export function createMemorySaveStore(initial: readonly (SaveFile | null)[] = []): SaveStore {
  if (initial.length > SAVE_SLOT_COUNT) {
    throw new RangeError(`给了 ${initial.length} 个槽的档，一共只有 ${SAVE_SLOT_COUNT} 个槽`)
  }
  const slots: (SaveFile | null)[] = Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => initial[i] ?? null)
  return {
    status: () => 'ready',
    error: () => null,
    read(slot) {
      checkSlot(slot)
      return slots[slot]!
    },
    write(slot, save) {
      checkSlot(slot)
      slots[slot] = save
    },
  }
}
