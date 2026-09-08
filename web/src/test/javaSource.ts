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
 *
 * ## 谁**不**该用这个函数（xl-xh3 数了一遍全仓，判据是 `grep -rn
 * "TextDecoder('gbk')" web/src --include='*.ts'`）
 *
 * 除这个 helper 外，仓库里还有两处自己解 GBK，都是**故意留着**的，不要顺手
 * 收编。⚠️ **这不是一段散文**：`javaSource.test.ts` 会现扫 `web/src` 把实际
 * 的那批文件跟一张手签的豁免表对撞，多一处少一处都红 —— 分母现扫、登记手签，
 * 两者对撞才有分辨力（dispatch.md 纪律 3）。改了下面这份名单就得同步改那张表。
 *
 * - `battle/drugs.test.ts` —— 读的是 `sources/Shop/drug.txt`，一份**游戏数据
 *   文件**，不是 Java 源码。解码方式碰巧相同，来源与含义不同；套上这个名字
 *   之后 `javaSource('sources/…')` 就不再分得出源码和数据了。
 * - `data/bakeScript.ts` —— **生产代码**，要进浏览器包，而这里用 `node:fs`
 *   读磁盘；它收的又是**字节**（调用者已经拿到 `Uint8Array`）而不是路径。
 *   ⚠️ 那个文件还被 `assets/bakeStamp.test.ts` 的烘焙指纹守着，**连改一行
 *   注释都会让它红**（xl-xh3 实测：`bakeScript.ts` 的哈希变了，一条用例失败）
 *   —— 所以那一处的理由写在这里，而不是写在它自己身上。
 */
export function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}
