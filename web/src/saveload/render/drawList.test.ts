import { describe, expect, it } from 'vitest'
import { mapAssetId, startFrameAssetId } from '../../assets/ids'
import { createMemorySaveStore } from '../../save/memoryStore'
import { javaSource } from '../../test/javaSource'
import { LS_IMAGES, LS_SEQUENCES, lsFrameId, lsImageId } from '../assets'
import { draftSlots } from '../test/replayTrace'
import { SLOT_BUTTON_X, createSaveLoadWorld } from '../world'
import { SAVE_SLOT_COUNT } from '../../save/store'
import { START_SEQUENCES } from '../../start/assets'
import type { SaveLoadWorld } from '../world'
import { LS_FONT_SIZE, LS_LAYOUT, mapLabel, saveLoadDrawList, saveLoadTextureIds } from './drawList'

/**
 * 存读档面板的绘制清单（xl-i06.9）。坐标、字号、素材路径、帧数全从 GBK 源码现读，
 * 不在这里手抄第二份 —— 手抄的话两份一起错也是绿的。
 */
const SRC = javaSource('src/start/LoadAndSavePanel.java').replace(/\s+/g, '')
const PAINT = SRC.slice(SRC.indexOf('publicvoidpaint(Graphicsg){'), SRC.indexOf('publicvoidsetLastPanel'))

function world(slots = draftSlots([1])): SaveLoadWorld {
  return createSaveLoadWorld(createMemorySaveStore(slots))
}

