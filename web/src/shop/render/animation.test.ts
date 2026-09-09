import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { COL_PARTY } from '../../state/fight'
import {
  ANIMATION_FRAMES,
  ANIMATION_INTERVAL_MS,
  KEEPER_ANIMATION_X,
  KEEPER_ANIMATION_Y,
  PARTY_ANIMATION_X,
  PARTY_ANIMATION_Y,
} from '../layout'
import type { ShopKind } from '../layout'
import { createShopWorld } from '../world'
import { KEEPER_ROLE, PARTY_ROLES, animationFrameId } from './assets'
import { shopDrawList } from './drawList'

/**
 * **店里站着的那几个角色（xl-knp.9）—— 期望值全部从 GBK 源码现读。**
 *
 * 「两个面板各站几个、站的是谁、站在哪、每个几帧、多久换一格、谁的门上有条件」
 * 这六件事，实现里是 `layout.ts` 的六个常量、`render/assets.ts` 的两张名单、
 * `render/drawList.ts` 里那个 `if (!w.party[key]) return`。
 *
 * ## ⚠️ 这里有一半是**复核**，不是新盖的地
 *
 * 写完之后拿篡改矩阵量了一遍（读数在文件末尾），**坐标、帧数、`mouses` 长度、
 * `Clock.sleep(120)` 这四样 `layout.test.ts` 已经在守了**，角色名与图片路径
 * `render/assets.test.ts` 已经在守了。照实说：这几条在这里是第二双眼睛，
 * 不是这一票买到的分辨力。**旧判据全绿、只有这个文件红**的篡改只有两条：
 *
 * - **每条动画的门是哪个标志位**（把 `PARTY_ROLES` 里 `lu` / `wen` 两个 key
 *   对调、角色名不动）—— 旧判据一条都不响，因为三个人还是三个人、八帧还是八帧；
 * - **第四条是按当前这家店取的**（把 `drawList` 里 `KEEPER_ROLE[w.active]`
 *   写死成 `KEEPER_ROLE.drug`）—— 同上。
 *
 * 第三样 —— **那三个标志位是队伍名单而不是出战名单** —— 旧那边也红，但抓到它的
 * 是 `preview.test.ts` 里碰巧写死的一个 `{zhang,lu,wen}` 字面量，跟着改一改
 * 就绿了。这里那一条是真的在比两份名单，见下面那条用例与末尾矩阵的最后一行。
 *
 * 另外两处是把写死的分母改成现推的：`layout.test.ts` 那条写着
 * `expect(ani).toHaveLength(4)`，这里的 4 从源码解出来的条数来；八帧那个数
 * 在这里要求**三份独立读数同时对上**（`ani.add` 的实参、`for` 的上界、
 * `new Image[8]`）。
 *
 * ## 为什么非要源码这一头，而不是等逐帧比对
 *
 * 真值**一个字都不记这一层**（状态列里那个 `icon` 是"光标所在那一行的图标"），
 * 所以状态层断言在这里是够不着的。而逐帧比对（xl-knp.10）也只够得着一半 ——
 * 导出时 `Clock.setFactor(1e-9)` 把 `Clock.sleep(120)` 拉成约 3800 年，那条
 * 动画线程**永远停在第 0 格**。实测见下面「逐帧读数」。
 *
 * ## 逐帧读数（2026-09-09 实测，原版侧）
 *
 * ⚠️ **下面这几个数是一次性读数，不是判据** —— 没有任何东西会在它们过期时变红。
 * 贴在这里是为了让 xl-knp.10 接线时手里有已知量而不是未知量；要复核就照下面
 * 这条命令重跑一遍，别把它们当成"已经有人守着了"。
 *
 * ```
 * tools/build.sh
 * java … devtools.ExportTrace tools/traces/scripts/<剧本>.json <out>/trace.json \
 *      --frames <out> --every 5          # 三条商店剧本各一遍
 * ```
 *
 * 把每一帧那张真的 1024×640 位图与底图 `sources/Shop/shopback.png` 逐像素比，
 * 只看四条动画各自那个 72×144 的框（第四条落在 (364,515)，`515+144=659>640`，
 * 底部被裁，只露 125 行 = 9000 个像素）：
 *
 * | 框 | 读数 |
 * |---|---|
 * | 张小凡 (0,0) | 与底图不同 **5579 / 10368** 个像素 —— 真的画着 |
 * | 陆雪琪 (0,160) | **0 / 10368**，三条剧本的**每一帧**都是 0 —— 没画 |
 * | 文敏 (0,320) | **0 / 10368**，同上 |
 * | 第四位 (364,515) | 药店 **3595 / 9000**（shop-trade / shop-edges 第 0 帧）、装备店 **2474 / 9000**（shop-categories 第 0 帧） |
 *
 * 三条剧本的 `setup.party` 都是 `["zhang"]` —— 也就是说**那两个 0 不是"这一层
 * 没做"，是原版在这一局里真的没画他们**。
 *
 * 同一条剧本里那四个框在整条时间线上只变过两次，**两次都不是动画**：
 *
 * - 张小凡那个框在第 5 拍起相对第 0 拍差 **366** 个像素 —— 光标开局停在
 *   `(0,0)`（真值 `cursor` 那一列的第 0 行），第一次 `move` 之后鼠标图挪走了，
 *   366 正是鼠标图的不透明像素数；
 * - 第四位那个框在 shop-trade 第 25 拍起差 **3923** 个像素 —— 那一拍切到了
 *   装备店，**店主换成了小妹**。
 *
 * 也就是说：逐帧比对能守住「谁站在哪、画的是哪一张」，**守不住这八格怎么循环**
 * （它永远只看得见第 1 张）。所以循环那一半在这里对回源码，剩下那一半在
 * xl-knp.10 接线之后由像素兜底。
 *
 * ⚠️ 顺带一条留给 xl-knp.10 的读数：**三条商店剧本的 `setup.party` 都是
 * `["zhang"]`**，所以陆雪琪与文敏那两条动画在逐帧比对里一帧都走不到。要盖住
 * 它们得另补一条 party 更满的商店真值，那是补真值那一层的活，不是这一票的。
 *
 * ## 篡改矩阵（2026-09-09 实测，每一条都真改真跑真还原）
 *
 * 「新」= 只跑这个文件；「旧」= 跑 `src/shop` 但排除这个文件。**两列都要看** ——
 * 只跑新的话，证不出这一票买到了什么。
 *
 * | 篡改 | 新 | 旧 | 旧那边是谁抓到的 |
 * |---|---|---|---|
 * | 基线（不改） | 绿 | 绿 | —— |
 * | `PARTY_ANIMATION_Y` 160→161 | **红** | 红 | `layout.test.ts` 四条人物动画的位置 |
 * | `KEEPER_ANIMATION_X` 364→365 | **红** | 红 | 同上 |
 * | `ANIMATION_FRAMES` 8→6 | **红** | 红 | 同上 |
 * | `ANIMATION_INTERVAL_MS` 120→100 | **红** | 红 | `layout.test.ts` 动画线程每格睡 120ms |
 * | `KEEPER_ROLE.equipment` 小妹→店主 | **红** | 红 | `assets.test.ts` 人物动画的路径 |
 * | `drawList` 里去掉 `if (!w.party[key]) return` | **红** | 红 | `drawList.test.ts` 队伍名单决定画几个人 |
 * | **`PARTY_ROLES` 的 `lu`/`wen` 两个 key 对调**（角色名不动） | **红** | **绿** | 没人 |
 * | **`drawList` 的 `KEEPER_ROLE[w.active]` 写死成 `.drug`** | **红** | **绿** | 没人 |
 * | `drawList` 的门焊死成 `if (true) return`（谁都不画） | **红** | 未跑 | —— |
 * | `shop/preview.ts` 里 import 一根 `state/fight` 进来 | **红** | 未跑 | —— |
 * | 一致地换成出战名单那套键（assets + types + world 三处同改） | **红** | 红 | `preview.test.ts` 里那句写死的 `{zhang,lu,wen}` |
 *
 * 最后那一行值得说一句：旧那边确实红了，但抓到它的是预览那一局**碰巧写死的
 * 一个字面量**，不是任何一条"这两份名单不是同一份"的判据 —— 把那个字面量跟着
 * 改一改它就绿了。这里那一条不是。
 */

