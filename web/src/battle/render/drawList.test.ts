import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../compare/png'
import { repoPath } from '../../test/repoPath'
import { replayBattle } from '../replay'
import { snapshotBattle } from '../snapshot'
import { stepBattle } from '../step'
import { expectationOf } from '../../compare/expected'
import { BATTLE_TRACE_NAMES, readBattleTrace } from '../trace'
import type { BattleWorld } from '../types'
import { BATTLE_LAYERS, battleDrawList, hurtDigits } from './drawList'
import type { DrawOp, LayerName } from './drawList'
import { advancePaintState, applyPaintInput, createPaintState } from './paint'

/**
 * 25 层的**顺序**与**内容**，两类判据。
 *
 * 顺序那一半不手写：从 GBK 的 `src/battle/BattlePanel.java` 里把 `paint()`
 * 的 25 个 `drawXxx` 调用按出现顺序解出来再对。顺序就是 z 序，抄错一层的
 * 表现是"某个精灵被别的盖住了"—— 画面看起来完全正常。
 *
 * 内容那一半跑真的那一场：拿 `battle-min` 的行为真值回放 404 拍，每一拍都
 * 生成一次绘制清单。它验的不是"每个像素对不对"（那是跨端逐帧比对的事），
 * 而是**这一层不许炸、不许画出名单外的图、坐标不许跑出画布之外**。
 */

function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}

/** 怪物出场图的像素尺寸，跟状态层的测试同一个来源（不从真值里读）。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

describe('25 层的次序对回原版 paint()', () => {
  /**
   * `paint()` 方法体里每一次绘制调用，按出现顺序。
   *
   * 抓的是 `<最后一个接收者>.<方法名>` —— 这样 `enemy.beAttackedAnimation
   * .drawAnimation`、`hero.getBeAttackedAnimation().drawAnimation` 与
   * `skillAnimation.drawAnimation` 三处同名方法能分得开。
   */
  const calls = (() => {
    const src = javaSource('src/battle/BattlePanel.java')
    const start = src.indexOf('public void paint(Graphics g){')
    expect(start, 'BattlePanel.java 里找不到 paint(Graphics g) —— 解析器空转').toBeGreaterThan(0)
    // 方法体到下一个方法声明为止。`run()` 紧跟在 paint() 后面。
    const end = src.indexOf('public void run()', start)
    expect(end, 'paint() 之后找不到 run()').toBeGreaterThan(start)
    const body = src.slice(start, end)
    return [...body.matchAll(/([A-Za-z0-9_]+)(\(\))?\.(draw[A-Za-z]+)\s*\(\s*([A-Za-z0-9_]*)/g)].map(
      (m) => `${m[1]}${m[2] ?? ''}.${m[3]}(${m[4]})`,
    )
  })()

  it('从源码里真的解出了绘制调用 —— 解析器空转要响', () => {
    // 分母数得出来：25 层，加上最后那一句把双缓冲刷到屏幕上的 g.drawImage。
    expect(calls.length).toBe(BATTLE_LAYERS.length + 1)
    // 26 条互不相同，否则下面那张对照表会把两层混成一层。
    expect(new Set(calls).size).toBe(calls.length)
  })

  it('逐层同序，一层不多一层不少', () => {
    // 这张表只做"原版那句话叫什么"到"这边那层叫什么"的改名，**不重排**：
    // 顺序完全来自上面解出来的 calls。
    const NAME: Readonly<Record<string, LayerName>> = {
      'bufferedGraphics.drawImage(background)': 'background',
      'backgroundAnimation.drawBackAnimation(bufferedGraphics)': 'background-anim',
      'stateBlank.drawStateBlank(bufferedGraphics)': 'state-blank',
      'angryBar.drawAngryBar(bufferedGraphics)': 'angry-bar',
      'command.drawCommand(bufferedGraphics)': 'command',
      'drugMenu.drawDrugMenu(bufferedGraphics)': 'drug-menu',
      'hero.drawHero(bufferedGraphics)': 'hero',
      'getDeadAnimation().drawDeadAniamtion(bufferedGraphics)': 'dead-anim',
      'getVictoryAnimation().drawVictoryAnimation(bufferedGraphics)': 'victory-anim',
      'enemy.drawEnemy(bufferedGraphics)': 'enemy',
      'pet.drawPet(bufferedGraphics)': 'pet',
      'progressBar.drawProgressBar(bufferedGraphics)': 'progress-bar',
      'skillMenu.drawSkillMenu(bufferedGraphics)': 'skill-menu',
      'beAttackedAnimation.drawAnimation(bufferedGraphics)': 'enemy-be-attacked',
      'getBeAttackedAnimation().drawAnimation(bufferedGraphics)': 'hero-be-attacked',
      'skillAnimation.drawAnimation(bufferedGraphics)': 'skill-anim',
      'getBattleState().drawState(bufferedGraphics)': 'hero-state',
      'battleState.drawState(bufferedGraphics)': 'enemy-state',
      'hurtValue.drawHurtValue(bufferedGraphics)': 'hurt-value',
      'instruct.drawInstruct(bufferedGraphics)': 'instruct',
      'reminder.drawReminder(bufferedGraphics)': 'reminder',
      'victoryReminder.drawVictoryReminder(bufferedGraphics)': 'victory-reminder',
      'mouse.drawMouse(bufferedGraphics)': 'mouse',
      'gameOver.drawGameOver(bufferedGraphics)': 'game-over',
      'startAnimation.drawStartAnimation(bufferedGraphics)': 'start-anim',
    }
    const mapped = calls
      // 最后那一句是把离屏位图刷到屏幕上，不是一层。
      .filter((c) => c !== 'g.drawImage(bufferedPic)')
      .map((c) => {
        const name = NAME[c]
        expect(name, `paint() 里的 ${c} 在这边没有对应的层 —— 原版多画了一层？`).toBeDefined()
        return name!
      })
    expect(mapped).toEqual([...BATTLE_LAYERS])
  })
})

