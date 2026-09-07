/**
 * 六种回复类药品（xl-rh9.11）。
 *
 * 数据源是 `sources/Shop/drug.txt`（GBK + CRLF，五列：名字 / 加血 / 加蓝 /
 * 图片文件名 / 价钱）。这里抄的是那五列里状态层与药品菜单用得到的四列，
 * **判据是 `drugs.test.ts`**：它自己去读那份 GBK 数据再逐行对，抄错一位就红。
 * 与 `units.ts` 抄怪物属性是同一套办法 —— 这一层不读磁盘（它要进浏览器包），
 * 而"抄"这件事必须有人核。
 *
 * ## 存货恒为 0，而那正是这条路径的前提
 *
 * `Drug.numberGOT` 是 int 字段，`ShopReader.readDrug()` **不给它赋值**，
 * 数据文件里也没有那一列。也就是说一份没读过存档的进程里六种药一个都没有，
 * 于是 `DrugMenu.checkDrugNumber` 走的是 else 那一支 `bp.reminder.show(19)`。
 * `battle-menus` 那条真值走的就是这一路：既盖住了药品菜单、又盖住了提示图，
 * 而且一行「用药」的状态后果都不必先实现。
 */
export interface DrugSpec {
  readonly name: string
  readonly addHp: number
  readonly addMp: number
  /** `sources/Shop/药品/回复类/<picture>`。药品菜单的介绍图就是它。 */
  readonly picture: string
  readonly reduceMoney: number
}

export const DRUGS: readonly DrugSpec[] = [
  { name: '金创药', addHp: 300, addMp: 0, picture: '金创药.png', reduceMoney: 1000 },
  { name: '姜黄粉', addHp: 0, addMp: 200, picture: '姜黄粉.png', reduceMoney: 1200 },
  { name: '还魄丹', addHp: 600, addMp: 0, picture: '还魄丹.png', reduceMoney: 4000 },
  { name: '还灵丹', addHp: 0, addMp: 400, picture: '还灵丹.png', reduceMoney: 4500 },
  { name: '神农药方', addHp: 1500, addMp: 0, picture: '神农药方.png', reduceMoney: 10000 },
  { name: '灵神天药', addHp: 0, addMp: 1200, picture: '灵神天药.png', reduceMoney: 15000 },
]

/**
 * 药品菜单里那一行介绍文字（`DrugMenu.checkMoveIn`）：
 * `"hp "+getAddHp()+" mp "+getAddMp()`。空格与大小写照抄 —— 它进真值。
 */
export function drugIntroText(drug: DrugSpec): string {
  return `hp ${drug.addHp} mp ${drug.addMp}`
}