describe('坐标与素材从原版现读', () => {
  it('底板、缩略图、地图名、任务的坐标与 paint() 一致', () => {
    const L = LS_LAYOUT
    expect(PAINT).toContain(`drawImage(Reader.readImage("${LS_IMAGES.board}"),${L.boardX},${L.boardY0}+i*200,this)`)
    expect(PAINT).toContain(`Reader.readImage("maps/"+maps.get(i)),${L.thumbX},${L.thumbY0}+i*200,${L.thumbWidth},${L.thumbHeight},this)`)
    expect(PAINT).toContain(`drawString(mapName,${L.mapNameX},${L.mapNameY0}+i*200)`)
    expect(PAINT).toContain(`if(tasks.get(i)!="无")backgroundGraphics.drawString(tasks.get(i),${L.taskX},${L.taskY0}+i*200)`)
    expect(PAINT).toContain(`setFont(newFont("文鼎粗钢笔行楷",Font.BOLD,${LS_FONT_SIZE}))`)
    expect(PAINT).toContain('setColor(Color.WHITE)')
  })

  it('四段动画的目录、帧数、落点与 initialAnimations() 一致', () => {
    const got = [...SRC.matchAll(/newStartAnimation\((\d+),"([^"]+)",this,(\d+),150\+i\*200\)/g)].map((m) => [m[2], Number(m[1]), Number(m[3])])
    expect(got).toEqual([
      [LS_SEQUENCES.buttonGlow.dir, LS_SEQUENCES.buttonGlow.count, SLOT_BUTTON_X],
      [LS_SEQUENCES.zhang.dir, LS_SEQUENCES.zhang.count, LS_LAYOUT.roleX.zhang],
      [LS_SEQUENCES.lu.dir, LS_SEQUENCES.lu.count, LS_LAYOUT.roleX.lu],
      [LS_SEQUENCES.wen.dir, LS_SEQUENCES.wen.count, LS_LAYOUT.roleX.wen],
    ])
  })

  it('背景两张、按钮一张的路径与源码一致', () => {
    expect(SRC).toContain(`backgroundImage=Reader.readImage("${LS_IMAGES.saveBackground}")`)
    expect(SRC).toContain(`backgroundImage=Reader.readImage("${LS_IMAGES.loadBackground}")`)
    expect(SRC.split(`Reader.readImage("${LS_IMAGES.blank}")`).length - 1).toBe(SAVE_SLOT_COUNT)
  })

  it('mapLabel 就是 split("\\\\.")[0]', () => {
    expect(PAINT).toContain('StringmapName=maps.get(i).split("\\\\.")[0];')
    expect(mapLabel('大地图.jpg')).toBe('大地图')
    expect(mapLabel('无')).toBe('无')
  })
})

describe('一帧的绘制清单', () => {
  it('z 序：背景 → 三个槽（底板 / 人 / 缩略图 / 地图名 / 任务）→ 三颗按钮 → 鼠标', () => {
    const w = world()
    w.mode = 'save'
    const ops = saveLoadDrawList(w)
    expect(ops[0]).toEqual({ kind: 'image', id: lsImageId('saveBackground'), x: 0, y: 0 })
    expect(ops.at(-1)).toEqual({ kind: 'image', id: startFrameAssetId('cursor', 0), x: 0, y: 0 })
    const boards = ops.flatMap((o, i) => (o.kind === 'image' && o.id === lsImageId('board') ? [i] : []))
    const blanks = ops.flatMap((o, i) => (o.kind === 'image' && o.id === lsImageId('blank') ? [i] : []))
    expect(boards).toHaveLength(SAVE_SLOT_COUNT)
    expect(blanks).toHaveLength(SAVE_SLOT_COUNT)
    expect(Math.max(...boards)).toBeLessThan(Math.min(...blanks))
  })

  it('空槽：不画缩略图、不画任务，地图名那一行写「无」；非空槽缩略图按 150×100 缩', () => {
    const w = world() // 槽 1 空
    const ops = saveLoadDrawList(w)
    const texts = ops.filter((o) => o.kind === 'text')
    expect(texts.filter((o) => o.y === LS_LAYOUT.mapNameY0 + 200)).toEqual([{ kind: 'text', text: '无', x: 100, y: 420 }])
    expect(texts.some((o) => o.y === LS_LAYOUT.taskY0 + 200)).toBe(false)
    const thumbs = ops.filter((o) => o.kind === 'image' && o.scaled)
    expect(thumbs.map((o) => o.kind === 'image' && [o.id, o.y])).toEqual([
      [mapAssetId(w.maps[0]!), 100],
      [mapAssetId(w.maps[2]!), 500],
    ])
    expect(thumbs.every((o) => o.kind === 'image' && o.scaled?.width === 150 && o.scaled.height === 100)).toBe(true)
  })

  it('任务画不画看的是「这个槽非空」，不看文本（原版引用比较）—— 文本恰好是「无」也照画', () => {
    const w = world()
    w.tasks[0] = '无'
    const ops = saveLoadDrawList(w)
    expect(ops).toContainEqual({ kind: 'text', text: '无', x: LS_LAYOUT.taskX, y: LS_LAYOUT.taskY0 })
  })

  it('三个人只在 isRoleExist 为真时画，帧号取渲染层给的', () => {
    const w = world()
    w.roles[1] = [false, true, false]
    const ops = saveLoadDrawList(w, { cursor: 3, roles: 5, glow: [0, 0, 0] })
    const lu = ops.filter((o) => o.kind === 'image' && o.id.startsWith('ls:lu:'))
    expect(lu).toContainEqual({ kind: 'image', id: lsFrameId('lu', 5), x: 400, y: 350 })
    expect(ops.filter((o) => o.kind === 'image' && o.y === 350 && /ls:(zhang|wen):/.test(o.id))).toEqual([])
    expect(ops.at(-1)).toMatchObject({ id: startFrameAssetId('cursor', 3) })
  })

  it('按钮光效：停着画第 0 帧，开着画渲染层数到的那一帧', () => {
    const w = world()
    w.buttons[2]!.glowing = true
    const ops = saveLoadDrawList(w, { cursor: 0, roles: 0, glow: [3, 3, 3] })
    const glows = ops.filter((o) => o.kind === 'image' && o.id.startsWith('ls:buttonGlow:'))
    expect(glows.map((o) => o.kind === 'image' && o.id)).toEqual([lsFrameId('buttonGlow', 0), lsFrameId('buttonGlow', 0), lsFrameId('buttonGlow', 3)])
  })

  it('载入名单盖住这一帧用到的每一张', () => {
    const w = world()
    w.roles[1] = [true, true, true]
    w.buttons.forEach((b) => (b.glowing = true))
    const ids = new Set(saveLoadTextureIds(w))
    const longest = Math.max(...Object.values(LS_SEQUENCES).map((s) => s.count), START_SEQUENCES.cursor.count)
    for (let f = 0; f < longest; f++) {
      for (const o of saveLoadDrawList(w, { cursor: f, roles: f, glow: [f, f, f] })) {
        if (o.kind === 'image') expect(ids, o.id).toContain(o.id)
      }
    }
  })
})
