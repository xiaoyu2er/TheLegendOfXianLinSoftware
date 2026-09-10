import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { OVERLAY_FILES, overlayPlacements } from './mapOverlays'
import type { SceneViewport } from './viewport'

const at = (firstTileX: number, firstTileY: number): SceneViewport => ({
  offsetX: -firstTileX * 8,
  offsetY: -firstTileY * 8,
  firstTileX,
  lastTileX: firstTileX + 129,
  firstTileY,
  lastTileY: firstTileY + 81,
})

/** 原版 `OtherEvent.addMap` 的源码（GBK），拿来对数，不手抄第二份。 */
const otherEvent = javaSource('src/scene/OtherEvent.java')

describe('OtherEvent.addMap 的遮掩图', () => {
  it('十张的文件、世界坐标与次序逐句等于原版那十句 drawImage', () => {
    const fromJava = [
      ...otherEvent.matchAll(/"maps\/\/(\w+)" \+ type \+ "\.png"\),\s*(\d+) - firstTileX \* 8, (\d+) - firstTileY \* 8/g),
    ].map((m) => `${m[1]}@${m[2]},${m[3]}`)
    // 分母写死在这里是有意的：正则写坏了会匹配出 0 条，而 0 条与「全对上了」不许长得一样。
    expect(fromJava).toHaveLength(10)
    const ours = overlayPlacements('大地图.jpg', 80, at(0, 0)).map(
      (p) => `${p.asset.replace(/^overlay:/, '')}@${p.x},${p.y}`,
    )
    expect(ours).toEqual(fromJava)
  })

  it('减的是 firstTile*8，与 NPC 同一个量', () => {
    const [first] = overlayPlacements('大地图.jpg', 80, at(10, 20))
    expect(first).toEqual({ asset: 'overlay:tiyuguan2', x: 918 - 80, y: 906 - 160 })
  })

  it('地图名恰好是 大地图夜.jpg 时换夜那一套', () => {
    const night = overlayPlacements('大地图夜.jpg', 80, at(0, 0))
    expect(night.map((p) => p.asset)).toEqual(
      overlayPlacements('大地图.jpg', 80, at(0, 0)).map((p) => `${p.asset}夜`),
    )
  })

  it('碰撞网格不是 80 行的地图一张都不贴', () => {
    expect(overlayPlacements('宿舍.png', 20, at(0, 0))).toEqual([])
  })

  it('烘焙名单：九个文件各白天与夜一张，加金币图标，一个不重', () => {
    expect(OVERLAY_FILES).toHaveLength(19)
    expect(new Set(OVERLAY_FILES).size).toBe(OVERLAY_FILES.length)
    expect(OVERLAY_FILES).toContain('money')
    // 核的是**磁盘**，不是名单自己：名单由 `OVERLAYS` 推出来，拿它去核它推出来的
    // 那几个名字按构造恒真（/code-review 抓的）。拼错一个字，这里点名是哪张。
    const absent = OVERLAY_FILES.filter((file) => !existsSync(repoPath(`maps/${file}.png`)))
    expect(absent, '烘焙名单里这几张 maps/ 下没有').toEqual([])
  })
})
