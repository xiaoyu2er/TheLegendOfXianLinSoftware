import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bakeScript } from '../data/bakeScript'
import { repoPath } from '../test/repoPath'
import { normalizePath } from './path'
import { type SceneAssetRef, scanSceneAssets } from './sceneAssets'

const bake = (name: string) => bakeScript(readFileSync(repoPath(`script/${name}.txt`)), `${name}.txt`)
const ALL = readdirSync(repoPath('script'))
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''))
  .sort()

describe('反斜杠路径规范化', () => {
  it('对着仓库里那 3 条真实脏数据：规范化前找不到，规范化后就在那儿', () => {
    // 这 3 条是数据里仅有的 Windows 路径（剧情1 的 Fight 段 1 条、迷宫1 的 2 条），
    // 也是这段逻辑**唯一的**真实夹具。所以 CLAUDE.md 特意写了不要"修好"它们。
    const dirty = [...scanSceneAssets(bake('剧情1')).refs, ...scanSceneAssets(bake('迷宫1')).refs]
      .filter((r) => r.raw.includes('\\'))
    expect(dirty.map((r) => `${r.where} ${r.raw}`)).toEqual([
      '剧情1.txt battle1[0] image\\背景图\\伏魔山树林.png',
      '迷宫1.txt battle0[0] image\\背景图\\伏魔山树林.png',
      '迷宫1.txt battle0[1] image\\背景图\\黑色背景.png',
    ])
    expect(dirty.map((r) => r.path)).toEqual([
      'image/背景图/伏魔山树林.png',
      'image/背景图/伏魔山树林.png',
      'image/背景图/黑色背景.png',
    ])
    // 关键的一步：规范化之后这些文件是**真的存在**的。少了这条断言，
    // 上面就只是在比字符串，而"路径长得对"和"文件找得到"是两回事。
    for (const ref of dirty) expect(() => readFileSync(repoPath(ref.path))).not.toThrow()
    // 反过来：原样去找，一条都找不到 —— 这就是原版那 3 场战斗背景全白的原因。
    for (const ref of dirty) expect(() => readFileSync(repoPath(ref.raw))).toThrow()
  })

  it('只把反斜杠换成正斜杠，不做别的', () => {
    // 方向只能是这一个：Java 与浏览器在 Windows 上都吃正斜杠，反过来会把
    // 另外 22 条本来正常的路径在别的平台上弄坏。
    expect(normalizePath('image\\背景图\\x.png')).toBe('image/背景图/x.png')
    expect(normalizePath('maps/宿舍.png')).toBe('maps/宿舍.png')
  })

  it('全部 96 个脚本里带反斜杠的引用恰好就是那 3 条', () => {
    const dirty = ALL.flatMap((n) => scanSceneAssets(bake(n)).refs).filter((r) => r.path !== r.raw)
    expect(dirty.length).toBe(3)
  })
})

describe('NPC 图片路径', () => {
  // 三种构造函数三种拼法，都照 scene/NPC.java:40,54,71。
  const refsOf = (name: string, kind = 'npc') =>
    scanSceneAssets(bake(name)).refs.filter((r) => r.kind === kind)

  it('状态码 0（静止）：字段 3 是文件名，扩展名写在数据里', () => {
    expect(refsOf('脚本23').map((r) => r.path)).toEqual([
      'NPCs/罹年居士.png',
      'NPCs/陆雪琪.png',
    ])
  })

  it('状态码 2（原地运动）：目录下 1..帧数', () => {
    const cleaner = refsOf('仙一102').filter((r) => r.path.startsWith('NPCs/清洁工'))
    expect(cleaner.map((r) => r.path)).toEqual([
      'NPCs/清洁工/1.png',
      'NPCs/清洁工/2.png',
      'NPCs/清洁工/3.png',
      'NPCs/清洁工/4.png',
    ])
  })

  it('状态码 1（单向走动）：首帧号是方向码，不是 1', () => {
    // NPC.java:71 是 images.add(readImage(fileName + "//" + (i + direction) + ".png"))，
    // i 从 0 数到 imageSize-1。藏经阁一层夜 的图书馆管理员方向是 9，
    // 所以它要的是 9..16 —— 按 1..8 去查会"查得到"，那才是真的错。
    const librarian = refsOf('藏经阁一层夜').filter((r) => r.path.includes('图书馆管理员'))
    expect(librarian.map((r) => r.path)).toEqual(
      [9, 10, 11, 12, 13, 14, 15, 16].map((i) => `NPCs/图书馆管理员/${i}.png`),
    )
  })

  it('字段少一个的记录不去猜，报成数据不成形', () => {
    // 仙二205 那条把 NPC 名与口头禅之间的空格写成了全角逗号（xl-1dv.14）。
    // 原版在这里是 ArrayIndexOutOfBoundsException，猜一个路径出来只会
    // 变成一条查无此文件的假缺失。
    const { defects, refs } = scanSceneAssets(bake('仙二205'))
    expect(defects.map((d) => d.where)).toEqual(['仙二205.txt npcList[3]'])
    expect(refs.some((r) => r.where === '仙二205.txt npcList[3]')).toBe(false)
  })
})

describe('96 个脚本的引用总表', () => {
  it('条数与分类都是数得出来的', () => {
    const refs: SceneAssetRef[] = ALL.flatMap((n) => scanSceneAssets(bake(n)).refs)
    const count = (kind: string) => refs.filter((r) => r.kind === kind).length
    // 每个场景恰好一张地图；96 个场景全都有 Music 段（这本身就是一条断言）。
    expect(count('map')).toBe(96)
    expect(count('bgm')).toBe(96)
    expect(count('npc')).toBe(1129)
    expect(count('battleBackground')).toBe(29)
    expect(count('script')).toBe(252)
    expect(refs.length).toBe(1602)
    expect(new Set(refs.map((r) => r.path)).size).toBe(523)
  })

  it('全部 96 个脚本里数据不成形的地方只有 1 处', () => {
    const defects = ALL.flatMap((n) => scanSceneAssets(bake(n)).defects)
    expect(defects.map((d) => d.where)).toEqual(['仙二205.txt npcList[3]'])
  })
})
