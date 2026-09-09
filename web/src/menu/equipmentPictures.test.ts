import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listFiles } from '../assets/listFiles'
import { repoPath } from '../test/repoPath'
import { EQUIPMENT_LISTS, EQUIP_SLOTS, SLOT_FILE } from './equipment'
import type { EquipSlot } from './equipment'
import {
  EQUIP_PICTURE_EXTENSIONS,
  EQUIP_PICTURE_IGNORED_EXTENSIONS,
  EQUIP_PICTURE_ROOT,
  KNOWN_MISSING_EQUIP_PICTURES,
  equipPictureExtension,
  equipPictureId,
  equipPictureSource,
  isBakedEquipPicture,
  isIgnoredEquipPicture,
  isKnownMissingEquipPicture,
  reconcileEquipPictures,
} from './equipmentPictures'

/**
 * 装备图那一层的**登记与对账**（xl-234）。
 *
 * 两半，分开：
 *
 * - 上半是**登记对撞另一个来源**：两份手写的扩展名名单与三条已知缺失，各自
 *   要被一个独立算出来的东西核一遍（数据的第 6 列 / 磁盘）。
 * - 下半是**对账本身的失败形态**：`reconcileEquipPictures` 是纯函数，所以
 *   五条失败每一条都真造出来看一眼。只在真仓库上跑一遍全绿，跟"这几条根本
 *   没写对"长得一模一样。
 */

/** 磁盘上 `sources/Shop/装备/` 的现扫清单（相对根，正斜杠）。 */
function onDisk(): string[] {
  const files = listFiles(repoPath(EQUIP_PICTURE_ROOT))
  expect(
    files.length,
    `${EQUIP_PICTURE_ROOT} 下一个文件都没有 —— 下面每一条的分母都塌了`,
  ).toBeGreaterThan(0)
  return files
}

/** 六张表第 6 列点名过的全部文件名。 */
function namedByData(): { slot: EquipSlot; picture: string }[] {
  return EQUIP_SLOTS.flatMap((slot) =>
    EQUIPMENT_LISTS[slot].map((item) => ({ slot, picture: item.picture })),
  )
}

describe('两份扩展名登记，被数据与磁盘各核一遍', () => {
  it('要烘的那份 = 六张表点名过的扩展名集合，一个不多一个不少', () => {
    // 这一条的分母是**数据**（`equipment.ts` 的 picture 列，而那一列由
    // `equipment.test.ts` 核回 GBK 的 `sources/Shop/*.txt`），与被核的那份
    // 手写名单彼此独立。拿磁盘去核它是不行的：磁盘上有 30 个原版一辈子读
    // 不到的 `.bmp`。
    const named = namedByData()
    expect(named.length, '六张表一行都没有').toBeGreaterThan(0)
    const exts = [...new Set(named.map((n) => equipPictureExtension(n.picture)))].sort()
    expect(exts).toEqual([...EQUIP_PICTURE_EXTENSIONS].sort())
  })

  it('两份登记合起来盖住磁盘上的每一个文件，而且两份互不相交', () => {
    const files = onDisk()
    expect(files.filter((f) => !isBakedEquipPicture(f) && !isIgnoredEquipPicture(f))).toEqual([])
    // 互不相交：同一个扩展名同时进两份的话，"烘了"与"登记为不烘"就并存了。
    expect(
      EQUIP_PICTURE_EXTENSIONS.filter((e) => EQUIP_PICTURE_IGNORED_EXTENSIONS.includes(e)),
    ).toEqual([])
    // 两边都得非空 —— 空的那一份会让上面那条塌成恒真的一半。
    expect(files.filter(isBakedEquipPicture).length).toBeGreaterThan(0)
    expect(files.filter(isIgnoredEquipPicture).length).toBeGreaterThan(0)
  })

  it('登记为不烘的那批，原版一条都读不到 —— 数据里一次都没点过名', () => {
    // 这才是"不烘"的**理由**。少了这一条，往 IGNORED 里塞一个 `.png`
    // 就能让一整批图静静消失，而别的判据一条都不会红。
    const ignoredExts = new Set(EQUIP_PICTURE_IGNORED_EXTENSIONS)
    for (const { slot, picture } of namedByData()) {
      expect(
        ignoredExts.has(equipPictureExtension(picture)),
        `${slot} 表点名了 ${picture}，而它的扩展名登记成了"不烘"`,
      ).toBe(false)
    }
  })

  it('扩展名取的是最后一个点之后那一段，没有点就是空串', () => {
    expect(equipPictureExtension('武器/月苗刀.png')).toBe('.png')
    expect(equipPictureExtension('饰品/银戒指.BMP')).toBe('.bmp')
    expect(equipPictureExtension('武器/没有扩展名')).toBe('')
  })
})

