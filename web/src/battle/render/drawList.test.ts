import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../compare/png'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { replayBattle } from '../replay'
import { snapshotBattle } from '../snapshot'
import { stepBattleWithPaint } from '../loop'
import { expectationOf } from '../../compare/expected'
import { BATTLE_TRACE_NAMES, readBattleTrace } from '../trace'
import type { BattleWorld } from '../types'
import { BATTLE_LAYERS, battleDrawList, hurtDigits } from './drawList'
import type { DrawOp, LayerName } from './drawList'
import { createPaintState } from './paint'

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

/**
 * 战斗渲染器画在一张**不清屏的持久缓冲**上、上屏时扔掉 alpha —— 那样做的
 * 理由**回到源码上取**（xl-84z）。理由本身写在 `battleRenderer.ts` 文件头
 * 第四处；这里核它依赖的那几件事还成立。没有一份真值能替它作证：比对器不看
 * alpha，而「原版为什么更亮」恰恰是 alpha 通道里的事。
 */
describe('原版离屏缓冲：非预乘 ARGB、从不清屏、默认 SrcOver', () => {
  const panel = javaSource('src/battle/BattlePanel.java')

  it('离屏缓冲是 TYPE_INT_ARGB（非预乘，起始全透明）', () => {
    expect(panel).toContain('bufferedPic=new BufferedImage(WIDTH, HEIGHT,BufferedImage.TYPE_INT_ARGB);')
  })

  it('bufferedGraphics 只被 drawImage 与 setFont 调过 —— 从不清屏', () => {
    const uses = [...panel.matchAll(/bufferedGraphics\.([A-Za-z]+)\s*\(/g)].map((m) => m[1])
    // 正面数出来：一个都没抓到就是正则空转，不是「从不清屏」。
    expect(uses.length).toBeGreaterThan(1)
    expect(new Set(uses)).toEqual(new Set(['drawImage', 'setFont']))
  })

  it('整个原版没有一处改合成规则或清屏（各层拿到的都是同一个 bufferedGraphics）', () => {
    const files = (readdirSync(repoPath('src'), { recursive: true }) as string[]).filter((f) =>
      f.endsWith('.java'),
    )
    // 分母与阳性对照：扫到了文件、而且解码后真读得出 drawImage —— 否则
    // 「一处都没找到」与「文件没读进来」长得一样。
    expect(files.length).toBeGreaterThan(50)
    const text = files.map((f) => javaSource(join('src', f)))
    expect(text.filter((s) => s.includes('drawImage(')).length).toBeGreaterThan(20)
    for (const [i, s] of text.entries()) {
      for (const word of ['setComposite', 'AlphaComposite', 'clearRect']) {
        expect(s.includes(word), `${files[i]} 里有 ${word}`).toBe(false)
      }
    }
  })
})

describe('battle-min 的 404 拍逐拍生成绘制清单', () => {
  /**
   * 回放一遍，每一拍收一次清单。**输入照真值喂，状态一个字段都不喂。**
   *
   * 末拍（t=403）是胜利第一次出现的那一刻。它原先**收不进来** —— 第 22 层
   * 当场抛，归 xl-rh9.13；那张票把它画出来之后，404 拍一拍不落。
   */
  const frames = (() => {
    const trace = readBattleTrace('battle-min')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const out: { t: number; ops: DrawOp[]; world: BattleWorld }[] = []
    for (const tick of trace.ticks) {
      stepBattleWithPaint(world, paint, tick.input)
      out.push({ t: tick.t, ops: battleDrawList(world, paint), world })
    }
    return out
  })()

  it('每一拍都画得出来，没有一拍是空的', () => {
    // ⚠️ **这里不要写 `frames.length === trace.ticks.length`** —— 上面那个
    // 构造循环里既没有 continue 也没有 break，那句话是恒真的（分母从被守的
    // 东西自己推出来，dispatch.md 纪律 3 记的那种误用）。
    //
    // 这一条真正在验的是「一拍都不许抛」：`battleDrawList` 抛的话上面那个
    // IIFE 当场炸，整个 describe 收集失败 —— 失败的样子和通过完全不一样。
    // 「结算那一层只在末拍出现」由下面单独一条正面数出来。
    expect(frames.length, '一帧都没收到 —— 真值空了？').toBeGreaterThan(0)
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
        // 末拍（t=403）胜利第一次出现，这两层同时起来：胜利动画三个人各一张，
        // 结算画面的卷轴与物品框各拉开一格。xl-rh9.13 之前它们是"碰不到"的
        // —— 那一拍当场抛。
        'victory-anim',
        'victory-reminder',
      ].sort(),
    )
    // 反方向：碰不到的那 9 层是**有名有姓**的，不是"剩下的"。**这一场碰不到
    // 不等于画不出来** —— 菜单那几层 xl-rh9.12 已经画出来了、胜利结算
    // xl-rh9.13 画出来了，只是 battle-min 一次菜单都没开；这 9 层里今天真正
    // 画不出来的只剩小精灵（pet，归 xl-rh9.15）。
    // 这一条只跑 battle-min；「所有战斗真值合起来盖到了哪几层」在下面那个
    // describe 里，两者的分母不同。
    const unseen = BATTLE_LAYERS.filter((l) => !seen.has(l))
    expect(unseen.sort()).toEqual(
      [
        'background-anim', // 只有技能才放，这一场全是普攻
        'dead-anim', // 我方没人倒下
        'drug-menu', // 这一场没点过「物」（battle-menus 点了）
        'enemy-state', // 这一场没人挂上状态（battle-menus 敌我各挂过一次）
        'game-over', // 这一场没输
        'hero-state', // 同 enemy-state
        'pet', // 结构性缺席：世界里根本没有这个字段
        'reminder', // 这一场没有提示（battle-menus 触发过两种）
        'skill-menu', // 这一场没点过「技」
      ].sort(),
    )
  })

  it('胜利那一拍画的是结算的第一笔，而且只有那一拍', () => {
    // 这一条与上面那张"碰得到 / 碰不到"的表是配套的：表说 victory-reminder
    // 只在末拍出现，靠的不是"那一拍没生成清单"（末拍的清单就是在胜利之后
    // 生成的），而是这里正面数出来的。
    const withVr = frames.filter((f) => f.ops.some((op) => op.layer === 'victory-reminder'))
    expect(withVr.length, '结算那一层不是恰好只在末拍出现').toBe(1)
    const last = withVr[0]!
    expect(last.t).toBe(frames[frames.length - 1]!.t)
    expect(snapshotBattle(last.world).ui.victory).toBe(true)
    // 卷轴刚拉开一格（`sy2` 20），物品框刚对开一格（`thing_sx1` 60→56，
    // 源矩形 8×10）—— 两个矩形各一条，都还是 1:1。
    const ops = last.ops.filter((op) => op.layer === 'victory-reminder')
    expect(ops.length).toBe(2)
    expect(
      ops.map((op) => (op.kind === 'rect' ? [op.dest.width, op.dest.height, op.src.width, op.src.height] : null)),
    ).toEqual([
      [200, 20, 200, 20],
      [8, 10, 8, 10],
    ])
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

describe('battle-menus：菜单 / 提示图 / 状态图标四层逐帧点名（xl-rh9.12）', () => {
  /**
   * 这四层的判据全在 `battle-menus` 那份真值里 —— 它真的点过「技」与「物」、
   * 真的挂上过敌我两侧的战斗状态。这里回放它，把**跨端逐帧比对会采样到的
   * 那几拍**（`--every 25`）逐条摊开断言。
   *
   * 为什么挑采样点而不是随便挑几拍：这几拍正是像素比对真的会看的那几帧。
   * 断言写在别处的话，"清单对了"与"比对看到的那一帧对了"就分了家。
   */
  const frames = (() => {
    const trace = readBattleTrace('battle-menus')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const out = new Map<number, DrawOp[]>()
    for (const tick of trace.ticks) {
      stepBattleWithPaint(world, paint, tick.input)
      // 末拍是胜利结算（xl-rh9.13），照旧抛 —— 它由下面单独一条钉住。
      if (snapshotBattle(world).ui.victory) break
      out.set(tick.t, battleDrawList(world, paint))
    }
    return out
  })()

  const at = (t: number, layer: LayerName): DrawOp[] => {
    const ops = frames.get(t)
    expect(ops, `第 ${t} 拍没收到清单`).toBeDefined()
    return ops!.filter((op) => op.layer === layer)
  }
  /** 一条绘制指令摊成可比的形状。`rect` 连源矩形一起摊 —— 提示图靠它。 */
  const flat = (op: DrawOp): unknown =>
    op.kind === 'text'
      ? ['text', op.text, op.x, op.y]
      : op.kind === 'image'
        ? ['image', op.id, op.x, op.y]
        : [
            'rect',
            op.id,
            [op.dest.x, op.dest.y, op.dest.width, op.dest.height],
            [op.src.x, op.src.y, op.src.width, op.src.height],
          ]

  it('第 125 拍：药品菜单开着，第一颗按钮待点、六行存货都是 0、金创药的介绍图在', () => {
    // 真值 t=125：buttons=[2,1,1,1,1,1,1]、stock 六个 0、introDrug=0、
    // introY=226、introText="hp 300 mp 0"。
    //
    // **存货那六个 0 不是占位**：`ShopReader.readDrug()` 不给 `numberGOT` 赋值，
    // 新开档六种药一个都没有 —— 正因如此点下去走的是 `reminder.show(19)`
    // 那一路，这条剧本才同时盖住了药品菜单与提示图两层。
    expect(at(125, 'drug-menu').map(flat)).toEqual([
      ['image', 'battle:药品菜单/药品显示框.png', 340, 200],
      ['image', 'battle:药品菜单/药品1按钮2.png', 395, 226],
      ['image', 'battle:药品菜单/药品2按钮1.png', 395, 256],
      ['image', 'battle:药品菜单/药品3按钮1.png', 395, 286],
      ['image', 'battle:药品菜单/药品4按钮1.png', 395, 316],
      ['image', 'battle:药品菜单/药品5按钮1.png', 395, 346],
      ['image', 'battle:药品菜单/药品6按钮1.png', 395, 376],
      // 第七颗是返回，命名规则与前六颗**不同**。
      ['image', 'battle:药品菜单/返回1.png', 395, 406],
      ['text', '0', 575, 246],
      ['text', '0', 575, 276],
      ['text', '0', 575, 306],
      ['text', '0', 575, 336],
      ['text', '0', 575, 366],
      ['text', '0', 575, 396],
      // 介绍图不在 `image/` 下 —— 它是商店那一摊的数据，前缀因此是 `drug:`。
      ['image', 'drug:金创药.png', 220, 226],
      ['text', 'hp 300 mp 0', 230, 246],
    ])
  })

  it('第 275 拍：技能菜单画的是张小凡那组，介绍图却还是文敏的', () => {
    // 真值 t=275：group="zhang"、buttons=[1,2]、returnY=286，而
    // introImage="文敏/2"、introY=256。
    //
    // **这不是抄错了，是原版缺陷的复刻**：`SkillMenu.isDrawIntro` 一旦置真就
    // 再也没人清过它，`introduceImage` 也留着 —— 于是张小凡这一轮的菜单上
    // 挂着文敏上一轮鼠标扫过的那张说明图。改"顺手清一下"会让这一帧对不上。
    expect(at(275, 'skill-menu').map(flat)).toEqual([
      ['image', 'battle:技能菜单/技能显示框.png', 340, 200],
      ['image', 'battle:技能菜单/技能按钮/张小凡/技能1按钮1.png', 395, 226],
      ['image', 'battle:技能菜单/技能按钮/张小凡/技能2按钮2.png', 395, 256],
      // 返回按钮排在最后一颗的下一格 —— 张小凡只有两颗技能，所以是 286。
      ['image', 'battle:技能菜单/技能按钮/返回/返回1.png', 395, 286],
      ['image', 'battle:技能说明/文敏/2.png', 160, 256],
    ])
  })

  it('第 175 拍：文敏那一组三颗，返回按钮跟着往下挪一格', () => {
    // 同一层换一组：文敏 3 颗（SKILL_NUMBER.yu = 3）、返回在 316。
    // 与上一条对着看，"画错组"与"返回按钮算错位置"就分得开了。
    expect(at(175, 'skill-menu').map(flat)).toEqual([
      ['image', 'battle:技能菜单/技能显示框.png', 340, 200],
      ['image', 'battle:技能菜单/技能按钮/文敏/技能1按钮1.png', 395, 226],
      ['image', 'battle:技能菜单/技能按钮/文敏/技能2按钮2.png', 395, 256],
      ['image', 'battle:技能菜单/技能按钮/文敏/技能3按钮1.png', 395, 286],
      ['image', 'battle:技能菜单/技能按钮/返回/返回1.png', 395, 316],
    ])
    // 这一拍 isDrawIntro 还是假的（鼠标刚点进来），所以没有第五条图。
  })

  it('提示图：文件号与 show() 的入参差一，目标矩形每拍朝两边张开', () => {
    // `show(19)`（药品存货不足）画的是 **20.png** —— `loadImage()` 装的是
    // 1..22 而 `show(i)` 取 `images.get(i)`。差一抄反的表现是"提示图换了一张"，
    // 而那 22 张长得都差不多。
    expect(at(125, 'reminder').map(flat)).toEqual([
      ['rect', 'battle:提示图/20.png', [460, 112, 80, 16], [0, 0, 128, 24]],
    ])
    // 另外两种提示：t=200 是 7.png（灵力不够 / 技能相关那一路），
    // t=300 是 2.png。三种都由这条剧本触发，源矩形恒为 (0,0)-(128,24)。
    expect(at(200, 'reminder').map(flat)).toEqual([
      ['rect', 'battle:提示图/7.png', [490, 118, 20, 4], [0, 0, 128, 24]],
    ])
    expect(at(300, 'reminder').map(flat)).toEqual([
      ['rect', 'battle:提示图/2.png', [485, 117, 30, 6], [0, 0, 128, 24]],
    ])
    // **这一层是战斗里唯一真的在缩放的**：目标 80×16 对源 128×24。
    // 采样方式在这里看得见（Java2D 最近邻 / Pixi 默认线性，见 battleRenderer）。
  })

  it('战斗状态图标：我方那一层与怪物那一层各画各的，落点是 set() 写死的', () => {
    // 真值 t=300：文敏挂着 type 1（敏捷提升）在 (800,150)，第 3 槽那只怪
    // 挂着 type 8（体力下降）在 (60,330)。敌我两侧由这一条剧本一起盖住。
    expect(at(300, 'hero-state').map(flat)).toEqual([
      ['image', 'battle:状态/敏捷提升.png', 800, 150],
    ])
    expect(at(300, 'enemy-state').map(flat)).toEqual([
      ['image', 'battle:状态/体力下降.png', 60, 330],
    ])
    // t=200 时怪物那边还没挂上 —— 两层不是同一个开关。
    expect(at(200, 'hero-state').map(flat)).toEqual([
      ['image', 'battle:状态/敏捷提升.png', 800, 150],
    ])
    expect(at(200, 'enemy-state')).toEqual([])
  })

  it('四层的 z 序：药品菜单在控制台之后、技能菜单在行动条之后、状态图标在技能动画之后', () => {
    // 次序是 `BATTLE_LAYERS` 定的，而那份名单由本文件开头那条从 GBK 源码现解
    // 出来对。这里换一个角度再钉一遍：真的画出来的那几拍，相邻层的相对位置。
    const rank = new Map(BATTLE_LAYERS.map((l, i) => [l, i]))
    const seq = (t: number): LayerName[] => {
      const ops = frames.get(t)!
      return [...new Set(ops.map((op) => op.layer))]
    }
    // 第 125 拍：控制台已经收起来了（点「物」那一下），药品菜单排在
    // 状态栏之后、我方走图之前。
    expect(seq(125).filter((l) => ['state-blank', 'drug-menu', 'hero'].includes(l))).toEqual([
      'state-blank',
      'drug-menu',
      'hero',
    ])
    // 第 175 拍：技能菜单夹在行动条与怪物被击之间。
    expect(seq(175).filter((l) => ['progress-bar', 'skill-menu'].includes(l))).toEqual([
      'progress-bar',
      'skill-menu',
    ])
    // 第 300 拍：技能动画 → 我方状态 → 怪物状态 → 提示图，一路递增。
    const order = seq(300).filter((l) =>
      ['skill-anim', 'hero-state', 'enemy-state', 'reminder'].includes(l),
    )
    expect(order).toEqual(['skill-anim', 'hero-state', 'enemy-state', 'reminder'])
    expect(order.map((l) => rank.get(l)!)).toEqual([...order.map((l) => rank.get(l)!)].sort((a, b) => a - b))
  })

  it('末拍不再抛了，画的是胜利结算（xl-rh9.13 合进来之后）', () => {
    // ⚠️ 这条原先断言的是**反面**：末拍抛，且那句话点名 xl-rh9.13。
    // xl-rh9.12 做出来的时候胜利结算确实还没画（那时 .13 还在另一条分支上），
    // xl-rh9.18 把两边合到一起，这一层就有了 —— 判据跟着翻面：末拍**不许抛**，
    // 且真的画出了 victory-reminder。
    //
    // 翻面而不是删掉：这一拍是 battle-menus 唯一一拍走进结算画面的，删了
    // 就没有任何东西盯着"这条剧本的末拍还画不画得出来"。
    const trace = readBattleTrace('battle-menus')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    let last: LayerName[] | null = null
    for (const tick of trace.ticks) {
      stepBattleWithPaint(world, paint, tick.input)
      if (!snapshotBattle(world).ui.victory) continue
      last = [...new Set(battleDrawList(world, paint).map((op) => op.layer))]
      break
    }
    expect(last, 'battle-menus 一拍都没走进胜利 —— 这条判据在空转').not.toBeNull()
    expect(last!, '走进胜利那一拍没画结算画面').toContain('victory-reminder')
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
    // xl-rh9.12 之前这一层只有代码没有判据：battle-menus 是唯一用技能的剧本，
    // 而它在开菜单那一拍就先撞上 drug-menu 抛了，背景动画一帧也没走到。
    'background-anim',
    'command',
    'dead-anim',
    'drug-menu',
    'enemy',
    'enemy-be-attacked',
    'enemy-state',
    'game-over',
    'hero',
    'hero-be-attacked',
    'hero-state',
    'hurt-value',
    'instruct',
    'mouse',
    // xl-rh9.15 之前这一层在 UNCOVERED 里：先是结构性缺席（世界里没有 pet
    // 这个字段），xl-rh9.14 之后是走到就抛。battle-mishu-lu 第 864 拍起画到它。
    'pet',
    'progress-bar',
    'reminder',
    'skill-anim',
    'skill-menu',
    'start-anim',
    'state-blank',
    'victory-anim',
    'victory-reminder',
  ]

  /**
   * 一次都没画到的层，各自写明为什么。**没有第三种。**
   *
   * xl-rh9.15 把小精灵画出来之后这里空了 —— 25 层全部被至少一条真值走到过。
   * **空不等于这张表没用**：上面那条「不许有第三种」拿它当分母，谁新加一层
   * 却不写判据，`unaccounted` 立刻红；而下面「登记说盖不到，实际画到了」
   * 那一支现在恒真，它只在这张表重新长出条目时才有对象。
   */
  const UNCOVERED: Readonly<Record<string, string>> = {}

  /** 每一条真值各跑一遍，收下它画到的层。抛了就停在那一拍（那也是结论）。 */
  const covered = (() => {
    const seen = new Set<LayerName>()
    for (const name of BATTLE_TRACE_NAMES) {
      const trace = readBattleTrace(name)
      const world = replayBattle(trace, spriteSize)
      const paint = createPaintState(world)
      for (const tick of trace.ticks) {
        stepBattleWithPaint(world, paint, tick.input)
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

describe('battle-mishu-lu：第 11 层小精灵与行动条上那一颗（xl-rh9.15）', () => {
  /**
   * 这一层的像素归跨端逐帧比对（`expected.ts` 的 `battle-mishu-lu`，硬比区
   * 44 帧逐像素相等）。这里补的是**那 44 帧看不见、而它一坏就悄悄坏**的三样：
   *
   * 1. **z 序**。小精灵在 (700,396..400)，行动条在 y=50 —— 两层压根不重叠，
   *    所以把 `petOps` 挪到行动条之后，逐帧比对**一个像素都不变**。实测过：
   *    位置差 3 个像素、y 钉死不浮动、不看 `isDraw`、行动条那一颗改看
   *    `pet.isDraw`，四种篡改比对全红，唯独换序是绿的。次序就是 z 序，而
   *    「抄错一层」的表现是某个精灵被别的盖住 —— 这一场看不见，换一场
   *    （小精灵飘到行动条上）就看得见了。
   * 2. **浮动的形状**。`pet.y` 一个字段都不在行为真值里 —— 逐步的 `toEqual`
   *    验不到它。这里不手写坐标（CLAUDE.md 明令禁止手写状态层的期望值，而
   *    这个数没有真值可读），验的是**形状**，见下面那条。
   * 3. **两层各自的开关不是同一个**：本体看 `pet.isDraw`，行动条那一颗看
   *    `bp.pet!=null`。后者的横坐标 `bar.pet` 在真值里，所以对得上真值。
   *
   * 拍号先**从真值里现找**（`anim.skill` 变成哪一发、`bar.pet` 什么时候动），
   * 再把找出来的那个数**签一次**（`expect(summonTick).toBe(855)`）。两步都要：
   * 现找的那一步保证判据的意思跟着真值走，签名的那一步保证真值重导之后
   * **这里会响**而不是悄悄换一组拍号继续绿。
   */
  const PET_BODY = 'battle:小精灵/小精灵.png'
  const PET_HEAD = 'battle:小精灵/头像.png'

  const trace = readBattleTrace('battle-mishu-lu')
  const frames = (() => {
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const out = new Map<number, DrawOp[]>()
    for (const tick of trace.ticks) {
      stepBattleWithPaint(world, paint, tick.input)
      out.set(tick.t, battleDrawList(world, paint))
    }
    return out
  })()
  const at = (t: number, layer: LayerName): DrawOp[] => {
    const ops = frames.get(t)
    expect(ops, `第 ${t} 拍没收到清单`).toBeDefined()
    return ops!.filter((op) => op.layer === layer)
  }
  /** 小精灵本体这一拍画在哪；没画是 null。 */
  const bodyAt = (t: number): [number, number] | null => {
    const ops = at(t, 'pet')
    if (ops.length === 0) return null
    expect(ops.length, `第 ${t} 拍小精灵画了 ${ops.length} 次`).toBe(1)
    const op = ops[0]!
    if (op.kind !== 'image') throw new Error('小精灵那一层只该有 image')
    expect(op.id).toBe(PET_BODY)
    return [op.x, op.y]
  }
  /** 行动条上小精灵那一颗的横坐标（七颗里只挑它）；没画是 null。 */
  const headXAt = (t: number): number | null => {
    const ops = at(t, 'progress-bar').filter((op) => op.kind === 'image' && op.id === PET_HEAD)
    if (ops.length === 0) return null
    expect(ops.length, `第 ${t} 拍小精灵的头像画了 ${ops.length} 次`).toBe(1)
    const op = ops[0]!
    // ⚠️ 这里**不能**写 `op.kind === 'image' ? op.x : null` —— 那个 null 与
    // 「这一拍没画头像」是同一个返回值，而后者正是好几条断言的通过态。
    // 「失败的样子和成功一样」的现成形状（xl-rh9.15 评审收的一条）。
    if (op.kind !== 'image') throw new Error(`第 ${t} 拍头像那一条不是 image`)
    return op.x
  }
  const tickAt = (t: number) => {
    const tick = trace.ticks.find((x) => x.t === t)
    expect(tick, `真值里没有第 ${t} 拍`).toBeDefined()
    return tick!
  }

  /** 秘术动画起的那一拍 —— `heroMishu` 里 `new Pet(bp)` 与 `setSkillAnimation` 同一句话。 */
  const summonTick = trace.ticks.find((x) => x.anim.skill === '陆雪琪秘术')!.t
  /** `bar.pet` 第一次离开初值的那一拍。 */
  const initialBarPet = trace.ticks[0]!.bar.pet
  const barMoveTick = trace.ticks.find((x) => x.bar.pet !== initialBarPet)!.t

  it('召出来那一拍是秘术动画起的那一拍，比 bar.pet 动早 9 拍', () => {
    // ⚠️ **这两个数不是同一件事**，票面原先把它们当成了同一件事。
    // `new Pet(bp)` 在秘术动画起的那一拍（真值第 855 拍，`anim.skill` 变成
    // 「陆雪琪秘术」），而 `bar.pet` 要到第 864 拍才动 —— 中间那 9 拍行动条
    // 是停的（`progressBar.isStop`），小精灵却已经在场上浮动了。
    //
    // 判据由此有了分辨力：把「召出来」写成「bar.pet 动了」，这 9 拍的小精灵
    // 就会整个消失，而跨端比对的采样点是 25 的倍数、这一段一帧都不采
    // （850 与 875 各在两头），**像素比对看不见**。
    expect(summonTick).toBe(855)
    expect(barMoveTick).toBe(864)
    expect(barMoveTick - summonTick).toBe(9)

    // 之前：两层一张图都没有。分母是真值自己的拍数。
    for (const tick of trace.ticks) {
      if (tick.t >= summonTick) break
      expect(bodyAt(tick.t), `第 ${tick.t} 拍不该有小精灵`).toBeNull()
      expect(headXAt(tick.t), `第 ${tick.t} 拍不该有小精灵的头像`).toBeNull()
    }
    // 召出来那一拍起：两层都在，头像的横坐标一直等于真值里的 `bar.pet`
    // ——包括它还没开始动的那 9 拍（恒是初值）。
    for (let t = summonTick; t < barMoveTick; t++) {
      expect(bodyAt(t), `第 ${t} 拍该有小精灵`).not.toBeNull()
      expect(headXAt(t), `第 ${t} 拍头像的 x`).toBe(initialBarPet)
    }
    expect(headXAt(barMoveTick)).toBe(tickAt(barMoveTick).bar.pet)
  })

  it('小精灵出手那一段：本体消失，行动条上那一颗照画', () => {
    // 原版 `Pet.attack()` 把 `isDraw` 关掉（本体让位给技能动画），而
    // `ProgressBar.drawProgressBar` 判的是 `bp.pet!=null` —— 两个判据写成
    // 同一个，那一颗头像会在攻击动画期间闪一下。实测这条篡改在跨端比对里
    // 也红（第 950 帧 924 个像素 @ (717,54)-(752,84)），两处互为旁证。
    //
    // 这一段的两头都从真值里现找：起点是 `anim.skill` 第一次变成
    // 「小精灵攻击」，终点是 `bar.pet` 被打回起跑线那一拍
    // （`checkPetTurn` 收尾的 `progressBar.petX = barX`，与 `isDraw=true`
    // 同一句话）。⚠️ **不能拿「`anim.skill` 还是不是小精灵攻击」当终点**：
    // 原版 `SkillAnimation.set()` 不清名字，那一发放完之后名字还挂着，
    // 一直挂到下一发（真值里是第 960 拍）—— 拿它当终点，第 956..959 这四拍
    // 会被错判成「本体不该画」。
    const attackStart = trace.ticks.find((x) => x.anim.skill === '小精灵攻击')!.t
    expect(attackStart).toBe(935)
    const back = trace.ticks.find((x) => x.t > attackStart && x.bar.pet === initialBarPet)!
    expect(back.t).toBe(956)

    for (let t = attackStart; t < back.t; t++) {
      expect(bodyAt(t), `第 ${t} 拍小精灵在放招，本体不该画`).toBeNull()
      expect(headXAt(t), `第 ${t} 拍头像的 x`).toBe(tickAt(t).bar.pet)
    }
    // 收尾那一拍：本体回来，行动条那一颗回到起跑线。
    expect(bodyAt(back.t), '放完招本体该回来').not.toBeNull()
    expect(headXAt(back.t)).toBe(initialBarPet)
  })

  it('z 序：小精灵夹在怪物走图与行动条之间', () => {
    // 逐帧比对看不见这一条（两层不重叠），所以在这里钉。
    const rank = new Map(BATTLE_LAYERS.map((l, i) => [l, i]))
    const t = summonTick + 20
    const seq = [...new Set(frames.get(t)!.map((op) => op.layer))]
    const three = seq.filter((l) => ['enemy', 'pet', 'progress-bar'].includes(l))
    expect(three).toEqual(['enemy', 'pet', 'progress-bar'])
    // ⚠️ 这里原先还跟着一句「这三层的 `rank` 是递增的」。它接近恒真：
    // 上一行已经把次序钉死，而 `rank` 来自 `BATTLE_LAYERS`，那份名单另有
    // 一组判据从 `BattlePanel.java` 解出来对。换成两句真的在说话的
    // （xl-rh9.15 评审收的一条）。
    expect(rank.get('pet')!).toBeGreaterThan(rank.get('enemy')!)
    expect(rank.get('pet')!).toBeLessThan(rank.get('progress-bar')!)
  })

  it('浮动的形状：x 恒定，y 是「−1 四拍、平一拍、+1 四拍」，周期 9', () => {
    /**
     * 形状的**来历与那句错注释的账**写在 `battle/step.ts` 的 `updatePet` 上，
     * 只有那一份；这里是把它钉成判据的地方。一句话：原版三个 `if` 是并列的，
     * `code==4` 那一拍一上一下净位移 0，于是一轮 **9 拍**而不是注释说的十拍。
     *
     * 这个形状**一个字都不在行为真值里**（`snapshotState` 没取 `bp.pet`），
     * 所以它只能在这里钉。y 钉死不浮动的篡改在这里立刻红。
     */
    const PERIOD = 9
    const ONE_CYCLE = [-1, -1, -1, -1, 0, 1, 1, 1, 1]
    // 从召出来那一拍起连着取四轮多一点，中途不许断（断了说明本体没画，
    // 那是另一条判据的事，这里要的是连续的一段）。
    const span = PERIOD * 4 + 1
    const ys: number[] = []
    let x: number | null = null
    for (let t = summonTick; t < summonTick + span; t++) {
      const body = bodyAt(t)
      expect(body, `第 ${t} 拍本体断了，这一段该是连着的`).not.toBeNull()
      if (x === null) x = body![0]
      expect(body![0], '小精灵的 x 不该变').toBe(x)
      ys.push(body![1])
    }
    const deltas = ys.slice(1).map((y, i) => y - ys[i]!)
    expect(deltas.length).toBe(PERIOD * 4)
    // 四轮逐轮相等，且每一轮就是上面那九个数。
    for (let k = 0; k < 4; k++) {
      expect(deltas.slice(k * PERIOD, (k + 1) * PERIOD), `第 ${k + 1} 轮`).toEqual(ONE_CYCLE)
    }
    // 一轮净位移 0：召出来那一拍的 y 与九拍之后相等，四轮都回得来。
    for (let k = 0; k <= 4; k++) expect(ys[k * PERIOD]).toBe(ys[0])
    // 振幅 4（−1 走了四拍），不是注释说的 5。
    expect(ys[0]! - Math.min(...ys)).toBe(4)
  })
})

describe('哪条剧本在末拍之前抛，与它的表态对得上（xl-rh9.11）', () => {
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
      stepBattleWithPaint(world, paint, tick.input)
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

  it('表 unpainted 的就是这一条 —— 这是一份登记，不是自动推导', () => {
    // **两头都会红**：谁新表一条 unpainted，这一行红；谁把最后一层画出来了
    // 却没改表，也红。写成 `filter` 现扫出来的就是对的，这两件事都不会响
    // （纪律 3 那条误用的形状）。
    //
    // 历史：xl-rh9.12 之前有一批 unpainted，四层画出来之后一条都不剩，这里
    // 曾经签的是一个空数组。xl-rh9.14 又添了六条，xl-rh9.18 把其中五条换成
    // 真量出来的 gap，最后一条 `battle-mishu-lu` 撞第 11 层小精灵 ——
    // xl-rh9.15 把它画出来了，于是这里**第二次**签回空数组。
    //
    // ⚠️ 空数组这一侧是真的会红的那一侧：下面 `for (const a of attempts)`
    // 里每条剧本都走 else 那一支「不许在末拍之前抛」，一条剧本抛了却没表
    // unpainted 就红。反过来"这份登记恒真"要靠有人新表 unpainted 才有对象。
    const unpainted = attempts.filter((a) => expectationOf(a.name).status === 'unpainted')
    expect(
      unpainted.map((a) => a.name),
      '表 unpainted 的剧本变了？改这份登记，下面那一支会跟着验它',
    ).toEqual([])
  })

  it('这些剧本撞上的层，正是登记在案还没画的那几层', () => {
    // ⚠️ 这条原先写的是 `hit.size > 1`（"合起来不止一层，否则点名对不对只
    // 验了一层"）。xl-rh9.12 / .13 把那几层都画出来之后**只剩小精灵一层**，
    // 那个下界就永远够不着了 —— 而"够不着的检查"和"没有检查"是两回事：它是
    // 恒红。恒红的判据会被人调宽或删掉，那才是真的失去分辨力。
    //
    // 换成对撞一份**手写的**未实现层名单：多撞一层红（有别的东西炸了），
    // 少撞一层也红（那一层画出来了，表该改了）。分辨力从"不止一层"换成了
    // "恰好是这几层"，比原先还硬。
    //
    // xl-rh9.15 之后这份名单是空的（25 层一层不缺），于是这一条只剩"多撞
    // 一层红"那半边 —— 而那半边现在也够不着，因为上面那条已经钉死了没有
    // 剧本表 unpainted、这个循环一次都进不去。**它是留着的脚手架**：再有
    // 一层画不出来时，往这里签一个名字，它立刻恢复双向。
    const UNIMPLEMENTED_LAYERS: string[] = []
    const hit = new Set<string>()
    for (const a of attempts) {
      if (expectationOf(a.name).status !== 'unpainted') continue
      // 报错那句话的开头是「第 n 层「<层名>」…」，把层名摘出来。
      for (const m of a.messages) {
        const layer = /第 \d+ 层「([a-z-]+)」/.exec(m)?.[1]
        expect(layer, `这句报错认不出是哪一层：${m}`).toBeDefined()
        hit.add(layer!)
      }
    }
    expect([...hit].sort()).toEqual([...UNIMPLEMENTED_LAYERS].sort())
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
        // 分母：这一条剧本到底撞上了几层。至少一层 —— 上面那句「每一句都点名」
        // 在零句上是恒真的。
        //
        // ⚠️ **这里不能要求「不止一层」**（xl-rh9.14 撞到过）：撞几层是剧本的
        // 性质，不是判据的。`battle-menus` 在末拍之前撞三层（药品菜单 @88、
        // 技能菜单 @168、我方状态图标 @198），而三条秘术剧本各只撞一层 ——
        // 它们根本不开菜单。"合起来不止一层"那件事由下面那条整体的判据管。
        expect(a.messages.length, `${a.name} 一句都没抛？`).toBeGreaterThan(0)
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
