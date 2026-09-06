import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import MISSING_IDS from '../generated/missingAssets.json'
import { bgmAssetId, mapAssetId, npcAssetId, roleAssetId } from './ids'
import { knownAssetIds, resolveAsset, resolveAssetOrNull } from './resolve'
import { scanSceneAssets } from './sceneAssets'

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
    // 分母不写死一个总数：地图 28 张、主角 32+16 帧是原版结构定死的，NPC 的
    // 帧数则跟着脚本数据走（xl-9bd.9），写一个当天数出来的总数，别人加一帧
    // 素材这里就会红成一片。改成**逐类点名 + 不许有名外之物**：
    // 少烘一类要响，多出一类不认识的 ID 也要响。
    const ids = knownAssetIds()
    expect(ids.filter((id) => id.startsWith('map:'))).toHaveLength(28)
    expect(ids).toContain('map:宿舍')
    expect(ids).toContain('map:大地图')
    expect(ids.filter((id) => id.startsWith('role:walk:'))).toHaveLength(32)
    expect(ids.filter((id) => id.startsWith('role:run:'))).toHaveLength(16)
    // NPC 的分母从数据源头算：96 个场景引用到的互异帧，减去仓库里确实没有的
    // 那些（`missingAssets.json`，每条都挂着 bd issue）。
    expect(ids.filter((id) => id.startsWith('npc:'))).toHaveLength(
      expectedNpcIds().size - MISSING_IDS.length,
    )
    const known = ['map:', 'role:walk:', 'role:run:', 'npc:']
    expect(ids.filter((id) => !known.some((prefix) => id.startsWith(prefix)))).toEqual([])
  })

  it('已知缺失的素材查出来是 null，别的查不到照旧抛', () => {
    // 两头都会红：名单上的静默放行（原版在那里也什么都没画），名单外的一律抛。
    // 只留"查不到就不画"的话，一次真正的烘焙遗漏会表现为"某个 NPC 不见了"。
    expect(MISSING_IDS.length).toBeGreaterThan(0)
    for (const id of MISSING_IDS) expect(resolveAssetOrNull(id)).toBeNull()
    expect(() => resolveAssetOrNull('npc:不存在的人.png')).toThrowError(/映射表里没有资产/)
    expect(resolveAssetOrNull(mapAssetId('宿舍.png'))).toBe(resolveAsset(mapAssetId('宿舍.png')))
  })
})

/** 96 个场景的数据引用到的互异 NPC 帧，按 `npcAssetId` 去重。 */
function expectedNpcIds(): Set<string> {
  const ids = new Set<string>()
  for (const name of SCENE_NAMES) {
    for (const ref of scanSceneAssets(getScene(name)).refs) {
      if (ref.kind === 'npc') ids.add(npcAssetId(ref.path.slice('NPCs/'.length)))
    }
  }
  return ids
}
