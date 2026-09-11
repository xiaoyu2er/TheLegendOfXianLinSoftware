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
 * 谁读它们：`bgm` 由 `session.ts` 的 `currentBgm` 读（关着就声明 `null`，背景音乐
 * 播放器停），`sfx` 由 `session.ts` 的 `playSfx` 每拍拨到音效播放器的
 * `setEnabled` 上（xl-03x.8）。**各读各的**：原版两个开关各自只被自己那条播放
 * 线程读，读数与判据在 `sfxSwitch.test.ts`。
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

/** 回到出厂值。**测试用** —— 用例之间不隔离的话，前一条的关会漏进后一条。 */
export function resetAudioSettings(): void {
  current = { ...DEFAULT_AUDIO_SETTINGS }
}
