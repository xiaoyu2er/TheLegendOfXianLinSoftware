import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { DEFAULT_TOLERANCE, diffImage, frameDiff, summarize } from '../src/compare/diff'
import type { FrameResult, SequenceResult } from '../src/compare/diff'
import { expectationOf, scriptNames } from '../src/compare/expected'
import type { Expectation } from '../src/compare/expected'
import { checkStanding, unassembledLine } from '../src/compare/unassembled'
import type { DriverStanding } from '../src/compare/unassembled'
import { IMPLEMENTED_DRIVERS } from '../src/replay/implemented'
import { decodePng, encodePng } from '../src/compare/png'
import { judgeRegions, partitionedDiff } from '../src/compare/regions'
import type { PartitionedFrame, RegionVerdict } from '../src/compare/regions'
import { repoPath } from '../src/test/repoPath'
import { judgeWhole } from '../src/compare/verdict'
import { launch } from './cdp'
import type { Browser } from './cdp'

/**
 * 跨端逐帧比对（xl-9bd.8）的 Web 侧 + 报告生成。
 *
 * 前一半由 `tools/compare-frames.sh` 做完：原版跑一遍剧本，把它**真的画出来的**
 * 那张 1024×640 位图每 n 个 tick 存一张 PNG，外加一份帧清单。这里读那份清单，
 * 在真浏览器里回放同一份剧本、在同一组 tick 上截同样多的图，逐帧算差异。
 *
 * 判据见 `src/compare/diff.ts`（为什么不是哈希），预期见 `src/compare/expected.ts`
 * （为什么"现在必然红"不等于"这条流水线没用"）。
 */

const STAGE_WIDTH = 1024
const STAGE_HEIGHT = 640

interface Manifest {
  readonly format: string
  /** 驱动器判别名（xl-1vu.2）。由导出侧写进 frames.json，比对侧照它判能不能比。 */
  readonly driver: string
  readonly script: string
  readonly scene: string
  readonly tickMs: number
  readonly width: number
  readonly height: number
  readonly every: number
  readonly tickCount: number
  readonly ticks: readonly number[]
}

interface ScriptReport {
  readonly name: string
  readonly expectation: Expectation
  readonly sequence: SequenceResult
  readonly ok: boolean
  readonly verdict: string
  /** 只有分区表态的剧本有：硬比区 / 每个缺口区各自的账。 */
  readonly regions?: RegionVerdict | undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const threshold = numberFlag(argv, '--threshold', 0.0002)
  const tolerance = numberFlag(argv, '--tolerance', DEFAULT_TOLERANCE)
  const skipCapture = argv.includes('--skip-capture')
  const selfCheck = argv.includes('--self-check')
  const names = argv.filter((a) => !a.startsWith('--') && !isFlagValue(argv, a))
  const wanted = names.length > 0 ? names : scriptNames()

  const root = repoPath('tools/traces/compare')
  const manifests = wanted.map((name) => readManifest(root, name))

  // 先分流：哪几条 web 侧根本装配不出来（xl-1vu.7）。这一步必须在开浏览器
  // **之前**做完 —— 一条一条撞上去的话，撞到第一条就整轮中断，后面那些能比的
  // 剧本一帧都比不成，`--self-check` 也跟着不跑。实测过：默认全跑时第一条按
  // 字典序是 battle-em3-box，整条流水线就停在那里。
  //
  // `checkStanding` 是双向的：表说比得了而页面装不出、页面装得出而表还写着
  // unassembled，两种都当场抛。见 `src/compare/unassembled.ts`。
  const standings = manifests.map((m) => checkStanding(m.script, m.driver))
  const blocked = standings.filter((s) => !s.implemented)
  const comparable = manifests.filter((m) => !blocked.some((s) => s.script === m.script))

  if (!skipCapture && comparable.length > 0) await capture(root, comparable, 'web', null)

  const reports = comparable.map((m) => compareOne(root, m, threshold, tolerance))
  report(reports, blocked, threshold, tolerance)

