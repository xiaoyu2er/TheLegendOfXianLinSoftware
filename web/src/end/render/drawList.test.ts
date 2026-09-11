import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { END_IMAGES, endImageId, endPictureId } from '../assets'
import { createEndWorld, startEnd, updateEnd } from '../world'
import { END_LAYOUT, endDrawList } from './drawList'

/**
 * 结局面板的绘制清单（xl-czb.6）。次序、坐标、素材路径从 GBK 源码现读，不在这里
 * 手抄第二份 —— 手抄的话两份一起错也是绿的。
 */
const SRC = javaSource('src/start/EndPanel.java').replace(/\s+/g, '')
const PAINT = SRC.slice(SRC.indexOf('publicvoidpaint(Graphicsg){'), SRC.indexOf('publicvoidupdate(){'))

describe('坐标与素材从原版现读', () => {
  it('paint()：isDraw 挡着，四层的次序与落点', () => {
    expect(SRC.indexOf('publicvoidpaint(Graphicsg){'), '源码里找不到 paint()').toBeGreaterThanOrEqual(0)
    expect(PAINT).toContain(
      'if(isDraw){bufferGraphics.drawImage(back,0,0,this);bufferGraphics.drawImage(currentImage,0,0,this);' +
        'bufferGraphics.drawImage(word,wordX,wordY,this);bufferGraphics.drawImage(blank,blankX,blankY,this);',
    )
    expect(SRC).toContain(`wordX=${END_LAYOUT.wordX};`)
    expect(SRC).toContain(`blankX=${END_LAYOUT.blankX};`)
  })

  it('三张固定图的路径与构造函数一致', () => {
    expect(SRC).toContain(`back=Reader.readImage("${END_IMAGES.back}");`)
    expect(SRC).toContain(`word=Reader.readImage("${END_IMAGES.word}");`)
    expect(SRC).toContain(`blank=Reader.readImage("${END_IMAGES.blank}");`)
  })
})

describe('一帧的绘制清单', () => {
  it('没 start 之前 isDraw 为假，一笔都不画', () => {
    expect(endDrawList(createEndWorld())).toEqual([])
  })

  it('刚进来还没读过过场画：背景 → 字幕 → 侧栏，没有过场画那一层', () => {
    const w = createEndWorld()
    startEnd(w)
    expect(endDrawList(w)).toEqual([
      { id: endImageId('back'), x: 0, y: 0 },
      { id: endImageId('word'), x: 0, y: 640 },
      { id: endImageId('blank'), x: 700, y: -1920 },
    ])
  })

  it('第一拍之后：过场画 1 夹在背景与字幕之间', () => {
    const w = createEndWorld()
    startEnd(w)
    updateEnd(w)
    expect(endDrawList(w)).toEqual([
      { id: endImageId('back'), x: 0, y: 0 },
      { id: endPictureId(1), x: 0, y: 0 },
      { id: endImageId('word'), x: 0, y: 635 },
      { id: endImageId('blank'), x: 700, y: -1915 },
    ])
  })
})
