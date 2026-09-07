import { readFileSync } from 'node:fs'
import { repoPath } from './repoPath'

/**
 * 读一份原版 Java 源码，**显式按 GBK 解码**。
 *
 * `src/` 全是 GBK+CRLF（见 CLAUDE.md）。按 UTF-8 读出来中文全是乱码，而
 * **乱码与"源码里没有这一行"在正则下长得一模一样** —— 匹配不到就是 0 行，
 * 0 行的逐行对比是一条恒真的检查。凡是把源码当判据的测试都从这里读。
 */
export function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}
