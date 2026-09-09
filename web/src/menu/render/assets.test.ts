import { describe, expect, it } from 'vitest'
import manifest from '../../generated/assets.json'
import { javaSource } from '../../test/javaSource'
import { MENU_SKELETON_TOP_DIRS } from '../../assets/menuAssets'
import {
  COMMAND_BAR,
  LEVEL_LABEL,
  MENU_BACKGROUND,
  funcButtonId,
  funcButtonIds,
  headId,
  menuSkeletonIds,
  menuTextureIds,
  mouseId,
  scollId,
  tabId,
} from './assets'
import { createMenuWorld } from '../world'
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

  it('天书页那批按钮贴图，对回 FuncButtons.addButton()', () => {
    const paths = [
      ...javaSource('src/menu/FuncButtons.java').matchAll(
        /new ImageIcon\("sources\/菜单\/天书\/([^"]+)"\)/g,
      ),
    ].map((m) => m[1]!)
    expect(paths.length).toBeGreaterThan(0)
    for (const id of funcButtonIds()) {
      expect(paths, `${id} 不是 addButton() 读的那批`).toContain(id.replace('menu:天书/', ''))
    }
    // 开 / 关那两对是共用的（BGM 与音效各一对），所以名单是去过重的。
    expect(new Set(funcButtonIds()).size).toBe(funcButtonIds().length)

    // ⚠️ 上面两条核的都是**集合**（这批文件名都在 / 名单没重），
    // 「哪颗按钮读的哪三张图」它们一个字都没核 —— 把 returnButton 的词干抄成
    // 「退出」照样全绿（篡改矩阵第 29 条）。下面这条核的是**配对**：
    // `addButton()` 里每一次赋值之前最近的那组 `image1/2/3` 读的是哪个词干。
    const src = javaSource('src/menu/FuncButtons.java')
    const stemOfButton = new Map<string, string>()
    let stem: string | null = null
    for (const line of src.split(/\r?\n/)) {
      const img = /image1\s*=\s*new ImageIcon\("sources\/菜单\/天书\/(.+?)1\.png"\)/.exec(line)
      if (img) stem = img[1]!
      const assign = /^\s*(\w+)\s*=\s*new MenuButton\(/.exec(line)
      if (assign && stem !== null) stemOfButton.set(assign[1]!, stem)
    }
    // 空转要响：一行都没配上时下面那个循环零轮，而零轮是恒真的。
    expect(stemOfButton.size, 'addButton() 里一颗按钮的词干都没配上').toBeGreaterThan(10)
    for (const [button, want] of stemOfButton) {
      const key = button as Parameters<typeof funcButtonId>[0]
      expect(funcButtonId(key, 'normal'), `${button} 读的应该是 ${want}1.png`).toBe(
        `menu:天书/${want}1.png`,
      )
    }
  })

  it('天书页的按钮走按需加载，只有翻到那一页才进名单', () => {
    const table = manifest as Record<string, string>
    for (const id of funcButtonIds()) {
      expect(table[id], `${id} 不该进主包映射表`).toBeUndefined()
    }
    const thing = createMenuWorld({ party: ['zhang'], fullHeal: true })
    expect(menuTextureIds(thing)).not.toContain(funcButtonId('returnButton', 'normal'))
    const func = createMenuWorld({ party: ['zhang'], fullHeal: true })
    func.panel = 'funcPanel'
    expect(menuTextureIds(func)).toContain(funcButtonId('returnButton', 'normal'))
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
