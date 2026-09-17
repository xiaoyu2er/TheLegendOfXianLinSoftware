# xl-wou 裁定材料：场景快照 select / treasure 两列的体量

**这份文件不做决定，只摆数字。** 裁定权在用户。

每一条读数都是 2026-09-17 在 `xl-wou` worktree 上现量的；取数命令写在各节里。
**基线**：合并 master（`b6ecc4c3`）之后复核过 —— 那几步一个字都没动到
`tools/traces/`、`SceneDriver.java`、`traceReplay.test.ts`、`select.ts`，scene 名单
未变、18 份合计仍是 41,629,997 B，本文全部读数成立。
票面（`bd show xl-wou`）那几个数逐条复量过，两条成立、一条被推翻、一条的**分母
已经过期**。

---

## 一、复量票面

### 1.1 「14.6 → 22.1 MB（+7.5 MB）」—— **成立**

```bash
for rev in dd637a87~1 dd637a87; do
  t=0; for n in bigmap-walk dorm-exit dorm-intro dorm-walk milestone; do
    t=$((t + $(git show "$rev:tools/traces/out/$n.trace.json" | wc -c))); done; echo "$rev $t"
done
```

| | 五份合计 | |
|---|---|---|
| `dd637a87~1`（加列前） | 14,644,420 B | 14.64 MB / 13.97 MiB |
| `dd637a87`（加列后） | 22,121,610 B | 22.12 MB / 21.10 MiB |
| 增量 | **+7,477,190 B** | **+7.48 MB** |
| 今天 HEAD 的那五份 | 22,295,872 B | 22.30 MB |

票面的 14.6 → 22.1（+7.5）与 `xl-yg6.3` close reason 里的 14.0 → 21.1 是**同一批
字节的两种单位**（MB 与 MiB），两处都对。

### 1.2 ⚠️ 「五份场景真值」—— **分母已经过期，实际是 18 份**

driver 现数（`CLAUDE.md` 里那条命令）：

```bash
for f in tools/traces/scripts/*.json; do
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('driver','scene'))" "$f"
done | sort | uniq -c
```

今天 `driver == scene` 的是 **18 份**，共 **27,908 拍**：

| | 明文 | gzip -9 | git blob on-disk |
|---|---|---|---|
| 18 份现状 | **41,629,997 B（41.63 MB）** | 0.48 MB | 1.05 MB |
| 剥掉 `select` + `treasure` 两列 | 27,120,357 B（27.12 MB） | 0.38 MB | — |
| **两列实际占** | **14,509,640 B（14.51 MB）** | **≈0.10 MB** | — |

其中 `select` 一列 11.75 MB、`treasure` 一列 2.76 MB（18 份口径）。

**票面那个 7.5 MB 是今天真实代价的 52%。** 成因不是量错，是立票时 scene 真值只有
11 份、且票面只盯着 xl-yg6.6 重导过的那五份；`npc-defect` 等是之后加的。

### 1.3 ⚠️ 「select 那一列今天全是常量」—— **在任何一个分母下都不成立**

逐字段扫整条真值的取值集合（`select` 28 个 + `treasure` 6 个 = 34 个子字段）：

| 分母 | 恒定字段数 | 不恒定的是谁 |
|---|---|---|
| 票面的五份（15,842 拍，拍数与票面逐个相同） | **33 / 34** | `select.fought`：`[]` / `[false]` / `[false,false]` 三个取值 |
| 今天全部 18 份（27,908 拍） | **2 / 34** | 只有 `select.battleNo` 与 `select.sceneNo` 恒为 0 |

票面点名的四条**逐条成立**（五份口径下 `active` 全 `false`、`boxes` 全 `null`、
`answered` / `recorder` 全空），但由它们推出的「这 7.5 MB 眼下全是常量」**不成立** ——
`fought` 就在同一列里变着。

### 1.4 ⚠️ 「补真值（xl-yg6.7）之后才开始有信息」—— **立票时已经发生了**

```
e8bf8ae4  2026-09-09 21:17:17 -0700  Merge xl-yg6-6（加列，重导五份）
8ad4bd21  2026-09-09 22:34:36 -0700  Merge xl-yg6-7（补六份带答题/宝箱的真值）
xl-wou    2026-09-10 建票
```

补真值比加列晚 **77 分钟**，比立票早**一天**。这句话是从 `xl-yg6.6` 的 close reason
原样抄进票面的，抄的时候已经过期。今天 `question-answer` / `question-memory` /
`maze-treasure` 三份真值把这两列用满了（见 1.3 的 2/34）。