  const selfCheckOk = selfCheck ? await runSelfCheck(root, comparable, tolerance) : true
  const failed = reports.filter((r) => !r.ok)
  writeFileSync(
    join(root, 'report.json'),
    `${JSON.stringify(
      {
        format: 'xianlin-compare/1',
        threshold,
        tolerance,
        scripts: reports.length,
        frames: reports.reduce((n, r) => n + r.sequence.frames, 0),
        failed: failed.map((r) => r.name),
        // 装配不出来的那几条也要进报告：只记 failed 的话，一份机器可读的报告
        // 会显示"0 条失败"，而实际上有三条一帧都没比过。
        unassembled: blocked.map((s) => ({
          name: s.script,
          driver: s.driver,
          why: s.expectation.why ?? null,
          issue: s.expectation.issue ?? null,
        })),
        reports,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  process.exit(failed.length === 0 && selfCheckOk && blocked.length === 0 ? 0 : 1)
}

// ================= 取图 =================

async function capture(
  root: string,
  manifests: readonly Manifest[],
  side: string,
  brk: { fromTick: number; heroDx: number } | null,
): Promise<void> {
  const server = await createServer({ logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('vite dev server 没报出它的地址')

  let browser: Browser | null = null
  try {
    browser = await launch(`${url}replay.html`)
    await waitForPage(browser)
    await assertPageAgrees(browser)
    for (const m of manifests) {
      const dir = join(root, m.script, side)
      resetDir(dir)
      // trace 读的是本次导出的那一份（就在 java/ 旁边），不是入库的那份：
      // 帧与 trace 必须来自同一次运行。shell 那一步已经把它与入库真值 cmp 过。
      const trace = readFileSync(join(root, m.script, 'java', 'trace.json'), 'utf8')
      await browser.evaluate(
        `window.__xlBreak = ${brk === null ? 'undefined' : JSON.stringify(brk)}`,
      )
      const loaded = await browser.evaluate<{ scene: string; tickCount: number }>(
        `window.__xlReplay.load(${JSON.stringify(slimTrace(trace))})`,
      )
      // 两端跑的必须是同一份剧本的同样长度。对不上就不是"差异大"，是接错了。
      if (loaded.tickCount !== m.tickCount) {
        throw new Error(
          `${m.script}：清单说 ${m.tickCount} 个 tick，Web 侧装载到 ${loaded.tickCount} 个`,
        )
      }
      for (const t of m.ticks) {
        await browser.evaluate(`window.__xlReplay.seek(${t})`)
        const png = await browser.screenshot(STAGE_WIDTH, STAGE_HEIGHT)
        writeFileSync(join(dir, frameName(t)), png)
      }
      process.stdout.write(
        `  取图 ${m.script}：${m.ticks.length} 帧${brk === null ? '' : `（第 ${brk.fromTick} tick 起故意改坏渲染）`}\n`,
      )
    }
  } finally {
    if (browser) await browser.close()
    await server.close()
  }
}

/**
 * 只把回放真正要用的字段送进浏览器：剧本头、tick 号、那一 tick 的按键。
 * 整份 trace 里对话与旁白的逐字游标占了绝大部分体积（dorm-intro 3.4 MB），
 * 而取图页一个状态字段都不读 —— 对话与旁白都由它自己推进（xl-9bd.10 /
 * xl-9bd.11，口子在 xl-4rx 关上）。
 */
function slimTrace(json: string): string {
  const trace = JSON.parse(json) as {
    driver: string
    script: { name: string; scene: string; tickMs: number; isScript: boolean }
    tickCount: number
    ticks: {
      t: number
      input: unknown[]
    }[]
  }
  return JSON.stringify({
    // 驱动器判别名要透传（xl-1vu.2）：取图页照它挑装配，收不到就没法挑，
    // 而"挑不出来"是硬失败 —— 这里悄悄丢掉它，表现是每条剧本都装不起来。
    driver: trace.driver,
    script: trace.script,
    tickCount: trace.tickCount,
    // 状态字段**一个都不传**：NPC 的坐标（xl-9bd.9）、对话的逐字游标
    // （xl-9bd.10）、旁白的整个状态机（xl-9bd.11）都由取图页自己推进，喂真值
    // 等于把两端的分歧提前抹平。`ScenePanel.step()` 那几道门也一样：两边各自
    // 留的临时口子在 xl-4rx 一起关掉了。
    // `script` 整个回显，取图页要从里面读 `isScript`——它决定进场放不放旁白。
    ticks: trace.ticks.map((tick) => ({
      t: tick.t,
      input: tick.input,
    })),
  })
}

async function waitForPage(browser: Browser): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const state = await browser.evaluate<{ ready: boolean; error: string | null }>(
      '({ ready: !!window.__xlReplay, error: window.__xlReplayError ?? null })',
    )
    if (state.error) throw new Error(`取图页起不来：${state.error}`)
    if (state.ready) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('60 秒内取图页没有装上 __xlReplay')
}

/**
 * 核一次：取图页运行时**真的**装配得出来的那几个驱动器，与本进程读的那份
 * 名单（`src/replay/implemented.ts`）是不是同一批。
 *
 * 为什么要核。分流是在开浏览器之前做的，靠的是那个数组；而真正决定"装不装得
 * 出来"的是页面里的 `ASSEMBLIES`。两者由类型钉着（`Record<ImplementedDriver,
 * Assembly>`），可类型只管编译期 —— 真出现分家时，表现是比对器把一条页面其实
 * 装得出来的剧本当成"比不了"跳过，或者反过来，撞上一个装不出来的驱动器。
 * 前者安安静静地少比一条，正是这条流水线最不能有的失败形状。
 */
async function assertPageAgrees(browser: Browser): Promise<void> {
  const page = await browser.evaluate<string[] | null>('window.__xlDrivers ?? null')
  if (!Array.isArray(page) || page.length === 0) {
    throw new Error(
      `取图页没有报出它的装配名单（window.__xlDrivers = ${JSON.stringify(page)}）。` +
        `报不出来就没法核 —— 这一条不许降级成"那就信本地这份名单"。`,
    )
  }
  const mine = [...IMPLEMENTED_DRIVERS].sort()
  const theirs = [...page].sort()
  if (mine.join('、') !== theirs.join('、')) {
    throw new Error(
      `装配名单分家了：src/replay/implemented.ts 说 ${mine.join('、')}，` +
        `而取图页运行时装得出 ${theirs.join('、')}。两份必须一致 —— ` +
        `比对器就是照前者决定哪些剧本连试都不试的。`,
    )
  }
}

// ================= 比对 =================

function compareOne(
  root: string,
  m: Manifest,
  threshold: number,
  tolerance: number,
): ScriptReport {
  if (m.width !== STAGE_WIDTH || m.height !== STAGE_HEIGHT) {
    throw new Error(`${m.script} 的原版帧是 ${m.width}×${m.height}，应为 1024×640`)
  }
  const results = diffSide(root, m, 'web', tolerance)
  const sequence = summarize(results, threshold)
  const expectation = expectationOf(m.script)

  // 分区表态的剧本走另一套判据（`src/compare/regions.ts`）：整屏的 ratio 与
  // threshold 仍然算出来给报告看，但**判通不通过的是分区那一套** —— 硬比区
  // 一个超容差的像素都不许有，每个缺口区各自双向红。
  let regions: RegionVerdict | undefined
  if (expectation.gaps) {
    const rects = expectation.gaps.map((g) => g.rect)
    const javaDir0 = join(root, m.script, 'java')
    const webDir0 = join(root, m.script, 'web')
    const frames: PartitionedFrame[] = m.ticks.map((t) => {
      const a = decodePng(readFrame(javaDir0, t, m.script, '原版'))
      const b = decodePng(readFrame(webDir0, t, m.script, 'Web'))
      return { tick: t, ...partitionedDiff(a, b, rects, tolerance) }
    })
    regions = judgeRegions(frames, expectation.gaps)
  }

  // 判据本身在 `src/compare/`：整屏表态走 `verdict.ts`，分区表态走 `regions.ts`。
  // 这里只负责挑一边、把结论抄进报告 —— 判据留在 src/ 下才跟得上 CI 里的
  // vitest（这条流水线要 Java 与 Chrome，进不了 CI）。
  const whole = regions ? null : judgeWhole(sequence, expectation)
  const ok = regions ? regions.ok : whole!.ok
  const verdict = regions ? regions.verdict : whole!.verdict

  // 差异图只出两张：第一个偏离帧（"从哪儿开始不对"）和最差帧（"最坏长什么样"）。
  // 每帧都出会得到几百张没人看的图。
  const highlights = new Set([sequence.worst.tick, sequence.firstDivergent].filter(
    (t): t is number => t !== null,
  ))
  const javaDir = join(root, m.script, 'java')
  const webDir = join(root, m.script, 'web')
  const diffDir = join(root, m.script, 'diff')
  resetDir(diffDir)
  for (const t of highlights) {
    const a = decodePng(readFrame(javaDir, t, m.script, '原版'))
    const b = decodePng(readFrame(webDir, t, m.script, 'Web'))
    writeFileSync(join(diffDir, frameName(t)), encodePng(diffImage(a, b, tolerance)))
  }

  return { name: m.script, expectation, sequence, ok, verdict, regions }
}

/** 逐帧比原版与某一侧产物的差异。`side` 是 `<剧本>/` 下的子目录名。 */
function diffSide(
  root: string,
  m: Manifest,
  side: string,
  tolerance: number,
): FrameResult[] {
  const javaDir = join(root, m.script, 'java')
  const sideDir = join(root, m.script, side)
  return m.ticks.map((t) => {
    const a = decodePng(readFrame(javaDir, t, m.script, '原版'))
    const b = decodePng(readFrame(sideDir, t, m.script, 'Web'))
    return { tick: t, ...frameDiff(a, b, tolerance) }
  })
}

/**
 * 流水线自检：**故意改坏一处渲染，看它响不响、指不指得出帧号**。
 *
 * 为什么必须有这一条。这条流水线现在每条剧本都是"已知缺口"，也就是每条都红着；
 * 一条恒红的检查和一条恒绿的检查一样没有诊断力，而两者都能安安静静地退出 0。
 * 这里从中间那一帧起把主角画偏 8 像素（世界状态不动，只有画出来的那一帧坏了），
 * 然后断言两件事：
 *
 * - 注入点之前的每一帧，差异**逐帧不变**（改坏一处不会污染别处）；
 * - 差异第一次变化的帧号，**正好是注入点**。
 *
 * 分母是采样帧数，开跑前就数得出来。
 */
async function runSelfCheck(
  root: string,
  manifests: readonly Manifest[],
  tolerance: number,
): Promise<boolean> {
  const HERO_DX = 8
  process.stdout.write('\n流水线自检：故意改坏一处渲染\n')
  if (manifests.length === 0) {
    // 一条可比的剧本都没有时自检"全过"，与真的验过一遍长得一模一样。
    // 只跑装配不出来的那几条剧本时会走到这里（`tools/compare-frames.sh
    // menu-equip --self-check`）。
    process.stdout.write('  失败  没有一条装配得出来的剧本可供注入 —— 自检什么都没验\n')
    return false
  }
  let ok = true
  for (const m of manifests) {
    const clean = diffSide(root, m, 'web', tolerance)
    // 注入点取采样帧里靠中间的那个：前面要有帧可以证明"没被污染"，
    // 后面要有帧可以证明"确实变了"。
    const fromTick = m.ticks[Math.floor(m.ticks.length / 2)]!
    await capture(root, [m], 'web-broken', { fromTick, heroDx: HERO_DX })
    const broken = diffSide(root, m, 'web-broken', tolerance)

    const changed = clean
      .map((c, i) => (c.differing === broken[i]!.differing ? null : c.tick))
      .filter((t): t is number => t !== null)
    const first = changed.length > 0 ? changed[0]! : null
    const pass = first === fromTick
    ok = ok && pass
    process.stdout.write(
      `  ${pass ? '通过' : '失败'}  ${m.script.padEnd(12)} ` +
        `${m.ticks.length} 帧 · 注入点 #${fromTick} · ` +
        `首个变化帧 ${first === null ? '无（改坏了却没响）' : `#${first}`} · ` +
        `变了 ${changed.length}/${m.ticks.length} 帧\n`,
    )
    if (!pass) {
      process.stdout.write(
        `        判据没有诊断力：把主角画偏 ${HERO_DX} 像素之后，` +
          `${first === null ? '一帧都没变' : `最先变的是 #${first}，不是注入点 #${fromTick}`}。\n`,
      )
    }
  }
  return ok
}

