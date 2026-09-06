import { roleAssetId } from '../assets/ids'
import { DIRECTION_CODE } from '../state/types'
import type { AssetId } from '../assets/ids'
import type { RoleState } from '../state/types'

/**
 * 主角当前该画哪一帧，以及画在哪、画多大。
 *
 * 抽成纯函数是为了能测：下标算错的表现是"主角在某个朝向的某一帧凭空消失"，
 * 在画面上几乎看不出来，而这里可以把 4 个朝向 × 全部帧号一次枚举干净
 * （`roleSprite.test.ts`）。
 *
 * 几何照抄原版 `Role.drawHero`：
 *
 *   走：`walkImages.get(direction + count)`，画在 (x, y-32)，32×64；
 *   跑：`runImages.get(direction/2 + count2)`，画在 (x-5, y-32)，42×64。
 *
 * 那个 -5 不是随手写的：跑步图比行走图宽 10 px，往左挪 5 px 两套图的人物
 * 中心才对齐；不挪的话走跑一切换主角会横向跳一下。
 */
export interface RoleSprite {
  readonly asset: AssetId
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function roleSprite(role: RoleState): RoleSprite {
  if (role.running) {
    return {
      asset: roleAssetId('run', DIRECTION_CODE[role.dir] / 2 + role.runFrame),
      x: role.px - 5,
      y: role.py - 32,
      width: 42,
      height: 64,
    }
  }
  return {
    asset: roleAssetId('walk', DIRECTION_CODE[role.dir] + role.frame),
    x: role.px,
    y: role.py - 32,
    width: 32,
    height: 64,
  }
}
