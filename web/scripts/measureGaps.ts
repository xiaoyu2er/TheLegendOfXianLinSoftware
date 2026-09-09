/**
 * 从**实际差异图**上量缺口区（xl-knp.10 用它量 shop 那三条）。
 *
 * 票面那句「分区坐标不许手写，要从实际差异图上量出来」的可执行版本：把
 * `tools/traces/compare/<剧本>/` 下两侧的位图逐帧对齐，取超容差像素的**并集**，
 * 连通聚类，逐块打印外接框与「单帧最多」。区的四边再各留几个像素余量、成因
 * 逐块回到截图上认，那两件事是人做的 —— 这个脚本只交出读数。
 *
 * 为什么不写成测试：它量的是**当下这一轮**的产物，而那个目录整个不入库
 * （`tools/.gitignore`）。落成判据的是它的输出被抄进 `expected.ts` 之后，由
 * `regions.ts` 那套「缺口区之外一个像素都不许差」守着。
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
import { DEFAULT_TOLERANCE } from '../src/compare/diff'
import { repoPath } from '../src/test/repoPath'

/** 聚类时把差异像素向外胀这么多再连通 —— 一个字的笔画之间是断开的。 */
const DILATE = 4

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
  pixels: number
}

function frameNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
}

/** 与 `diff.ts` 的 `frameDiff` 同一条规则：**alpha 不参与**，容差 8。 */
function diffMask(a: Uint8Array, b: Uint8Array, n: number): Uint8Array {
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const d = Math.max(
      Math.abs(a[p]! - b[p]!),
      Math.abs(a[p + 1]! - b[p + 1]!),
      Math.abs(a[p + 2]! - b[p + 2]!),
    )
    if (d > DEFAULT_TOLERANCE) mask[i] = 1
  }
  return mask
}

/** 并集掩码 → 连通块的外接框。膨胀只用于判连通，框仍是原始像素的外接框。 */
function cluster(union: Uint8Array, w: number, h: number): Box[] {
  const label = new Int32Array(w * h).fill(-1)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let seed = 0; seed < union.length; seed++) {
    if (!union[seed] || label[seed] !== -1) continue
    const id = boxes.length
    const box: Box = { x0: w, y0: h, x1: -1, y1: -1, pixels: 0 }
    boxes.push(box)
    label[seed] = id
    stack.push(seed)
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % w
      const y = (i / w) | 0
      if (x < box.x0) box.x0 = x
      if (x > box.x1) box.x1 = x
      if (y < box.y0) box.y0 = y
      if (y > box.y1) box.y1 = y
      box.pixels++
      for (let dy = -DILATE; dy <= DILATE; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -DILATE; dx <= DILATE; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (union[j] && label[j] === -1) {
            label[j] = id
            stack.push(j)
          }
        }
      }
    }
  }
  return boxes
}

function measure(script: string): void {
  const root = repoPath(join('tools/traces/compare', script))
  const javaDir = join(root, 'java')
  const webDir = join(root, 'web')
  const names = frameNames(javaDir)
  if (names.length === 0) throw new Error(`${script}: java/ 下一张 PNG 都没有`)

  let w = 0
  let h = 0
  let union: Uint8Array | null = null
  const masks: Uint8Array[] = []
  for (const name of names) {
    const a = decodePng(readFileSync(join(javaDir, name)))
    const b = decodePng(readFileSync(join(webDir, name)))
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error(`${script}/${name}: 两端尺寸不同`)
    }
    w = a.width
    h = a.height
    const mask = diffMask(a.rgba, b.rgba, w * h)
    masks.push(mask)
    if (!union) union = new Uint8Array(w * h)
    for (let i = 0; i < mask.length; i++) if (mask[i]) union[i] = 1
  }
  if (!union) throw new Error(`${script}: 一帧都没读到`)

  const boxes = cluster(union, w, h).sort((p, q) => q.pixels - p.pixels)
  const total = union.reduce((s, v) => s + v, 0)
  console.log(`\n=== ${script} — ${names.length} 帧 · 并集 ${total} 个差异像素 · ${boxes.length} 块 ===`)
  for (const box of boxes) {
    // 单帧最多：这一块在任意一帧里的超容差像素数的上限，正是 maxPixels 的来源。
    let worst = 0
    let worstFrame = ''
    let framesHit = 0
    masks.forEach((mask, k) => {
      let n = 0
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) if (mask[y * w + x]) n++
      }
      if (n > 0) framesHit++
      if (n > worst) {
        worst = n
        worstFrame = names[k]!
      }
    })
    console.log(
      `  (${box.x0},${box.y0})-(${box.x1},${box.y1})` +
        ` ${box.x1 - box.x0 + 1}×${box.y1 - box.y0 + 1}` +
        ` · 并集 ${box.pixels} · 单帧最多 ${worst}（${worstFrame}）· 出现在 ${framesHit}/${names.length} 帧`,
    )
  }
}

