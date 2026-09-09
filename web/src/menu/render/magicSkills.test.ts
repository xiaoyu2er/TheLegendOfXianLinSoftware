import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { MAGIC_ANIMATION_LENGTHS, MAGIC_HEROES } from '../magic'
import {
  MAGIC_SKILL_DESCRIPTIONS,
  MAGIC_SKILL_STEMS,
  magicAnimationFrameId,
  magicAnimationFrameIds,
  magicButtonIds,
  magicSkillButtonId,
} from './magicSkills'

/**
 * 三张表各自对回它自己那一处源码。**三处是三个文件里的三套写法**，谁都推不出谁。
 */
describe('奇术页那三张表，对回原版', () => {
  it('十五颗按钮的贴图名，逐条对上 addMagicButton() 里读的图', () => {
    const src = javaSource('src/menu/MagicPanel.java')
    const from = src.indexOf('private void addMagicButton')
    const to = src.indexOf('private void addMagicAnimation')
    expect(from, 'addMagicButton 没找到').toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const stems = [...src.slice(from, to).matchAll(/sources\/菜单\/奇术\/(.+?)1\.png/g)].map(
      (m) => m[1]!,
    )
    // 四组各五个 —— 宋大仁那一组在源码里，这一层不列。
    expect(stems, 'addMagicButton() 里读到的 *1.png 条数').toHaveLength(20)
    const song = stems.slice(10, 15)
    const ported = [
      ...MAGIC_SKILL_STEMS[1],
      ...MAGIC_SKILL_STEMS[2],
      ...MAGIC_SKILL_STEMS[4],
    ]
    expect([...stems.slice(0, 10), ...stems.slice(15)]).toEqual(ported)
    // 宋大仁那五个真的不在这张表里 —— 否则"少列了他"与"列错了别人"分不开。
    for (const stem of song) {
      expect(ported, `${stem} 是宋大仁的招，不该出现在表里`).not.toContain(stem)
    }
  })

  it('三态贴图在磁盘上都在 —— 名字抄错一个字就是这一条红', () => {
    const dir = repoPath('sources/菜单/奇术')
    const files = new Set(readdirSync(dir))
    expect(files.size).toBeGreaterThan(0)
    const ids = magicButtonIds()
    // 分母从表本身推，不写死 15×3：招数或人数一变，这里跟着变。
    const skills = MAGIC_HEROES.reduce((n, { hero }) => n + MAGIC_SKILL_STEMS[hero].length, 0)
    expect(ids).toHaveLength(skills * 3)
    expect(new Set(ids).size, '十五颗按钮的三态贴图不该有重名').toBe(ids.length)
    for (const id of ids) {
      const name = id.slice(id.lastIndexOf('/') + 1)
      expect(files.has(name), `sources/菜单/奇术/${name} 不在磁盘上`).toBe(true)
    }
  })

  it('三十行说明，逐条对上 magicDiscription 的构造函数', () => {
    const src = javaSource('src/menu/magicDiscription.java')
    const rows = new Map<string, string>()
    for (const m of src.matchAll(/(zhang|lu|yu)\[(\d)\]\[(\d)\]\s*=\s*"([^"]*)";/g)) {
      rows.set(`${m[1]}${m[2]}${m[3]}`, m[4]!)
    }
    expect(rows.size, 'magicDiscription 里没解出赋值').toBe(30)
    // ⚠️ 这条顺带守着**那几行空的第二行**（张小凡 1/4、玉洁 3）：源码里就是
    // 空串，逐行相等意味着"顺手把空串当成漏抄补一句上去"当场红。为它单写
    // 一条 `空串数 > 0` 是恒真的 —— 那个数是从下面这张表自己推出来的
    // （/code-review 的 Standards 轴提的）。
    expect([...rows.values()].filter((v) => v === '').length).toBeGreaterThan(0)
    const field: Readonly<Record<number, string>> = { 1: 'zhang', 2: 'lu', 4: 'yu' }
    for (const { hero } of MAGIC_HEROES) {
      const lines = MAGIC_SKILL_DESCRIPTIONS[hero]
      expect(lines).toHaveLength(5)
      lines.forEach((two, i) => {
        expect(two).toHaveLength(2)
        two.forEach((text, line) => {
          expect(text, `${field[hero]}[${i}][${line}]`).toBe(rows.get(`${field[hero]}${i}${line}`))
        })
      })
    }
  })

})

describe('技能动画的帧 ID', () => {
  it('目录名是 <角色词干><招号>，而且磁盘上的张数就是那条动画的帧数', () => {
    for (const { hero, animationStem } of MAGIC_HEROES) {
      MAGIC_ANIMATION_LENGTHS[hero].forEach((length, i) => {
        const skill = i + 1
        const dir = repoPath(`image/技能动画/${animationStem}${skill}`)
        expect(existsSync(dir), `${dir} 不在磁盘上`).toBe(true)
        // 分母从磁盘现数：源码里的帧数与磁盘上的张数对不上，说明素材缺了。
        const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'))
        expect(pngs, `${animationStem}${skill} 的张数`).toHaveLength(length)
        // 末帧那张也在（原版画不到它，但整条要齐 —— 少一张的表现是 404）。
        expect(pngs).toContain(`${length}.png`)
      })
    }
  })

  it('帧 ID 是 1 基的，走战斗那套按需边界', () => {
    const first = magicAnimationFrameId(1, 1, 1)
    expect(first).toBe('battle:技能动画/张小凡技能1/1.png')
    const all = magicAnimationFrameIds(1, 1)
    expect(all).toHaveLength(MAGIC_ANIMATION_LENGTHS[1][0]!)
    expect(all[0]).toBe(first)
    expect(all[all.length - 1]).toBe(`battle:技能动画/张小凡技能1/${all.length}.png`)
  })

  it('招号越界要抛，不许悄悄给一张别的图', () => {
    expect(() => magicSkillButtonId(1, 6, 'normal')).toThrow(/第 6 招/)
    expect(() => magicAnimationFrameIds(1, 0)).toThrow(/第 0 招/)
  })
})
