import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { javaSource } from '../test/javaSource'
import {
  MAX_LINE,
  NO,
  YES,
  checkSelectEvent,
  createSelect,
  fromSelectDraft,
  selectKeyPressed,
  showSelectQuestion,
  tickSelectTimers,
  toSelectDraft,
} from './select'
import type { PresentRequest, SelectDraft, SelectHost, SelectRecord } from './select'
import { TICK_MS, createWorld, step } from './step'
import type { BattleInfo } from './fight'
import type { World } from './types'

/**
 * 一句 Java 语句在源码里是**折过行的**（原文是 Eclipse 的自动换行），
 * 所以核它要把空白挤掉再比。直接 `toContain` 会得到"源码里没这一行"，
 * 而那与"原版真的改掉了"长得一模一样。
 */
function javaStatements(file: string): string {
  const source = javaSource(file).replace(/\s+/g, ' ')
  // 空转要响：GBK 解码要是出了岔子，下面每一条 `toContain` 都会红成"原版改了"，
  // 而每一条 `not.toContain` 会**全绿** —— 后者与"这一行确实不在源码里"长得
  // 一模一样（`test/javaSource.ts` 明写了这条规矩）。
  if (source.length === 0) throw new Error(`${file} 读出来是空的`)
  return source
}

/**
 * 选择框状态机里**真值盖不到的那几条分支**。
 *
 * 逐 tick 对齐（`traceReplay.test.ts` 的 `select` 那 11 格）是这一层的主判据，
 * 这个文件只补它**观测不到**的那些 —— 判据一律回到 GBK 源码上取，做法照
 * `docs/agents/dispatch.md` §「真值盖不到那个分支」的第二条出路。
 *
 * 每条用例开头写明：为什么真值看不见它。
 */

/** 一个把三件外部动作记下来的 `SelectHost`。`random` 钉死，好让金额可断言。 */
function recordingHost(random = 0.5): {
  readonly host: SelectHost
  readonly fights: BattleInfo[]
  readonly panels: string[]
  readonly presents: PresentRequest[]
} {
  const fights: BattleInfo[] = []
  const panels: string[] = []
  const presents: PresentRequest[] = []
  return {
    fights,
    panels,
    presents,
    host: {
      fight: (info) => fights.push(info),
      switchTo: (panel) => panels.push(panel),
      present: (request) => presents.push(request),
      random: () => random,
    },
  }
}

/** 把一份 `SelectState` 摊成草稿，带上那张跨场景的表。 */
function draftOf(scene: string, recorder: readonly SelectRecord[] = []) {
  const built = createSelect(getScene(scene), recorder)
  return { draft: toSelectDraft(built.select, built.recorder), recorder: built.recorder }
}

/** 把选择框的三个定时器一直跑到都停下来（滑入 + 逐字吐完）。 */
function settle(d: SelectDraft, from = 0): number {
  let now = from
  for (let i = 0; i < 4000; i++) {
    if (!d.selectImageMove.running && !d.questionImageMove.running && !d.wordsRun.running) {
      return now
    }
    tickSelectTimers(d, now)
    now += TICK_MS
  }
  throw new Error('选择框的三个定时器 4000 拍还没停下来')
}

