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
   * 会抛，归 xl-rh9.13（**画**那一层；状态层归 xl-rh9.5，已做完）。
   * 它由下面单独一条用例正面钉住，不是被跳过。
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
    // 反方向：碰不到的那 11 层是**有名有姓**的，不是"剩下的"。**这一场碰不到
    // 不等于画不出来** —— 菜单那几层 xl-rh9.12 已经画出来了，只是 battle-min
    // 一次菜单都没开；今天真正画不出来的只剩胜利结算（xl-rh9.13）。
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
        'victory-anim', // 胜利动画与胜利结算同一拍开始，而那一拍收不进来
        'victory-reminder', // 画不出来，归 xl-rh9.13；这一场只在末拍出现
      ].sort(),
    )
  })

  it('胜利那一拍真的会抛，并点名 xl-rh9.13', () => {
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
    // xl-rh9.5 把**状态层**那一整段做完了（发经验 / 物品 / 钱 / 升级 / 回地图），
    // **画**出来是另一回事，归 xl-rh9.13。这一层还没有，所以照旧要抛。
    expect(threw, '胜利那一拍没有抛 —— 那说明结算那一层被静默跳过了').toMatch(/xl-rh9\.13/)
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
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
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

  it('末拍照旧抛，点名 xl-rh9.13 —— 这四层画出来了，胜利结算还没有', () => {
    const trace = readBattleTrace('battle-menus')
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
    expect(threw, 'battle-menus 的末拍没有抛 —— 胜利结算被静默跳过了').toMatch(/xl-rh9\.13/)
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
    'progress-bar',
    'reminder',
    'skill-anim',
    'skill-menu',
    'start-anim',
    'state-blank',
  ]

  /** 一次都没画到的层，各自写明为什么。**没有第三种。** */
  const UNCOVERED: Readonly<Record<string, string>> = {
    'victory-anim': '与胜利结算同一拍开始，而那一拍先被 victory-reminder 拦下来抛（xl-rh9.13）',
    pet: '结构性缺席：世界里根本没有 pet 字段，只有陆雪琪的秘术召得出来',
    'victory-reminder': '胜利结算画面归 xl-rh9.13 —— 这一层抛（状态层已由 xl-rh9.5 做完）',
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

  it('今天一条战斗剧本都不表 unpainted —— 这是一份登记，不是自动推导', () => {
    // xl-rh9.12 之前这里要求「至少有一条」，理由是没有的话下面 unpainted 那
    // 一支就是空转的。四层画出来之后 `battle-menus` 换成了真量出来的 gap，
    // 于是**一条都没有了** —— 而 unpainted 那一支现在确实是空转的。
    //
    // 把这条改成签一个 0，是为了让"空转"这件事**自己会响**：谁哪天再表一条
    // unpainted（比如 xl-rh9.13 之前有人给胜利结算配一条只到末拍之外的剧本），
    // 这一行立刻红，他得回来把这句话改掉，顺带就读到了下面那两支各自要求
    // 什么。留着 `toBeGreaterThan(0)` 反而是恒红，留空则是恒绿。
    //
    // **另一支不是空转的**：下面按剧本各生成一条 `it`，每一条都在跑「不许在
    // 末拍之前抛，且末拍真的抛了」。原先这里还跟着一条"剩下的每一条都真的
    // 比得成"，那条是**恒真**的：`attempts` 就是 `BATTLE_TRACE_NAMES.map` 出来
    // 的，减掉一个已经断言为空的子集，长度当然还是原来那个。删了。
    const unpainted = attempts.filter((a) => expectationOf(a.name).status === 'unpainted')
    expect(
      unpainted.map((a) => a.name),
      '有剧本表 unpainted 了？把这条登记改掉，下面那一支会开始验它',
    ).toEqual([])
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
