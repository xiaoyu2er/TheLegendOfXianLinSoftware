import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { START_IMAGES, START_SEQUENCES, TITLE_BGM } from '../start/assets'
import DEFERRED_BGM_IDS from '../generated/deferredBgm.json'
import MISSING_IDS from '../generated/missingAssets.json'
import { BG_COUNT } from '../state/narratage'
import {
  bgmAssetId,
  equipPictureAssetId,
  mapAssetId,
  narratageBgAssetId,
  npcAssetId,
  roleAssetId,
} from './ids'
import { knownAssetIds, resolveAsset, resolveAssetOrNull, resolveBgmOrNull } from './resolve'
import { scanSceneAssets } from './sceneAssets'
import { DEFERRED_TOP_DIRS, IMAGE_ROOT, isDeferredBattleAsset } from './battleAssets'
import { MENU_ROOT, isDeferredMenuAsset } from './menuAssets'
import { listFiles } from './listFiles'
import {
  EQUIP_PICTURE_ROOT,
  isBakedEquipPicture,
  isIgnoredEquipPicture,
} from '../menu/equipmentPictures'
import { repoPath } from '../test/repoPath'
import { SCENE_TRACE_NAMES, readTrace } from '../state/trace'

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

/**
 * 菜单骨架素材的分母（xl-6lo.4），与战斗那条同形：`sources/菜单/` 下现扫，
 * 减去按需加载的那几个目录 —— 那 146 张不在这张表里，走
 * `resolveDeferredMenuAsset`。边界与两边的双向判据见 `menuAssets.test.ts`。
 */
function bundledMenuFilesInRepo(): number {
  return listFiles(repoPath(MENU_ROOT)).filter((f) => !isDeferredMenuAsset(f)).length
}

/**
 * 装备图的分母（xl-234）：`sources/Shop/装备/` 下现扫，**减去登记为不烘的
 * 那些扩展名**。写死 59 的话，素材少一张这里会跟着烘焙器一起沉默；而把
 * `EQUIP_PICTURE_EXTENSIONS` 当过滤器（"只数烘得动的"）等于让被守的东西自己
 * 签字 —— 所以两份登记都参与：认得出的一律计数，认不出的**让它红**。
 */
function equipPictureFilesInRepo(): number {
  const all = listFiles(repoPath(EQUIP_PICTURE_ROOT))
  expect(
    all.filter((f) => !isBakedEquipPicture(f) && !isIgnoredEquipPicture(f)),
    '装备图目录下有没登记过的扩展名',
  ).toEqual([])
  return all.filter(isBakedEquipPicture).length
}

