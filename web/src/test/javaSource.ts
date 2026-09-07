import { readFileSync } from 'node:fs'
import { repoPath } from './repoPath'

/**
 * 读一份原版 Java 源码。
 *
 * **必须显式解码 GBK**（CLAUDE.md §Conventions）：`src/` 全是 GBK+CRLF，
 * 按 UTF-8 读出来中文全是乱码，而**乱码与「源码里本来就没有这一行」在正则
 * 匹配下长得一模一样** —— 都是零匹配。凡是拿这个函数的结果做匹配的地方，
 * 都要先断言「解出来的条数 > 0」，那条断言拦的就是这个。
 *
 * `units.test.ts` 与 `render/drawList.test.ts` 各自还留着一份自己的拷贝，
 * 这一趟没有合并过去：`units.test.ts` 正在被 xl-rh9.10 并行改，
 * `docs/agents/dispatch.md` 纪律 2 说并行热点上只做加法、不要重排。
 * 合并它们该单开一张票、串行做。
 */
export function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}