describe('选择框：真值盖不到的分支', () => {
  /**
   * 真值看不见它，因为**两条有题的剧本都只登记过一个场景**（`question-answer`
   * 与 `question-memory` 走的都是大活，`recorder` 从头到尾只有一条）。
   * 于是 `count_scene` 与那条记录的真实下标恒等，两者分岔这件事观测不到。
   *
   * 判据回到源码上取：`SelectEvent` 的构造函数只在**认领到旧记录**时才写
   * `count_scene = i`，新登记的那一支一个字都不写它 —— 而 `keyPressed` 里
   * 答完题之后按的偏偏是 `answeredRecorder.remove(count_scene)`。
   */
  it('新登记的场景里 count_scene 停在 0，答完题写坏的是表里第一条 —— 那个 0 指着别人', () => {
    // 先核这条分支的前提确实在源码里，而不是我读岔了。
    const source = javaStatements('src/scene/SelectEvent.java')
    expect(source, 'count_scene 只在认领旧记录那一支被赋值').toContain('count_scene = i;')
    expect(source, '写回那张表按的是 count_scene').toContain('answeredRecorder.remove(count_scene);')

    // 大活先登记（18 道题），食堂后登记（1 道题）。
    const first = draftOf('大活')
    expect(first.recorder).toHaveLength(1)
    const second = createSelect(getScene('食堂'), first.recorder)
    expect(second.recorder.map((r) => r.scene)).toEqual(['大活.txt', '食堂.txt'])
    // 正题：这个场景的记录在下标 1 上，而 count_scene 停在 0。
    expect(second.select.recordIndex).toBe(1)
    expect(second.select.sceneNo).toBe(0)

    // 在食堂答第 0 道题（答对答错都一样，这条分支不看对错）。
    const d = toSelectDraft(second.select, second.recorder)
    const { host } = recordingHost()
    showSelectQuestion(d, 0, 0)
    let now = settle(d)
    selectKeyPressed(d, 'enter', now, host) // 选「是」→ 问题框
    now = settle(d, now)
    selectKeyPressed(d, 'enter', now, host) // 交卷

    // 食堂自己那条对了（对象别名那一路）……
    expect(d.recorder[1]).toEqual({ scene: '食堂.txt', answered: [true] })
    // ……而大活那条被按 count_scene 覆盖成了食堂的答题记录：场景名还是大活，
    // 18 道题的记录只剩 1 个。**原版就是这样**，这里钉住它，不修。
    expect(d.recorder[0]).toEqual({ scene: '大活.txt', answered: [true] })

    // 后果是可观察的：再走回大活，它认领到的是那条被写坏的记录。
    const back = createSelect(getScene('大活'), d.recorder)
    expect(back.select.answered).toEqual([true])
    expect(getScene('大活').question).toHaveLength(18)
  })

  /**
   * 真值看不见它，因为 `battle-door` 打完那一架之后剧本就 `wait 30` 结束了，
   * 没有再对同一个 NPC 按一次空格。
   *
   * 判据是 `checkSelectEvent` 里那句 `if (!haveFighted.get(i))` —— 打过的
   * 那一场整条跳过，于是这个 NPC 从"弹选择框"改成"说口头语"。
   */
  it('打过的那一场不再问：checkSelectEvent 不再截胡，同一个 NPC 改说口头语', () => {
    const { draft: d } = draftOf('大地图')
    const npcNo = Number(getScene('大地图').selectBattlePanel![0]![0])
    // 头一次：截胡并弹框。
    expect(checkSelectEvent(d, npcNo, 0)).toBe(true)
    expect(d.isSelect).toBe(true)
    expect(d.battle).toBe(true)
    expect(d.battleNo).toBe(0)

    // 打完（选「是」）之后 fought[0] 翻真。
    const { host, fights } = recordingHost()
    const now = settle(d)
    selectKeyPressed(d, 'enter', now, host)
    expect(d.fought).toEqual([true, false])
    expect(fights).toHaveLength(1)
    expect(fights[0]).toEqual(getScene('大地图').battle2![0])

    // 关掉回答框，再问一次同一个 NPC —— 这次不截胡了。
    const after = settle(d, now)
    selectKeyPressed(d, 'space', after, host)
    expect(d.isSelect).toBe(false)
    expect(checkSelectEvent(d, npcNo, after)).toBe(false)
    // 而**另一场**照旧截胡 —— 否则"跳过打过的"与"整支都不认了"长得一样。
    const other = Number(getScene('大地图').selectBattlePanel![1]![0])
    expect(other).not.toBe(npcNo)
    expect(checkSelectEvent(d, other, after)).toBe(true)
    expect(d.battleNo).toBe(1)
  })

  /**
   * `checkSelectEvent` 答题那支开头那句 `if (isSelect) return true` ——
   * **它不看 npcNo**，于是选择框开着时，有题的场景里所有 NPC 都说不了口头语。
   *
   * ⚠️ 这一条**篡改矩阵头一轮是绿的**，而那不是判据失灵：大活的 5 个 NPC
   * 恰好每一个都还挂着没答的题（18 道题分在 5 个 NPC 上，两条剧本各答掉
   * 1–2 道），所以拿掉这句之后循环照样命中、照样返回 true。分辨得出来的
   * 只有"这个 NPC 的题全答完了"那一刻 —— 今天的真值走不到，所以在这里造。
   */
  it('选择框开着时，题全答完的 NPC 也不说口头语 —— 那句 if (isSelect) 不看 npcNo', () => {
    const { draft: d } = draftOf('大活')
    const npcNo = Number(getScene('大活').selectQuestion![0]![0])
    // 先把这个 NPC 名下的题全标成答过 —— 大活 18 道题都挂在 0..4 号 NPC 上，
    // 这里直接全标，夹具才不依赖"哪几道是他的"。
    d.answered = d.answered.map(() => true)

    // 框关着：全答完了就不再截胡，这个 NPC 该说口头语。
    expect(checkSelectEvent(d, npcNo, 0)).toBe(false)

    // 框开着：那句早退把所有 NPC 一律截胡。**两个方向都要有**，否则
    // "早退生效了"与"这个 NPC 本来就截胡"长得一样。
    d.isSelect = true
    expect(checkSelectEvent(d, npcNo, 0)).toBe(true)
    // 连一个压根不在选择数据里的序号也一样 —— 那正是它不看 npcNo 的意思。
    expect(checkSelectEvent(d, 999, 0)).toBe(true)
  })

  /**
   * 真值看不见它，因为 11 条场景真值里没有一次在选择框开着时按过左右键
   * （剧本的 `cursor` 指令只认 `down` / `up`，见 `docs/trace-format.md`）。
   *
   * 判据是 `SelectEvent.keyPressed` 的第一个 `if` —— 它只判
   * `VK_DOWN || VK_UP`，左右两个键一路落到最后什么分支都不进。
   */
  it('左右键在选择框里什么都不做', () => {
    const source = javaStatements('src/scene/SelectEvent.java')
    expect(source, 'keyPressed 的方向键那一支只认上下').toContain(
      'if (keyCode == KeyEvent.VK_DOWN || keyCode == KeyEvent.VK_UP)',
    )
    expect(source, '左右键在 SelectEvent 里根本没出现过').not.toContain('VK_LEFT')

    const { draft: d } = draftOf('金陵大学医院')
    const { host } = recordingHost()
    checkSelectEvent(d, 0, 0)
    const now = settle(d)
    const before = fromSelectDraft(d)
    selectKeyPressed(d, 'left', now, host)
    selectKeyPressed(d, 'right', now, host)
    expect(fromSelectDraft(d)).toEqual(before)
    // 反面：同一个夹具按下键，光标真的动了 —— 否则"左右键没反应"与
    // "这个夹具本来就动不了"长得一样。
    selectKeyPressed(d, 'down', now, host)
    expect(fromSelectDraft(d)).not.toEqual(before)
    expect(d.yesNo).toBe(NO)
  })

  /**
   * 那两件外部动作（消费者是 `game/session.ts`，xl-yg6.11 接上的；逐支对真值的
   * 读数在 `game/doors.test.ts`）。这一条守的是状态层自己：请求只亮一拍。
   */
  it('选「是」进药店 / 装备超市：这一拍把面板请求发出来', () => {
    for (const [scene, want] of [
      ['金陵大学医院', 'shop'],
      ['金陵大学装备超市', 'equipmentShop'],
    ] as const) {
      const data = getScene(scene)
      const row = want === 'shop' ? data.selectShopPanel : data.selectEquipmentShopPanel
      expect(row, `${scene} 应该有这一段选择数据`).not.toBeNull()
      const { draft: d } = draftOf(scene)
      const { host, panels } = recordingHost()
      expect(checkSelectEvent(d, Number(row![0]), 0)).toBe(true)
      const now = settle(d)
      expect(d.yesNo).toBe(YES)
      selectKeyPressed(d, 'enter', now, host)
      expect(panels).toEqual([want])
      // 原版选「是」**不关框**（`isSelect` 那一支里一个字都没写它）。照抄。
      expect(d.isSelect).toBe(true)
    }
  })

  it('选「否」：什么都不发生，框关掉、回到走路', () => {
    const { draft: d } = draftOf('金陵大学医院')
    const { host, panels, fights, presents } = recordingHost()
    checkSelectEvent(d, 0, 0)
    let now = settle(d)
    selectKeyPressed(d, 'down', now, host)
    expect(d.yesNo).toBe(NO)
    now += TICK_MS
    selectKeyPressed(d, 'enter', now, host)
    expect(d.isSelect).toBe(false)
    expect(d.shop).toBe(false)
    expect([panels, fights, presents]).toEqual([[], [], []])
  })

  /**
   * 加扣金币那一处。真值不记它（金额是 `Math.random()` 现掷的，记进来
   * `--check` 当场红，见 `docs/trace-format.md`），所以这里钉的是**那句拼法**
   * 与那个算式，判据从 GBK 源码上取。
   */
  it('答对答错各自的提示语与金额：500 + (int)(500 * random)', () => {
    const source = javaStatements('src/scene/SelectEvent.java')
    expect(source).toContain('int i = 500 + (int) (500 * Math.random());')
    expect(source).toContain('drawString("得到" + i + "个金币");')
    expect(source).toContain('drawString("回答错误，扣掉" + i + "个金币");')

    const answer = getScene('大活').answer![0]!
    const right = Number(answer[0])
    for (const [abcd, correct] of [
      [right, true],
      [right + 1, false],
    ] as const) {
      const { draft: d } = draftOf('大活')
      const { host, presents } = recordingHost(0.5)
      showSelectQuestion(d, 0, 0)
      let now = settle(d)
      selectKeyPressed(d, 'enter', now, host)
      now = settle(d, now)
      d.abcd = abcd
      selectKeyPressed(d, 'enter', now, host)
      expect(presents).toEqual([
        { correct, coins: 750, text: correct ? '得到750个金币' : '回答错误，扣掉750个金币' },
      ])
      // 答对取答案的第 3 列、答错取第 2 列，两者都不许拿反。
      expect(d.sentences[2]).toBe(correct ? answer[3] : answer[2])
      expect(d.answered[0]).toBe(true)
    }
  })

  /**
   * 逐字打印的折行。真值记的是 `wordNo` / `lineNo` 两个游标（那两个是对齐的），
   * **不记 `bufferedText` 的内容** —— 而渲染层画的正是那个内容。
   *
   * 判据是 `WordsRun` 里那句 `substring(maxLength - 1, count_word)`：
   * 换行的切点是 `maxLength - 1` 而不是 `maxLength`，于是**一行实际只装
   * 21 个字，而那个常量写的是 22**。这是原版的一处差一，不修 —— 修了逐 tick
   * 那几个游标照样全绿（它们数的是 `count_word`，不是切在哪），而画面上
   * 一行多一个字没人看得出来。
   *
   * ⚠️ 这条断言的头一版写的是"上一行的最后一个字会被重复带到下一行"，
   * **跑出来是错的**：`substring(21, 22)` 取的是第 22 个字，而上一行到第 21 个
   * 字为止，两段不重叠。改成现在这样，是判据纠正了我读源码时的推断。
   */
  it('折行的切点是 maxLength - 1：一行只装 21 个字，两段不重叠', () => {
    expect(javaStatements('src/scene/SelectEvent.java')).toContain(
      '.substring(maxLength - 1, count_word)',
    )

    const { draft: d } = draftOf('金陵大学医院')
    const lines = getScene('金陵大学医院').selectShopPanel!
    checkSelectEvent(d, 0, 0)
    settle(d)

    // 第 1 句超过一行（22 个字），所以它一定折过 —— 夹具本身先核一遍。
    expect(lines[1]!.length).toBeGreaterThan(d.maxLength)
    expect(d.text[0]).toBe(lines[1]!.slice(0, d.maxLength - 1))
    expect(d.text[1]).toBe(lines[1]!.slice(d.maxLength - 1))
    // 两段不重不漏地拼回原句，而第一段只有 21 个字。
    expect(`${d.text[0]}${d.text[1]}`).toBe(lines[1])
    expect(d.text[0]).toHaveLength(d.maxLength - 1)
    // 缓冲的长度是原版那 20 行，不许被 JS 的数组悄悄撑长。
    expect(d.text).toHaveLength(MAX_LINE)
  })
})