describe('battle-min 的 404 拍逐拍生成绘制清单', () => {
  /**
   * 回放一遍，每一拍收一次清单。**输入照真值喂，状态一个字段都不喂。**
   *
   * 末拍（t=403，胜利第一次出现）**故意不收** —— 那一拍 `battleDrawList`
   * 会抛，归 xl-rh9.5。它由下面单独一条用例正面钉住，不是被跳过。
   */
  const frames = (() => {
    const trace = readBattleTrace('battle-min')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const out: { t: number; ops: DrawOp[]; world: BattleWorld }[] = []
    for (const tick of trace.ticks) {
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
      if (snapshotBattle(world).ui.victory) break
      out.push({ t: tick.t, ops: battleDrawList(world, paint), world })
    }
    return out
  })()

  it('每一拍都画得出来，没有一拍是空的', () => {
    // 404 拍减掉末拍那一次胜利。这个数是**数出来的**：真值里 ui.victory 只有
    // t=403 一拍为真。
    expect(frames.length).toBe(403)
    for (const f of frames) {
      expect(f.ops.length, `第 ${f.t} 拍一条绘制指令都没有`).toBeGreaterThan(0)
      // 背景永远是第一条 —— 它没被画的话整屏是黑的，而黑屏在差异图里看着
      // 像"两端都画错了"。
      expect(f.ops[0]!.layer).toBe('background')
    }
  })

  it('清单里的层次序始终是 BATTLE_LAYERS 的子序列', () => {
    const rank = new Map(BATTLE_LAYERS.map((l, i) => [l, i]))
    for (const f of frames) {
      let last = -1
      for (const op of f.ops) {
        const r = rank.get(op.layer)!
        expect(r, `第 ${f.t} 拍：${op.layer} 排到了前面的层之前`).toBeGreaterThanOrEqual(last)
        last = r
      }
    }
  })

  it('这一场碰得到的层，逐层数出来', () => {
    // 分母是 25。哪些层这一场碰得到、哪些碰不到，写成可核的数 —— 不写的话
    // "这一层从来没被画过"和"这一层写错了"长得一样。
    const seen = new Set<LayerName>()
    for (const f of frames) for (const op of f.ops) seen.add(op.layer)
    expect([...seen].sort()).toEqual(
      [
        'angry-bar',
        'background',
        'command',
        'enemy',
        'enemy-be-attacked',
        'hero',
        'hero-be-attacked',
        'hurt-value',
        'instruct',
        'mouse',
        'progress-bar',
        'skill-anim',
        'start-anim',
        'state-blank',
      ].sort(),
    )
    // 反方向：碰不到的那 11 层是**有名有姓**的，不是"剩下的"。其中 6 层今天
    // 画不出来（各自归哪张票见 drawList.ts），5 层是这一场里确实没发生。
    // 这一条只跑 battle-min；「所有战斗真值合起来盖到了哪几层」在下面那个
    // describe 里，两者的分母不同。
    const unseen = BATTLE_LAYERS.filter((l) => !seen.has(l))
    expect(unseen.sort()).toEqual(
      [
        'background-anim', // 只有技能才放，这一场全是普攻
        'dead-anim', // 我方没人倒下
        'drug-menu', // 没实现，归 xl-rh9.11
        'enemy-state', // 没实现（真值没记坐标），归 xl-rh9.11
        'game-over', // 没实现，归 xl-rh9.8；这一场也没输
        'hero-state', // 同 enemy-state
        'pet', // 结构性缺席：世界里根本没有这个字段
        'reminder', // 没实现（真值只记了布尔），归 xl-rh9.11
        'skill-menu', // 没实现，归 xl-rh9.11
        'victory-anim', // 胜利动画与胜利结算同一拍开始，而那一拍收不进来
        'victory-reminder', // 没实现，归 xl-rh9.5；这一场只在末拍出现
      ].sort(),
    )
  })

  it('胜利那一拍真的会抛，并点名 xl-rh9.5', () => {
    // 上一条说 victory-reminder "碰不到"，靠的是 404 拍里只有末拍胜利、而
    // 那一拍的清单是在胜利**之前**生成的吗？不是 —— 末拍的清单就是在
    // 胜利之后生成的。所以这里把它单独钉住：那一拍确实抛了，是被
    // `battleDrawList` 拦下来的，不是"这一场没走到"。
    const trace = readBattleTrace('battle-min')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    let threw: string | null = null
    for (const tick of trace.ticks) {
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
      if (!snapshotBattle(world).ui.victory) continue
      try {
        battleDrawList(world, paint)
      } catch (e) {
        threw = e instanceof Error ? e.message : String(e)
      }
      break
    }
    expect(threw, '胜利那一拍没有抛 —— 那说明结算那一层被静默跳过了').toMatch(/xl-rh9\.5/)
  })

  it('画出来的东西都落在画布上，没有跑飞的坐标', () => {
    // 一个跑飞的坐标（比如把 showY 当成 showX）在差异图上看着就是"少画了
    // 一个精灵"，与"这一帧本来就没有它"分不开。这里给一个宽松但有限的框：
    // 精灵可以部分出界（开场云雾就是从 −1024 推进来的），但不许整个跑到
    // 几千像素外。
    for (const f of frames) {
      for (const op of f.ops) {
        const [x, y] = op.kind === 'rect' ? [op.dest.x, op.dest.y] : [op.x, op.y]
        expect(Math.abs(x), `第 ${f.t} 拍 ${op.layer} 的 x=${x}`).toBeLessThanOrEqual(2048)
        expect(Math.abs(y), `第 ${f.t} 拍 ${op.layer} 的 y=${y}`).toBeLessThanOrEqual(2048)
      }
    }
  })

  it('第 200 拍：「击」还亮着上一轮松手留下的贴图', () => {
    // 这一拍在跨端逐帧比对的采样点上（--every 25），也是 17 帧里唯一画到
    // 控制台与指示图的一帧。把它单拎出来，是为了让"这两层画错了"有一个
    // 不依赖浏览器的判据。
    //
    // **「击」是待点态（击2）而不是常态（击1）**，这条是这一票里最值得记的
    // 一个发现。按钮贴图由鼠标事件换，而三个事件处理器都套着
    // `if(command.isDraw)`：
    //
    //   t=157  点「击」→ 松手时游标在框里 → 击 换成待点态；控制台随即隐藏
    //   t=158  点怪物 → 控制台没画出来，三个 check 一个都不跑 → 贴图不动
    //   t=200  控制台重新画出来 → 「击」仍然是 t=157 留下的那一张
    //
    // 也就是说这张贴图**不是游标当前位置的函数**。原先按"游标在不在框里"
    // 现算，这一帧会算成常态 —— 而它是采样帧，跨端比对会红在这一处。
    // 原版那 17 张位图里 f000200.png 的「击」确实是亮着的（金色），与这里一致。
    const f = frames.find((x) => x.t === 200)!
    const command = f.ops.filter((op) => op.layer === 'command')
    expect(command.map((op) => (op.kind === 'image' ? op.id : ''))).toEqual([
      'battle:按钮图/击2.png',
      'battle:按钮图/技1.png',
      'battle:按钮图/防1.png',
      'battle:按钮图/物1.png',
    ])
    // 击在 (500,300)，技在它上面 62，防/物左右各 58、下面 40。
    expect(command.map((op) => (op.kind === 'image' ? [op.x, op.y] : null))).toEqual([
      [500, 300],
      [500, 238],
      [442, 340],
      [558, 340],
    ])
    const instruct = f.ops.find((op) => op.layer === 'instruct')!
    // 这一拍是**陆雪琪**的回合（真值 t=200 的 round 走到 3），所以走的是
    // `Instruct.start()` 的 case 3：陆雪琪 (800,330) 加 (45,−20)。
    // 三支 switch 各写各的偏移，挑错一支的表现是指示图指着旁边那个人。
    expect(instruct.kind === 'image' ? [instruct.x, instruct.y] : null).toEqual([845, 310])
  })
})

