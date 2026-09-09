import type { MenuAudioSettings } from '../menu/types'

/**
 * 音频那两个开关的家 —— `MusicPlayer.CAN_PLAY_BGM` / `CAN_PLAY_MUSIC` 的对应物。
 *
 * 原版那两个是 **static** 字段：菜单关掉背景音乐之后，回场景、再打开菜单、
 * 再打一场仗，它都还是关着的。而这一层**每次开菜单都新建一份菜单世界**
 * （`session.ts` 的 `openMenu`），所以那个设置得有个活得比菜单久的地方 ——
 * 就是这里，与队伍那一份（`fakes/party.ts`）同一个手法、同一个理由。
 *
 * 这不是"假"：它没有替代任何还没做的东西，它就是那两个 static 本身。
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
