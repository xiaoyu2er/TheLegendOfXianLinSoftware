import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import {
  END_INITIAL,
  END_PICTURE_COUNT,
  END_STEP,
  END_TICK_MS,
  END_WORD_STOP,
  advanceEnd,
  createEndLoop,
  createEndWorld,
  startEnd,
  updateEnd,
} from './world'

/**
 * 结局面板状态层的几个常数，从 GBK 源码现读（xl-czb.6）。逐拍的行为由
 * `endTrace.test.ts` 对真值；这里只守「抄过来的数就是源码里那个数」—— 真值只走过
 * 一条剧本，常数抄错一个而恰好不影响那一条的写法，在那边是看不见的。
 */
const SRC = javaSource('src/start/EndPanel.java').replace(/\s+/g, '')

describe('EndPanel 的常数与源码一致', () => {
  it('构造函数：wordY / blankY / code 的初值，isDraw 假、isStop 真', () => {
    expect(SRC).toContain(`wordY=${END_INITIAL.wordY};`)
    expect(SRC).toContain(`blankY=${END_INITIAL.blankY};`)
    expect(SRC).toContain(`code=${END_INITIAL.code};`)
    expect(SRC).toContain('isDraw=false;isStop=true;')
    const w = createEndWorld()
    expect([w.isDraw, w.isStop, w.picture]).toEqual([false, true, null])
  })

  it('update()：两个并列的 if、步长、上界', () => {
    const update = SRC.slice(SRC.indexOf('publicvoidupdate(){'), SRC.indexOf('publicvoidrun()'))
    expect(SRC.indexOf('publicvoidupdate(){'), '源码里找不到 update()').toBeGreaterThanOrEqual(0)
    expect(update).toContain(
      `if(code<${END_PICTURE_COUNT}){currentImage=Reader.readImage("sources/End/"+code+".jpg");code++;}` +
        `if(code==${END_PICTURE_COUNT}){currentImage=Reader.readImage("sources/End/"+code+".jpg");code=1;}`,
    )
    expect(update).toContain(`if(wordY>${END_WORD_STOP}){wordY-=${END_STEP};blankY+=${END_STEP};}`)
    expect(update).toContain(`if(wordY==${END_WORD_STOP}){isStop=true;}`)
  })

  it('run()：while(true) 里 sleep 一圈的毫秒数，循环体没有出口', () => {
    const run = SRC.slice(SRC.indexOf('publicvoidrun(){'))
    expect(run).toContain(`while(true){try{tools.Clock.sleep(${END_TICK_MS});`)
    expect(run).not.toMatch(/break|return/)
  })

  it('start()：isDraw 真、isStop 假', () => {
    expect(SRC).toContain('publicvoidstart(){Threadt=newThread(this);t.start();isDraw=true;isStop=false;}')
  })
})

describe('update() 的行为', () => {
  it('24.jpg 从来没被画出来过：一轮 24 拍，picture 取遍 1..23 与 25', () => {
    const w = createEndWorld()
    startEnd(w)
    const seen: (number | null)[] = []
    for (let i = 0; i < 24; i++) {
      updateEnd(w)
      seen.push(w.picture)
    }
    expect(seen).toEqual([...Array.from({ length: 23 }, (_, i) => i + 1), 25])
  })

  it('停在 (640 − (−1280)) / 5 = 384 拍：那一拍 isStop 翻真，之后不再 repaint、一个字段都不改', () => {
    const w = createEndWorld()
    startEnd(w)
    const stopAt = (END_INITIAL.wordY - END_WORD_STOP) / END_STEP
    for (let i = 1; i < stopAt; i++) expect(updateEnd(w)).toBe(true)
    expect(w.isStop).toBe(false)
    expect(updateEnd(w)).toBe(true)
    expect(w.isStop).toBe(true)
    expect([w.wordY, w.blankY]).toEqual([END_WORD_STOP, 0])
    const frozen = { ...w }
    expect(updateEnd(w)).toBe(false)
    expect(w).toEqual(frozen)
  })

  it('那条循环按 100 ms 一圈走，余量攒着不丢；isStop 之后照样走（线程不退出）', () => {
    const w = createEndWorld()
    startEnd(w)
    const loop = createEndLoop(w)
    advanceEnd(loop, 99)
    expect(loop.iterations).toBe(0)
    advanceEnd(loop, 1)
    expect(loop.iterations).toBe(1)
    advanceEnd(loop, 250)
    expect([loop.iterations, loop.carryMs]).toEqual([3, 50])
    advanceEnd(loop, 1000 * END_TICK_MS)
    expect(w.isStop).toBe(true)
    const before = loop.iterations
    advanceEnd(loop, 10 * END_TICK_MS)
    expect(loop.iterations - before).toBe(10)
  })
})
