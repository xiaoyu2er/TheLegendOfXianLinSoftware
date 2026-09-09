import { hits } from '../buttons'
import type { ShopButtonBox } from '../layout'

/**
 * 一颗按钮**点得中**的那个点，与 `ShopDriver.center()` 同一个算法：
 *
 *     new int[] { x - 15 + w / 2, y - 6 + h / 2 }
 *
 * 只有一份，因为这里有两个 `-15` / `-6`：一份在 `buttons.ts` 的 `hits`
 * （被测的那个），一份是导出器算落点用的。抄成两份的表现是改了偏移只红一处
 * ——`/code-review` 的 Standards 轴在 `step.test.ts` 与 `drawList.test.ts`
 * 里各抓到一份。
 *
 * 算完**当场核一遍真的点得中**：算错了的点在 `pressButton` 那里是"什么都没
 * 发生"，而那与"这一颗本来就不该响"长得一模一样。
 */
export function hitCenter(box: ShopButtonBox): [number, number] {
  const x = box.x - 15 + Math.floor(box.width / 2)
  const y = box.y - 6 + Math.floor(box.height / 2)
  if (!hits(box, x, y)) {
    throw new Error(`(${x},${y}) 点不中 ${box.x},${box.y} ${box.width}×${box.height} 那颗按钮`)
  }
  return [x, y]
}
