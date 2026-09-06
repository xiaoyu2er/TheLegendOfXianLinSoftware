import { describe, expect, it } from 'vitest'
import { SCENE_NAMES, getScene } from '../data/scenes'
import { bgmAssetId, mapAssetId, roleAssetId } from './ids'
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
    // 分母 = 已烘焙的场景数，不是"找到几条算几条"。
    for (const name of SCENE_NAMES) {
      const scene = getScene(name)
      const url = resolveAsset(mapAssetId(scene.mapName))
      // URL 里的中文是百分号编码的，比对前先解回来。
      const stem = scene.mapName.replace(/\.[^.]+$/, '')
      expect(decodeURIComponent(url), `${name} 的地图`).toContain(`maps/${stem}.webp`)
    }
  })

  it('主角的每一帧都在映射表里，走 32 帧、跑 16 帧', () => {
    // 下标就是原版绘制时用的下标（走 direction+count、跑 direction/2+count2），
    // 少一帧的表现是"主角走到某个朝向的某一帧就消失"，不逐帧查是查不出来的。
    for (let frame = 0; frame < 32; frame++) {
      expect(decodeURIComponent(resolveAsset(roleAssetId('walk', frame)))).toContain(
        `roles/walk/${frame}.webp`,
      )
    }
    for (let frame = 0; frame < 16; frame++) {
      expect(decodeURIComponent(resolveAsset(roleAssetId('run', frame)))).toContain(
        `roles/run/${frame}.webp`,
      )
    }
  })

  it('查一个映射表里没有的 ID 会抛错，并报出表里有什么', () => {
    // 静默返回 undefined 的话，缺图只会表现为"画面上少了点东西"——
    // 原版那 31 条缺失路径藏了十三年就是因为失败形态和成功一模一样。
    expect(() => resolveAsset('map:不存在的地图')).toThrowError(/映射表里没有资产/)
    // 分母写死：2 张地图 + 主角的 32 帧行走图 + 16 帧跑步图（xl-9bd.6）。
    // 烘焙器少烘了一批，这里要响，而不是等到画面上主角没了才发现。
    const ids = knownAssetIds()
    expect(ids.filter((id) => id.startsWith('map:'))).toEqual(['map:大地图', 'map:宿舍'])
    expect(ids.filter((id) => id.startsWith('role:walk:'))).toHaveLength(32)
    expect(ids.filter((id) => id.startsWith('role:run:'))).toHaveLength(16)
    expect(ids).toHaveLength(50)
  })
})
