/**
 * 从**实际差异图**上量缺口区（xl-knp.10 用它量 shop 那三条）。
 *
 * 票面那句「分区坐标不许手写，要从实际差异图上量出来」的可执行版本。**这个
 * 文件只做读盘与打印** —— 算术全在 `src/compare/measure.ts`，那半有测试
 * （`measure.test.ts`，跑在 `pnpm test` 里）。分成两半的理由与这条流水线其余
 * 各处一样：`tools/traces/compare/` 整个不入库，拿它当测试的分母的话，别人
 * 机器上"目录是空的"会让测试恒真。
 *
 * 第一档：**量**。两侧位图逐帧对齐、取超容差像素的并集、连通聚类，逐块打印
 * 外接框与「单帧最多」。区的四边再各留几个像素余量、成因逐块回到截图上认，
 * 那两件事是人做的 —— 这个脚本只交出读数。
 *
 *   cd web && pnpm exec vite-node scripts/measureGaps.ts -- <剧本> [<剧本>…]
 *
 * 第二档：**核一组已经划好的分区**。把矩形按剧本名写成一份 JSON 传进来，它
 * 逐区报「单帧最多」（`maxPixels` 就是它的 2 倍），并且**把落在所有区之外的
 * 差异像素点出来** —— 那正是「还有一个没认出来的成因」的样子，不许拿一个更大
 * 的框盖掉。
 *
 *   … scripts/measureGaps.ts -- <剧本> --rects <矩形.json>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng } from '../src/compare/png'
import { clusterBoxes, diffMask, readOutside, readRegion, unionOf } from '../src/compare/measure'
import { repoPath } from '../src/test/repoPath'
import type { Rect } from '../src/compare/regions'

interface NamedRect extends Rect {
  readonly name: string
}

interface Frames {
  readonly names: readonly string[]
  readonly masks: readonly Uint8Array[]
  readonly width: number
  readonly height: number
}

/**
 * 把一条剧本这一轮的两侧位图读成逐帧掩码。
 *
 * **一张 PNG 都没有要响。** 那个目录整个不入库，跑错剧本名 / 上一轮被清掉都会
 * 让它是空的 —— 而空的掩码会让下面每个区都报「一帧都不差」、末尾报「硬比区
 * 逐像素相等」，与真的量过一遍**逐字相同**。实测过：把这道守卫拿掉，空目录上
 * 整轮退出码 **0** 并打印那句「逐像素相等」。而这份输出正是要被抄进
 * `expected.ts` 的那份读数。
 */
function readFrames(script: string): Frames {
  const root = repoPath(join('tools/traces/compare', script))
  const names = readdirSync(join(root, 'java'))
    .filter((f) => f.endsWith('.png'))
    .sort()
  if (names.length === 0) throw new Error(`${script}: java/ 下一张 PNG 都没有`)
  let width = 0
  let height = 0
  const masks: Uint8Array[] = []
  for (const name of names) {
    const a = decodePng(readFileSync(join(root, 'java', name)))
    const b = decodePng(readFileSync(join(root, 'web', name)))
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error(
        `${script}/${name}: 两端尺寸不同（${a.width}×${a.height} vs ${b.width}×${b.height}）`,
      )
    }
    width = a.width
    height = a.height
    masks.push(diffMask(a.rgba, b.rgba, width * height))
  }
  return { names, masks, width, height }
}

const box = (r: Rect) => `(${r.x0},${r.y0})-(${r.x1},${r.y1})`

function measure(script: string): void {
  const { names, masks, width, height } = readFrames(script)
  const union = unionOf(masks, width * height)
  const boxes = clusterBoxes(union, width, height)
  const total = union.reduce((s: number, v: number) => s + v, 0)
  console.log(
    `\n=== ${script} — ${names.length} 帧 · 并集 ${total} 个差异像素 · ${boxes.length} 块 ===`,
  )
  for (const b of boxes) {
    const r = readRegion(masks, width, b)
    console.log(
      `  ${box(b)} ${b.x1 - b.x0 + 1}×${b.y1 - b.y0 + 1}` +
        ` · 并集 ${b.pixels} · 单帧最多 ${r.worst}（${names[r.worstFrame] ?? '—'}）` +
        ` · 出现在 ${r.framesHit}/${names.length} 帧`,
    )
  }
}

function verify(script: string, rects: readonly NamedRect[]): void {
  const { names, masks, width, height } = readFrames(script)
  console.log(`\n=== ${script} — ${names.length} 帧 · 核 ${rects.length} 个分区 ===`)
  for (const rect of rects) {
    const r = readRegion(masks, width, rect)
    const area = (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1)
    console.log(
      `  ${rect.name.padEnd(20)} 外接框 ${r.box ? box(r.box) : '（无）'}` +
        ` · 单帧最多 ${String(r.worst).padStart(6)}（${names[r.worstFrame] ?? '—'}）` +
        ` · maxPixels=${r.worst * 2} · 面积 ${area} · 出现在 ${r.framesHit}/${names.length} 帧` +
        (r.worst === 0 ? '  ⚠️ 一帧都不差 —— 这个区该删掉' : ''),
    )
  }
  const outside = readOutside(masks, width, height, rects)
  console.log(
    outside.pixels === 0
      ? '  硬比区：逐像素相等（0 个超容差像素）'
      : `  ⚠️ 硬比区里有 ${outside.pixels} 个超容差像素，外接框 ${box(outside.box!)}，` +
          `涉及 ${outside.frames} 帧`,
  )
}

const argv = process.argv.slice(2)
const rectsAt = argv.indexOf('--rects')
const rectsFile = rectsAt < 0 ? null : argv[rectsAt + 1]
const scripts = argv.filter((a, i) => !a.startsWith('-') && i !== rectsAt + 1)
if (scripts.length === 0) {
  console.error('用法: pnpm exec vite-node scripts/measureGaps.ts -- <剧本> [--rects <矩形.json>]')
  process.exit(2)
}
if (rectsFile) {
  const table = JSON.parse(readFileSync(rectsFile, 'utf8')) as Record<string, NamedRect[]>
  for (const s of scripts) {
    const rects = table[s]
    if (!rects) throw new Error(`${rectsFile} 里没有 ${s} 的矩形`)
    verify(s, rects)
  }
} else {
  for (const s of scripts) measure(s)
}