interface NamedRect {
  readonly name: string
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** 核一组已经划好的分区：逐区报单帧最多，并把区外的差异像素点出来。 */
function verify(script: string, rects: readonly NamedRect[]): void {
  const root = repoPath(join('tools/traces/compare', script))
  const names = frameNames(join(root, 'java'))
  const masks: Uint8Array[] = []
  let w = 0
  let h = 0
  for (const name of names) {
    const a = decodePng(readFileSync(join(root, 'java', name)))
    const b = decodePng(readFileSync(join(root, 'web', name)))
    w = a.width
    h = a.height
    masks.push(diffMask(a.rgba, b.rgba, w * h))
  }
  console.log(`\n=== ${script} — ${names.length} 帧 · 核 ${rects.length} 个分区 ===`)
  const inside = new Uint8Array(w * h)
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) inside[y * w + x] = 1
  }
  for (const r of rects) {
    let worst = 0
    let worstFrame = ''
    let hit = 0
    masks.forEach((mask, k) => {
      let n = 0
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) if (mask[y * w + x]) n++
      }
      if (n > 0) hit++
      if (n > worst) {
        worst = n
        worstFrame = names[k]!
      }
    })
    // 实测外接框：区里那些差异像素**并集**的外接框。写进注释，它与矩形之间
    // 的差就是留的余量，别人一眼看得出留了几个像素。
    let bx0 = r.x1
    let by0 = r.y1
    let bx1 = r.x0 - 1
    let by1 = r.y0 - 1
    for (const mask of masks) {
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) {
          if (!mask[y * w + x]) continue
          if (x < bx0) bx0 = x
          if (y < by0) by0 = y
          if (x > bx1) bx1 = x
          if (y > by1) by1 = y
        }
      }
    }
    const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
    console.log(
      `  ${r.name.padEnd(20)} 外接框 (${bx0},${by0})-(${bx1},${by1})` +
        ` · 单帧最多 ${String(worst).padStart(6)}（${worstFrame}）` +
        ` · maxPixels=${worst * 2} · 面积 ${area} · 出现在 ${hit}/${names.length} 帧` +
        (worst === 0 ? '  ⚠️ 一帧都不差 —— 这个区该删掉' : ''),
    )
  }
  // 区外：硬比区里一个超容差的像素都不许有。
  let outside = 0
  let box = { x0: w, y0: h, x1: -1, y1: -1 }
  const frames = new Set<string>()
  masks.forEach((mask, k) => {
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || inside[i]) continue
      outside++
      frames.add(names[k]!)
      const x = i % w
      const y = (i / w) | 0
      if (x < box.x0) box.x0 = x
      if (y < box.y0) box.y0 = y
      if (x > box.x1) box.x1 = x
      if (y > box.y1) box.y1 = y
    }
  })
  console.log(
    outside === 0
      ? '  硬比区：逐像素相等（0 个超容差像素）'
      : `  ⚠️ 硬比区里有 ${outside} 个超容差像素，外接框 (${box.x0},${box.y0})-(${box.x1},${box.y1})，` +
          `涉及 ${frames.size} 帧`,
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