describe('全部战斗真值合起来画到了哪几层', () => {
  /**
   * **哪几层真的被像素比对盖住了**，逐层登记。
   *
   * 为什么值得单写一条：`battleDrawList` 把 25 层都写出来了，可"写出来了"与
   * "有判据"是两回事 —— 一层从来没被任何一条剧本触发过，它写对了和写错了
   * 长得一模一样。这里把五条真值合起来跑一遍，数出**实际画到**的那几层，
   * 再与下面这张手写的登记对撞。
   *
   * 分母（有哪几份战斗真值）从磁盘现扫，登记由人签 —— 两者对撞才有分辨力
   * （`docs/agents/dispatch.md` 纪律 3 那条已记录的误用讲的就是这个）。
   */

  /** 全部战斗真值合起来**真的画到**的层，逐个签在这里。 */
  const COVERED: readonly LayerName[] = [
    'angry-bar',
    'background',
    'command',
    'dead-anim',
    'enemy',
    'enemy-be-attacked',
    'game-over',
    'hero',
    'hero-be-attacked',
    'hurt-value',
    'instruct',
    'mouse',
    'progress-bar',
    'skill-anim',
    'start-anim',
    'state-blank',
  ]

  /** 一次都没画到的层，各自写明为什么。**没有第三种。** */
  const UNCOVERED: Readonly<Record<string, string>> = {
    'background-anim':
      '只有技能才放。battle-menus 用了两次技能，可它在开菜单那一拍就先撞上 ' +
      'drug-menu 抛了 —— 这一层仍然只有代码、没有判据。归 xl-rh9.12',
    'victory-anim': '与胜利结算同一拍开始，而那一拍先被 victory-reminder 拦下来抛（xl-rh9.5）',
    pet: '结构性缺席：世界里根本没有 pet 字段，只有陆雪琪的秘术召得出来',
    'drug-menu':
      '点「物」才打开。battle-menus 点过了，可这一层还没画 —— 撞上就抛，' +
      '那条剧本因此在 expected.ts 里表着 unpainted。归 xl-rh9.12',
    'skill-menu': '点「技」才打开，同 drug-menu —— 这一层抛，归 xl-rh9.12',
    reminder: '真值已经记了是第几张与目标矩形（xl-rh9.11），可这一层还没画 —— 抛，归 xl-rh9.12',
    'hero-state': '战斗状态图标：真值已经记了 type 与坐标，这一层还没画 —— 抛，归 xl-rh9.12',
    'enemy-state': '同 hero-state，怪物身上那一层',
    'victory-reminder': '胜利结算整段归 xl-rh9.5 —— 这一层抛',
  }

  /** 每一条真值各跑一遍，收下它画到的层。抛了就停在那一拍（那也是结论）。 */
  const covered = (() => {
    const seen = new Set<LayerName>()
    for (const name of BATTLE_TRACE_NAMES) {
      const trace = readBattleTrace(name)
      const world = replayBattle(trace, spriteSize)
      const paint = createPaintState(world)
      for (const tick of trace.ticks) {
        for (const input of tick.input) applyPaintInput(world, paint, input)
        stepBattle(world, tick.input)
        advancePaintState(world, paint)
        let ops
        try {
          ops = battleDrawList(world, paint)
        } catch {
          // 撞上一层还没实现的 —— 那一条剧本到此为止，这是预期内的。
          break
        }
        for (const op of ops) seen.add(op.layer)
      }
    }
    return seen
  })()

  it('分母是磁盘上的战斗真值份数，不是抄来的名单', () => {
    expect(BATTLE_TRACE_NAMES.length).toBeGreaterThan(0)
    // 25 层每一层要么在 COVERED 里、要么在 UNCOVERED 里，没有第三种。
    const unaccounted = BATTLE_LAYERS.filter((l) => !COVERED.includes(l) && !(l in UNCOVERED))
    expect(unaccounted, '新加的层要么签进 COVERED、要么写明为什么盖不到').toEqual([])
    // 两张表不许有交集 —— 同时写进两边时，下面两条都过得去。
    expect(COVERED.filter((l) => l in UNCOVERED)).toEqual([])
    // UNCOVERED 里的键必须真的是层名，不是打错的字。
    expect(
      Object.keys(UNCOVERED).filter((k) => !(BATTLE_LAYERS as readonly string[]).includes(k)),
    ).toEqual([])
  })

  it('登记与实际跑出来的逐层相等 —— 两个方向', () => {
    // 正方向：签了"画到了"的，真的画到了。
    const missing = COVERED.filter((l) => !covered.has(l))
    expect(missing, '登记说画到了，实际一次都没画到').toEqual([])
    // 反方向：签了"盖不到"的，真的一次都没画到。哪天某一层被触发了
    // （比如有人加了一条用技能的剧本），这一条就红 —— 那时候它该从
    // UNCOVERED 挪进 COVERED，而不是继续挂在"没判据"里。
    const surprises = Object.keys(UNCOVERED).filter((l) => covered.has(l as LayerName))
    expect(surprises, '登记说盖不到，实际画到了 —— 把它挪进 COVERED').toEqual([])
  })

  it('盖到的层占多数，且每一条没盖到的都写了理由', () => {
    // 这两条防的是"登记表被清空/被塞满"这种让上面两条空转的改法。
    expect(COVERED.length).toBeGreaterThan(BATTLE_LAYERS.length / 2)
    for (const [layer, why] of Object.entries(UNCOVERED)) {
      expect(why.length, `${layer} 没写为什么盖不到`).toBeGreaterThan(10)
    }
  })
})

