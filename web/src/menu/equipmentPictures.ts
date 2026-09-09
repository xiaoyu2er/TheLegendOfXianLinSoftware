import { equipPictureAssetId } from '../assets/ids'
import type { AssetId } from '../assets/ids'
import { SLOT_FILE } from './equipment'
import type { EquipSlot } from './equipment'

/**
 * 装备页那两张图的素材层（xl-234）。
 *
 * 原版 `shop.ShopReader.readEquipment(s)` 那一句：
 *
 *     equipment.setPicture(Reader.readImage("sources/Shop/装备/" + s + "/" + lineArray[5]));
 *
 * 也就是 `sources/Shop/装备/<类>/<表里第 6 列那个文件名>`，而 `s` 恰好就是
 * `SLOT_FILE[slot]`（`sources/Shop/<s>.txt` 是同一个 `s`）—— 所以这里不再抄
 * 一份目录名表，直接用它。抄第二份的表现是"某一类的图全空了"。
 *
 * ## 磁盘上有 89 个文件，能烘的只有 59 个
 *
 * `sources/Shop/装备/` 下混着两种东西：**59 个 `.png`**（原版真正读的那批），
 * 和 **30 个 `.bmp`**（美术源文件，16 位 `BI_BITFIELDS`，`file` 报
 * `120 x 220 x 16, 3 compression`）。后者两条路都走不通，而且是当场量出来的：
 *
 * - **原版一条都读不到**：六张表 56 行的第 6 列**全是 `.png`**（现数，
 *   `EQUIP_PICTURE_EXTENSIONS` 那条判据每次跑都重数一遍）；
 * - **`cwebp 1.6.0` 读不了它们**：`Error! Could not process file …银戒指.bmp`，
 *   退出码 1（这个仓库用的就是这一版）；
 * - **它们和 `.png` 撞产物路径**：29 个词干两种扩展名各有一份，按"扩展名一律
 *   换成 `.webp`"落盘的话，后写的静静盖掉前一张 —— 而画面上两者长得一样
 *   （同尺寸的同一件装备），谁都看不出来盖错了。
 *
 * 所以 `.bmp` 那 30 个**登记为不烘**（dispatch.md 纪律 3 意义上的登记，不是
 * 分母）：名单是手写的，而**分母现扫** —— 磁盘上出现第三种扩展名，烘焙器
 * 硬失败并点名，不会悄悄跳过。
 *
 * ## 数据点名了、仓库里却没有的那两张
 *
 * 跟 `knownMissing.ts` 那 37 条同一类，也同一个规矩：**两头都要红**。
 * 表内的路径哪天存在了，烘焙器同样硬失败（"数据修好了却没来销账"）。
 * 原版在这两处画的是 `new ImageIcon(<不存在的路径>).getImage()` —— 一个宽度
 * −1 的空壳，`g.drawImage` 什么都不画（`tools.Reader.readImage` 只在 stderr
 * 上警告一句）。Web 侧照抄这件事：`equipPictureId` 对它们返回 `null`，
 * 绘制清单里就没有那一条。
 *
 * ⚠️ 名单上是**三**条，不是票面写的两条。第三条（`钛珖奇鞋.png`）是烘焙器
 * 的对账当场抓出来的，手写的 `while read` 抽查一次都没查到它 —— 理由记在
 * 那一条自己的注释里。
 *
 * ## 分包：整批进主包，量出来的
 *
 * 票面明写「分包放哪一边要量，不要照抄」。**量的是这一趟自己的读数**
 * （2026-09-09，同一台机器上跑 `pnpm build`）：
 *
 *   构型                        index-*.js   对基线      gzip       对基线
 *   基线（装备图一张都不烘）      851.24 kB      —      229.55 kB      —
 *   **59 张全进主包**            862.81 kB  **+11.57 kB** 232.48 kB **+2.93 kB**
 *
 * 产物 **821,292 B**（59 张，源 1,210,500 B，`-lossless` 压到 67.9%）。
 *
 * 为什么不学 `装备/` 那 28 张菜单贴图走按需：**两条路的下载行为是一样的**。
 * 进主包走的是 `resolve.ts` 那条 `?url` 的 eager glob —— 进 JS 的只有**路径
 * 字符串**，二进制由 Vite 拷进 `dist/assets/` 等人来取，跟 `public/` 下那批
 * 一样是用到才下。也就是说按需那条路买到的只有上面那 11.57 kB，代价是一整
 * 条新的按需通道（第三份名单 + 第三个 `public/` 目录 + `menuAssetUrl` 里
 * 第三支分流）。11.57 kB 换那些，不值。
 *
 * 对照：整个菜单骨架 47 张进主包是 +7.71 kB（`menuAssets.ts` 头注），
 * 每条映射约 164 B；这里 59 张 11.57 kB，每条约 196 B —— 同一个量级。
 * ⚠️ 那个 7.71 kB 是**另一趟、另一个基线**上量的，不能跟这里的数直接相减。
 */

