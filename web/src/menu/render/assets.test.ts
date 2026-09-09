import { describe, expect, it } from 'vitest'
import manifest from '../../generated/assets.json'
import { javaSource } from '../../test/javaSource'
import { MENU_SKELETON_TOP_DIRS } from '../../assets/menuAssets'
import {
  COMMAND_BAR,
  LEVEL_LABEL,
  MENU_BACKGROUND,
  headId,
  menuSkeletonIds,
  mouseId,
  scollId,
  tabId,
} from './assets'
import type { MenuPanelName } from '../types'

/**
 * 路径抄错一个字，画面上是"这一块没了"，而它跟"这一层本来就不画"长得一样。
 * 所以两头都核：**每一条路径从原版源码里现读**，**骨架那批必须在已烘的映射
 * 表里查得到**（按需那三张背景不在表里，那是边界，见 `assets/menuAssets.ts`）。
 */
describe('菜单骨架的贴图 ID', () => {
  const SOURCE_OF: Readonly<Record<MenuPanelName, string>> = {
    thingPanel: 'src/menu/DrugPanel.java',
    magicPanel: 'src/menu/MagicPanel.java',
    funcPanel: 'src/menu/FuncPanel.java',
    equipPanel: 'src/menu/EquipPanel.java',
  }

  for (const panel of Object.keys(SOURCE_OF) as MenuPanelName[]) {
    it(`${panel} 的整屏背景，对回 readBackgroundImage()`, () => {
      const matches = [
        ...javaSource(SOURCE_OF[panel]).matchAll(
          /backgroundImage\s*=\s*Reader\.readImage\("([^"]+)"\)/g,
        ),
      ]
      expect(matches, `${SOURCE_OF[panel]} 里没解出 readBackgroundImage 的那一句`).toHaveLength(1)
      expect(MENU_BACKGROUND[panel]).toBe(`menu:${matches[0]![1]!.replace('sources/菜单/', '')}`)
    })
  }

  it('顶栏与四颗页签的三态，对回 Command.addGameButton()', () => {
    const command = javaSource('src/menu/Command.java')
    const paths = [...command.matchAll(/new ImageIcon\("sources\/菜单\/菜单\/([^"]+)"\)/g)].map(
      (m) => m[1]!,
    )
    // 四颗按钮 × 三态 = 12 张，`标题栏.png` 在 drawCommand 里另取一次。
    expect(paths).toHaveLength(13)
    expect(paths).toContain('标题栏.png')
    for (const key of ['thing', 'equip', 'magic', 'func'] as const) {
      for (const image of ['normal', 'waitclick', 'pressed'] as const) {
        const relative = tabId(key, image).replace('menu:菜单/', '')
        expect(paths, `${key} 的 ${image} 那一张`).toContain(relative)
      }
    }
    expect(COMMAND_BAR).toBe('menu:菜单/标题栏.png')
  })

  it('卷轴、等级与三颗头像的三态，对回 Scoll.initial()', () => {
    const scoll = javaSource('src/menu/Scoll.java')
    const paths = [...scoll.matchAll(/new ImageIcon\("sources\/菜单\/scoll\/([^"]+)"\)/g)].map(
      (m) => m[1]!,
    )
    expect(paths.length).toBeGreaterThan(0)
    expect(LEVEL_LABEL).toBe('menu:scoll/等级.png')
    expect(paths).toContain('等级.png')
    for (const hero of [1, 2, 4]) {
      for (const image of ['normal', 'waitclick', 'pressed'] as const) {
        expect(paths, `${hero} 号头像的 ${image}`).toContain(headId(hero, image).replace('menu:scoll/', ''))
      }
    }
    // `scollImage` 三张：一号 卷轴1、二号 卷轴2、四号 卷轴4（`image3` 建了但
    // `checkPressed` 一次都没用到 —— 三号宋大仁没做进菜单）。
    for (const hero of [1, 2, 4]) {
      expect(paths, `${hero} 号的卷轴底图`).toContain(scollId(hero).replace('menu:scoll/', ''))
    }
  })

  it('游标八帧，对回 Mouse.getImage()', () => {
    expect(javaSource('src/menu/Mouse.java')).toContain('"sources/菜单/鼠标图/"+i+".png"')
    expect([0, 7].map(mouseId)).toEqual(['menu:鼠标图/1.png', 'menu:鼠标图/8.png'])
  })

  it('骨架那批全在已烘的映射表里 —— 少一条就是"这一块画不出来"', () => {
    const table = manifest as Record<string, string>
    for (const id of menuSkeletonIds()) {
      expect(table[id], `${id} 不在 assets.json 里，跑一次 pnpm bake`).toBeDefined()
    }
  })

  it('另外三页的背景**不**在主包映射表里 —— 那正是那条边界', () => {
    const table = manifest as Record<string, string>
    // 首页（物品）的背景必须在；另外三页必须不在。两条一起才说得出"边界画对了"。
    expect(table[MENU_BACKGROUND.thingPanel]).toBeDefined()
    for (const panel of ['magicPanel', 'funcPanel', 'equipPanel'] as const) {
      expect(table[MENU_BACKGROUND[panel]], `${panel} 的背景不该进主包`).toBeUndefined()
    }
    // 边界名单是 xl-6lo.4 签的，这里只借它说明「首页在手上」不是巧合。
    expect(MENU_SKELETON_TOP_DIRS).toContain('物品')
  })
})
