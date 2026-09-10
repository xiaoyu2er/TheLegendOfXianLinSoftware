import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'

/**
 * **读档之后的残留，原版那一半**（xl-i06.11）—— 从 GBK 源码现读。
 *
 * 会话层那一半（`game/loadResidue.test.ts`）证明的是「我们的会话这么做」；原版这么做，
 * 只能靠这里。两半各缺一半都是自己给自己签字。
 *
 * 每一条的读数都先在真 JVM 上跑过一次（2026-09-10，openjdk 17，探针直接调
 * `Loader.load` / `ScenePanel.initiation` / `LoadAndSavePanel.setButton`），读数抄在
 * `game/loadResidue.test.ts` 各条的注释里；这里钉的是**产生那个读数的那几句代码还在**。
 *
 * 每个选择器都配一个**反面样本**：把源码改成「会重置 / 会清 / 会压」的样子喂同一个选择器，
 * 它必须认得出来。否则「选择器抓不到」与「源码里真没有」长得一样（`fakes/originalNewGame.test.ts`
 * 的同一条规矩）。
 */

/** 从 `header` 那一行起配对花括号取方法体（同 `fakes/originalNewGame.test.ts`）。 */
function methodBody(source: string, header: string): string {
  const start = source.indexOf(header)
  expect(start, `找不到 ${header}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${header} 的花括号没配上`)
}

/** 源码里对 `field` 的每一处赋值（`=` 但不是 `==`），带着它前面那一小段。 */
function assignments(source: string, field: string): string[] {
  return [...source.matchAll(new RegExp(`\\b${field}\\s*=(?!=)[^;]*;`, 'g'))].map((m) => m[0].replace(/\s+/g, ''))
}

