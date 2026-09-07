import { readFileSync } from 'node:fs'
import { repoPath } from './repoPath'

/**
 * 读一份原版 Java 源码，**显式按 GBK 解码**。
 *
 * `src/` 全是 GBK+CRLF（见 CLAUDE.md）。按 UTF-8 读出来中文全是乱码，而
 * **乱码与「源码里没有这一行」在正则下长得一模一样** —— 都是零匹配，而零行的
 * 逐行对比是一条恒真的检查。凡是把源码当判据的测试都从这里读。
 *
 * 由此还有一条配套的规矩（xl-rh9.5 写下的）：**凡是拿这个函数的结果做匹配的
 * 地方，都要先断言「解出来的条数 > 0」**。那条断言拦的就是上面这种零匹配 ——
 * 它同时也拦得住「界标写错了」「源码那一段被挪走了」。
 */
export function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}