---

## 二、三条路的实测代价

口径统一：18 份 scene 真值的**明文字节**，括号里给相对基线 41.63 MB 的百分比，以及
相对「两列共 14.51 MB」的回收率。

| 路 | 明文体量 | 省下 | 占基线 | 回收增量 |
|---|---|---|---|---|
| **基线（现状）** | 41.63 MB | — | — | — |
| 1 · 就这样 | 41.63 MB | 0 | 0% | 0% |
| 2 · 收窄（砍 qy1/qx2/qy2 + recorder）**← 真的试做了** | **39.88 MB** | **1.75 MB** | 4.2% | **12%** |
|   · 只砍三个游标 | 40.95 MB | 0.68 MB | 1.6% | 4.7% |
|   · 只砍 recorder | 40.57 MB | 1.06 MB | 2.6% | 7.3% |
| 3a · 缩短键名（34 个键换成 1–2 字符） | 36.49 MB | **5.14 MB** | 12.3% | 35% |
| 3b · 恒定列提到 trace 头声明一次 | **30.47 MB** | **11.16 MB** | 26.8% | **77%** |
| （参照）两列整个不要 | 27.12 MB | 14.51 MB | 34.9% | 100% |

### 2.0 ⚠️ 先看一个会改变权重的读数：这两列在 git 里其实不贵

`tools/traces/out/` 是入库的，而 git 存的是压缩后的对象。五份在加列前后：

| | gzip -9（与 pack 无关） | 同一次 repack 里的 blob on-disk |
|---|---|---|
| `dd637a87~1` | 209,819 B | 216,745 B |
| `dd637a87` | 255,028 B | 225,611 B |
| 增量 | **+45,209 B（+45 KB）** | +8,866 B（+8.7 KB） |

18 份口径的 gzip 增量是 **+0.10 MB**。

**+7.48 MB 明文 ≈ +45 KB 压缩后。** 这一列每拍几乎原样重复，压缩器吃得干干净净。
（on-disk 那一列跨版本受 delta 链影响，是近似读数；gzip 那一列不受影响。）
明文体量真正的代价落在**工作区**（`tools/traces/out/` 现在 73 MB）与**导出/读取
耗时**上，不落在仓库大小上。

### 2.1 路 2 的试做（真做了一遍，产物没入库）

做法：改 `tools/src/devtools/SceneDriver.java` 的 `selectState()`，去掉
`qy1` / `qx2` / `qy2` 三行与 `recorder` 一行，`tools/build.sh` 重编，把 18 份 scene
真值**导到临时目录**（没有碰 `tools/traces/out/`）。

**先立对照组**：未改动的导出器重导 18 份，与入库真值 **18/18 逐字节一致**（64 秒）。
基线可信，下面的差值全部由这次收窄造成。

| | 18 份 | 五份 |
|---|---|---|
| 试做实测 | 39,884,921 B | 21,693,876 B |
| 文本层面模拟预测 | 39,884,921 B | 21,693,876 B |

两个数**逐字节对上**，所以第二节表里其余各变体的模拟数也是精确的（模拟器先验过
保真度：27,908 条 tick 行 Python 再序列化后与原文 0 处不一致）。

试做已还原：`tools/src/devtools/SceneDriver.java` 复原并重编，`git status` 干净。

### 2.2 候选一：qx1/qy1/qx2/qy2 —— **票面这条成立，留一个真的够**

源码 `src/scene/SelectEvent.java`（GBK，`iconv -f GBK` 现读）：

```
43-46:   private int x1_questionImage;  y1_  x2_  y2_        ← 四个 private int，初值 0
283-286: x1=512; y1=320; x2=512; y2=320;                     ← showQuestion 一次性置中心
446-450: if (x1_questionImage >= 262) { x1-=25; y1-=25; x2+=25; y2+=25; }
```

`grep` 全文对这四个标识符只有四处：43-46 声明、145-148 只读（drawImage 同时拿它们
当源矩形与目标矩形）、283-286 写、446-450 写。**没有别的赋值点。**

所以四个游标只有两族取值：**全 0**（问题框从未初始化），或
`(512−25k, 320−25k, 512+25k, 320+25k)`，k = 0…11（判据是自增**前**的 `x1 >= 262`，
262 那一拍仍满足、再减一次到 237 才停）。