describe('资产逻辑 ID', () => {
  /**
   * 装备图的 ID 必须带上「类」那一段（xl-234）。
   *
   * ⚠️ **这一条是直接断言，不是分母**，而这一点是量出来的：今天六个类目录下
   * 那 59 个 `.png` 文件名两两互异，所以把类去掉，映射表的条数**一条都不会
   * 变**（篡改矩阵 R9 实测全绿）。也就是说上面那条普查看不见它 ——
   * 一个"这一场观测不到"的现成例子，判据只能自己造两件同名的来问。
   */
  it('同名不同类算出来的 ID 不一样 —— 类必须在 ID 里', () => {
    expect(equipPictureAssetId('武器', '同名.png')).not.toBe(
      equipPictureAssetId('饰品', '同名.png'),
    )
    // 形状也钉住：它是原版那条 `sources/Shop/装备/<s>/<第 6 列>` 的函数。
    expect(equipPictureAssetId('武器', '月苗刀.png')).toBe('equip:武器/月苗刀.png')
    // 反斜杠照规范化，与 `npcAssetId` / `battleAssetId` 同一个规矩。
    expect(equipPictureAssetId('武器', '月苗刀.png')).toBe(
      equipPictureAssetId('武器', '月苗刀.png'.replace('/', '\\')),
    )
    // 正向控制：今天磁盘上确实一对重名都没有 —— 所以上面那条只能这么问。
    const png = listFiles(repoPath(EQUIP_PICTURE_ROOT)).filter(isBakedEquipPicture)
    const names = png.map((f) => f.slice(f.lastIndexOf('/') + 1))
    expect(new Set(names).size, '磁盘上出现重名了 —— 那烘焙器那道 ID 撞车的守卫该响了').toBe(
      names.length,
    )
  })

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
    // `dialogue/` 那几张固定图。**这是一份登记，不是分母**：目录里还躺着
    // `提示框.png`（xl-yg6.10）没人烘，改成"现扫目录"就等于让还没做的那张
    // 自动算作做完了。
    expect(ids.filter((id) => id.startsWith('dialogue:')).sort()).toEqual([
      'dialogue:box',
      'dialogue:icon0',
      'dialogue:icon1',
      'dialogue:name',
      // 问题框，xl-yg6.9。
      'dialogue:question',
      // 选择框那两张，xl-yg6.8。
      'dialogue:select',
      'dialogue:selectIcon',
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
    // 菜单骨架素材（xl-6lo.4）。它在 `sources/菜单/` 下，不归上面任何一个分母。
    expect(ids.filter((id) => id.startsWith('menu:'))).toHaveLength(bundledMenuFilesInRepo())
    // 装备页那两张图的素材（xl-234）。跟药品介绍图一样在 `sources/Shop/` 下，
    // 不归上面任何一个分母；`.bmp` 那 30 个登记为不烘，见 `equipmentPictures.ts`。
    expect(ids.filter((id) => id.startsWith('equip:'))).toHaveLength(equipPictureFilesInRepo())
    // 开始界面（xl-kaa 起，xl-4si 加了六段逐帧动画）。分母是那两份表算出来
    // 的，不是手写的数：`START_IMAGES` 的类型是 `Record<StartImageName, string>`、
    // `START_SEQUENCES` 的是 `Record<StartSequenceName, …>`，少一条 typecheck
    // 就红；而帧数本身由 `start/layout.test.ts` 对着 GBK 源码守着。
    const startFrames = Object.values(START_SEQUENCES).reduce((sum, s) => sum + s.count, 0)
    expect(ids.filter((id) => id.startsWith('start:'))).toHaveLength(
      Object.keys(START_IMAGES).length + startFrames,
    )
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
      // 开始界面（xl-kaa），在 `sources/StartPanel/` 下。
      'start:',
      // 菜单骨架素材（xl-6lo.4），在 `sources/菜单/` 下。各页自己的那 146 张
      // 不在这张表里，走 `resolveDeferredMenuAsset`。
      'menu:',
      // 装备页那两张图的素材（xl-234），在 `sources/Shop/装备/<类>/` 下。
      'equip:',
      // 商店素材（xl-knp.5），`sources/Shop/` 下除 `装备/`、`药品/回复类/`
      // 与那几张数据表之外的那批。**没有代码引用的 13 张不在这张表里**，
      // 它们照烘但不进主包 —— 见 `shop/shopAssets.ts`。
      'shop:',
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
    // **标题曲是场景数据之外的一首**：它写在 `GameLauncher.switchTo("start")`
    // 那句 `MusicReader.readBGM("主题曲.mp3")` 上（见 `start/assets.ts` 的
    // `TITLE_BGM`），96 个场景的 `Music` 段里一个字都没提。所以点名把它扣掉
    // 再对账 —— 直接把等号放宽成 `>=` 的话，"多烘了一首"与"多的正是标题曲"
    // 就分不开了。
    const title = bgmAssetId(TITLE_BGM)
    expect({ baked: baked.has(title), deferred: deferred.has(title) }).toEqual({
      baked: true,
      deferred: false,
    })
    // **场景数据之外还有第二类**（xl-yg6.7）：真值里真的响过、而 96 个场景的
    // `Music` 段一个都没写的那几首。今天只有一首 —— `battle-door` 选「是」的
    // 一下，原版跑进 `BattlePanel.initial`，那里按背景图挑了 `B6.mp3`。
    //
    // 这一类**不点名**，从真值现扫（烘焙器 `bake.ts` 的 `tracedBgm()` 数的是
    // 同一批字符串）：点名写死的话，下一条走进战斗的剧本会让这条判据红，
    // 而它红的理由与"烘多了一首"分不开。两头仍然有咬合 —— 烘出来的一首要是
    // 既不来自场景、也不来自真值、又不是标题曲，下面那个减法立刻对不上。
    const fromTraces = new Set<string>()
    for (const name of SCENE_TRACE_NAMES) {
      for (const tick of readTrace(name).ticks) {
        if (tick.audio.bgm !== null) fromTraces.add(bgmAssetId(tick.audio.bgm))
      }
    }
    const fromScenes = new Set([...declared].map(bgmAssetId))
    const outside = [...baked].filter((id) => id !== title && !fromScenes.has(id)).sort()
    expect(outside).toEqual(outside.filter((id) => fromTraces.has(id)))
    // 空转要响：这一类今天非空，而它一旦空了，上面那条 `toEqual` 是恒真的。
    expect(outside.length).toBeGreaterThan(0)
    expect(
      [...baked].filter((id) => id !== title && !outside.includes(id)).length + deferred.size,
    ).toBe(declared.size)
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
