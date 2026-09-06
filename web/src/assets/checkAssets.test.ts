import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SceneScript } from '../data/types'
import { repoPath } from '../test/repoPath'
import { checkSceneAssets, formatReport, isClean } from './checkAssets'
import { KNOWN_DEFECTS, KNOWN_MISSING } from './knownMissing'

/** 入库的 96 份场景 JSON —— 校验器在 CI 里查的就是它们。 */
const SCENES: SceneScript[] = readdirSync(repoPath('web/src/generated/scenes'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(repoPath('web/src/generated/scenes', f), 'utf8')))

const realExists = (path: string) => {
  try {
    readFileSync(repoPath(path))
    return true
  } catch {
    return false
  }
}

describe('资源存在性硬校验', () => {
  it('96 份产物全绿，且分母对得上', () => {
    const report = checkSceneAssets(SCENES, realExists)
    expect(formatReport(report)).toBe(
      '资源校验：96 个场景，1602 条引用（互异 523 条），已知缺失容忍 38 条',
    )
    expect(isClean(report)).toBe(true)
    // 通过与失败长得不一样：通过时也得把分母打出来，否则"一个场景都没扫到"
    // 会安静地通过 —— 这正是本项目栽过的那种坑。
    expect(report.scenes).toBe(96)
  })

  it('已知缺失清单：37 条路径 + 1 处不成形，每条都挂着 bd issue', () => {
    expect(KNOWN_MISSING.length).toBe(37)
    expect(new Set(KNOWN_MISSING.map((k) => k.path)).size).toBe(37)
    expect(KNOWN_DEFECTS.length).toBe(1)
    for (const entry of [...KNOWN_MISSING, ...KNOWN_DEFECTS]) {
      expect(entry.issue, JSON.stringify(entry)).toMatch(/^xl-[0-9a-z]+\.\d+$/)
    }
    // 27 帧从未交付的 NPC 素材（xl-1dv.1）占了其中的大头，其余 10 条分别是
    // 1 条漏扩展名的 NPC 路径与 9 个不是文件的出口目标。
    expect(KNOWN_MISSING.filter((k) => k.issue === 'xl-1dv.1').length).toBe(27)
  })

  it('故意写坏一条路径 → 报出的正好是那一条，其余不受影响', () => {
    const broken = SCENES.map((s) =>
      s.script === '宿舍.txt' ? { ...s, mapName: '不存在的地图.png' } : s,
    )
    const report = checkSceneAssets(broken, realExists)
    expect(isClean(report)).toBe(false)
    expect(report.missing.map((m) => `${m.where} ${m.path}`)).toEqual([
      '宿舍.txt mapName maps/不存在的地图.png',
    ])
    expect(formatReport(report)).toContain('maps/不存在的地图.png   ← 宿舍.txt mapName（map）')
  })

  it('一次收齐全部缺失，不是撞见第一条就退出', () => {
    // 缺 5 张图要跑 5 次才知道，那种报错方式本身就是个坑。
    const broken = SCENES.map((s) => ({ ...s, mapName: `坏-${s.mapName}` }))
    const report = checkSceneAssets(broken, realExists)
    expect(report.missing.length).toBe(96)
  })

  it('已知缺失的路径**存在了**同样要红 —— 清单不许过期', () => {
    // 只有"表外缺失才红"的话，这张表会慢慢变成一堆没人敢删的字符串，
    // 而"清单里全都还缺着"与"清单早就过期了"看起来一模一样。
    const healed = (path: string) => path === 'NPCs/太极老师/1.png' || realExists(path)
    const report = checkSceneAssets(SCENES, healed)
    expect(isClean(report)).toBe(false)
    expect(report.stale).toEqual(['NPCs/太极老师/1.png'])
    expect(formatReport(report)).toContain('已知缺失清单已过期')
  })

  it('已知缺失清单里抄错了字（没有任何数据引用到）也要红', () => {
    const report = checkSceneAssets(SCENES.slice(0, 1), realExists)
    expect(isClean(report)).toBe(false)
    expect(report.unreferenced.length).toBeGreaterThan(0)
  })
})

/**
 * 上面那些是对纯函数的断言；下面这条是对**退出码**的断言。
 * 验收标准写的是"构建以非零退出码失败"，那就得真去跑一次拿退出码，
 * 而不是相信 `process.exit(1)` 这一行写在那里就一定会执行到。
 */
describe('checkAssets CLI 的退出码', () => {
  const WEB = repoPath('web')
  const CLI = 'scripts/checkAssets.ts'
  const temps: string[] = []
  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  })

  const run = (args: string[]) => {
    try {
      const stdout = execFileSync('node_modules/.bin/vite-node', [CLI, ...args], {
        cwd: WEB,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { code: 0, output: stdout }
    } catch (e) {
      const err = e as { status: number | null; stdout: string; stderr: string }
      return { code: err.status ?? -1, output: `${err.stdout}${err.stderr}` }
    }
  }

  const copyScenes = () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'xl-scenes-'))
    temps.push(dir)
    cpSync(repoPath('web/src/generated/scenes'), dir, { recursive: true })
    return dir
  }

  it('入库产物照跑 → 退出码 0', () => {
    const result = run([])
    expect(result.code).toBe(0)
    expect(result.output).toContain('96 个场景')
  })

  it('把一条地图路径写坏 → 退出码非 0，并指出是哪条', () => {
    const dir = copyScenes()
    const file = resolve(dir, '宿舍.json')
    const scene = JSON.parse(readFileSync(file, 'utf8')) as SceneScript
    writeFileSync(file, JSON.stringify({ ...scene, mapName: '不存在的地图.png' }), 'utf8')

    const result = run(['--scenes', dir])
    expect(result.code).toBe(1)
    expect(result.output).toContain('maps/不存在的地图.png')
    expect(result.output).toContain('宿舍.txt mapName')
  })

  it('目录里一个场景都没有 → 退出码非 0，而不是"没发现问题"', () => {
    // 找不到目标的检查会安静地全绿，这是本仓库反复栽的坑。
    const dir = mkdtempSync(resolve(tmpdir(), 'xl-empty-'))
    temps.push(dir)
    const result = run(['--scenes', dir])
    expect(result.code).toBe(1)
    expect(result.output).toContain('没有场景 JSON')
  })
})