describe('伤害数字的位数', () => {
  it('去掉前导零，个位总是画', () => {
    expect(hurtDigits(0)).toEqual([0])
    expect(hurtDigits(7)).toEqual([7])
    expect(hurtDigits(70)).toEqual([7, 0])
    expect(hurtDigits(700)).toEqual([7, 0, 0])
    expect(hurtDigits(7000)).toEqual([7, 0, 0, 0])
    expect(hurtDigits(1204)).toEqual([1, 2, 0, 4])
    expect(hurtDigits(103)).toEqual([1, 0, 3])
  })

  it('五位数、负数 —— 抛，不悄悄截断', () => {
    expect(() => hurtDigits(10000)).toThrow(/五位数/)
    expect(() => hurtDigits(-1)).toThrow(/非负整数/)
    expect(() => hurtDigits(1.5)).toThrow(/非负整数/)
  })
})

describe('表态 unpainted 的剧本，真的画不出来（xl-rh9.11）', () => {
  /**
   * `expected.ts` 的 `unpainted` 说的是：驱动器装得出，可**这条剧本**会走进一层
   * 还没实现的绘制，于是跨端比对在它身上一帧都比不成。
   *
   * 一个不带任何要求的状态就是一个逃生舱 —— 谁想绕开上界，把 `status` 改成它
   * 就行了。所以这里把那句话真的跑一遍：**回放到某一拍，`battleDrawList` 必须
   * 当场抛，而且抛的那句话点的正是表里挂的那张票。**
   *
   * 两个方向都撞：
   *
   * - 表说 `unpainted` 而它一路画到底 → 红（那几层已经画出来了，表过期了）；
   * - 表没说 `unpainted` 而它中途就抛 → 红（这条剧本其实比不了，账是编的）。
   *
   * **末拍不算**：`battle-min` / `battle-em3-box` 打赢的那一拍会被
   * `victory-reminder` 拦下来抛（归 xl-rh9.5），而那一拍在 `--every 25` 的采样
   * 点之外，比对照常跑得完。所以判的是「有没有在末拍**之前**抛」。
   */
  interface Attempt {
    name: string
    /** 第一次抛在第几拍（0 基，按真值的步序）；一路画到底是 null。 */
    firstThrow: number | null
    /**
     * **末拍之前**抛出来的每一句不同的话。
     *
     * ⚠️ **收的是全部，不是第一句。** 原先只收第一次抛。实测（xl-rh9.11 的
     * 篡改 T11）：把 `drawList.ts` 里技能菜单那一层挂的票号改成另一张，整套
     * 判据**是绿的** —— 因为 `battle-menus` 先在第 88 拍撞上药品菜单，那一句
     * 先抛，后面几层的票号一次都没被读到。「只覆盖到第一层」与「几层都覆盖
     * 到了」长得一模一样。抛过之后照样往下跑：`battleDrawList` 是纯函数，
     * 抛不改世界。
     *
     * 末拍单独排除：打赢的那一拍撞的是胜利结算（归 xl-rh9.5），与这条表态挂的
     * 票不是一张，而那一拍在 `--every 25` 的采样点之外、比对照常跑得完。
     */
    messages: string[]
    ticks: number
  }

  const attempts: Attempt[] = BATTLE_TRACE_NAMES.map((name) => {
    const trace = readBattleTrace(name)
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const messages = new Set<string>()
    let firstThrow: number | null = null
    let i = 0
    for (const tick of trace.ticks) {
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
      try {
        battleDrawList(world, paint)
      } catch (e) {
        if (firstThrow === null) firstThrow = i
        if (i < trace.ticks.length - 1) messages.add(e instanceof Error ? e.message : String(e))
      }
      i++
    }
    return { name, firstThrow, messages: [...messages], ticks: trace.ticks.length }
  })

  it('分母是磁盘上的战斗真值份数', () => {
    expect(attempts.length).toBe(BATTLE_TRACE_NAMES.length)
    expect(attempts.length).toBeGreaterThan(0)
  })

  it('至少有一条剧本表着 unpainted —— 否则下面两条是空转的', () => {
    const unpainted = attempts.filter((a) => expectationOf(a.name).status === 'unpainted')
    expect(
      unpainted.length,
      '一条 unpainted 的战斗剧本都没有了？那几层画出来之后，把这一整个 describe 删掉',
    ).toBeGreaterThan(0)
  })

  for (const a of attempts) {
    const e = expectationOf(a.name)
    if (e.status === 'unpainted') {
      it(`${a.name}：表说画不出来，那就必须在末拍之前真的抛，并点名 ${e.issue}`, () => {
        expect(
          a.firstThrow,
          `${a.name} 一路画到底了 —— 那几层已经画出来了，把 expected.ts 里这条从 ` +
            'unpainted 换成 match 或者真量出来的 gap',
        ).not.toBeNull()
        expect(a.firstThrow!, `${a.name} 只在末拍抛（那是胜利结算，不是这条表态的理由）`).toBeLessThan(
          a.ticks - 1,
        )
        // 点名：末拍之前抛出来的**每一句**都必须有表上挂的票号，否则
        // 「画不出来」与「画错了炸了」在报告里长得一样。
        const unnamed = a.messages.filter((m) => !m.includes(e.issue!))
        expect(unnamed, `${a.name} 抛了这几句，可它们没点名 ${e.issue}`).toEqual([])
        // 分母：这一条剧本到底撞上了几层。只撞上一层时上面那句话就只覆盖得到
        // 一层 —— 而 battle-menus 在末拍之前撞的是三层（药品菜单 @88、
        // 技能菜单 @168、我方状态图标 @198）。
        expect(a.messages.length, `${a.name} 只撞上了一层？`).toBeGreaterThan(1)
      })
    } else {
      it(`${a.name}：表没说画不出来，那它就不许在末拍之前抛`, () => {
        if (a.firstThrow === null) return
        expect(
          a.firstThrow,
          `${a.name} 在第 ${a.firstThrow} 拍就抛了（${a.messages[0]}）—— 这条剧本其实比不了，` +
            'expected.ts 里那笔账是编的',
        ).toBe(a.ticks - 1)
      })
    }
  }
})