describe('三条已知缺失，两头都验', () => {
  it('每一条：数据真的点了名、仓库里真的没有、旁边那个只差一个字的真的在', () => {
    expect(KNOWN_MISSING_EQUIP_PICTURES.length).toBeGreaterThan(0)
    const named = new Set(namedByData().map((n) => `${n.slot} ${n.picture}`))
    for (const m of KNOWN_MISSING_EQUIP_PICTURES) {
      expect(named.has(`${m.slot} ${m.picture}`), `${m.slot} 表里没有一行点名 ${m.picture}`).toBe(
        true,
      )
      expect(
        existsSync(repoPath(equipPictureSource(m.slot, m.picture))),
        `${equipPictureSource(m.slot, m.picture)} 现在存在了 —— 从名单里删掉`,
      ).toBe(false)
      expect(
        existsSync(repoPath(equipPictureSource(m.slot, m.note))),
        `${m.note} 不在 —— 那这就不是"差一个字"，是整批没交付`,
      ).toBe(true)
      // 差的真的只是名字，不是目录：两者同一个类目录。
      expect(m.note).not.toBe(m.picture)
      expect(m.issue).toMatch(/^xl-/)
    }
  })

  it('名单上的返回 null，名单外的照旧出 ID', () => {
    const m = KNOWN_MISSING_EQUIP_PICTURES[0]!
    expect(equipPictureId(m.slot, m.picture)).toBeNull()
    // 正向控制：同一个槽位上别的东西照旧有 ID，否则上面那条在"全都返回 null"
    // 时也是绿的。
    const ok = EQUIPMENT_LISTS[m.slot].find((i) => !isKnownMissingEquipPicture(m.slot, i.picture))!
    expect(equipPictureId(m.slot, ok.picture)).toBe(`equip:${SLOT_FILE[m.slot]}/${ok.picture}`)
  })
})

describe('对账的五条，每一条都真造一次失败', () => {
  /** 今天入库的那个状态：真磁盘 + "除了已知缺失全都烘出来了"。 */
  const healthy = () => onDisk()
  const bakedUnlessMissing = (slot: EquipSlot, picture: string) =>
    !isKnownMissingEquipPicture(slot, picture)

  it('健康状态下一条问题都没有', () => {
    expect(reconcileEquipPictures(healthy(), bakedUnlessMissing)).toEqual([])
  })

  it('1. 磁盘上多一个没登记过的扩展名', () => {
    const p = reconcileEquipPictures([...healthy(), '武器/新素材.tga'], bakedUnlessMissing)
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('新素材.tga')
    expect(p[0]).toContain('扩展名没登记过')
  })

  it('2. 类目录与 SLOT_FILE 对不上（多一个、少一个各造一次）', () => {
    const extra = reconcileEquipPictures([...healthy(), '法宝/新东西.png'], bakedUnlessMissing)
    expect(extra.filter((x) => x.includes('类目录'))).toHaveLength(1)
    // 少一个：把 `武器/` 整个拿掉。那一类的每一行同时会报"烘不出来"，
    // 所以这里只数类目录那一条。
    const fewer = reconcileEquipPictures(
      healthy().filter((f) => !f.startsWith(`${SLOT_FILE.weapon}/`)),
      (slot, picture) => slot !== 'weapon' && bakedUnlessMissing(slot, picture),
    )
    expect(fewer.filter((x) => x.includes('类目录'))).toHaveLength(1)
    // 正向控制：那一类的行确实一起报了，否则"少一个目录"就只丢一条消息。
    expect(fewer.filter((x) => x.includes('烘不出来')).length).toBeGreaterThan(0)
  })

  it('3. 表里点名的图烘不出来，而它不在已知缺失名单里', () => {
    const victim = EQUIPMENT_LISTS.armor.find(
      (i) => !isKnownMissingEquipPicture('armor', i.picture),
    )!
    const p = reconcileEquipPictures(healthy(), (slot, picture) =>
      slot === 'armor' && picture === victim.picture ? false : bakedUnlessMissing(slot, picture),
    )
    expect(p).toHaveLength(1)
    expect(p[0]).toContain(equipPictureSource('armor', victim.picture))
    expect(p[0]).toContain('烘不出来')
  })

  it('4. 已知缺失名单过期 —— 名单上的图烘得出来了', () => {
    const p = reconcileEquipPictures(healthy(), () => true)
    expect(p).toHaveLength(KNOWN_MISSING_EQUIP_PICTURES.length)
    for (const x of p) expect(x).toContain('已知缺失名单过期')
  })

  it('5. 名单里的图没有任何一行点名（抄错了字）', () => {
    // 名单从参数注进去，就为了造得出这一支 —— 读模块级常量的话，它只能
    // 靠"今天恰好没人抄错字"保持绿，而那与"这一支写坏了"长得一模一样。
    const typo = { slot: 'helmet' as const, picture: '数据里没有这一行.png', issue: 'xl-234', note: '武兜.png' }
    expect(
      namedByData().some((n) => n.picture === typo.picture),
      '数据里居然有这一行 —— 换一个不存在的名字',
    ).toBe(false)
    const p = reconcileEquipPictures(healthy(), bakedUnlessMissing, [
      ...KNOWN_MISSING_EQUIP_PICTURES,
      typo,
    ])
    expect(p).toHaveLength(1)
    expect(p[0]).toContain(typo.picture)
    expect(p[0]).toContain('没有任何一行点名')
  })
})
