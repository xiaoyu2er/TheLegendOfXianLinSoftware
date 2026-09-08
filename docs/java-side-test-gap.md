# Java 侧的判据缺口：重导对比看不见的那 7 处（xl-f8y 第 1 步）

Java 侧一个测试文件都没有：

    find . -path ./web -prune -o -name '*Test*.java' -print   # 零结果（2026-09-08 复量）

代替它的是两条重导对比，跑完都必须没有 diff：

| 判据 | 覆盖 | 实测耗时（2026-09-08，openjdk 17，本机） |
|---|---|---|
| `tools/export-truth.sh` + `git diff tools/ground-truth` | 96 个脚本 × 26 个字段 | 3.0 s |
| `tools/export-trace.sh` + `git diff tools/traces/out` | `tools/traces/scripts/*.json` 里的每一份，四支驱动器 | 1 min 19 s |
| `tools/export-trace.sh --check`（同上，外加每份剧本两个 JVM 各导一遍再 `cmp`） | 同上 | 2 min 34 s |

**下面所有出现的「21」（份剧本 / `/21` 的分母）都是 2026-09-08 的读数，不是规格。** `CLAUDE.md`
明令每支驱动器各有几份剧本不许写死在文档里（那个数一天内过期过两次），现数：

    for f in tools/traces/scripts/*.json; do
      python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('driver','scene'))" "$f"
    done | sort | uniq -c


这份文档回答的是一个有分母的问题：**挑 10 个具体的篡改点，这两条判据分别抓到
几个。** 分母是开跑前就数得清的，破了的样子（"绿"）和没破的样子（"红"）在表里
是分开的两列。

## 篡改矩阵（10 个点，3 抓到 / 7 看不见）

每一处都先用 `assert old in source` 确认篡改真的写进去了才看颜色
（`docs/agents/dispatch.md` 验证坑 7），改完 `tools/build.sh` 重编、两条判据都
跑全量，跑完 `git checkout --` 还原。

| # | 篡改点 | truth | trace | 结果 |
|---|---|---|---|---|
| 1 | `Reader` 读地图规格时 `col` / `row` 读反 | **96/96 红** | **exit=1 红** | 抓到 |
| 2 | `ProgressBar` 行动条阈值 `400` → `410` | 绿 | **exit=2 红** | 抓到 |
| 3 | `Json.str` 的 `"` 转义分支写坏 | **4/96 红** | **2/21 红** | 抓到 |
| 4 | `Reader.normalizePath` 的反斜杠归一化整个失效 | 绿 | 绿 | **看不见** |
| 5 | `Reader` 的 `Role` 段：陆雪琪的在队位读成张小凡那一位 | 绿 | 绿 | **看不见** |
| 6 | `Json.str` 的 `\n` 转义分支写坏 | 绿 | 绿 | **看不见** |
| 7 | `ExportTrace` 未知 `driver` 从硬失败退化为静默回落 `scene` | 绿 | 绿 | **看不见** |
| 8 | `Clock.ms` 的 1 ms 下限（注释写着 0 会让循环空转吃满 CPU） | 绿 | 绿 | **看不见** |
| 9 | `Reader.readImage` 的缺图警告整个哑掉 | 绿 | 绿 | **看不见** |
| 10 | `ExportTrace.requireKind` 的判别名形状校验整个关掉 | 绿 | 绿 | **看不见** |

1 与 2 是正对照，证明这一轮的测法本身没坏。**两支正对照红的方式不一样**，
值得记一句：1 是 96 份真值全变（`git diff` 抓的），2 一份真值都没变、
是导出器自己非零退出并打出 `跑满 2000 步仍未分出胜负（我方 hp 3360/3360/0）`
——判「trace 层红没红」只看 `git diff` 会漏掉 2 这一类，**退出码和 diff 要一起看**。

（第一次写 7 时插的是 `if (true) return new SceneDriver(s);`，`s` 不在那个
`default:` 分支的作用域里，**编译红**——那是一次无效篡改，不是一个结果。
重写成 `default:` 分支整个换成 scene 的装载逻辑才读到上表那一行。）

## 那 7 处不是一堆散点，是三族

### 一、`src/` 里唯一允许改的那两类改动，恰好一条守卫都没有

`CLAUDE.md` 写着「During migration the Java source is the specification…
The only sanctioned edits are portability and diagnostics」。4 是 `fix(path)`
的那处归一化，9 是 `fix(diag)` 的那处缺图警告 —— **仓库唯一会动 `src/` 的两类
改动，重导对比一个都盯不住**。

追下去的原因是实的，不是判据失灵：

- 真值存的是脚本里的**原样字符串**，反斜杠原封不动地留在里面
  （`tools/ground-truth/剧情1.json` 与 `迷宫1.json`，共 6 个 `\\` 转义 ——
  正是 `CLAUDE.md` 说的那批「故意的测试夹具」）。`normalizePath` 只在
  `readImage` 那一刻起作用，而 `ImageIcon` 路径错时既不抛也不返回 null，
  状态层完全看不出区别。
- 缺图警告走 stderr，两条判据的产物里都没有 stderr。

### 二、导出器自己的错误路径与没被走到的分支

6 / 7 / 10。这一族的失败形态正是这个仓库最怕的那种：

- **7 最贵**。未知 `driver` 静默回落成 scene，会导出一份**看起来完全正常的**
  真值 —— 退出码 0、JSON 合法、`--check` 两次一致。`ExportTrace` 的类注释
  专门写了「默认值是**唯一**的宽容之处，认不出的名字一律硬失败，绝不猜」，
  而这句承诺今天没有任何东西在核。
- **6 是分支覆盖的问题，可以数**。`Json.str` 有 6 个转义分支
  （`"` / `\` / `\n` / `\r` / `\t` / `<0x20`），把 96 份真值加 21 份 trace 里
  出现过的转义全数一遍，只有 3 种：`"` ×22、`\` ×6、`t` ×3。
  **`\n`、`\r`、控制字符三个分支从来没被跑到过**，改坏了当然不会红。
  （这一普查覆盖 `tools/ground-truth/*.json` 与 `tools/traces/out/*.json` 的全部
  文件，2026-09-08 读数。）
- 10 同理：`requireKind` 的正则今天只被四个写死的合法名字喂过。

### 三、原版里「真值不记录」的字段

5 / 8。`ExportGroundTruth` 全文没有一处碰 `SaveAndLoad`，所以 `Role` 段
（三个主角谁在队）解析对不对，26 个字段里没有一个能表态；战斗真值里那些
`"zhang"` / `"lu"` 是战斗剧本自己摆的队伍，不经过 `Reader` 的 `Role` 段。
`Clock.ms` 的下限则是被导出器的时钟配置绕开的。

这一族**数量上最大也最难穷尽** —— 26 个字段与 21 份剧本盖不到的地方有多少，
没有办法在开跑前数出分母来。

## 结论：要做，但不是「给 `src/` 18k 行建套件」

给 `src/` 写单测的回报接近零，两条理由：

1. **它是冻结的规范。** 单测的价值在于「改了会响」，而这里的政策是不改。
2. **它已经被覆盖在移植端真正消费的那一层上** —— 96×26 的字段契约与 21 份
   逐步行为真值，比任何为 Swing 面板写的单测都更贴近 `web/` 实际要复刻的东西。

**值得建的是一套很小的、只盯上面三族的套件**，七项、落在五个被测文件上：

| 目标 | 要钉的事 | 对应上表 |
|---|---|---|
| `Reader.normalizePath` | 反斜杠→正斜杠；`null` 进 `null` 出；正斜杠不动 | 4 |
| `Reader.readImage` | 缺图时 stderr 有那一行；同一路径只警告一次 | 9 |
| `Reader.switchReader` 的 `Role` 段 | 三个位分别置 `zhang` / `lu` / `wen` | 5 |
| `Json.str` | 6 个转义分支逐个，含今天没被跑到的 `\n` / `\r` / `<0x20` | 6 |
| `Clock` | `factor==1.0` 恒等、`setFactor(0)` 被忽略、`ms` 的 1 ms 下限、`freezeTimers` 的 `base+millis` 可反算 | 8 |
| `ExportTrace.pickDriver` | 四个合法名各得对的驱动器；**未知名硬失败**；缺字段默认 `scene` | 7 |
| `ExportTrace.requireKind` | 空串 / 带空格 / 带大写各自失败 | 10 |

规模估计（**是估计，没量过**）：实现 0 行、测试大约 300–500 行。

**前五项**（`normalizePath` / `readImage` / `Role` 段 / `Json.str` / `Clock`）
是纯函数或近乎纯函数，都够得着：`Reader.normalizePath` 与 `readImage` 是
`public static`，`switchReader` 是 `public`，`Json` 与 `Clock` 全是 public static
（四处可见性都复核过）。这五项要**只读地**调用原版类，不改一行游戏逻辑。

**后两项不是，这一点要先说清楚。** `ExportTrace.pickDriver()` 是 **private 非
静态**、从磁盘读 `scriptFile`、写四个实例字段，而且它的 `case "battle"` 会构造
`BattleDriver` —— 那条路 `import battle.BattlePanel`，`tools/export-trace.sh` 正是
为它写了 `-Djava.awt.headless=false`。`requireKind` 是 `private static`。要测这两项
得先决定怎么够着：把测试放进 `devtools` 包里、反射、还是把这两处提成
package-private 的小函数。**这是这套里唯一有设计成本的一块**，别的都是直接断言。

## 要用户拍板的两件事（`bd show xl-f8y` 的范围护栏）

这两件都是仓库级决定，一张测试票不该顺带做掉，所以本趟没有动
`tools/build.sh`。

### 1. 测试框架与依赖怎么进来

- **甲：手放一个 `junit-platform-console-standalone.jar`。** 和现有的三个
  jar（`jl1.0.jar` / `mp3spi1.9.4.jar` / `tritonus_share.jar`）**完全同一条路**
  —— 它们的 classpath 就写死在 `tools/build.sh` 与 `tools/export-*.sh` 里。
  新增一个 `tools/test.sh`，`tools/build.sh` 加第三段编译测试源码。
  代价：仓库里多一个 2 809 597 字节（2.68 MiB）的二进制 —— 这是
  `junit-platform-console-standalone-1.11.4.jar` 在 Maven Central 上的
  `Content-Length`，2026-09-08 拉的。
- **乙：不引任何 jar，自己写一个几十行的跑起器。** 这个仓库有现成的先例：
  `Json.java` 的类注释就写着「不引第三方依赖」，`JsonIn` 同理。一个
  `assertEquals` + 反射扫 `*Test` 类的 `main`，够上表那七项用。
  代价：没有 IDE 集成、没有参数化用例，报错信息要自己写好。
- **丙：引入 Maven / Gradle。** 会改变每个人的 build 入口、CI 形状，以及
  `-encoding GBK` 这条约束的落点。

**建议乙**：上表七项里五项是纯函数断言，另两项的难处是可见性（见上），
JUnit 的那些能力一样都用不上，而甲和丙
都要动依赖形状。乙也最容易将来改成甲。

### 2. Java 侧接不接 CI

`.github/workflows/` 只有 `web.yml`，Java 侧没有 CI（2026-09-08 读数）。要接的话，
接的应该是**三样一起**：`tools/build.sh`、新的 `tools/test.sh`、以及
`tools/export-truth.sh` + `git diff --exit-code tools/ground-truth`。
第三样今天完全靠人记得跑。

`export-trace.sh --check` 要不要也进 CI 是另一个问题：实测 2 min 34 s，
且它要 `-Djava.awt.headless=false`（战斗驱动器要真的 Swing 组件），
GitHub runner 上跑不跑得起来**没测过**。

## 复现

跑矩阵的脚本是 `/tmp` 下的一次性产物，**没有入库**：它不是一条要长期跑的门禁，
入库反而会多一样没人维护、坏了也没人知道的东西。要复现的话下面这张表就够 ——
每一行是「在哪个文件里，把 A 换成 B」，逐字可搜。

| # | 文件 | 把这个 | 换成这个 |
|---|---|---|---|
| 1 | `src/tools/Reader.java` | `col = Integer.parseInt(ss[0]); row = …ss[1]` | 两个下标对调 |
| 2 | `src/battle/ProgressBar.java` | `ZhangX-BarX>=400` | `ZhangX-BarX>=410` |
| 3 | `tools/src/devtools/Json.java` | `case '"':  b.append("\\\"");` | `case '"':  b.append("'");` |
| 4 | `src/tools/Reader.java` | `return path == null ? null : path.replace('\\', '/');` | `return path;` |
| 5 | `src/tools/Reader.java` | `Role` 段里 `Integer.parseInt(ss[1]) == 1` 那一支 | `ss[0]` |
| 6 | `tools/src/devtools/Json.java` | `case '\n': b.append("\\n");` | `case '\n': b.append("N");` |
| 7 | `tools/src/devtools/ExportTrace.java` | `pickDriver()` 的 `default:` 分支（`die(...)`） | 整段换成 `case "scene"` 的装载 + `return new SceneDriver(s);` |
| 8 | `src/tools/Clock.java` | `return Math.max(1L, (long) (millis / factor));` | `return (long) (millis / factor);` |
| 9 | `src/tools/Reader.java` | `System.err.println("[readImage] 图片缺失: " + path` | 前面加 `if (false) ` |
| 10 | `tools/src/devtools/ExportTrace.java` | `if (kind == null \|\| !kind.matches("[a-z][a-z0-9-]*")) {` | `if (false) {` |

每个点的形状是：

1. **先确认篡改真的写进去了**再看颜色 —— `python3 -c "s=open(p).read(); assert OLD in s"`，
   `sed` 匹配不到照样 exit 0（`docs/agents/dispatch.md` 验证坑 7）；
2. `tools/build.sh` 重编 —— **编译红不是一个数据点，是一次无效篡改**，要重写；
3. 两条判据都跑全量，**退出码和 `git diff` 一起看**（正文里 2 就是 diff 为 0、
   导出器自己 exit=2）；
4. `git checkout -- src tools/src tools/ground-truth tools/traces/out` 还原，
   跑下一个之前 `git status --porcelain` 必须是空的。

`src/` 是 GBK + CRLF：改它要按 GBK 读写并保住 `\r\n`，别写进裸 LF
（`CLAUDE.md` § Conventions & Patterns）。
