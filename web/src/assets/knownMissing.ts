/**
 * **已知缺失清单**：仓库里确实没有、而数据确实引用了的资源。
 *
 * 为什么要有这么一张表：硬校验的规则是"少一条就构建失败"，但仓库当下就少
 * 37 条 —— 27 帧 NPC 素材从未交付、9 个出口目标不是脚本文件、1 条 NPC 路径
 * 漏了扩展名。不给它们一个位置，硬校验就只能被关掉，那等于没有。
 *
 * 这张表把"已知缺"和"新缺"分开，代价是它必须**两头都会红**：
 *
 *   - 表外的缺失 → 构建失败（新引入的坏路径）
 *   - 表内的路径**存在了** → 构建同样失败（数据修好了却没来销账）
 *
 * 第二条是关键。只写第一条的话，这张表会慢慢变成一堆没人敢删的字符串，
 * 而"清单里全都还缺着"与"清单早就过期了"看起来一模一样 —— 这正是本项目
 * 反复栽的那种坑。
 *
 * 每一条都必须挂一个 bd issue：这里记的是"暂时容忍"，不是"就这样了"。
 */
export interface KnownMissing {
  /** 仓库根目录下的相对路径，与 `SceneAssetRef.path` 逐字相等。 */
  path: string
  /** 追这条的 bd issue。 */
  issue: string
}

/** 数据不成形、连路径都拼不出来的已知处，键是 `SceneDefect.where`。 */
export interface KnownDefect {
  where: string
  issue: string
}

const npcFrames = (folder: string, from: number, to: number, issue: string): KnownMissing[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    path: `NPCs/${folder}/${from + i}.png`,
    issue,
  }))

export const KNOWN_MISSING: readonly KnownMissing[] = [
  // xl-1dv.1 —— 27 帧素材从未交付，三个 NPC 十三年来一直是隐形的。
  // 帧号不是 1..n：单向走动的首帧号就是方向码（NPC.java:71），
  // 所以 图书馆管理员 缺的是 9..16 而不是 1..8。
  ...npcFrames('太极老师', 1, 8, 'xl-1dv.1'), // 仙一102.txt
  ...npcFrames('打坐的文科男', 1, 11, 'xl-1dv.1'), // 仙二205.txt（目录名疑为 打坐的文院男 之误）
  ...npcFrames('图书馆管理员', 9, 16, 'xl-1dv.1'), // 藏经阁一层夜.txt（目录名疑为 图书管理员N 之误）

  // xl-1dv.3 —— NPCs/商塔副堂主.png 是有的，数据里漏了扩展名。
  { path: 'NPCs/商塔副堂主', issue: 'xl-1dv.3' },

  // xl-1dv.11 —— 目标脚本名行尾多一个空格。这两条**结尾的空格是数据的一部分**，
  // 别在编辑器里顺手 trim 掉，那样这张表就对不上了。
  { path: 'script/仙二教学楼二楼.txt ', issue: 'xl-1dv.11' },
  { path: 'script/仙二教学楼二楼夜.txt ', issue: 'xl-1dv.11' },

  // xl-1dv.12 —— 仓库里只有 仙一教学楼一楼/二楼/三楼/四楼。
  { path: 'script/仙一教学楼.txt', issue: 'xl-1dv.12' },

  // xl-1dv.13 —— 6 个剧情脚本拿 Exit 段当剧情标记用，目标不是文件。
  { path: 'script/中途逃跑', issue: 'xl-1dv.13' },
  { path: 'script/消失', issue: 'xl-1dv.13' },
  { path: 'script/出现黑衣人', issue: 'xl-1dv.13' },
  { path: 'script/李洵逃跑', issue: 'xl-1dv.13' },
  { path: 'script/比武第二阶段', issue: 'xl-1dv.13' },
  { path: 'script/最终话', issue: 'xl-1dv.13' },
]

export const KNOWN_DEFECTS: readonly KnownDefect[] = [
  // xl-1dv.14 —— NPC 名与口头禅之间的空格写成了全角逗号，字段少一个，
  // 原版读到这一条 ArrayIndexOutOfBoundsException，被 Reader.switchReader 吞掉：
  // 场景照进，只建出它前面那 3 个 NPC（xl-03x.13 实跑，见 state/npc.ts 的 createNpcs）。
  { where: '仙二205.txt npcList[3]', issue: 'xl-1dv.14' },
]
