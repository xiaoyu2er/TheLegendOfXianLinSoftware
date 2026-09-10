import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from './javaSource'
import { repoPath } from './repoPath'

/**
 * `javaSource.ts` 的文档里写着一句「谁**不**该用这个函数」的**登记**，还附了
 * 一条 grep 判据。这个文件就是把那条 grep 跑起来 —— 否则那段话是一句**没有
 * 判据守着的散文**：第三处自己解 GBK 的地方混进来时它会静默变假，
 * 而「静默变假」与「一直是对的」长得一模一样（xl-xh3 的 /code-review 提的）。
 *
 * ⚠️ 这里两半的性质是不同的，混起来会造出一个恒真的判据（dispatch.md 纪律 3）：
 *
 * - **分母**（仓库里现在有哪几个文件自己造 GBK 解码器，见下面的 `NEEDLE`）——
 *   从磁盘现扫，不手抄。少一处多一处都得响。
 * - **登记**（哪几处是**故意**不走 `javaSource` 的）—— 必须由人手签在下面这张
 *   表里，连理由一起。把它改成自动推导，等于让被守的东西自己给自己签字。
 *
 * 两者对撞才有分辨力。
 */

/**
 * 要找的那一句，**拼出来而不是写成字面量**。
 *
 * ⚠️ 头一版把整句写成字面量，于是扫描器扫到了**它自己**，
 * 用例红在一个多出来的 `src/test/javaSource.test.ts` 上。那是个真失败：一个
 * 把自己算进分母的扫描器，等于永远要在豁免表里给自己开一个口子，而那个口子
 * 下次就会被别人拿来搭便车。拼接之后这个文件里确实没有那一句，扫描器扫自己
 * 得零 —— 用例名与注释里也一律不许出现整句（所以下面写成「自己解 GBK」）。
 */
const NEEDLE = "new TextDecoder(" + "'gbk')"

/** 手签的豁免表：路径 → 为什么这一处不走 `javaSource`。改这张表要连理由一起改。 */
const ALLOWED: Record<string, string> = {
  'src/test/javaSource.ts': 'helper 自己 —— 它就是那个唯一的解码点',
  'src/battle/drugs.test.ts':
    '读的是 sources/Shop/drug.txt，游戏**数据文件**而非 Java 源码；解码方式碰巧相同，来源与含义不同',
  'src/data/bakeScript.ts':
    '**生产代码**，要进浏览器包（helper 用 node:fs 读磁盘），且它收的是字节不是路径',
  'src/menu/equipment.test.ts':
    '读的是 sources/Shop/ 下那六份装备表，与 drugs.test.ts 同一个理由：游戏**数据文件**而非 Java 源码（同一个文件里读 Java 源码那一半走的正是 helper）',
  'src/shop/shopReferences.ts':
    '烘焙器的一部分（Node 侧），而 helper 从 `import.meta.url` 算死了仓库根 —— 这个扫描器收 `repoRoot` 做参数，正是为了让 `shopAssets.test.ts` 把它指向临时目录里的假源码树，把每一种失败真造出来',
  'src/menu/defaultWeapons.test.ts':
    '读的是 sources/Shop/武器.txt，与 drugs.test.ts 同一个理由：游戏**数据文件**而非 Java 源码（同一个文件里读 Java 源码那一半走的正是 helper）',
  'src/save/test/originalSave.ts':
    '读的是 tools/ground-truth/存档/ 下原版存出来的样例存档，与 drugs.test.ts 同一个理由：游戏**数据文件**而非 Java 源码（同一个文件里读 Java 源码那一半走的正是 helper）',
}

/** `web/src` 下所有 `.ts` / `.tsx`，相对 `web/` 的路径。 */
function allSources(dir = 'src'): string[] {
  return readdirSync(repoPath('web', dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? allSources(`${dir}/${e.name}`)
      : /\.tsx?$/.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  )
}

describe('GBK 解码只有一个入口', () => {
  const files = allSources()

  it('扫描器真的扫到了文件 —— 空转要响', () => {
    // 分母不写死条数（别的票在并行加文件，见 dispatch.md 纪律 3），但零个文件的
    // 逐条对比是一条恒真的检查，而"目录走错了"与"仓库里没有 .ts"长得一样。
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('src/test/javaSource.ts')
  })

  it('自己解 GBK 的，只有手签豁免的那几处', () => {
    const found = files.filter((f) => readFileSync(repoPath('web', f), 'utf8').includes(NEEDLE))
    const allowed = Object.keys(ALLOWED)
    // ⚠️ 差集要**分开断言**，不能只写 `toEqual`。vitest 对超过两三项的数组会打成
    // `[ 'a', …(3) ]`，多出来的那个路径正好被省略号吃掉 —— 判据是红的，可它
    // 不告诉你红在哪个文件上（xl-xh3 实测：篡改后输出里根本没有那个文件名）。
    expect(
      found.filter((f) => !allowed.includes(f)),
      '这几个文件自己解了 GBK 却不在豁免表里：改用 test/javaSource.ts，或者手签进 ALLOWED 并写清理由',
    ).toEqual([])
    expect(
      allowed.filter((f) => !found.includes(f)),
      '豁免表里这几处已经不自己解码了 —— 从 ALLOWED 里删掉',
    ).toEqual([])
    // 上面两条差集都空时，剩下的只有"扫描器整个空转"这一种可能：空集合与空集合
    // 的差也是空。所以还要这一条 —— ALLOWED 恒非空，found 为空时它必红。
    expect(found.length, '一处自己解 GBK 的都没扫到 —— 扫描器空转了').toBe(allowed.length)
  })

  it('豁免表里的每一处都真的存在，且真的自己解了码', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${path} 的豁免理由是空的 —— 手签就要签得出理由`).toBeGreaterThan(10)
      expect(
        readFileSync(repoPath('web', path), 'utf8'),
        `${path} 已经不自己解码了 —— 从豁免表里删掉它`,
      ).toContain(NEEDLE)
    }
  })
})

describe('javaSource 本身', () => {
  it('按 GBK 解出中文 —— 按 UTF-8 读会是乱码', () => {
    const src = javaSource('src/start/StartPanel.java')
    expect(src).toContain('scenePanel.initiation(')
    // 同一份字节按 UTF-8 解，`initiation("大地图.txt")` 里的中文会碎掉。
    const utf8 = new TextDecoder('utf-8').decode(readFileSync(repoPath('src/start/StartPanel.java')))
    expect(utf8).not.toEqual(src)
  })

  it('文件不存在时抛，不是安静地返回空串', () => {
    expect(() => javaSource('src/不存在的文件.java')).toThrow()
  })
})
