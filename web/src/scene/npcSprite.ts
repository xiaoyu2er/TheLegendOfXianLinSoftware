import { npcAssetId } from '../assets/ids'
import type { AssetId } from '../assets/ids'
import type { NpcState } from '../state/npc'

/**
 * 一个 NPC 这一帧该画哪张图、画在哪（**世界像素**，镜头由调用方加）。
 *
 * 几何照抄原版 `NPC.drawNPC`：
 *
 *     g.drawImage(图, x - firstTileX * 8, y - firstTileY * 8, scene)
 *
 * 两件事跟主角**不一样**，都不是笔误：
 *
 * 1. **没有 `-32`。** 主角画在 `(x, y - 32)`，NPC 画在 `(x, y)`。NPC 的图是
 *    32×64，于是它占的是 `y` 与 `y+1` 两格，脚下那一格是 `y+1` —— 这正是
 *    `RoleEvent.isAllow` 里那条 `y == npc.getY() + 1` 的由来，两处必须一致。
 * 2. **不指定宽高**，按图的原尺寸画。所以这里也不返回 width/height，交给
 *    纹理自己说了算；写死 32×64 会把 `老头.png`（32×65）压扁一像素。
 *
 * 帧的选法：静止的 NPC 永远是它那唯一一张（原版是另一个字段 `image`，
 * 跟 `count` 无关）；另外两种按 `count` 取。**下标越界就抛** —— 原版在这里是
 * `IndexOutOfBoundsException`，静默不画会把"素材少给了几帧"变成"这个 NPC
 * 偶尔闪一下"。
 */
export interface NpcSpritePlacement {
  readonly asset: AssetId
  readonly x: number
  readonly y: number
}

export function npcSprite(npc: NpcState): NpcSpritePlacement {
  const index = npc.type === 0 ? 0 : npc.frame
  const image = npc.images[index]
  if (image === undefined) {
    throw new Error(
      `NPC ${npc.name}（状态码 ${npc.type}）取第 ${index} 帧，但只有 ${npc.images.length} 帧：` +
        `${npc.images.join(', ')}。原版在这里是 IndexOutOfBoundsException。`,
    )
  }
  return { asset: npcAssetId(image), x: npc.px, y: npc.py }
}
