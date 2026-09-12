import type { AssetId } from '../../assets/ids'
import type { BlitLoop } from '../../battle/render/scaledBlit'
import { mapAssetId, startFrameAssetId } from '../../assets/ids'
import { START_SEQUENCES } from '../../start/assets'
import { LS_SEQUENCES, lsFrameId, lsImageId } from '../assets'
import type { LsSequenceName } from '../assets'
import { SLOT_STRIDE } from '../world'
import type { SaveLoadWorld } from '../world'

/**
 * **原版 `LoadAndSavePanel.paint()`，摊成一份有序的绘制清单**（xl-i06.9）。
 *
 * 纯函数：世界 + 动画帧号 → 一串「把哪张图贴在哪 / 把哪句话画在哪」。不碰 Pixi、
 * 不碰 DOM，次序与坐标全在 `drawList.test.ts` 里逐条断言（坐标从 GBK 源码现读）。
 * 真实像素归跨端逐帧比对（xl-i06.12 接上，分区表态见 `compare/expected.ts` 的 saveload-*）。
 *
 * ## paint() 的次序就是 z 序
 *
 *     drawImage(backgroundImage, 0, 0)                              ← 背景（按模式）
 *     for i in 0..2:
 *       drawImage(底板.png, 90, 60 + i*200)
 *       isRoleExist[i][0..2] → 张 / 陆 / 文 那段动画 (300|400|500, 150 + i*200)
 *       drawImage(maps/<地图>, 100, 100 + i*200, 150, 100)           ← 缩略图（平台缩放）
 *       drawString(地图名去扩展名, 100, 220 + i*200)                   ← 白、粗、20
 *       if (tasks.get(i) != "无") drawString(任务, 400, 120 + i*200)
 *     三颗按钮：drawImage(空白.png, 800, 150 + i*200) + 它那段光效
 *     鼠标那段动画画在 (currentX, currentY)
 *
 * ## 缩略图按原版的采样表在 CPU 上缩（xl-cpo）
 *
 * 原版那句是 `drawImage(img, x, y, 150, 100, observer)` —— 交给平台自己缩放，没有手写
 * 循环。Java2D 在这里走哪条 blit 循环、每个目标像素取哪个源像素，`tools/export-scaled-blit.sh`
 * 照这一句真画量过（缩小区间，`maps/` 下每种尺寸），模型在 `battle/render/scaledBlit.ts`。
 * 这里只登记**走哪条循环**（{@link THUMBNAIL_LOOP}），渲染器照 `op.scaled` 在 CPU 上拼。
 *
 * ## 动画帧号不在状态层里
 *
 * 那条 10 Hz 的线程（鼠标、按钮光效、三个人）只推帧号，真值不记（导出时它冻在
 * 第一帧上）。所以帧号是这里的参数，由渲染层自己数 —— 与商店、菜单同一个处置。
 */
export type SaveLoadDrawOp =
  | {
      readonly kind: 'image'
      readonly id: AssetId
      readonly x: number
      readonly y: number
      /**
       * 给了就按这个尺寸画（`drawImage(img, x, y, w, h, …)`）。**只有缩略图用它**。
       * `loop` 是 Java2D 缩放时走的那条 blit 循环，渲染器照它选采样表（见 {@link THUMBNAIL_LOOP}）。
       */
      readonly scaled?: { readonly width: number; readonly height: number; readonly loop: BlitLoop }
    }
  | {
      readonly kind: 'text'
      readonly text: string
      /** `drawString` 的 x / y 是**基线**。 */
      readonly x: number
      readonly y: number
    }

/** `paint()` 里那几个坐标。与 GBK 源码对撞见 `drawList.test.ts`。 */
export const LS_LAYOUT = {
  boardX: 90,
  boardY0: 60,
  roleX: { zhang: 300, lu: 400, wen: 500 },
  roleY0: 150,
  thumbX: 100,
  thumbY0: 100,
  thumbWidth: 150,
  thumbHeight: 100,
  mapNameX: 100,
  mapNameY0: 220,
  taskX: 400,
  taskY0: 120,
} as const

/**
 * 缩略图走的 blit 循环：**不透明那条**。这是登记，不是推导 —— 判据是导出器把每张真地图
 * 照原版那一句画出来、看它对上哪张表（`java-scaled-blit.json` 的 `thumbnail.maps`）。
 * 场景地图全都没有真透明像素（带 alpha 通道的 PNG 也是每个像素 255），读数里 27 张跑出来
 * 是不透明、1 张（教室2.png）两条循环在它的尺寸上画出来处处相同。`drawList.test.ts` 拿
 * 那份读数逐张对撞；哪天冒出一张走带透明那条的场景地图，那里会红，这一行要跟着改成按图选。
 */
