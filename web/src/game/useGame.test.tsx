import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { readTrace } from '../state/trace'
import { getParty, initialMember, rememberParty, resetParty } from '../fakes/party'
import { getScene } from '../data/scenesEager'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { roleTileX, roleTileY } from '../state/role'
import { TICK_MS, createWorld } from '../state/step'
import type { RoleState, World } from '../state/types'
import { useGame } from './useGame'

/**
 * 接线的测试：键盘 → 定步长推进 → 渲染器。**渲染器是个假的**——这里要验的是
 * 线接对了没有，不是 Pixi 画得对不对（那一层没有测试缝，是 spec 的明确决策）。
 *
 * 值得单独测的理由：状态层再纯，只要按键没送进去、或者推进没跑起来，
 * 表现都是"按方向键没反应"，而两层各自的测试都还是绿的。
 */
describe('useGame 接线', () => {
  let seen: RoleState[] = []
  const renderer = {
    showScene: async () => {},
    showWorld: (world: World) => {
      seen.push(world.role)
    },
    destroy: () => {},
  } satisfies SceneRenderer

  beforeEach(() => {
    seen = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * 挂上钩子，并等场景 JSON 到位——它是按需取的（见 `data/scenes.ts`），
   * 世界要等它回来才建得出来。不等就推时间，推的是一个还没有世界的 ticker：
   * 表现是"渲染器一帧都没收到"，看上去像接线断了。
   */
  async function mount(scene = '宿舍') {
    // 出口的目标也要先取到手：世界要等它们到齐才开始推进
    // （见 `data/loadedScenes.ts`）。这里先取一遍，钩子里那一遍就是缓存命中，
    // 一个微任务就过去了 —— 不然假定时器下要等一次真的 I/O，谁也说不准几拍。
    await prepareExits(createWorld(await loadScene(scene)))
    const rendered = renderHook(() => useGame(renderer, scene))
    await act(async () => {
      await loadScene(scene)
    })
    return rendered
  }

  /** trace 里的按键事件 → 页面上的 KeyboardEvent。`toInputEvent` 那张表的反向。 */
  function dispatch(input: { e: string; k: string; ctrl?: boolean }) {
    const key =
      input.k === 'space'
        ? ' '
        : `Arrow${input.k.charAt(0).toUpperCase()}${input.k.slice(1)}`
    window.dispatchEvent(
      new KeyboardEvent(input.e === 'press' ? 'keydown' : 'keyup', {
        key,
        ctrlKey: input.ctrl === true,
      }),
    )
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
    })
  }

  it('按下右方向键，主角往右走；渲染器每次拿到的都是新的世界状态', async () => {
    await mount()
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const last = seen.at(-1)
    expect(last).toBeDefined()
    expect(last!.dir).toBe('right')
    expect(roleTileX(last!)).toBeGreaterThan(12)
  })

  it('按住 Shift 是跑（macOS 上 Ctrl+方向键被系统吃掉，见 keyboard.ts）', async () => {
    await mount()
    press('ArrowRight', { shiftKey: true })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(seen.at(-1)!.running).toBe(true)
  })

  it('没有按键就不动', async () => {
    await mount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen.at(-1)!.px).toBe(12 * 32)
  })

  /**
   * 对话状态要真的走到 React 手里 —— 对话框是真 DOM，接不上的表现是"游戏在
   * 动、对话框永远不出现"，而状态层与组件各自的测试都还是绿的。
   *
   * 用 `脚本4`：它的 `Dialogue` 段触发码是 `-1`，也就是**进场自动播**
   * （`DialogueEvent.checkAutoDialogue`），不用先把主角走到谁跟前。
   */
  /**
   * ESC 开菜单（xl-6lo.8）。接线断了的表现是"按 ESC 没反应"，而
   * `game/session.ts` 的 `openMenu` 与整个 `menu/` 的测试**都还是绿的** ——
   * 这条缝只有在这里才看得见。
   */
  it('按 ESC 开菜单；进了菜单再按 ESC 出不去（原版就是这样坏的）', async () => {
    const { result } = await mount()
    expect(result.current.panel).toBe('scene')
    press('Escape')
    act(() => {
      vi.advanceTimersByTime(TICK_MS)
    })
    expect(result.current.panel).toBe('menu')

    // ⚠️ 复刻的死代码：菜单里那个 keyPressed(ESC) 一个分支都不命中。
    // Web 上按 ESC 关面板是肌肉记忆，别"顺手修好"它 —— 改了真值就对不上。
    press('Escape')
    act(() => {
      vi.advanceTimersByTime(10 * TICK_MS)
    })
    expect(result.current.panel).toBe('menu')
  })

  it('自动对话会走到 React 手里，空格能把它推下去', async () => {
    const scene = getScene('脚本4')
    const sentences = scene.dialogue![0]!
    const { result } = await mount('脚本4')

    // 弹出动画 + 逐字打印。多给一点时间，判据是"这一句打完了"而不是某个 tick 数。
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.dialogue?.speaking).toBe(true)
    expect(result.current.dialogue?.sentence).toBe(sentences[0]![2])
    expect(result.current.dialogue?.sentenceOver).toBe(true)

    // 空格推进到下一句。键名与 trace 里逐字一致（见 keyboard.ts）。
    press(' ')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.dialogue?.sentence).toBe(sentences[1]![2])
  })

  /**
   * 出口切换的接线（xl-9bd.12）：**世界换了场景，调用方要能知道**。
   *
   * 画面是跟着 `useGame` 报出来的这个场景走的（见 `app/App.tsx`），接不上的
   * 表现是"走出门之后人在新场景里跑，画面还是旧地图"——而状态层与渲染器
   * 各自的测试都还是绿的。
   *
   * 按键不是手编的：照着真值 `dorm-exit` 里那一 tick 实际喂给原版的事件回放
   * （`docs/trace-format.md`）。一 tick 一次 `setInterval`，10 ms 一拍，与
   * `advance` 的步长严丝合缝。换场景发生在第几 tick 也来自真值，不写死。
   */
  it('走到出口，报出来的场景跟着真值换掉', async () => {
    const trace = readTrace('dorm-exit')
    const switchAt = trace.ticks.findIndex((tick) => tick.scene !== trace.ticks[0]!.scene)
    expect(switchAt).toBeGreaterThan(0)

    const { result } = await mount(trace.script.scene.replace(/\.txt$/, ''))
    expect(result.current.scene).toBe('宿舍')

    for (const tick of trace.ticks.slice(0, switchAt + 1)) {
      act(() => {
        for (const input of tick.input) dispatch(input)
        vi.advanceTimersByTime(10)
      })
    }
    expect(result.current.scene).toBe(trace.ticks[switchAt]!.scene.replace(/\.txt$/, ''))
  })

  /**
   * 重开一局（xl-kaa）—— 原版 `GameLauncher.init()`。
   *
   * 两件事分开验，因为**少做哪一件都表现为"重开了，画面也回去了"**：
   *
   * - 队伍没回出厂状态：新一局带着上一局的等级、经验、残血开局，画面正常；
   * - 会话没重建：主角还站在死之前那一格上，而队伍是新的。
   *
   * 所以先把两样都弄脏（走 `rememberParty` 那条正路记一份脏队伍，再真的按
   * 方向键把主角走开），重开之后两样一起查。
   */
  it('重开一局：队伍回出厂状态，世界也整个重建', async () => {
    resetParty()
    const { result } = await mount()

    // 弄脏（一）：队伍。走的是"打完一场记回去"那条路，不是直接改字段。
    rememberParty([
      {
        spec: { key: 'zhang' },
        level: 9,
        physicalPower: 99,
        agile: 98,
        strength: 97,
        sprit: 96,
        exp: 123,
        hp: 1,
        mp: 2,
        isDead: true,
        angryValue: 5,
        isAngry: false,
      },
    ])
    expect(getParty().zhang.level).toBe(9)

    // 弄脏（二）：世界。真的按右方向键走出去几格。
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(roleTileX(seen.at(-1)!)).toBeGreaterThan(12)
    const walked = seen.length

    act(() => {
      result.current.restart()
    })
    // 会话是从头建的：场景 JSON 要重新取（缓存命中，一个微任务）。
    await act(async () => {
      await loadScene('宿舍')
    })
    // 松开方向键，不然新世界一起手就在走 —— 那会把"回到出生格"糊掉。
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }))
      vi.advanceTimersByTime(10)
    })

    expect(getParty().zhang).toEqual(initialMember('zhang'))
    expect(getParty().yu).toEqual(initialMember('yu'))
    expect(getParty().lu).toEqual(initialMember('lu'))
    // 主角回到脚本里的出生格（12,8）—— 新世界，不是被挪回去的旧世界。
    expect(seen.length).toBeGreaterThan(walked)
    expect(seen.at(-1)!.px).toBe(12 * 32)
    expect(roleTileX(seen.at(-1)!)).toBe(12)
  })

  /**
   * 开机停在标题上（xl-q7f）：`sceneName` 是 `null` 就**没有世界**——
   * 原版这时 `ScenePanel` 那条线程还没起来（`initiation` 与 `Thread.start()`
   * 都在「起」那一下里）。
   *
   * **判据不是 `panel === 'start'` 一条**：先把世界建出来、再把面板摆成
   * start，那一条照样绿，而画面上两者一模一样。所以还要真按方向键、真推一
   * 整秒，看渲染器**一帧都收不到**。
   */
  it('还没开局：停在标题上，世界一拍都不推', () => {
    const { result } = renderHook(() => useGame(renderer, null))
    expect(result.current.panel).toBe('start')
    expect(result.current.scene).toBeNull()

    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen).toHaveLength(0)
  })

  /**
   * 给了场景名才开局 —— 开发用的场景选择器走的就是这条路（`app/App.tsx`
   * 把选中的名字喂进来），「起」走的也是它（那边还多一句 `restart()`）。
   *
   * 反过来也要通：再变回 `null` 就回到标题、世界丢掉。少了这一半，
   * "开局之后再也回不去"也能过，而它在开始界面上就是"点了没反应"。
   */
  it('给了场景名就开局，变回 null 就回标题', async () => {
    // 出口的目标先取到手，理由同 `mount`。
    await prepareExits(createWorld(await loadScene('宿舍')))
    const { result, rerender } = renderHook(({ scene }) => useGame(renderer, scene), {
      initialProps: { scene: null as string | null },
    })
    expect(result.current.panel).toBe('start')

    rerender({ scene: '宿舍' })
    await act(async () => {
      await loadScene('宿舍')
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.panel).toBe('scene')
    expect(result.current.scene).toBe('宿舍')
    // 世界真的在推：渲染器收到了帧，主角站在**脚本里写的**出生格上。
    // 那对数从脚本现读，不是手写的 —— 脚本改了这条要跟着响。
    const spawn = getScene('宿舍')
    expect([roleTileX(seen.at(-1)!), roleTileY(seen.at(-1)!)]).toEqual([
      spawn.roleX,
      spawn.roleY,
    ])
    const drawn = seen.length

    rerender({ scene: null })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.panel).toBe('start')
    expect(result.current.scene).toBeNull()
    // 回标题之后一帧都不再来 —— 世界丢掉了，不是藏起来了。
    expect(seen.length).toBe(drawn)
  })

  /**
   * **渲染器还没就绪时世界不推进**（xl-w16 之后仍然成立的那半）。
   *
   * 那道守卫原先是 pump 起手的一句 `if (!renderer) return`，xl-w16 把它挪到
   * `isRunning` 之后 —— 「还没开局」那一路不再受它管（标题要出声），
   * 「开局了但渲染器还没到」这一路照旧。
   *
   * 这里验两件事：
   *
   * 1. 没有渲染器时一帧都不画；
   * 2. 等了 5 秒再把渲染器交出来，跑三拍 —— 主角的位置与**从头就有渲染器、
   *    只跑同样三拍**的那一局**逐字段相同**。那 5 秒是真的丢掉了，没有被
   *    下一拍一次性补跑。（拿另一局当基准而不是手写坐标：走三拍走多远由步长
   *    与动画决定，写死一个数只会在别处改了步长时红，且红得看不出因果。）
   *
   * ## ⚠️ 这两件里只有第一件有单点篡改能让它红，第二件是登记
   *
   * 篡改矩阵实测（xl-w16）：**把那道守卫整个删掉，这条红**（第一件）。
   * 而"往前跳一大截"那一路**今天没有任何单点篡改观测得到** —— 追下去的结论
   * 是：`renderer` 在 pump 那个 effect 的 deps 里，渲染器一到 effect 整个
   * 重建，`let last = performance.now()` 自己就重置了。所以守卫里原本写的
   * 那句 `last = now` 是死代码，已经删掉。
   *
   * 第二件仍然留着，因为它验的是**行为**而不是那一行：哪天有人把 `renderer`
   * 改成从 ref 里读（effect 不再重建），补跑就会真的发生，而那时这条会红。
   * 把它记成"结构性保证"而不是"判据"，是因为两者在绿的时候长得一样。
   */
  it('渲染器还没就绪：一帧不画，而且这段时间不会攒着一次性补跑', async () => {
    await prepareExits(createWorld(await loadScene('宿舍')))

    // 甲局：渲染器晚到 5 秒。
    const late = renderHook(({ r }) => useGame(r, '宿舍'), {
      initialProps: { r: null as SceneRenderer | null },
    })
    await act(async () => {
      await loadScene('宿舍')
    })
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(seen).toHaveLength(0)
    late.rerender({ r: renderer })
    act(() => {
      vi.advanceTimersByTime(TICK_MS * 3)
    })
    const afterLate = seen.at(-1)
    expect(afterLate).toBeDefined()
    late.unmount()

    // 乙局：渲染器从头就在，同样三拍。这一局就是 `mount()` 本身。
    seen = []
    await mount('宿舍')
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(TICK_MS * 3)
    })
    const afterPrompt = seen.at(-1)
    expect(afterPrompt).toBeDefined()

    expect(afterLate).toEqual(afterPrompt)
  })

  it('卸载之后不再推进，也不再收键', async () => {
    const { unmount } = await mount()
    unmount()
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen).toHaveLength(0)
  })
})
