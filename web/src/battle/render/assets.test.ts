import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../compare/png'
import { knownAssetIds, resolveAsset } from '../../assets/resolve'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { DRUGS } from '../drugs'
import { replayBattle } from '../replay'
import { SKILL_INTRO_DIR, SKILL_NUMBER } from '../skills'
import { snapshotBattle } from '../snapshot'
import { stepBattle } from '../step'
import { BATTLE_TRACE_NAMES, readBattleTrace } from '../trace'
import type { PartyKey } from '../units'
import { battleDrawList } from './drawList'
import { advancePaintState, applyPaintInput, createPaintState } from './paint'
import {
  DRUG_MENU_BACK_ID,
  REMINDER_COUNT,
  SKILL_MENU_BACK_ID,
  STATE_ICON_TYPES,
  battleTextureIds,
  drugButtonId,
  drugPictureId,
  reminderId,
  skillButtonId,
  skillIntroId,
  skillReturnId,
  stateIconId,
} from './assets'

/**
 * 菜单 / 提示图 / 状态图标那几批**路径拼接**的判据（xl-rh9.12）。
 *
 * 两种手法，各管一头：
 *
 * 1. **从 GBK 源码里现解**，对付"抄了一张表"这一类。状态图标那 12 条与提示图
 *    的 22 张都是抄来的，而抄错一条的表现是"挂了状态，图标却是另一个" ——
 *    画面上完全正常。`battle-menus` 只挂过 type 1 与 type 8，剩下十条一条判据
 *    都没有（xl-rh9.12 的篡改 M7 实测：对调 1 与 2 会红，对调 3 与 4 全绿）。
 * 2. **拿烘焙映射表对撞**，对付"拼错一个字"。每一条 ID 都要真的查得出产物 URL
 *    —— 查不到就抛，而不是"这张图没画出来"。
 */

describe('战斗状态图标那 12 条，从 BattleState.getImage() 现解', () => {
  /** `case N: stateImage=Reader.readImage("image/状态/<名>.png");` 逐条解出来。 */
  const cases = (() => {
    const src = javaSource('src/battle/BattleState.java')
    const start = src.indexOf('public void getImage(){')
    expect(start, 'BattleState.java 里找不到 getImage() —— 解析器空转').toBeGreaterThan(0)
    const end = src.indexOf('public void set(', start)
    expect(end, 'getImage() 之后找不到 set()').toBeGreaterThan(start)
    const body = src.slice(start, end)
    return [...body.matchAll(/case\s+(\d+):\s*\n?\s*stateImage=Reader\.readImage\("image\/状态\/([^"]+)\.png"\);/g)].map(
      (m) => ({ type: Number(m[1]), name: m[2]! }),
    )
  })()

  it('真的解出了 12 条 —— 解析器空转要响', () => {
    expect(cases.length).toBe(12)
    // 12 个 type 互不相同，12 个名字也互不相同；否则下面那条会把两条混成一条。
    expect(new Set(cases.map((c) => c.type)).size).toBe(12)
    expect(new Set(cases.map((c) => c.name)).size).toBe(12)
  })

  it('逐条对上，一条不多一条不少', () => {
    expect(STATE_ICON_TYPES).toEqual(cases.map((c) => c.type))
    for (const c of cases) {
      expect(stateIconId(c.type), `type ${c.type}`).toBe(`battle:状态/${c.name}.png`)
    }
  })

  it('switch 之外的 type 抛，不悄悄画上一张', () => {
    // 原版落到 default 时 `stateImage` 还是上一次那张（或 null），画出来是
    // "图标偶尔是别人的"。这里抛。
    expect(() => stateIconId(0)).toThrow(/没有图标/)
    expect(() => stateIconId(13)).toThrow(/没有图标/)
  })
})

