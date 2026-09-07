import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import DEFERRED_BGM_IDS from '../generated/deferredBgm.json'
import MISSING_IDS from '../generated/missingAssets.json'
import { BG_COUNT } from '../state/narratage'
import { bgmAssetId, mapAssetId, narratageBgAssetId, npcAssetId, roleAssetId } from './ids'
import { knownAssetIds, resolveAsset, resolveAssetOrNull, resolveBgmOrNull } from './resolve'
import { scanSceneAssets } from './sceneAssets'
import { DEFERRED_TOP_DIRS, IMAGE_ROOT, isDeferredBattleAsset } from './battleAssets'
import { listFiles } from './listFiles'
import { repoPath } from '../test/repoPath'

/** 仓库里有几张 `heads/heads (n).png`。头像那一类的分母，从素材源头数。 */
function headFilesInRepo(): number {
  return readdirSync(repoPath('heads')).filter((f) => /^heads \(\d+\)\.png$/.test(f)).length
}

/**
 * `image/` 下**不走按需加载**的文件有几个。战斗常用素材那一类的分母，
 * 从素材源头数：目录里有什么就该烘什么，切出去的正是 `DEFERRED_TOP_DIRS`。
 */
function bundledBattleFilesInRepo(): number {
  return listFiles(repoPath(IMAGE_ROOT)).filter((f) => !isDeferredBattleAsset(f)).length
}

/**
 * 药品介绍图那一类的分母（xl-rh9.12），同样从素材源头数：
 * `sources/Shop/药品/回复类/` 下有几张，映射表里就该有几条。
 */
function drugPictureFilesInRepo(): number {
  return readdirSync(repoPath('sources/Shop/药品/回复类')).length
}

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
    // 头像的分母从素材源头数：`heads/heads (n).png` 有几个就该烘几个
    // （原版 `Dialogue` 的构造函数读的是 1..91）。写死 91 的话，哪天素材
    // 少了一张，这里会跟着烘焙器一起沉默。
    expect(ids.filter((id) => id.startsWith('head:'))).toHaveLength(headFilesInRepo())
    // 下标必须是连着的 0..n-1：`headAssetId` 收的是 ArrayList 的下标，
    // 中间缺一个就会在某句对话上查不到图。
    expect(ids.filter((id) => id.startsWith('head:')).map((id) => Number(id.slice(5))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: headFilesInRepo() }, (_, i) => i),
    )
    expect(ids.filter((id) => id.startsWith('dialogue:')).sort()).toEqual([
      'dialogue:box',
      'dialogue:icon0',
      'dialogue:icon1',
      'dialogue:name',
    ])
    // 旁白背景的分母来自 `state/narratage.ts` 的 BG_COUNT，也就是原版
    // `Narratage` 构造函数里那个 2..53 的循环，不在这里另抄一个数字。
    expect(ids.filter((id) => id.startsWith('narratage:bg:'))).toHaveLength(BG_COUNT)
    // 战斗常用素材（xl-rh9.2）。分母从 `image/` 现扫，减去按需加载的那两个
    // 目录 —— 那 1770 帧不在这张表里，走 `resolveDeferredBattleAsset`。
    // 边界与两边的双向判据见 `battleAssets.test.ts`。
    expect(ids.filter((id) => id.startsWith('battle:'))).toHaveLength(bundledBattleFilesInRepo())
    // 药品菜单的介绍图（xl-rh9.12）。它不在 `image/` 下，所以不归上面那个
    // 分母 —— 见 `assets/ids.ts` 的 `drugPictureAssetId`。
    expect(ids.filter((id) => id.startsWith('drug:'))).toHaveLength(drugPictureFilesInRepo())
    const known = [
      'map:',
      'role:walk:',
      'role:run:',
      'npc:',
      'head:',
      'dialogue:',
      'narratage:bg:',
      // 背景音乐（xl-9bd.12）。烘的只有 M1 用到的那几首，其余的落在
      // `deferredBgm.json` 上，不在映射表里 —— 见 `assets/resolve.ts`。
      'bgm:',
      // 战斗常用素材（xl-rh9.2）。
      'battle:',
      // 药品菜单的介绍图（xl-rh9.12），在 `sources/Shop/` 下不在 `image/` 下。
      'drug:',
    ]
    expect(ids.filter((id) => !known.some((prefix) => id.startsWith(prefix)))).toEqual([])
  })

  /**
   * 背景音乐的范围（xl-9bd.12）：**两头都会红**。
   *
   * 96 个场景引用到的每一首曲子，要么在映射表里（已转码），要么在
   * `deferredBgm.json` 上（这一票故意还没转码）—— 不能两头都不在（那是烘焙
   * 漏了），也不能两头都在（那是名单过期了，转好了却还当没转）。
   *
   * 分母是场景数据自己：`sceneMusic` 有多少个不同的值就是多少。
   */
  it('每个场景引用的背景音乐，要么已转码要么在"故意没转"的名单上，不会两头都在', () => {
    const declared = new Set(
      SCENE_NAMES.map((name) => getScene(name).sceneMusic).filter((m): m is string => m !== null),
    )
    expect(declared.size).toBeGreaterThan(0)
    const baked = new Set(knownAssetIds().filter((id) => id.startsWith('bgm:')))
    const deferred = new Set(DEFERRED_BGM_IDS as string[])
    // 两边不重叠，合起来正好盖住数据里出现过的每一首。
    expect([...baked].filter((id) => deferred.has(id))).toEqual([])
    expect([...declared].map(bgmAssetId).filter((id) => !baked.has(id) && !deferred.has(id))).toEqual(
      [],
    )
    expect(baked.size + deferred.size).toBe(declared.size)
    // 名单上的查出来是 null，映射表里的查出来是 URL，都不抛。
    for (const id of deferred) expect(resolveBgmOrNull(id)).toBeNull()
    for (const id of baked) expect(resolveBgmOrNull(id)).toContain('bgm/')
  })

  it('战斗常用素材查得出 URL，走的是主包那条 ?url glob', () => {
    // 上面那条只数了映射表的条数——映射表有一条而产物不在，`resolveAsset` 的
    // 第二层守卫才会响，而那一层没人走过就等于没验。
    const [id] = knownAssetIds().filter((k) => k.startsWith('battle:'))
    expect(id).toBeDefined()
    expect(decodeURIComponent(resolveAsset(id as string))).toContain('battle/')
    // 按需那两个目录一张都不该在这张表里。
    expect(
      knownAssetIds().filter((k) => DEFERRED_TOP_DIRS.some((d) => k.startsWith(`battle:${d}/`))),
    ).toEqual([])
  })

  it('旁白背景的每一帧都在映射表里', () => {
    // 少一帧的表现是"旁白播到一半黑一下"——渲染层为此宁可抛（见 sceneRenderer）。
    for (let frame = 0; frame < BG_COUNT; frame++) {
      expect(decodeURIComponent(resolveAsset(narratageBgAssetId(frame)))).toContain(
        `narratage/${frame}.webp`,
      )
    }
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