`512 − 25k = 0` 要求 k = 20.48，`320 − 25k = 0` 要求 k = 12.8，都不是整数 ——
**四个游标一个都取不到 0**（离 0 最近的是 `qy1` 的 45）。0 因此唯一地表示
「从未 showQuestion 过」，**qx1 一个就能完全还原另外三个**。

⚠️ **还原必须写那条特判**：`qx1 == 0 → 四个全 0`。直接套公式会把 0 还原成
`(0, −192, 1024, 832)`，而原版那一拍是 `(0,0,0,0)`。

27,908 拍现测：`(qx1,qy1,qx2,qy2)` 只出现 **13 种组合**，全 0 那种 25,673 拍，
其余 12 种严格满足上式，**零例外**。

### 2.3 候选二：recorder 与 answered —— ⚠️ **票面这条被今天的真值证伪**

票面写「recorder 与 answered 是同一份数据」。对 27,908 拍逐拍核
`recorder[sceneNo].answered == answered`：

| | 拍数 |
|---|---|
| 相等 | 4,721 |
| **不相等** | **69** |
| `sceneNo` 在 `recorder` 里根本取不到（表为空） | 23,118 |

那 69 拍全在 `question-memory`，形状正是 `SceneDriver.selectState()` 注释里预警过的
那一种：

```
question-memory t=1616  scene=大地图.txt  sceneNo=0
  answered = []
  recorder = [{"scene": "大活.txt", "answered": [true, false, ×16]}]
```

走出「大活.txt」进「大地图.txt」之后 `answered` 空了，而 `count_scene` 停在 0，
于是 `recorder[0]` 指着**别的场景**的记录。

**去掉 recorder 不是去重，是丢信息。** 这条候选的前提已经不成立。

### 2.4 路 3b：恒定列提到 trace 头 —— 省得最多，也最贵

按**每条真值各自的**恒定集提头（这是唯一能省到 11 MB 的做法；按 18 份的全局恒定集
只有 2 个字段，省 0.70 MB）。各条真值的恒定字段数：

```
34: bigmap-walk dorm-intro dorm-walk load-slot0 load-slot1 load-slot2
    mapshort-both mapshort-height mapshort-width npc-defect
33: dorm-exit milestone      28: maze-treasure      24: equipshop-door shop-door
22: battle-door             7: question-answer      6: question-memory
```

票面自己指出的那个问题，实测比票面说的更重：不只是「这一列不存在」与「这一列没变」
分不开，而是**每条真值的列形状都不一样**（34 / 33 / 28 / 24 / 22 / 7 / 6 …），
`traceReplay.test.ts` 里 `groupsOf` + `unionSubKeys` 那条对撞**连分母都没有了**。
而头里那份声明由同一个导出器写 —— 拿它当判据正是 `docs/agents/dispatch.md` §3
点名的「把登记改成自动推导，等于让被守的东西自己给自己签字」。

---

## 三、每条路要配什么「会红的检查」，红起来是什么形状

### 3.0 现有判据是什么，以及它确实会红（实测）

`web/src/state/traceReplay.test.ts` 有两条逐字段守着这两列：

- 「每一列的子字段也对撞」：`unionSubKeys` **现扫整条真值**的列形状，与
  `OBSERVERS.select` 吐出的 28 个键对撞；
- 「逐格：登记成『已对齐』的格子逐 tick 与真值相等」：`select` × 18 条剧本，
  逐 tick `toEqual`。

把 2.1 的试做产物装进 `tools/traces/out/` 跑一遍（跑完已 `git checkout` 还原，
复跑 237/237 绿）：

```
Tests  235 passed | 2 failed (237)

× 每一列的子字段也对撞 —— 真值多一个字段，就得有人签它或登记它是死的
  → battle-door 的 select 子字段与真值不一致：真值有 abcd/active/answered/…/qx1/
    sceneNo/sentenceNo/shop/wordNo/yesNo（24 个）

× 逐格 … > battle-door · select：逐 tick 与真值相等
  → expected { t: +0, select: { …(28) } } to deeply equal { t: +0, select: { …(24) } }
```

**红得响、点名列与剧本。** 但下面这一点决定了它对路 2 没有防护力。

### 路 1 · 就这样

**不用加判据。** 上面那两条已经逐字段覆盖 34 个子字段中的每一个，且实测会红。
这是三条路里唯一一条「判据侧零成本」的。

### 路 2 · 收窄字段