export const THUMBNAIL_LOOP: BlitLoop = 'opaque'

/** `new Font("文鼎粗钢笔行楷", Font.BOLD, 20)`、`Color.WHITE`。 */
export const LS_FONT_SIZE = 20
export const LS_TEXT_COLOR = '#ffffff'

/** 渲染层自己数的帧号。`roles` 三个人共用一个（同一条线程推），`glow[i]` 是第 i 颗按钮的。 */
export interface SaveLoadFrames {
  readonly cursor: number
  readonly roles: number
  readonly glow: readonly number[]
}

export const FIRST_FRAMES: SaveLoadFrames = { cursor: 0, roles: 0, glow: [0, 0, 0] }

const ROLE_SEQUENCES: readonly LsSequenceName[] = ['zhang', 'lu', 'wen']

/**
 * `maps.get(i).split("\\.")[0]` —— Java 的 `split` 按正则切、丢末尾空串；这里只要
 * 第一段，与「第一个点之前」等价（地图名里没有以点开头的）。
 */
export function mapLabel(map: string): string {
  const dot = map.indexOf('.')
  return dot < 0 ? map : map.slice(0, dot)
}

export function saveLoadDrawList(w: SaveLoadWorld, frames: SaveLoadFrames = FIRST_FRAMES): SaveLoadDrawOp[] {
  const L = LS_LAYOUT
  const ops: SaveLoadDrawOp[] = [
    { kind: 'image', id: lsImageId(w.mode === 'save' ? 'saveBackground' : 'loadBackground'), x: 0, y: 0 },
  ]
  w.maps.forEach((map, i) => {
    const dy = i * SLOT_STRIDE
    ops.push({ kind: 'image', id: lsImageId('board'), x: L.boardX, y: L.boardY0 + dy })
    ROLE_SEQUENCES.forEach((name, k) => {
      if (!w.roles[i]![k]) return
      const id = lsFrameId(name, frames.roles % LS_SEQUENCES[name].count)
      ops.push({ kind: 'image', id, x: L.roleX[name as 'zhang' | 'lu' | 'wen'], y: L.roleY0 + dy })
    })
    // 空槽是字面量「无」：`readImage("maps/无")` 找不到文件、交出 null，`drawImage(null…)`
    // 什么都不画（外加一行缺图告警，原版缺陷，已登记）。
    if (map !== '无') {
      ops.push({
        kind: 'image',
        id: mapAssetId(map),
        x: L.thumbX,
        y: L.thumbY0 + dy,
        scaled: { width: L.thumbWidth, height: L.thumbHeight, loop: THUMBNAIL_LOOP },
      })
    }
    ops.push({ kind: 'text', text: mapLabel(map), x: L.mapNameX, y: L.mapNameY0 + dy })
    if (w.taskDrawn[i]) ops.push({ kind: 'text', text: w.tasks[i]!, x: L.taskX, y: L.taskY0 + dy })
  })
  w.buttons.forEach((b, i) => {
    ops.push({ kind: 'image', id: lsImageId('blank'), x: b.x, y: b.y })
    // 光效停着的时候 `currentImage = array[0]`（`stopButtonAnimation`），照样画。
    const glow = b.glowing ? (frames.glow[i] ?? 0) % LS_SEQUENCES.buttonGlow.count : 0
    ops.push({ kind: 'image', id: lsFrameId('buttonGlow', glow), x: b.x, y: b.y })
  })
  ops.push({
    kind: 'image',
    id: startFrameAssetId('cursor', frames.cursor % START_SEQUENCES.cursor.count),
    x: w.currentX,
    y: w.currentY,
  })
  return ops
}

/** 这一帧可能用到的每一张纹理 —— 载入名单。按内容去重。 */
export function saveLoadTextureIds(w: SaveLoadWorld): AssetId[] {
  const ids = new Set<AssetId>([lsImageId('saveBackground'), lsImageId('loadBackground'), lsImageId('board'), lsImageId('blank')])
  for (const name of Object.keys(LS_SEQUENCES) as LsSequenceName[]) {
    for (let f = 0; f < LS_SEQUENCES[name].count; f++) ids.add(lsFrameId(name, f))
  }
  for (let f = 0; f < START_SEQUENCES.cursor.count; f++) ids.add(startFrameAssetId('cursor', f))
  for (const map of w.maps) if (map !== '无') ids.add(mapAssetId(map))
  return [...ids]
}
