import { stem } from './path'

/**
 * 音效素材（xl-03x.5）：原版 `MusicReader.music = new MusicPlayer("sources/music")`
 * 读的那个目录。背景音乐是另一个播放器实例、另一个目录（`sources/BGM`），
 * 走 `bgmAssetId` 那一路，两边互不相干。
 *
 * ## 烘哪几个：目录里有什么就烘什么
 *
 * 分母是现扫 `sources/music/` 的，不是原版调用点里点过名的那几个。点过名的
 * 那份名单要从 GBK 源码里现读，放进烘焙器就等于让 `src/**` 全体进指纹 ——
 * 改一行原版注释都得重烘。而没被点名的那几个转码后只占三成不到的体积（数字见
 * 提交信息），不值得为它让烘焙器去读 Java。「点过名的都烘到了」由
 * `sfxAssets.test.ts` 从源码现读核对，方向是单向的：点名的必须在，多烘的无妨。
 *
 * ## 打包边界：全部进主包的映射表
 *
 * 与战斗那批**相反**：那边切出去的是「这一场多半一张都用不到」的逐帧动画；
 * 音效是**一响就要出声**的，按需那条路（动态 import 名单 → 拼 URL → fetch）
 * 在第一声之前多一次异步往返。而进映射表的代价只是每个文件一条 URL 字符串 ——
 * 二进制走 `?url`，不进 JS（`assetsInlineLimit: 0`）。前后的 `pnpm build`
 * 体积对比见提交信息。
 */

/** 原版音效根目录，仓库相对。 */
export const SFX_ROOT = 'sources/music'

/** 产物相对路径（相对 `src/generated/assets/`）。`换list.wav` → `sfx/换list.m4a`。 */
export function sfxProductPath(file: string): string {
  return `sfx/${stem(file)}.m4a`
}