const PANEL_SOURCE: Readonly<Record<ShopKind, string>> = {
  drug: javaSource('src/shop/ShopPanel.java'),
  equipment: javaSource('src/shop/EquipmentShopPanel.java'),
}

/** `ani.add(new ShopAnimation("<角色>", <x>, <y>, <帧数>, this));` 解出来的一条。 */
interface ParsedAnimation {
  readonly role: string
  readonly x: number
  readonly y: number
  readonly frames: number
}

function parseAnimations(source: string): ParsedAnimation[] {
  return [
    ...source.matchAll(
      /ani\.add\(new ShopAnimation\("([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*this\)\)/g,
    ),
  ].map((m) => ({ role: m[1]!, x: Number(m[2]), y: Number(m[3]), frames: Number(m[4]) }))
}

/**
 * `drawIcon()` 里每一条 `ani.get(i)` 的绘制，各自落在哪个 `if(SaveAndLoad.X)`
 * 里面 —— 落在外面的记 `null`。
 *
 * ⚠️ **用花括号配对，不用"下一个 if 之前"这种切法。** 后者对最后那一条
 * （`ani.get(3)`，在所有 if 之后）会算成"属于最后一个 if"，而那正是这一票要
 * 分辨的那一格：它**不看队伍名单**。
 */
function parseGates(source: string): Map<number, string | null> {
  const start = source.indexOf('public void drawIcon(Graphics g)')
  if (start < 0) throw new Error('drawIcon 的界标没找着 —— 多半是 GBK 解码错了')
  // 到下一个方法为止。`paint` 紧跟在 `drawIcon` 后面（两个面板都是）。
  const end = source.indexOf('public void paint(Graphics g)', start)
  if (end < 0) throw new Error('drawIcon 后面那个 paint 的界标没找着')
  const body = source.slice(start, end)

  /** 每个 `if(SaveAndLoad.X){` 的 [标志位, 起, 止)，止是配对的那个 `}` 之后。 */
  const blocks: { flag: string; from: number; to: number }[] = []
  for (const m of body.matchAll(/if\s*\(\s*SaveAndLoad\.(\w+)\s*\)\s*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') depth--
      i++
    }
    if (depth !== 0) throw new Error(`if(SaveAndLoad.${m[1]}) 的花括号没配上`)
    blocks.push({ flag: m[1]!, from: m.index, to: i })
  }

  const gates = new Map<number, string | null>()
  for (const m of body.matchAll(/\.drawImage\(ani\.get\((\d+)\)\.image\b/g)) {
    const at = m.index
    const owner = blocks.find((b) => at > b.from && at < b.to)
    gates.set(Number(m[1]), owner ? owner.flag : null)
  }
  return gates
}

/** 剧本 `Role` 那一行的三个位置各自置的是哪个标志位，**按 `ss[i]` 的下标排**。 */
function parseRoleLineFlags(): string[] {
  const reader = javaSource('src/tools/Reader.java')
  const from = reader.indexOf('case "Role":')
  const to = reader.indexOf('case "NPC":', from)
  if (from < 0 || to < 0) throw new Error('Reader 里 Role 那一段的界标没找着')
  const block = reader.slice(from, to)
  const hits = [
    ...block.matchAll(/Integer\.parseInt\(ss\[(\d+)\]\)\s*==\s*1\)\s*\r?\n\s*SaveAndLoad\.(\w+)\s*=\s*true/g),
  ].map((m) => ({ at: Number(m[1]), flag: m[2]! }))
  return hits.sort((a, b) => a.at - b.at).map((h) => h.flag)
}

/**
 * `FightEvent.fight(String[] battleInfo)` 开头那七行，按 `battleInfo[i]` 的下标排。
 *
 * ⚠️ 尾界标用的是紧跟那七行的 `ZhangXiaoFan zxf;`，**不是"往后数几百个字符"**：
 * 后者切多了会把别处的 `battleInfo[i]` 一起吞进来，而**吞多了不是零匹配** ——
 * `javaSource.ts` 那条"解出来的条数要 > 0"盖不住它，它长得和解对了一样。
 * （下面那条重复下标的保险今天**捅不响** —— `FightEvent.java` 里一共就这七处
 * `battleInfo[`，把窗口拉到十万个字符结果也不变。所以它是防御，不是判据。）
 */
function parseBattleInfoNames(): string[] {
  const source = javaSource('src/scene/FightEvent.java')
  const from = source.indexOf('public void fight(String[] battleInfo)')
  if (from < 0) throw new Error('FightEvent.fight 的界标没找着')
  const to = source.indexOf('ZhangXiaoFan zxf;', from)
  if (to < 0) throw new Error('FightEvent.fight 里那七行的尾界标没找着')
  const block = source.slice(from, to)
  const hits = [...block.matchAll(/String (\w+) = battleInfo\[(\d+)\];/g)].map((m) => ({
    at: Number(m[2]),
    name: m[1]!,
  }))
  if (new Set(hits.map((h) => h.at)).size !== hits.length) {
    throw new Error('battleInfo 的下标有重复 —— 尾界标切多了')
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name)
}

describe('店里那几个角色的循环动画：期望值从两个面板的 GBK 源码现读', () => {
  it('两段源码真的解出来了 —— 零匹配与"源码里没有这一行"长得一样', () => {
    for (const [kind, source] of Object.entries(PANEL_SOURCE)) {
      expect(source, kind).toContain('ShopAnimation')
      // GBK 解错时中文全是乱码，而乱码在下面每一条正则下都是零匹配。
      expect(source, `${kind} 的中文解码`).toContain('设置人物动画')
      expect(parseAnimations(source).length, `${kind} 一条 ani.add 都没解出来`).toBeGreaterThan(0)
      expect(parseGates(source).size, `${kind} 一条 ani.get(i) 的绘制都没解出来`).toBeGreaterThan(0)
    }
  })

  it('各站几个 / 站的是谁 / 站在哪：四条逐字对回 `new ShopAnimation(…)` 的五个实参', () => {
    // 分母是**源码里解出来的条数**，不是写死的 4。
    const drug = parseAnimations(PANEL_SOURCE.drug)
    const equipment = parseAnimations(PANEL_SOURCE.equipment)
    expect(equipment.length, '两个面板建的动画条数不一样').toBe(drug.length)

    // 队伍那几条 = 除去最后一条。⚠️ 这里不写"前三条"：条数从源码来。
    const partyCount = drug.length - 1
    expect(PARTY_ROLES.length, '队伍动画的条数与源码对不上').toBe(partyCount)
    expect(PARTY_ANIMATION_Y.length, 'PARTY_ANIMATION_Y 的长度与队伍动画条数对不上').toBe(
      partyCount,
    )

    for (const [kind, parsed] of [
      ['drug', drug],
      ['equipment', equipment],
    ] as const) {
      parsed.forEach((a, i) => {
        const last = i === parsed.length - 1
        expect(a.role, `${kind} 第 ${i} 条的角色名`).toBe(
          last ? KEEPER_ROLE[kind] : PARTY_ROLES[i]!.role,
        )
        expect(a.x, `${kind} 第 ${i} 条的 x`).toBe(last ? KEEPER_ANIMATION_X : PARTY_ANIMATION_X)
        expect(a.y, `${kind} 第 ${i} 条的 y`).toBe(last ? KEEPER_ANIMATION_Y : PARTY_ANIMATION_Y[i])
        expect(a.frames, `${kind} 第 ${i} 条的帧数`).toBe(ANIMATION_FRAMES)
      })
    }

    // ⚠️ 队伍那几条两个面板**逐字相同**，最后一条**不是同一个人**。
    expect(equipment.slice(0, partyCount)).toEqual(drug.slice(0, partyCount))
    expect(equipment[partyCount]!.role).not.toBe(drug[partyCount]!.role)
    // 位置倒是同一个 —— 换的是人不是位置。
    expect(equipment[partyCount]!.x).toBe(drug[partyCount]!.x)
    expect(equipment[partyCount]!.y).toBe(drug[partyCount]!.y)
  })

  it('八格一圈、每格 120ms，而且**同一个 i 同时推鼠标图与四条人物动画**', () => {
    for (const [kind, source] of Object.entries(PANEL_SOURCE)) {
      // 一条 for 里三件事：换鼠标图、把每条动画换到第 i 张、睡一格。
      // 三样连着解，是为了不让"另一处恰好也有个 8"顶上来。
      const loop = source.match(
        /for \(int i = 0; i < (\d+); i\+\+\) \{\s*mouse = mouses\[i\];\s*for\(ShopAnimation animation: ani\)\s*animation\.image=animation\.images\.get\(i\);\s*try \{\s*tools\.Clock\.sleep\((\d+)\);/,
      )
      expect(loop, `${kind} 的动画线程那一段没解析出来`).not.toBeNull()
      expect(Number(loop![1]), `${kind} 的循环上界`).toBe(ANIMATION_FRAMES)
      expect(Number(loop![2]), `${kind} 的每格毫秒数`).toBe(ANIMATION_INTERVAL_MS)

      // 鼠标图那个数组的长度是**同一个 8 的第三份读数**（第一份是 ani.add 的
      // 实参，第二份是上面那条 for）。三份对不上就说明 ANIMATION_FRAMES 只
      // 盖住了其中一处。
      const array = source.match(/final Image\[\] mouses = new Image\[(\d+)\];/)
      expect(array, `${kind} 的 mouses 数组声明没解析出来`).not.toBeNull()
      expect(Number(array![1]), `${kind} 的 mouses 长度`).toBe(ANIMATION_FRAMES)
    }

    // 图片是 1 起的：`for(int i=1;i<=length;i++)`，`length` 就是上面那个实参。
    const animation = javaSource('src/shop/ShopAnimation.java')
    expect(animation).toContain('for(int i=1;i<=length;i++)')
    expect(animationFrameId('店主', 0)).toBe('shop:商店人物/店主/店主 (1).png')
    expect(animationFrameId('店主', ANIMATION_FRAMES - 1)).toBe(
      `shop:商店人物/店主/店主 (${ANIMATION_FRAMES}).png`,
    )
  })

  it('门上那几个条件：队伍那几条各自挂一个 SaveAndLoad 标志位，最后一条**没有门**', () => {
    for (const [kind, source] of Object.entries(PANEL_SOURCE)) {
      const gates = parseGates(source)
      const parsed = parseAnimations(source)
      // 每一条动画都要在 drawIcon 里被画一次 —— 建了不画与画了不建都要露头。
      expect([...gates.keys()].sort((a, b) => a - b), `${kind} 画到的下标`).toEqual(
        parsed.map((_, i) => i),
      )
      PARTY_ROLES.forEach((role, i) => {
        expect(gates.get(i), `${kind} 第 ${i} 条动画的门`).toBe(role.key)
      })
      expect(gates.get(parsed.length - 1), `${kind} 最后一条动画不该有门`).toBeNull()
    }
  })

  it('⚠️ 门上那三个标志位是**队伍名单**（剧本 Role 那一行），不是出战名单', () => {
    // 这一条守的是票面那句「它们不随出战名单变」。两份名单**长得很像**：
    // 都是三个位置、第一位都叫 zhang —— 而它们是两件事。
    //
    //   队伍名单：剧本 `Role` 一行三个数 → SaveAndLoad.zhang/lu/wen（谁在队里）
    //   出战名单：`Fight` 一行的第 1/2/3 列 → zhang/yu/lu（这一场谁上场）
    //
    // 商店读的是前者。要是哪天有人把 `PARTY_ROLES` 的 key 换成后者那一套
    // （两处第二、三位不同），下面头一条当场红。
    //
    // ⚠️ **票面那句「改出战名单，画面不变」没有照字面写成一条用例**，是故意的：
    // 商店这一层**根本收不到出战名单**，所以"改了它画面不变"按构造成立 ——
    // 那正是 dispatch.md 纪律 3 点名的那种恒真判据，写出来一次也不会红。
    // 换成两条真会红的：(1) 对撞两份**名单本身**（商店的门必须逐字等于 Role
    // 那一行，而 Role 那一行必须不等于 Fight 那三列）；(2) 下面那条现扫 ——
    // 商店那两层的**生产代码**一个字都不许碰 `state/fight`。读数见文件头的矩阵。
    const roleLine = parseRoleLineFlags()
    expect(roleLine.length, 'Reader 的 Role 那一段一个标志位都没解出来').toBeGreaterThan(0)
    expect(PARTY_ROLES.map((r) => r.key), '商店的门与 Role 那一行对不上').toEqual(roleLine)

    const battleInfo = parseBattleInfoNames()
    expect(battleInfo.length, 'FightEvent.fight 一列都没解出来').toBeGreaterThan(0)
    // `state/fight.ts` 的那份列号也对回同一段源码 —— 免得这里拿一份自己编的
    // "出战名单"去比，比赢了什么也没证明。
    for (const [key, col] of Object.entries(COL_PARTY)) {
      expect(battleInfo[col], `battleInfo[${col}]`).toBe(key)
    }
    const roster = Object.entries(COL_PARTY)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key)
    // 两份名单确实不是同一份 —— 否则上面那条"对回 Role 行"就白守了。
    expect(roster).not.toEqual(roleLine)

    // 「不随出战名单变」的第二条：商店那两层的生产代码里不许出现出战名单。
    // **分母从磁盘现扫**（`shopTrace.test.ts` 那条"状态层不碰渲染"同一个套路）：
    // 写死一份文件名单的话，明天新加的 `shop/xxx.ts` 里接一根线进来它静默放过。
    // ⚠️ 排除 `*.test.ts` —— 这个文件自己就得 import `COL_PARTY` 才比得了两份名单。
    const dirs = ['web/src/shop', 'web/src/shop/render']
    let scanned = 0
    for (const dir of dirs) {
      const files = readdirSync(repoPath(dir), { withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        .map((e) => e.name)
      // 空转要响：目录名写错了与"这一层干净"长得一样。
      expect(files.length, `${dir} 一个生产文件都没扫到`).toBeGreaterThan(0)
      for (const file of files) {
        const text = readFileSync(repoPath(dir, file), 'utf8')
        const imports = [...text.matchAll(/^import[^']*'([^']+)'/gm)].map((m) => m[1]!)
        expect(
          imports.filter((x) => x.includes('state/fight')),
          `${dir}/${file} 里 import 了出战名单`,
        ).toEqual([])
        scanned++
      }
    }
    expect(scanned, '一个生产文件都没扫到').toBeGreaterThan(dirs.length)
  })

  it('队伍名单的每一种取值都对：分母是 2^(标志位个数)，一种不落', () => {
    const keys = PARTY_ROLES.map((r) => r.key)
    // 分母从解析出来的标志位个数推，不写死 8。
    const total = 2 ** keys.length
    // 空转要响：`PARTY_ROLES` 空了的话 total 是 1，下面那圈只走"谁都不在"
    // 一种，而每一条 `toBe(0)` 都会绿。
    expect(total).toBeGreaterThan(1)
    /** 绘制清单里**真的数出来**的队伍动画条数。 */
    let drawn = 0
    /** 按枚举出来的组合**应该**有几条。与上面那个是两个独立的量。 */
    let wanted = 0
    for (let mask = 0; mask < total; mask++) {
      const party = keys.filter((_, i) => (mask >> i) & 1)
      const world = createShopWorld({ party, coins: 10000, seed: 1 })
      for (const active of ['drug', 'equipment'] as const) {
        world.active = active
        const ops = shopDrawList(world, 0)
        const ids = ops.filter((o) => o.kind === 'image').map((o) => o.id)
        PARTY_ROLES.forEach(({ key, role }) => {
          const id = animationFrameId(role, 0)
          expect(
            ids.filter((x) => x === id).length,
            `${active} 店 party=[${party.join(',')}] 里的 ${role}`,
          ).toBe(party.includes(key) ? 1 : 0)
        })
        // 店主 / 小妹那一条**每一种取值下都在**，队伍空着也在。
        expect(
          ids.filter((x) => x === animationFrameId(KEEPER_ROLE[active], 0)).length,
          `${active} 店 party=[${party.join(',')}] 的第四条`,
        ).toBe(1)
        drawn += ids.filter((x) =>
          PARTY_ROLES.some(({ role }) => x === animationFrameId(role, 0)),
        ).length
        wanted += party.length
      }
    }
    // ⚠️ 这一条**不是**「循环走了几圈」—— 那种计数按构造成立，一次都不会红
    // （dispatch.md「断言本身按构造成立」那一族）。左边是绘制清单里真数出来的
    // 条数，右边是枚举出来的组合该有的条数：把那道门焊死左边就变 0（实测）。
    // `wanted` 是在**面板那一层**累加的，两家店各加了一遍，所以右边不再乘 2。
    expect(wanted, '一条队伍动画都没枚举到').toBeGreaterThan(0)
    expect(drawn, '两家店合计画出来的队伍动画条数').toBe(wanted)
  })
})