describe('skillNumber 只抬不压（xl-i06.13 的那条残留）', () => {
  /**
   * `intialFromInfo()` 里对 `skillNumber` 的写法：三句**并列的** `if(level>=N) skillNumber=M;`，
   * 没有 `else`，也没有一句把它往下写。于是读一个低级档之前已经抬过的话，读档之后留着高的。
   *
   * JVM 读数：读 存档0（11/10/11 级）→ 5/5/5；接着读 存档1（1/1/3 级）→ **5/5/3**。
   * 张小凡与陆雪琪 1 级，三个 if 一个都不成立，留着 5。
   *
   * 这一条 web 端**没有落点**（`fakes/party.ts` 不记技能格数），挂在 `state/traceReplay.test.ts`
   * 的 PENDING → xl-i06.13。所以这里只有原版一半；落点做出来时，会话层那一半要跟上。
   */
  const guards = (body: string) =>
    [...body.matchAll(/(else\s*)?if\s*\(\s*level\s*>=\s*(\d+)\s*\)\s*\{?\s*skillNumber\s*=\s*(\d+)\s*;/g)].map((m) => ({
      chained: m[1] !== undefined,
      level: Number(m[2]),
      value: Number(m[3]),
    }))

  /** 只抬不压：每一句都是并列的 `if(level>=N)`，被写的值随门槛递增，且不存在别的写法。 */
  function onlyRaises(body: string): string[] {
    const problems: string[] = []
    const found = guards(body)
    const all = assignments(body, 'skillNumber')
    if (found.length === 0) problems.push('一句 if(level>=N) skillNumber=M 都没找到')
    if (all.length !== found.length) problems.push(`skillNumber 的赋值 ${all.length} 处，带 level 门槛的只有 ${found.length} 处：${all.join(' ')}`)
    for (const g of found) if (g.chained) problems.push(`level>=${g.level} 那句挂在 else 上`)
    for (let i = 1; i < found.length; i++) {
      if (!(found[i]!.level > found[i - 1]!.level && found[i]!.value > found[i - 1]!.value)) problems.push('门槛或值不是递增的')
    }
    if (/else\s*\{?\s*skillNumber/.test(body)) problems.push('有一支 else 在写 skillNumber')
    return problems
  }

  it.each(['ZhangXiaoFan', 'LuXueQi', 'YuJie'])('%s.intialFromInfo()：三句并列的 if，只往上抬', (cls) => {
    const body = methodBody(javaSource(`src/battle/${cls}.java`), 'public void intialFromInfo(){')
    expect(guards(body).map((g) => [g.level, g.value])).toEqual([
      [2, 3],
      [5, 4],
      [10, 5],
    ])
    expect(onlyRaises(body)).toEqual([])
  })

  it('反面样本：多一支把它压回去的 else，选择器认得出来', () => {
    const body = methodBody(javaSource('src/battle/ZhangXiaoFan.java'), 'public void intialFromInfo(){')
    const lowered = body.replace(/if\s*\(\s*level\s*>=\s*2\s*\)\s*\{\s*skillNumber\s*=\s*3\s*;\s*\}/, 'if(level>=2){skillNumber=3;}else{skillNumber=2;}')
    expect(lowered).not.toBe(body)
    expect(onlyRaises(lowered)).not.toEqual([])
  })
})

describe('Loader.load 不碰任何一块面板 —— 菜单、战斗面板原样活过读档', () => {
  /**
   * `Loader.load` 只**调方法**（`loadRoleInfo` / `loadSceneInfo` / `initialEquipInfo` /
   * `initialShopInfo` / `initialEquipmentShopInfo`）加末三行写 `SaveAndLoad.zhang/lu/wen`，
   * 不给 `GameLauncher` 的任何一个字段赋值。于是菜单（药品页、法术页、当前在哪一页）与战斗
   * 面板都是读档前那一份。JVM 读数：`GameLauncher.menuPanel` 读档前后同一个对象（探针的
   * `heroEquipment` 那一栏正是从它身上读出来的，读档后仍是读档前的值）。
   */
  const body = () => methodBody(javaSource('src/start/Loader.java'), 'public void load(int textcode) {')
  const panelWrites = (b: string) => [...b.matchAll(/GameLauncher\.\w+\s*=(?!=)/g)].map((m) => m[0])
  const staticWrites = (b: string) => [...b.matchAll(/\b([A-Z]\w*)\.(\w+)\s*=(?!=)/g)].map((m) => `${m[1]}.${m[2]}`)

  it('只调方法：五个回填调用都在，GameLauncher 的字段一个都没被赋值', () => {
    const b = body()
    // 先证明取到的是那段体：五个回填调用一个不少。
    for (const call of ['loadRoleInfo', 'loadSceneInfo', 'initialEquipInfo', 'initialShopInfo', 'initialEquipmentShopInfo']) {
      expect(b).toContain(`.${call}(`)
    }
    expect(panelWrites(b)).toEqual([])
    // 它唯一写的 static 是队伍那三个开关。
    expect(staticWrites(b)).toEqual(['SaveAndLoad.zhang', 'SaveAndLoad.lu', 'SaveAndLoad.wen'])
  })

  it('反面样本：多一句重建菜单，选择器认得出来', () => {
    const b = body().replace('GameLauncher.zhangXiaoFan.loadRoleInfo', 'GameLauncher.menuPanel = null; GameLauncher.zhangXiaoFan.loadRoleInfo')
    expect(panelWrites(b)).toEqual(['GameLauncher.menuPanel ='])
  })
})

describe('菜单装备页 heroEquipment 读档不刷新', () => {
  /**
   * `EquipPanel.initialEquipInfo` 把三个人的六格换成存档里的，但**不碰 `heroEquipment`**
   * （「当前槽位上穿着的那件」，装备页右边那张图与「弃用」按钮看它）。于是读档之后打开装备页，
   * 那一格画的还是读档前那件，直到换人或换槽位。
   *
   * JVM 读数：读 存档0 之后 `currentPack.weapon = 千月星痕`，`heroEquipment = 月苗刀`（读档前那件）。
   */
  const src = () => javaSource('src/menu/EquipPanel.java')

  it('initialEquipInfo 里对 heroEquipment 一处赋值都没有', () => {
    const b = methodBody(src(), 'public void initialEquipInfo(ArrayList<String> equipInfo){')
    // 先证明取到的是那段体：六格都写了。
    for (const slot of ['weapon', 'armor', 'helmet', 'shoe', 'glove', 'decoration']) expect(assignments(b, `ep\\.${slot}`).length).toBeGreaterThan(0)
    expect(assignments(b, 'heroEquipment')).toEqual([])
  })

  // 6 = 那段六个 `else if` 各写一次（冻结的原版源码现读出来的数，不是分母）。
  it('对照：同一个选择器在换槽位那段（judgeCurrentPack）里一抓一个准', () => {
    const b = methodBody(src(), 'private void judgeCurrentPack() {')
    expect(assignments(b, 'heroEquipment').length).toBe(6)
  })
})

describe('读档标志 isLoad：置真一处、清零一处，清零只在「无对话编号」那一支（xl-1dv.33）', () => {
  /** `src/` 下所有 `.java` 的仓库相对路径 —— 分母现扫，不手列。 */
  function javaFiles(): string[] {
    const walk = (dir: string): string[] =>
      readdirSync(repoPath(dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.java') ? [`${dir}/${e.name}`] : [],
      )
    return walk('src').sort()
  }

  /** `src/` 下对 `isLoad` 的每一处赋值，带文件名。 */
  function isLoadWrites(): string[] {
    const files = javaFiles()
    // 分母先自证：扫空了目录与「真的只有两处」长得一样。
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('src/scene/SaveAndLoad.java')
    return files.flatMap((f) => assignments(javaSource(f), 'isLoad').map((a) => `${f.split('/').at(-1)}: ${a}`))
  }

  it('全仓只有两处写它：loadSceneInfo 置真、initiation 的 else-if 那支清零 —— 「起」不清', () => {
    // 选择器从 `isLoad` 起取，`sal.` 前缀不在里面；哪个文件由前缀说。
    expect(isLoadWrites()).toEqual(['SaveAndLoad.java: isLoad=true;', 'ScenePanel.java: isLoad=false;'])
  })

  it('initiation 的对话事件三支：有编号新建（不清）、无编号且 isLoad 新建并清、否则沿用', () => {
    const b = methodBody(javaSource('src/scene/ScenePanel.java'), 'public void initiation(String fileName) {')
    const compact = b.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '')
    // 第三支（沿用）就是「没有 else」：紧跟在 else-if 之后的是旁白，不是又一个 else。
    expect(compact).toContain(
      'if(reader.getDialogueCode()!=null){dialogueEvent=newDialogueEvent(this,reader.getDialogueCode(),reader.getDialogue());}' +
        'elseif(sal.isLoad){dialogueEvent=newDialogueEvent(this,reader.getDialogueCode(),reader.getDialogue());sal.isLoad=false;}' +
        'narratage=newNarratage(',
    )
  })

  it('DialogueEvent 在编号为 null 时 dialogueEventOver = true（读档后第一个无编号场景拿到的就是它）', () => {
    const b = methodBody(javaSource('src/scene/DialogueEvent.java'), 'public DialogueEvent(ScenePanel scene, ArrayList<String> dialogueCode,')
    expect(b.replace(/\s+/g, '')).toContain('if(dialogueCode==null){dialogueEventOver=true;}')
  })
})

describe('「起」（StartPanel case 0）一样都不清 —— 读档读回来的带进新局', () => {
  /**
   * `startLoadAction()` 的 case 0 只做 `switchTo("scene")`、停两个载入动画、
   * `initiation("脚本1.txt")`、起一条场景线程。钱、药、装备库存、身上的装备、答题记录、
   * 三个人的等级、剧情三元组一句都不碰（`Game.game.init()` 那句被注释掉，见 xl-lly）。
   *
   * JVM 读数（探针：读 存档0 → 再 initiation("脚本1.txt")，即 case 0 的状态部分）：
   * 等级 11/10/11、钱 59868、药 32/18/15/10/16/2、装备库存（探针预先写的 ×7）、身上的装备、
   * 答题记录（探针预先写的一条）**全部原样**；场景换成脚本1，但 `currentScript` 仍是
   * 存档0 的 `43/42 比武第二阶段 脚本38.txt`，`isLoad` 仍为 true。
   */
  it('case 0 那一段里没有一个名字碰上面那几样', () => {
    // 从 `startLoadAction()` 里取 —— 文件里更靠前还有一个 `case 0:`（卷轴动画那个 switch）。
    const src = methodBody(javaSource('src/start/StartPanel.java'), 'private void startLoadAction() {')
    const start = src.indexOf('case 0:')
    const end = src.indexOf('case 1:', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)
    // 先证明取到的是那一段：它确实做了「进脚本1」这件事。
    expect(block).toContain('initiation("脚本1.txt")')
    expect(block).toContain('switchTo("scene")')
    const touched = (b: string) => {
      const live = b
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n')
      return ['Money', 'DrugPack', 'EquipmentPack', 'SelectEvent', 'answeredRecorder', 'equipPanel', 'level', 'currentScript', 'isLoad', 'init()'].filter(
        (name) => live.includes(name),
      )
    }
    expect(touched(block)).toEqual([])
    // 反面样本：把被注释掉的那句 `Game.game.init();` 放活，同一个过滤器必须认得出来。
    const revived = block.replace(/\/\/\s*Game\.game\.init\(\);/, 'Game.game.init();')
    expect(revived).not.toBe(block)
    expect(touched(revived)).toEqual(['init()'])
  })
})

describe('那条不复刻的例外：中途读档多起一条场景循环', () => {
  /**
   * JVM 读数（探针：真 `LoadAndSavePanel`，反射调 `setButton()`，`step()` 按次数计）：
   *
   * | 时刻                     | 场景线程 | step() / 秒 |
   * |--------------------------|----------|-------------|
   * | 「起」之后               | 1        | 85.5        |
   * | 中途读档（第 1 次）之后  | **2**    | **169.5**   |
   * | 中途读档（第 2 次）之后  | 2        | 169.5（**没抛**） |
   * | 第 3 次（换槽）之后      | 2        | 169.0       |
   * | 回标题 → 再「起」之后    | **3**    | **254.5**   |
   *
   * 所以「第二次读档抛异常」不成立（xl-1dv.28 读源码的结论，这里跑出来了）；成立的是双倍速，
   * 以及**不经过读档的另一个入口**：每「起」一次多一条。
   */
  it('t 是面板构造时建的那一条，读档分支 isAlive 挡着；场景主循环 while(true) 没有出口', () => {
    const ls = javaSource('src/start/LoadAndSavePanel.java')
    expect(ls).toMatch(/Thread\s+t\s*=\s*new\s+Thread\(GameLauncher\.scenePanel\)\s*;/)
    expect(ls.replace(/\s+/g, '')).toContain('loader.load(i);if(!t.isAlive())t.start();GameLauncher.switchTo("scene");')
    const run = methodBody(javaSource('src/scene/ScenePanel.java'), 'public void run() {')
    const exits = /\bbreak\b|\breturn\b|\bthrow\b/
    expect(run).toMatch(/while\s*\(\s*true\s*\)/)
    expect(run).not.toMatch(exits)
    // 反面样本：循环体里多一句 break，同一个选择器认得出来。
    expect(run.replace('step();', 'step(); break;')).toMatch(exits)
    // 「起」每次都 new 一条（不经过读档的那个入口）。
    const start = javaSource('src/start/StartPanel.java')
    expect(start.replace(/\s+/g, '')).toContain('Threadt=newThread(GameLauncher.scenePanel);GameLauncher.scenePanel.initiation("脚本1.txt");t.start();')
  })
})
