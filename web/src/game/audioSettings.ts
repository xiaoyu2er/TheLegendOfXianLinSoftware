import type { MenuAudioSettings } from '../menu/types'

/**
 * 音频那两个开关的家 —— `MusicPlayer.CAN_PLAY_BGM` / `CAN_PLAY_MUSIC` 的对应物。
 *
 * 原版那两个是 **static** 字段：菜单关掉背景音乐之后，回场景、再打开菜单、
 * 再打一场仗，它都还是关着的。而这一层**每次开菜单都新建一份菜单世界**
 * （`session.ts` 的 `openMenu`），所以那个设置得有个活得比菜单久的地方 ——
 * 就是这里，与队伍那一份（`fakes/party.ts`）同一个手法、同一个理由。
 *
 * ## 为什么它不在假货登记册里（ADR-0005 / `fakes/registry.ts`）
 *
 * 登记册守的是"**顶替物**"：一个临时的东西站在真东西的位置上，而真的那一份
 * 做出来的那天没人记得这里还挂着一个假的。这两个开关不是顶替物 —— 它们**就是**
 * `MusicPlayer` 那两个 static 本身，没有一个"真的版本"在别处等着替换它们。
 *
 * ⚠️ **但 `sfx` 今天写了没人读**，这一条要说清楚：整个 web 端没有音效播放器
 * （`sources/music/` 35 个文件从 M2 起就没进过烘焙，`menu/step.ts` 里
 * `w.music` 那一列也是同样的处境），所以「特殊音效 开 / 关」改得动这个字段、
 * 却改不动任何声音。**缺的是播放器，不是这个开关** —— 播放器是 **xl-8l2**，
 * 它到位那天要读的正是这里。写成"等 xl-8l2 再加这个字段"的话，`checkPressed()`
 * 第 8/9 段就得少抄两句，而那两段的 `isDraw` 与出不出声都是要照抄的。
 *
 * 为什么不直接让菜单层读写这个模块：状态层要是纯的（同一条真值跑两遍必须
 * 得到同一串快照），一个模块级可变量会让第二遍从第一遍的尾巴上接着跑。
 * 所以设置进出菜单世界各走一次 —— `openMenu` 喂进去，每一拍再记回来。
 */

/**
 * 原版那两个字段的初值：`public static int CAN_PLAY_BGM = 1;`（= YES）、
 * `CAN_PLAY_MUSIC = 1;`。两个都开着。
 */
export const DEFAULT_AUDIO_SETTINGS: Readonly<MenuAudioSettings> = { bgm: true, sfx: true }

let current: MenuAudioSettings = { ...DEFAULT_AUDIO_SETTINGS }

/** 此刻那两个开关。**返回的是副本** —— 拿到手随便改，改不到这里。 */
export function getAudioSettings(): MenuAudioSettings {
  return { ...current }
}

/** 记下这一拍的那两个开关（菜单世界推完之后调）。 */
export function rememberAudioSettings(settings: Readonly<MenuAudioSettings>): void {
  current = { bgm: settings.bgm, sfx: settings.sfx }
}

/**
 * `MusicReader.openBGM()` 里 `CAN_PLAY_BGM = YES` 那一句：只拨背景音乐那一位，
 * 特殊音效那位不碰。前一句 `play(currentPlayingBGM)` 这一层不用抄 —— 该放哪首
 * 是 `currentBgm` 现算的，开关一开它自己就不再是 `null`。
 *
 * 调用点是会话翻到标题的每一处（`switchTo("start")` 那一支末尾就是这一句，xl-03x.21）。
 */
export function openBgm(): void {
  current = { ...current, bgm: true }
}

/** 回到出厂值。**测试用** —— 用例之间不隔离的话，前一条的关会漏进后一条。 */
export function resetAudioSettings(): void {
  current = { ...DEFAULT_AUDIO_SETTINGS }
}