⚠️ **上面那条红挡不住收窄** —— 收窄的正确做法本来就包含把 `OBSERVERS.select` 里
对应的键一起删掉，删完它立刻回绿。而 `web/src/state/select.ts:566-568` 与
`:759-761` 里 `qy1` / `qx2` / `qy2` 三个 stepper 还在跑，从此**一条判据都不核它们**。
所以路 2 必须自带新判据：

- **三游标**：在 `traceReplay.test.ts` 加一条**逐 tick 的推导对撞** —— 对每条真值
  每一拍断言 `port.qy1/qx2/qy2` 等于由真值 `qx1` 推出的三个值
  （`qx1 === 0` → 全 0；否则 `k = (512 - qx1) / 25`）。
  **红的形状**：`expected 295 to be 270`，并点名剧本与 tick 号。
  **分辨力今天可证**：把 `select.ts:760` 的 `+= STEP` 改成 `+= STEP * 2`，这条红而
  `qx1` 那一列仍绿 —— 正是 `dispatch.md` 要的前后对照。
  **代价要写明**：判据从「对着原版那一列」换成「对着一条推导」，推导本身
  （步长 25、中心 512/320、0 不可达）此后只由源码注释背书。

- **recorder**：**没有便宜的替代判据**。它守的是原版
  「`haveAnswered` 与 `answeredRecorder.get(count_scene)` 是同一个对象」
  （`SelectEvent.java:101` / `:108` 认领，`:396-397` 每次作答重挂）。唯一不动真值的
  替代是在 `tools/test.sh` 里给 `src/scene/SelectEvent.java` 写一条对象同一性单测 ——
  那要破 `CLAUDE.md` 写明的「不 unit-test `src/`，原始源码是冻结规格」。
  何况 2.3 的 69 拍已经说明去掉它**真的丢信息**，不只是丢判据。

### 路 3a · 缩短键名

**不用新判据，但要一张手写登记表。** 改名是一一映射，子字段对撞比的就是键名，
observer 必须跟着改名才回绿。要加的是一张**手写**的新旧名对照表 —— 按
`dispatch.md` §3 的分法这是「登记」不是「分母」，**必须由人签**，不能从导出器现扫。

### 路 3b · 恒定列提头

**要新造一整条判据，而且不好造。** 列形状不再逐条一致，`groupsOf` / `unionSubKeys`
那条对撞失效；替代品必须核「头里声明的恒定值 == 原版那一拍的真实值」，而两边都由
同一个导出器写，天然恒真。不改导出器就能做的唯一形状是：**同一份真值导两遍，
一遍提头一遍不提，在 CI 里比对还原结果** —— 那等于把省下的体量又加回去，并且
把 `--check` 的耗时再翻一倍。

---

## 四、三条路离用户故事 23 有多远

原文（`bd show xl-yg6.3`，第 23 条）：

> 作为迁移开发者，我想快照只记会变的游标与旗标、不记静态文本，**以便体量不因为
> 重复验证同一件事而翻几倍**。

这句话有两个半句，实测它们今天指向**不同**的结论：

- **「不记静态文本」那半句今天是满足的。** 两列一个静态文本字段都没记：题面、选项、
  回答文本（`currentSentences` / `bufferedText`）、物品名与金额全在数据层或被显式
  排除，理由逐条写在 `SceneDriver.selectState()` / `treasureState()` 的注释里。
  我核过导出的 34 个键，确实一个文本字段都没有。

- **「不因为重复验证同一件事而翻几倍」那半句：翻倍是真的，但「重复验证同一件事」
  在今天的分母下不成立。** 27.12 → 41.63 是 1.54 倍；而 34 个字段里 **32 个有信息**
  （1.3）。它只在**五份**那个分母下成立（33/34 恒定），而那个分母 2026-09-09 22:34
  就不再是全部了。

各条路的距离：

| 路 | 离故事 23 | 一句话 |
|---|---|---|
| **1 就这样** | 前半句已满足；后半句今天不适用 | 没有在重复验证同一件事。压缩后代价 0.10 MB |
| **2 收窄** | **最远** | 省 1.75 MB（增量的 12%）。recorder 那一半会丢信息（69 拍实测），三游标那一半是真冗余、但要拿一条推导判据换。为 4% 的明文花掉一条对着原版的判据 |
| **3a 短键名** | 不相干 | 省 5.14 MB，判据不受影响，但它省的是键名不是「重复验证」，是纯压缩 |
| **3b 恒定提头** | **最近**（字面上） | 省 11.16 MB（增量的 77%），唯一真正兑现「不为恒定列付体量」的一条；代价是拆掉现有唯一守着「列形状」的那条对撞 |