/** 原版装备图根目录，仓库相对。 */
export const EQUIP_PICTURE_ROOT = 'sources/Shop/装备'

/**
 * 要烘的扩展名。**登记**，不是分母 —— 判据在 `equipmentPictures.test.ts`：
 * 六张表点名的扩展名集合必须恰好等于它。
 */
export const EQUIP_PICTURE_EXTENSIONS: readonly string[] = ['.png']

/**
 * 磁盘上有、而原版读不到的扩展名（美术源文件）。**登记**，理由见头注。
 * 磁盘上出现这两份名单之外的扩展名 → 烘焙硬失败。
 */
export const EQUIP_PICTURE_IGNORED_EXTENSIONS: readonly string[] = ['.bmp']

/** 数据点名了、仓库里却没有的一张图。 */
export interface MissingEquipPicture {
  readonly slot: EquipSlot
  /** 表里第 6 列那个文件名，逐字。 */
  readonly picture: string
  /** 追这条的 bd issue。 */
  readonly issue: string
  /** 磁盘上那个长得几乎一样的名字 —— 这两条都是一个字之差。 */
  readonly note: string
}

/**
 * 已知缺失的装备图。两条都是**数据里的名字和文件名差一个字**，
 * 而两个字都念得通，所以十三年没人发现。
 */
export const KNOWN_MISSING_EQUIP_PICTURES: readonly MissingEquipPicture[] = [
  // xl-234 —— 磁盘上是 颀崟巨环.png（山字头的「崟」），数据写的是「鉴」。
  { slot: 'weapon', picture: '颀鉴巨环.png', issue: 'xl-234', note: '颀崟巨环.png' },
  // xl-234 —— 磁盘上是 银项练.png（「练」），而 银项链.bmp（「链」）恰好是
  // 那个不烘的 `.bmp`，所以「导出时改了一个字」这件事在磁盘上还留着痕迹。
  { slot: 'decoration', picture: '银项链.png', issue: 'xl-234', note: '银项练.png' },
  // xl-234 —— 磁盘上是 钛銧奇鞋.png（金字旁的「銧」U+92A7），数据写的是
  // 「珖」（U+73D6，王字旁）。⚠️ 这一条是**烘焙器的对账抓出来的**，手写的
  // `while read` 抽查漏了它：`sources/Shop/脚.txt` 结尾没有换行符，
  // `read` 读到最后一行时返回非零，循环体一次都没跑 —— 而"抽查干净"与
  // "没抽到"长得一模一样。四份表里有四份结尾无换行。
  { slot: 'shoe', picture: '钛珖奇鞋.png', issue: 'xl-234', note: '钛銧奇鞋.png' },
]

/** 一张装备图在仓库里的路径（仓库相对，正斜杠）。 */
export function equipPictureSource(slot: EquipSlot, picture: string): string {
  return `${EQUIP_PICTURE_ROOT}/${SLOT_FILE[slot]}/${picture}`
}

/** 这张图是不是那两条已知缺失之一。 */
export function isKnownMissingEquipPicture(slot: EquipSlot, picture: string): boolean {
  return KNOWN_MISSING_EQUIP_PICTURES.some((m) => m.slot === slot && m.picture === picture)
}

/**
 * 一张装备图的逻辑 ID，**已知缺失的返回 `null`**。
 *
 * 为什么不是"查不到就不画"：那样"这一张原版本来就没有"与"烘焙漏了一张"
 * 长得一模一样，而后者的表现只是某一件装备选中时中间是空的 —— 没人看得
 * 出来。跟 `resolveAssetOrNull` 是同一个套路，只是这一层判得更早：名单外的
 * 照旧出 ID，取不到图由 `resolveAsset` 抛。
 */
export function equipPictureId(slot: EquipSlot, picture: string): AssetId | null {
  if (isKnownMissingEquipPicture(slot, picture)) return null
  return equipPictureAssetId(SLOT_FILE[slot], picture)
}