function readFrame(dir: string, tick: number, script: string, side: string): Uint8Array {
  const file = join(dir, frameName(tick))
  if (!existsSync(file)) {
    throw new Error(
      `${script} 的${side}第 ${tick} 帧不在：${file}。` +
        `清单里有的帧两端都必须有 —— 少一帧不算"少比一点"，算这一次没跑完。`,
    )
  }
  return new Uint8Array(readFileSync(file))
}

function readManifest(root: string, name: string): Manifest {
  const file = join(root, name, 'java', 'frames.json')
  if (!existsSync(file)) {
    throw new Error(`找不到 ${file} —— 先跑 tools/compare-frames.sh，它负责出原版那一半。`)
  }
  const m = JSON.parse(readFileSync(file, 'utf8')) as Manifest
  if (m.format !== 'xianlin-frames/1') {
    throw new Error(`${file} 的 format 是 ${m.format}，本工具只认 xianlin-frames/1`)
  }
  if (m.ticks.length === 0) throw new Error(`${file} 里一帧都没有`)
  // 判别名是分流的唯一依据（xl-1vu.7）。缺了它，`checkStanding` 收到的是
  // undefined —— 那是"读不出来"，不该被当成"某个默认驱动器"。
  if (typeof m.driver !== 'string' || m.driver.length === 0) {
    throw new Error(
      `${file} 没有报驱动器判别名（driver = ${JSON.stringify(m.driver)}）——` +
        `重跑一遍 tools/compare-frames.sh，它负责出原版那一半。`,
    )
  }
  const onDisk = readdirSync(join(root, name, 'java')).filter((f) => f.endsWith('.png')).length
  if (onDisk !== m.ticks.length) {
    throw new Error(`${file} 说有 ${m.ticks.length} 帧，目录里却有 ${onDisk} 个 PNG`)
  }
  return m
}