---

## 五、给裁定者的三个数

1. **在 git 里这两列一共值 45 KB（五份 gzip）到 100 KB（18 份 gzip）**，不是 7.5 MB
   也不是 14.5 MB。明文体量的代价落在工作区（`out/` 73 MB）与导出耗时上。
2. **票面点名的两个收窄候选，一个成立一个被证伪**：三游标留一个真的够（27,908 拍
   零例外）；recorder 与 answered 不是同一份数据（69 拍不相等）。两个一起砍也只回收
   增量的 12%。
3. **三条路里只有路 1 判据侧零成本**；路 2 要拿一条「对着原版」的判据换一条「对着
   推导」的判据；路 3b 省得最多，代价是现有唯一守着列形状的那条对撞整个失效。

---

## 附：本文每个数字的取数命令

```bash
# 1.1 / 1.2 体量
for f in tools/traces/scripts/*.json; do
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('driver','scene'))" "$f"; done | sort | uniq -c
wc -c tools/traces/out/<name>.trace.json
git show "dd637a87~1:tools/traces/out/<name>.trace.json" | wc -c

# 2.0 压缩后
git show "<rev>:tools/traces/out/<name>.trace.json" | gzip -9 | wc -c
git cat-file --batch-check='%(objectsize:disk)' <<< "$(git rev-parse HEAD:tools/traces/out/<name>.trace.json)"

# 1.3 / 2.2 / 2.3 逐字段扫（每行一拍，紧凑 JSON，可逐行 json.loads）
#   —— 先验保真度：re-serialize 后与原文逐字节比，27908 行 0 处不一致

# 2.1 试做：改 SceneDriver.selectState() → tools/build.sh →
#   java … devtools.ExportTrace tools/traces/scripts/<n>.json <临时目录>/<n>.trace.json
#   对照组先跑一遍未改动的，与入库真值 cmp 应 18/18 一致

# 3.0 判据形状
cd web && pnpm vitest run src/state/traceReplay.test.ts
```

## 六、裁定结果与重开阈值

**2026-09-17，用户拍板：路 1「就这样」。** xl-wou 据此关闭，本文入库作为证据链。

⚠️ **这条裁定是有条件的，条件是两个可现量的阈值。** 命中任何一个就该重开 ——
而重开时该重估的**不是路 2**（它省的 4% 明文换一条判据，方向是反的），而是
**路 3b（恒定列提头）**：只有它能回收增量的 77%，到那时才值得为它造判据。

| 阈值 | 今天的读数 | 怎么现量 |
|---|---|---|
| `tools/traces/out/` 工作区超过 **200 MB** | **73 MB** | `du -sh tools/traces/out` |
| `tools/export-trace.sh --check` 全量超过 **10 分钟** | **364 秒**（63 份剧本，真 runner） | 见下 |

⚠️ **那 364 秒不是本文量的**，是 xl-u7b 在真 GitHub runner 上量的（run 35224054598），
现读自 `CLAUDE.md`：`--check` 全量 364 s、63/63 逐字节一致、`git diff tools/traces/out`
为 0。本机那个流传已久的 **2m34s 是 38 份剧本时的旧读数，已经不成立** —— 今天是
63 份（现数：`ls tools/traces/scripts/*.json | wc -l`），且 `--check` 自 xl-u7b 起
**已经接进 CI**（`java.yml` 的 `trace` job，与 `check` job 并行）。所以这条阈值现在
读 CI 的 job 耗时即可，不必在本机跑。

---

## 附：本文没有做的事

- **没有改真值、没有改 `SceneDriver` 并入库。** 试做全部还原，`git status` 干净。
- **没有跑 `tools/export-trace.sh --check`**（全量 63 份，真 runner 上 364 秒）。
  本文所有体量差值都建立在「未改动的导出器重导 18 份与入库真值 **18/18 逐字节
  一致**」这一条对照组上 —— 那条对照组是本文唯一的确定性依据，且它只覆盖
  scene 那 18 份，不覆盖另外 45 份。
- **没有验证路 2 那条推导判据真的写出来之后是什么样** —— 只说明了它的形状与该拿
  哪条篡改证它的分辨力。
- **`git blob on-disk` 那一列是近似**（跨版本 delta 链不同）；`gzip -9` 那一列不是。
