import { describe, expect, it } from 'vitest'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveFile } from '../save/format'
import type { SaveStore } from '../save/store'
import { javaSource } from '../test/javaSource'
import { draftSlots } from './test/replayTrace'
import { applySaveLoadInput } from './step'
import type { SaveLoadInput } from './step'
import { SLOT_BUTTON_SIZE, SLOT_BUTTON_X, SLOT_BUTTON_Y0, SLOT_STRIDE, createSaveLoadWorld, slotCenter } from './world'

/**
 * 面板状态机里真值走不到的那几支（xl-i06.9）。真值走到的都在
 * `saveloadTrace.test.ts` 里逐步对着；这里是剧本没点过的形状 —— 判据回到原版
 * 源码上取（`docs/agents/dispatch.md`「真值盖不到那个分支」）。
 */
const SAMPLE = draftSlots([])[0]!

/** 数一数写了几次的仓库。 */
function countingStore(initial: (SaveFile | null)[]): SaveStore & { writes: number[] } {
  const inner = createMemorySaveStore(initial)
  const writes: number[] = []
  return {
    ...inner,
    writes,
    write(slot, save) {
      writes.push(slot)
      inner.write(slot, save)
    },
  }
}

const center = slotCenter
const OUTSIDE = { x: 5, y: 5 }

function drive(store: SaveStore, inputs: SaveLoadInput[]) {
  const w = createSaveLoadWorld(store)
  const fx = inputs.map((input) => applySaveLoadInput(w, input, { store, capture: () => SAMPLE }))
  return { w, fx }
}

describe('存读档面板状态机：真值没走到的几支', () => {
  it('按下之后拖出去再松手：isclicked 清不掉，每对监听器各存一遍；下一次在空白处松手又存一遍', () => {
    const store = countingStore([null, null, null])
    const c = center(1)
    const { w, fx } = drive(store, [
      { e: 'enter', mode: 'save', from: 'menu' }, // 监听器 1 + 1 = 2 对
      { e: 'press', ...c },
      { e: 'release', ...OUTSIDE },
      { e: 'release', ...OUTSIDE },
    ])
    expect(w.listeners).toBe(2)
    expect(fx[2]!.saves).toEqual([1, 1])
    expect(fx[3]!.saves).toEqual([1, 1])
    expect(store.writes).toEqual([1, 1, 1, 1])
    expect(w.buttons[1]!.isclicked).toBe(true)
  })

  it('松手落在按下的那颗上：几对监听器都只存一遍（第一对办完就清掉）', () => {
    const store = countingStore([null, null, null])
    const c = center(0)
    const { fx } = drive(store, [
      { e: 'enter', mode: 'save', from: 'menu' },
      { e: 'enter', mode: 'save', from: 'menu' },
      { e: 'press', ...c },
      { e: 'release', ...c },
    ])
    expect(fx[3]!.saves).toEqual([0])
    expect(store.writes).toEqual([0])
  })

  it('这一支的次序（先 setButton 后 isRelesedButton、后者只在框里才清）是从原版现读的', () => {
    const src = javaSource('src/start/LoadAndSavePanel.java').replace(/\s+/g, '')
    expect(src).toMatch(/publicvoidmouseReleased\(MouseEvente\)\{currentX=e\.getX\(\);currentY=e\.getY\(\);\/\/检查按钮响应setButton\(\);for\(StartButtonbutton:buttons\)button\.isRelesedButton\(currentX,currentY\);\}/)
    const btn = javaSource('src/start/StartButton.java').replace(/\s+/g, '')
    expect(btn).toContain('publicvoidisRelesedButton(intcurrentX,intcurrentY){if(currentX>x-15&&currentX<(x+width-15)&&currentY>(y-6)&&currentY<(y+height-6)){buttonImage=waitclickImage;isclicked=false;}')
    // changeStateTo 末尾又 setMouse() 一次 —— 监听器对数随进面板次数涨。
    expect(src).toMatch(/publicvoidchangeStateTo\(booleanstate\)\{.*setMouse\(\);\}/)
  })

  it('读档点空槽：不读、不切面板、不起那条循环', () => {
    const store = countingStore([SAMPLE, null, null])
    const c = center(1)
    const { fx, w } = drive(store, [{ e: 'enter', mode: 'load', from: 'start' }, { e: 'press', ...c }, { e: 'release', ...c }])
    expect(fx[2]).toEqual({ switches: [], loads: [], saves: [], sceneLoopStart: false })
    expect(w.sceneLoopStarted).toBe(false)
  })

  it('那条多余的场景循环只起一次：第二次读档 sceneLoopStart 为假（t.isAlive() 已为真）', () => {
    const store = countingStore([SAMPLE, null, null])
    const c = center(0)
    const { fx } = drive(store, [
      { e: 'enter', mode: 'load', from: 'menu' },
      { e: 'press', ...c },
      { e: 'release', ...c },
      { e: 'enter', mode: 'load', from: 'menu' },
      { e: 'press', ...c },
      { e: 'release', ...c },
    ])
    expect(fx[2]!.sceneLoopStart).toBe(true)
    expect(fx[5]!.sceneLoopStart).toBe(false)
    expect(fx[5]!.switches).toEqual(['scene'])
  })

  it('移进按钮框光效开、移出去停；按下也停', () => {
    const store = countingStore([null, null, null])
    const c = center(2)
    const w = createSaveLoadWorld(store)
    const ports = { store, capture: () => SAMPLE }
    applySaveLoadInput(w, { e: 'move', ...c }, ports)
    expect(w.buttons.map((b) => b.glowing)).toEqual([false, false, true])
    applySaveLoadInput(w, { e: 'press', ...c }, ports)
    expect(w.buttons[2]!.glowing).toBe(false)
    applySaveLoadInput(w, { e: 'move', ...c }, ports)
    applySaveLoadInput(w, { e: 'move', ...OUTSIDE }, ports)
    expect(w.buttons[2]!.glowing).toBe(false)
  })

  it('从没进过面板就按退出键是抛（原版 switchTo(null) 走不到）', () => {
    const store = countingStore([null, null, null])
    const w = createSaveLoadWorld(store)
    expect(() => applySaveLoadInput(w, { e: 'key', key: 'escape' }, { store, capture: () => SAMPLE })).toThrow(/lastPanel 是 null/)
  })

  it('三颗按钮的位置与尺寸与原版 new StartButton(800, 150 + i * 200, 80, 80, …) 一致', () => {
    const src = javaSource('src/start/LoadAndSavePanel.java').replace(/\s+/g, '')
    const m = /newStartButton\((\d+),(\d+)\+i\*(\d+),(\d+),(\d+),/.exec(src)
    expect(m?.slice(1).map(Number)).toEqual([SLOT_BUTTON_X, SLOT_BUTTON_Y0, SLOT_STRIDE, SLOT_BUTTON_SIZE, SLOT_BUTTON_SIZE])
  })
})
