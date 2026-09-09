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

  it('三态 → 文件名末尾那个数字：常态 1 / 待点 2 / 按下 3', () => {
    // ⚠️ 上面那条只核**集合**（12 张都在），三态映射整体错一位它照样绿 ——
    // 实测过（篡改 18）。这一条核的是**哪一张对哪一态**，出处有两处：
    //
    //   1. `GameButton` 的构造函数形参次序：normalImage / waitclickImage /
    //      pressedImage；
    //   2. `Command.addGameButton` 把 `image1/2/3` 按这个次序传进去，而
    //      `image1/2/3` 分别读的是 `…1.png` / `…2.png` / `…3.png`。
    const gameButton = javaSource('src/tools/GameButton.java')
    expect(gameButton).toContain(
      'public GameButton(int x,int y,int width,int height,Image normalImage,' +
        'Image waitclickImage,Image pressedImage,JPanel mp)',
    )
    const command = javaSource('src/menu/Command.java')
    expect(command).toContain('image1=new ImageIcon("sources/菜单/菜单/标题物品1.png")')
    expect(command).toContain('image2=new ImageIcon("sources/菜单/菜单/标题物品2.png")')
    expect(command).toContain('image3=new ImageIcon("sources/菜单/菜单/标题物品3.png")')
    expect(/new MenuButton\([^)]*image1, image2, image3/.test(command)).toBe(true)

    expect([
      tabId('thing', 'normal'),
      tabId('thing', 'waitclick'),
      tabId('thing', 'pressed'),
    ]).toEqual(['menu:菜单/标题物品1.png', 'menu:菜单/标题物品2.png', 'menu:菜单/标题物品3.png'])
    // 头像那一组同一套映射，命名不规则（一号是 hero1/hero12/hero13）。
    expect([headId(1, 'normal'), headId(1, 'waitclick'), headId(1, 'pressed')]).toEqual([
      'menu:scoll/hero1.png',
      'menu:scoll/hero12.png',
      'menu:scoll/hero13.png',
    ])
    expect(javaSource('src/menu/Scoll.java')).toContain(
      'hero1=new MenuButton(x_head, y_head, width_head, height_head, image1, image2, image3, fp)',
    )
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
