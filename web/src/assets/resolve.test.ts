import { describe, expect, it } from 'vitest'
import { SCENE_NAMES, getScene } from '../data/scenes'
import { bgmAssetId, mapAssetId } from './ids'
import { knownAssetIds, resolveAsset } from './resolve'

describe('资产逻辑 ID', () => {
  it('从地图文件名推出 ID，扩展名与目录都不参与', () => {
    expect(mapAssetId('宿舍.png')).toBe('map:宿舍')
    expect(mapAssetId('大地图.jpg')).toBe('map:大地图')
    // 换格式（png → webp）不改 ID，这正是这层抽象存在的理由。
    expect(mapAssetId('宿舍.webp')).toBe('map:宿舍')
  })

  it('认 Windows 反斜杠路径', () => {
    // script/剧情1.txt 与 script/迷宫1.txt 里共 3 条这样的路径，是真实脏数据。
    expect(mapAssetId('image\\背景图\\伏魔山树林.png')).toBe('map:伏魔山树林')
    expect(bgmAssetId('sources\\music\\舒缓.mp3')).toBe('bgm:舒缓')
  })

  it('每个已烘焙场景的地图都能解析到一个产物 URL', () => {
    // 分母 = 已烘焙的场景数（96），不是"找到几条算几条"。
    expect(SCENE_NAMES.length).toBe(96)
    for (const name of SCENE_NAMES) {
      const scene = getScene(name)
      const url = resolveAsset(mapAssetId(scene.mapName))
      // URL 里的中文是百分号编码的，比对前先解回来。
      const stem = scene.mapName.replace(/\.[^.]+$/, '')
      expect(decodeURIComponent(url), `${name} 的地图`).toContain(`maps/${stem}.webp`)
    }
  })

  it('查一个映射表里没有的 ID 会抛错，并报出表里有什么', () => {
    // 静默返回 undefined 的话，缺图只会表现为"画面上少了点东西"——
    // 原版那 31 条缺失路径藏了十三年就是因为失败形态和成功一模一样。
    expect(() => resolveAsset('map:不存在的地图')).toThrowError(/映射表里没有资产/)
    // 96 个场景共用 28 张地图，映射表里就该正好是这 28 条。
    expect(knownAssetIds().length).toBe(28)
    expect(knownAssetIds()).toContain('map:宿舍')
    expect(knownAssetIds().every((id) => id.startsWith('map:'))).toBe(true)
  })
})
