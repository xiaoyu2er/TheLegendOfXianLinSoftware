import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { javaSource } from '../test/javaSource'
import type { SceneRecord } from '../save/format'
import { loadSceneInfo, worldAfterLoad } from './load'
import { TICK_MS, createWorld, initiate, step } from './step'
import type { World } from './types'

/**
 * 读档那一半场景回填（xl-i06.10）的单元判据。逐 tick 对齐真值的那一半在
 * `traceReplay.test.ts`（`load-slot*` 三份）；这里守的是真值盖不到、或者盖到了
 * 但要一眼看清因果的几条。
 */

const rec = (over: Partial<SceneRecord> = {}): SceneRecord => ({
  isScript: true,
  fileName: '脚本1.txt',
  dialogueEventOver: true,
  dialogueOrder: 1,
  x: 10,
  y: 14,
  currentScript: ['7/7', '宿舍.txt', '脚本1.txt'],
  nextScript: ['66/15', '大地图.txt', '脚本2.txt'],
  battle1Over: false,
  countOfBattle1: 0,
  ...over,
})
const PARTY = { zhang: true, lu: false, wen: false }

function run(world: World, ticks: number): World[] {
  const out: World[] = []
  for (let i = 0; i < ticks; i++) out.push((world = step(world, [], TICK_MS)))
  return out
}

describe('跳过旁白：loadSceneInfo 在 initiation 之后紧跟一句 narratageOver = true', () => {
  it('同一个脚本、同一个 isScript：普通进场景旁白会起来，读档进场景一拍都不起来', () => {
    const scene = getScene('脚本1')
    // 前提：这个脚本真的有旁白 —— 没有的话两边本来就都不起来，这条对照什么都没证明。
    expect(scene.narratage?.length ?? 0).toBeGreaterThan(0)
    const fresh = run(createWorld(scene, true), 200)
    expect(fresh.some((w) => w.narratage.active)).toBe(true)

    const loaded = loadSceneInfo(null, rec(), PARTY, scene)
    expect(loaded.narratage.over).toBe(true)
    expect(run(loaded, 200).some((w) => w.narratage.active)).toBe(false)
  })

  it('原版那一句排在 initiation 之后（排在前面会被 initiation 新建的 Narratage 盖掉）', () => {
    const body = javaSource('src/scene/SaveAndLoad.java').replace(/\r/g, '')
    const init = body.indexOf('scene.initiation(sceneInfo.get(1));')
    const skip = body.indexOf('scene.narratage.narratageOver = true;')
    expect(init).toBeGreaterThan(0)
    expect(skip).toBeGreaterThan(init)
    // 两句之间什么都没有 —— 旁白对象从被新建到被标成播完，中间没有一次机会被推。
    expect(body.slice(init, skip).replace(/\s+/g, '')).toBe('scene.initiation(sceneInfo.get(1));')
  })
})

describe('逐字段回填', () => {
  it('坐标是格子：role.setX(x) 是 x * 32', () => {
    const w = loadSceneInfo(null, rec({ x: 3, y: 5 }), PARTY, getScene('脚本1'))
    expect([w.role.px, w.role.py]).toEqual([96, 160])
  })

  it('isScript、对话结束旗标与编号、剧情三元组、两个战斗计数都取自存档', () => {
    const r = rec({
      isScript: false,
      dialogueEventOver: false,
      dialogueOrder: 7,
      currentScript: ['a', 'b', 'c'],
      nextScript: ['null', 'null', 'null'],
      battle1Over: true,
      countOfBattle1: 2,
    })
    const w = loadSceneInfo(null, r, PARTY, getScene('脚本1'))
    expect(w.isScript).toBe(false)
    expect([w.dialogue.eventOver, w.dialogue.groupOrder]).toEqual([false, 7])
    expect(w.currentScript).toEqual(['a', 'b', 'c'])
    // `split(" ")` 读回来的是三个字符串 "null"，不是 null —— 原版写档时 `new String[3]`
    // 拼出来的字面量，读回来就是字面量。
    expect(w.nextScript).toEqual(['null', 'null', 'null'])
    expect([w.fight.battle1Over, w.fight.countOfBattle1]).toEqual([true, 2])
  })

  it('队伍三个开关取自存档，压过场景脚本的 Role 段（Loader.load 末三行排在 loadSceneInfo 之后）', () => {
    const w = loadSceneInfo(null, rec(), { zhang: false, lu: true, wen: true }, getScene('脚本1'))
    expect(w.readerStatics).toMatchObject({ zhang: false, lu: true, wen: true })
  })

  it('没有 Dialogue 段的场景也换一份新的对话状态（else if (sal.isLoad) 那一支），不从上一个场景带', () => {
    const scene = getScene('脚本20')
    expect(scene.dialogueCode).toBeNull()
    // 普通进场景时，没有 Dialogue 段就原样带上一个场景的：先确认这条对照成立。
    const prev: World = { ...createWorld(getScene('脚本1')), dialogue: { ...createWorld(getScene('脚本1')).dialogue, sentenceOrder: 5, groupOver: true } }
    expect(initiate(prev, scene).dialogue.sentenceOrder).toBe(5)

    const w = loadSceneInfo(prev, rec({ fileName: '脚本20.txt', dialogueOrder: 0 }), PARTY, scene)
    expect(w.dialogue.sentenceOrder).toBe(0)
    expect(w.dialogue.groupOver).toBe(false)
  })

  it('答题记录（两张 static 表）从上一个场景原样带过来 —— 读档不回填也不清空', () => {
    const prev: World = { ...createWorld(getScene('脚本1')), recorder: [{ scene: '探针.txt', answered: [true] }] }
    const w = loadSceneInfo(prev, rec(), PARTY, getScene('脚本1'))
    expect(w.recorder[0]).toEqual({ scene: '探针.txt', answered: [true] })
  })

  it('交进来的场景与存档里的文件名对不上是抛，不是将错就错', () => {
    expect(() => loadSceneInfo(null, rec({ fileName: '脚本2.txt' }), PARTY, getScene('脚本1'))).toThrow(/脚本2\.txt/)
  })
})

describe('worldAfterLoad：读档那一下的第三句 switchTo("scene")', () => {
  it('SCENE_SIGNAL=1 —— 下一拍场景把自己的曲子放上', () => {
    const w = worldAfterLoad(null, rec(), PARTY, getScene('脚本1'))
    expect(w.sceneSignal).toBe(true)
    expect(loadSceneInfo(null, rec(), PARTY, getScene('脚本1')).sceneSignal).toBe(false)
  })
})