describe('选择框接进 ScenePanel 的那两处', () => {
  /** 主角站到 NPC 那一格（原版四个贴身位里的 `x1 == x2 && y1 == y2` 那个）。 */
  function facing(world: World, index = 0): World {
    const npc = world.npcs[index]!
    return { ...world, role: { ...world.role, px: npc.x * 32, py: npc.y * 32 } }
  }

  const press = (k: string) => [{ e: 'press' as const, k, ctrl: false }]

  /**
   * 这一条 `shop-door` 那份真值里有（xl-yg6.7 补的），逐 tick 已经对齐。
   * 留在这里是因为它是**这张票的正题**，而逐格用例的名字里读不出这件事。
   */
  it('选择框开着就走不动：同一下方向键，框开着时归光标、框关着时归主角', () => {
    const world = facing(createWorld(getScene('金陵大学医院')))
    const opened = step(world, press('space'), TICK_MS)
    expect(opened.select.isSelect).toBe(true)

    const moved = step(opened, press('down'), TICK_MS)
    expect(moved.select.yesNo).toBe(NO)
    expect(moved.role.walk.running, '选择框开着时不许起走路定时器').toBe(false)
    expect(moved.role.py).toBe(opened.role.py)

    // 反面：同一下键在框关着时确实把主角推起来了。
    const walking = step(world, press('down'), TICK_MS)
    expect(walking.role.walk.running).toBe(true)
  })

  /** 推到选择框那三个定时器都停下来（滑入 + 逐字吐完）。 */
  function settleWorld(world: World): World {
    let s = world
    for (let i = 0; i < 2000; i++) {
      const t = s.select
      if (!t.selectImageMove.running && !t.questionImageMove.running && !t.wordsRun.running) return s
      s = step(s, [], TICK_MS)
    }
    throw new Error('选择框 2000 拍还没停下来')
  }

  it('step() 把面板请求发到世界上（只亮一拍）', () => {
    const world = facing(createWorld(getScene('金陵大学医院')))
    const opened = step(world, press('space'), TICK_MS)
    expect(opened.selectPanelRequest).toBeNull()
    const chosen = step(settleWorld(opened), press('enter'), TICK_MS)
    expect(chosen.selectPanelRequest).toBe('shop')
    // 只亮一拍：下一拍就落回 null。
    expect(step(chosen, [], TICK_MS).selectPanelRequest).toBeNull()
  })

  it('step() 把答对答错的加扣请求发到世界上（只亮一拍）', () => {
    // 大活的 0 号 NPC 是原地运动型（状态码 2），要等 `checkNPCStop` 把它的
    // 动画停下来才搭得上话 —— 所以先空推几拍。
    let s = facing(createWorld(getScene('大活')))
    for (let i = 0; i < 5; i++) s = step(s, [], TICK_MS)
    s = settleWorld(step(s, press('space'), TICK_MS))
    expect(s.select.question, '第一下空格该弹出「要不要答题」').toBe(true)

    s = settleWorld(step(s, press('enter'), TICK_MS)) // 选「是」→ 问题框
    expect(s.select.asking).toBe(true)
    expect(s.presentRequest, '题还没交，不该有加扣').toBeNull()

    const answered = step(s, press('enter'), TICK_MS) // 交卷
    expect(answered.presentRequest).not.toBeNull()
    // 金额是 `500 + (int)(500 * Math.random())`，随机的 —— 断言的是区间与那句
    // 拼法，不是某一个数（`select.test.ts` 上面那条钉死 random 之后核过全等）。
    const request = answered.presentRequest!
    expect(request.coins).toBeGreaterThanOrEqual(500)
    expect(request.coins).toBeLessThan(1000)
    expect(request.text).toBe(
      request.correct ? `得到${request.coins}个金币` : `回答错误，扣掉${request.coins}个金币`,
    )
    expect(step(answered, [], TICK_MS).presentRequest).toBeNull()
  })
})