describe('提示图的张数，从 Reminder.loadImage() 现解', () => {
  it('22 是那个 for 循环的上界，不是数出来的文件数', () => {
    const src = javaSource('src/battle/Reminder.java')
    const m = /for\(int i=1;i<=(\d+);i\+\+\)\{\s*\n?\s*Image image=Reader\.readImage\("image\/提示图\//.exec(src)
    expect(m, 'Reminder.loadImage() 里那个循环没解出来 —— 解析器空转').not.toBeNull()
    expect(REMINDER_COUNT).toBe(Number(m![1]))
  })

  it('号码是 1 基的文件号，越界就抛', () => {
    expect(reminderId(1)).toBe('battle:提示图/1.png')
    expect(reminderId(REMINDER_COUNT)).toBe(`battle:提示图/${REMINDER_COUNT}.png`)
    // `show(i)` 传的是下标，文件号要 +1 —— 传 0 说明有人把两者混了。
    expect(() => reminderId(0)).toThrow(/只有 1\.\./)
    expect(() => reminderId(REMINDER_COUNT + 1)).toThrow(/只有 1\.\./)
  })
})

describe('菜单那几批 ID 逐条查得出产物 —— 拼错一个字就红', () => {
  /**
   * **分母是各自的构造函数**：六种药 + 一颗返回、三档贴图、每个人各自的
   * `SKILL_NUMBER` 颗按钮与同样多张说明图，加两张背板、22 张提示图、12 个图标。
   * 数出来是可核的，而"少推一条"的表现在渲染器里是 `textureOf` 当场抛 ——
   * 那时候已经在浏览器里了，比这里晚得多。
   */
  const ids: string[] = [SKILL_MENU_BACK_ID, DRUG_MENU_BACK_ID]
  for (let f = 1; f <= REMINDER_COUNT; f++) ids.push(reminderId(f))
  for (const type of STATE_ICON_TYPES) ids.push(stateIconId(type))
  for (const variant of [1, 2, 3] as const) {
    ids.push(skillReturnId(variant))
    for (let i = 0; i <= DRUGS.length; i++) ids.push(drugButtonId(i, variant))
  }
  for (let i = 0; i < DRUGS.length; i++) ids.push(drugPictureId(i))
  for (const key of Object.keys(SKILL_INTRO_DIR) as PartyKey[]) {
    for (let i = 0; i < SKILL_NUMBER[key]; i++) {
      for (const variant of [1, 2, 3] as const) ids.push(skillButtonId(key, i, variant))
      ids.push(skillIntroId(`${SKILL_INTRO_DIR[key]}/${i + 1}`))
    }
  }

  it('条数数得出来，且互不重复', () => {
    // 分母全部从数据源头推：两张背板、`REMINDER_COUNT` 张提示图、
    // `STATE_ICON_TYPES` 个图标、三档返回、(六种药 + 返回)×三档、六张介绍图，
    // 再加**三个人各自的 `SKILL_NUMBER`** 颗按钮 ×(三档贴图 + 一张说明图)。
    // 最后那一项写死成"7 招"就是纪律 3 拦的那种：谁给陆雪琪补上第 3 招，
    // 这里会莫名其妙地红在一个跟他无关的地方。
    const skills = Object.values(SKILL_NUMBER).reduce((n, k) => n + k, 0)
    expect(ids.length).toBe(
      2 + REMINDER_COUNT + STATE_ICON_TYPES.length + 3 + (DRUGS.length + 1) * 3 + DRUGS.length + skills * 4,
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每一条都在烘焙映射表里，查得出一个 URL', () => {
    const known = new Set(knownAssetIds())
    const missing = ids.filter((id) => !known.has(id))
    expect(missing, '这些 ID 不在映射表里 —— 要么路径拼错了，要么素材没烘').toEqual([])
    for (const id of ids) expect(resolveAsset(id), id).toBeTruthy()
  })

  it('药品菜单第七颗是返回，命名规则跟前六颗不是一套', () => {
    expect(drugButtonId(0, 1)).toBe('battle:药品菜单/药品1按钮1.png')
    expect(drugButtonId(5, 3)).toBe('battle:药品菜单/药品6按钮3.png')
    expect(drugButtonId(DRUGS.length, 2)).toBe('battle:药品菜单/返回2.png')
    expect(() => drugButtonId(DRUGS.length + 1, 1)).toThrow(
      new RegExp(`只有 ${DRUGS.length + 1} 颗按钮`),
    )
  })

  it('药品介绍图走 drug: 前缀 —— 它不在 image/ 下', () => {
    expect(drugPictureId(0)).toBe('drug:金创药.png')
    expect(() => drugPictureId(DRUGS.length)).toThrow(/一共只有/)
  })
})

describe('battleTextureIds 推的名单，盖得住每一条真值真的画到的每一张图', () => {
  /**
   * **这一条是被两次真实事故催出来的**（xl-rh9.12，都发生在真浏览器里）：
   *
   *     Error: 战斗渲染要 battle:背景动画/追星破月/2.jpg，但这一场没有载入它
   *     Error: 战斗渲染只认 battle: 前缀的逻辑 ID，收到 drug:姜黄粉.png
   *
   * `battleTextureIds` 是从**世界**现推的，而 `battleDrawList` 是从**这一拍**
   * 现算的 —— 两边各推各的，少推一类的表现是取图页跑到某一拍才炸。五条老
   * 剧本一次技能、一次菜单都没开过，所以这两处遗漏在它们身上是"什么都没发生"。
   *
   * 这里把两边对撞：回放每一条真值，收下清单里出现过的每一个 ID，一个都不许
   * 落在名单外。分母是磁盘上的战斗真值份数，不是抄来的名单。
   */
  function spriteSize(name: string): { width: number; height: number } {
    const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
    return { width: png.width, height: png.height }
  }

  const drawn = BATTLE_TRACE_NAMES.map((name) => {
    const trace = readBattleTrace(name)
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const loaded = new Set(battleTextureIds(world))
    const used = new Set<string>()
    for (const tick of trace.ticks) {
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
      // 末拍是胜利结算（xl-rh9.13），照旧抛 —— 到此为止。
      if (snapshotBattle(world).ui.victory) break
      for (const op of battleDrawList(world, paint)) {
        if (op.kind !== 'text') used.add(op.id)
      }
    }
    return { name, loaded, used }
  })

  it('每一条真值都真的画出了东西 —— 空集合会让下面那几条恒真', () => {
    // `drawn.length === BATTLE_TRACE_NAMES.length` 这种断言写了也白写：`drawn`
    // 就是那张表 `map` 出来的，长度当然相等。真正拦得住"空转"的是下面这句 ——
    // 一条剧本一张图都没画（回放在第 0 拍就抛了、真值是空的），它的那条
    // "画到的每一张都在名单里"就是拿空集合去减，恒过。
    expect(drawn.length).toBeGreaterThan(0)
    for (const d of drawn) expect(d.used.size, `${d.name} 一张图都没画`).toBeGreaterThan(0)
  })

  for (const d of drawn) {
    it(`${d.name}：画到的每一张都在名单里`, () => {
      expect([...d.used].filter((id) => !d.loaded.has(id)).sort()).toEqual([])
    })
  }
})