// ================= 报告 =================

function report(
  reports: readonly ScriptReport[],
  blocked: readonly DriverStanding[],
  threshold: number,
  tolerance: number,
): void {
  const frames = reports.reduce((n, r) => n + r.sequence.frames, 0)
  process.stdout.write(
    `\n跨端逐帧比对：${reports.length} 条剧本 × 各自的帧数 = ${frames} 帧` +
      `（阈值 ${pct(threshold)} 的像素，单通道容差 ${tolerance}）\n\n`,
  )
  for (const r of reports) {
    const s = r.sequence
    process.stdout.write(
      `  ${r.ok ? '通过' : '失败'}  ${r.name.padEnd(12)} ` +
        `${String(s.frames).padStart(4)} 帧 · ` +
        `首个偏离帧 ${s.firstDivergent === null ? '无' : `#${s.firstDivergent}`} · ` +
        `偏离 ${s.divergent.length}/${s.frames} · ` +
        `最差 #${s.worst.tick} ${pct(s.worst.ratio)}` +
        `${s.worst.box ? ` @ (${s.worst.box.x0},${s.worst.box.y0})-(${s.worst.box.x1},${s.worst.box.y1})` : ''}\n` +
        `        ${r.verdict}\n`,
    )
  }
  const failed = reports.filter((r) => !r.ok)
  process.stdout.write(
    // 一条都没比成时不许印"0/0 条剧本符合预期" —— 那句话读起来跟全过一模一样。
    // 只跑装配不出来的剧本时会走到这里。
    reports.length === 0
      ? `\n一条剧本都没比成 —— 这一趟没有任何像素被比过。\n`
      : failed.length === 0
        ? `\n${reports.length}/${reports.length} 条剧本符合预期。\n`
        : `\n${failed.length}/${reports.length} 条剧本不符合预期：${failed.map((r) => r.name).join('、')}\n`,
  )
  // 装配不出来的那几条**单独一段**，而且要点名（xl-1vu.7）。混在上面那份
  // "N/N 条符合预期"里的话，一条一帧都没比过的剧本会被读成一条比过了的。
  if (blocked.length > 0) {
    process.stdout.write(
      `\nweb 侧还装配不出来的剧本 ${blocked.length} 条 —— 这一趟它们一帧都没比过：\n`,
    )
    for (const s of blocked) process.stdout.write(`  装不出  ${unassembledLine(s)}\n`)
    process.stdout.write(
      `  取图页现在实现了：${[...IMPLEMENTED_DRIVERS].sort().join('、')}。` +
        `等上面那几张票把 web 侧的面板建起来，再回 src/compare/expected.ts 把表态换掉。\n` +
        `  （非零退出。一条没被装配的剧本比出来是"零帧差异"，跟"两端完全一致"长得一模一样。）\n`,
    )
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(4)}%`
}

function frameName(tick: number): string {
  return `f${String(tick).padStart(6, '0')}.png`
}

function resetDir(dir: string): void {
  // 整个删掉重建：留着上一次的 PNG，比对器会读到一份"这一次根本没画过"的图，
  // 而它能解码、尺寸也对 —— 失败长得和成功一模一样。
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function numberFlag(argv: readonly string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag)
  if (i < 0) return fallback
  const value = Number(argv[i + 1])
  if (!Number.isFinite(value)) throw new Error(`${flag} 后面要跟一个数，收到 ${argv[i + 1]}`)
  return value
}

/** 带值的参数，用来把它们的值从剧本名里摘出去。无值的开关不在这张表里。 */
const VALUED_FLAGS = ['--threshold', '--tolerance']

function isFlagValue(argv: readonly string[], arg: string): boolean {
  const i = argv.indexOf(arg)
  return i > 0 && VALUED_FLAGS.includes(argv[i - 1]!)
}

main().catch((e: unknown) => {
  process.stderr.write(`\n[compare] ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(2)
})
