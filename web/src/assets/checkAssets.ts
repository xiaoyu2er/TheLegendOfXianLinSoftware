import type { SceneScript } from '../data/types'
import { KNOWN_DEFECTS, KNOWN_MISSING } from './knownMissing'
import { type SceneAssetRef, type SceneDefect, scanSceneAssets } from './sceneAssets'

/**
 * 资源存在性硬校验。纯函数：文件系统从 `exists` 注进来，所以它能在
 * vitest 里被喂假的目录状态，不用真去动仓库里的文件。
 *
 * 报告一次收齐再返回，**不是撞见第一条就退出** —— 缺 30 条要跑 30 次才能
 * 数清楚，那种报错方式本身就是个坑。
 */
export interface AssetCheckReport {
  /** 扫过的场景数。分母，开跑前就该知道是 96。 */
  scenes: number
  /** 资源引用总条数与互异路径数。 */
  refs: number
  distinct: number
  /** 表外的缺失 —— 这就是"构建必须失败"的那一类。 */
  missing: SceneAssetRef[]
  /** 表内的缺失，按已知清单容忍；这里记的是实际撞到的条数。 */
  tolerated: SceneAssetRef[]
  /** 已知清单里**已经存在**的路径：数据修好了却没来销账，同样要失败。 */
  stale: string[]
  /** 已知清单里一条都没被引用到的路径：多半是清单抄错了字。 */
  unreferenced: string[]
  /** 表外的数据不成形处。 */
  defects: SceneDefect[]
  toleratedDefects: SceneDefect[]
  staleDefects: string[]
}

export function checkSceneAssets(
  scenes: readonly SceneScript[],
  exists: (repoRelativePath: string) => boolean,
): AssetCheckReport {
  const known = new Map(KNOWN_MISSING.map((k) => [k.path, k.issue]))
  const knownDefects = new Map(KNOWN_DEFECTS.map((k) => [k.where, k.issue]))
  const referenced = new Set<string>()
  const seenDefect = new Set<string>()

  const report: AssetCheckReport = {
    scenes: scenes.length,
    refs: 0,
    distinct: 0,
    missing: [],
    tolerated: [],
    stale: [],
    unreferenced: [],
    defects: [],
    toleratedDefects: [],
    staleDefects: [],
  }
  const distinct = new Set<string>()

  for (const scene of scenes) {
    const { refs, defects } = scanSceneAssets(scene)
    for (const ref of refs) {
      report.refs += 1
      distinct.add(ref.path)
      if (known.has(ref.path)) referenced.add(ref.path)
      if (exists(ref.path)) continue
      ;(known.has(ref.path) ? report.tolerated : report.missing).push(ref)
    }
    for (const defect of defects) {
      seenDefect.add(defect.where)
      ;(knownDefects.has(defect.where) ? report.toleratedDefects : report.defects).push(defect)
    }
  }
  report.distinct = distinct.size

  for (const [path] of known) {
    if (exists(path)) report.stale.push(path)
    else if (!referenced.has(path)) report.unreferenced.push(path)
  }
  for (const [where] of knownDefects) {
    if (!seenDefect.has(where)) report.staleDefects.push(where)
  }
  return report
}

/** 校验通过 = 四类问题一条都没有。已知清单里的那些不算问题，但过期的算。 */
export function isClean(report: AssetCheckReport): boolean {
  return (
    report.missing.length === 0 &&
    report.defects.length === 0 &&
    report.stale.length === 0 &&
    report.unreferenced.length === 0 &&
    report.staleDefects.length === 0
  )
}

/**
 * 报告文本。通过与失败**长得不一样**：通过时也把分母打出来
 * （扫了几个场景、几条引用、容忍了几条），否则"什么都没扫到"会安静地通过。
 */
export function formatReport(report: AssetCheckReport): string {
  const lines: string[] = []
  lines.push(
    `资源校验：${report.scenes} 个场景，${report.refs} 条引用（互异 ${report.distinct} 条），` +
      `已知缺失容忍 ${report.tolerated.length} 条`,
  )
  const list = (title: string, rows: string[]) => {
    if (rows.length === 0) return
    lines.push(`${title} ${rows.length} 条：`)
    for (const row of rows) lines.push(`  ${row}`)
  }
  list(
    '资源缺失',
    report.missing.map((m) => `${m.path}   ← ${m.where}（${m.kind}）`),
  )
  list(
    '数据不成形',
    report.defects.map((d) => `${d.where}: ${d.detail}`),
  )
  list(
    '已知缺失清单已过期，这些路径现在是存在的，请从 knownMissing.ts 删掉',
    report.stale,
  )
  list('已知缺失清单里没有任何数据引用到，多半是抄错了字', report.unreferenced)
  list('已知不成形清单已过期，这些位置现在是好的', report.staleDefects)
  return lines.join('\n')
}
