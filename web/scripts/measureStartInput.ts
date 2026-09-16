import { createServer } from 'vite'
import { launch } from './cdp'
import type { Browser } from './cdp'

/**
 * 标题页的三条浏览器行为，在真 Chrome 里量一遍（xl-qzx）。
 *
 *     cd web && pnpm exec vite-node scripts/measureStartInput.ts
 *
 * 为什么不是测试：它要 Chrome，进不了 CI（与 `compare.ts` 同一个理由）；读数写回
 * `start/StartPanel.tsx` / `start/replay.ts` 的注释，这个脚本留着给下一个要重量的人。
 *
 * **输入走 CDP 的 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`**：那条路进浏览器的
 * 输入管线，命中测试、禁用控件的过滤、焦点、按钮的键盘激活这些默认动作都照真的走；页面里手造的
 * `new MouseEvent(...)` 一样都不走（数 click 恒 0）。⚠️ 它**不经过操作系统**：「拖出窗口松手」
 * 在这里是把坐标派到视口外，操作系统替窗口握不握 grab 这件事它模拟不了 —— 第 2 条的「窗口外」
 * 那半只是 CDP 的读数，不是真窗口外的读数。
 *
 * 视口开成 1024×900：舞台按宽度撑满（scale 1），上下各留 130 像素黑边，于是「舞台外、窗口内」
 * 与「视口外」是两个分得开的地方。
 */

const VIEW_W = 1024
const VIEW_H = 900

type Rect = { x: number; y: number; w: number; h: number }
interface Reading {
  readonly [k: string]: unknown
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 页面里的探针：window 捕获阶段 + 面板冒泡阶段各记一份（面板冒泡收到 ≈ React 的委托收到）。 */
const PROBE = `(() => {
  const desc = (t) => t instanceof Element ? (t.getAttribute('aria-label') || t.getAttribute('class') || t.tagName) : String(t && t.nodeName)
  window.__log = []
  const panel = document.querySelector('.start-panel')
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'mousemove', 'mouseover', 'dragstart']) {
    window.addEventListener(type, (e) => window.__log.push({ type, at: 'window-capture', target: desc(e.target), buttons: e.buttons, detail: e.detail }), true)
    panel.addEventListener(type, (e) => window.__log.push({ type, at: 'panel-bubble', target: desc(e.target), buttons: e.buttons }), false)
  }
  // 冒泡到 window 的最后一站读 defaultPrevented：按钮自己的 preventDefault 此时已经跑过了。
  window.addEventListener('mousedown', (e) => window.__log.push({ type: 'mousedown', at: 'window-bubble', target: desc(e.target), defaultPrevented: e.defaultPrevented }), false)
  window.addEventListener('keydown', (e) => window.__log.push({ type: 'keydown', at: 'window-bubble', key: e.key, target: desc(e.target), defaultPrevented: e.defaultPrevented }), false)
  window.addEventListener('keyup', (e) => window.__log.push({ type: 'keyup', at: 'window-bubble', key: e.key, target: desc(e.target), defaultPrevented: e.defaultPrevented }), false)
  return true
})()`

async function main(): Promise<void> {
  const server = await createServer({ logLevel: 'warn', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('vite dev server 没报出它的地址')
  let browser: Browser | null = null
  const readings: Record<string, Reading> = {}
  try {
    browser = await launch(url)
    const b = browser
    await b.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false })

    const waitFor = async (expr: string, ms: number): Promise<boolean> => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (await b.evaluate<boolean>(`!!(${expr})`)) return true
        await sleep(50)
      }
      return false
    }
    const fresh = async () => {
      await b.send('Page.navigate', { url })
      await sleep(300)
      if (!(await waitFor(`document.querySelectorAll('.start-panel .start-button').length >= 4`, 20_000))) {
        throw new Error('20 秒内没等到标题页的四颗按钮')
      }
      await sleep(500)
      await b.evaluate(PROBE)
    }
    const rectOf = (label: string) =>
      b.evaluate<Rect>(`(() => { const r = document.querySelector('[aria-label="${label}"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    const center = async (label: string) => {
      const r = await rectOf(label)
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    }
    const mouse = async (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', p: { x: number; y: number }, held: boolean) => {
      await b.send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: type === 'mouseMoved' && !held ? 'none' : 'left',
        // 松手那一下 buttons 已经是 0（与真鼠标的 mouseup 一致）。
        buttons: type === 'mouseReleased' ? 0 : held || type === 'mousePressed' ? 1 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      })
      await sleep(30)
    }
    const KEYS = {
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
    } as const
    const key = async (name: keyof typeof KEYS) => {
      const k = KEYS[name]
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k })
      const { text: _text, ...up } = k as { text?: string }
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...up })
      await sleep(30)
    }
    const takeLog = () => b.evaluate<unknown[]>(`window.__log.splice(0)`)
    const focused = () => b.evaluate<string>(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName`)
    const aboutOpen = () => b.evaluate<boolean>(`!!document.querySelector('[data-testid="start-about"]')`)
    const cursorAt = () => b.evaluate<string>(`(() => { const c = document.querySelector('.start-cursor'); return c.style.left + ',' + c.style.top })()`)
    // 「起」「承」先是卷轴展开（`setButton` 的 `startAnimation(scroll)`），再载入、再切走 —— 判「按动了」
    // 看卷轴 / 载入这一块比按键之前变没变，不等切走。
    const SCROLL_SNAP = `(() => { const p = document.querySelector('.start-panel'); if (!p) return 'gone'; const s = p.querySelector('.start-scroll'); return s.dataset.sequence + '#' + s.dataset.frame + '#' + p.querySelectorAll('.start-loading').length })()`
    const scrollSnap = () => b.evaluate<string>(SCROLL_SNAP)
    const changedFrom = (before: string) => waitFor(`${SCROLL_SNAP} !== ${JSON.stringify(before)}`, 5000)
    const panelTop = async () => (await b.evaluate<number>(`document.querySelector('.start-panel').getBoundingClientRect().top`))

    // —— 1a. 没按键移到禁用的「结」上：悬停收不收（replay.ts 按「不收」推）——
    await fresh()
    const top = await panelTop()
    const back = { x: 600, y: top + 100 }
    await mouse('mouseMoved', back, false)
    await mouse('mouseMoved', await center('关于我们'), false)
    const aboutHover = await b.evaluate<string>(`document.querySelector('[aria-label="关于我们"]').dataset.hover`)
    await mouse('mouseMoved', back, false)
    await takeLog()
    await mouse('mouseMoved', await center('结束游戏'), false)
    await sleep(200)
    readings['1a 没按键移到「结」上'] = {
      对照_关于我们的dataHover: aboutHover,
      结的dataHover: await b.evaluate<string>(`document.querySelector('[aria-label="结束游戏"]').dataset.hover`),
      log: await takeLog(),
    }

    // —— 1b. 空手在「结」上按下、松开 ——
    await mouse('mousePressed', await center('结束游戏'), true)
    const downLog = await takeLog()
    await mouse('mouseReleased', await center('结束游戏'), false)
    readings['1b 空手在「结」上按下 / 松开'] = { 按下: downLog, 松开: await takeLog(), 光标: await cursorAt() }

    // —— 1c. 在「关于我们」上按下、拖到「结」上松开：window 的 mouseup 收不收、「关于」触不触发 ——
    await fresh()
    await mouse('mouseMoved', await center('关于我们'), false)
    await mouse('mousePressed', await center('关于我们'), true)
    await mouse('mouseMoved', await center('结束游戏'), true)
    await takeLog()
    await mouse('mouseReleased', await center('结束游戏'), false)
    const upLog = await takeLog()
    const openedByUp = await waitFor(`document.querySelector('[data-testid="start-about"]')`, 3000)
    await mouse('mouseMoved', back, false)
    const openedAfterMove = openedByUp || (await waitFor(`document.querySelector('[data-testid="start-about"]')`, 3000))
    readings['1c 关于我们上按下、拖到「结」上松开'] = { 松开: upLog, 松开后3秒内关于展开: openedByUp, 补一下无键移动后展开: openedAfterMove }

    // —— 2a. 按下后拖到舞台外、窗口内（上方黑边）松开 ——
    await fresh()
    await mouse('mouseMoved', await center('关于我们'), false)
    await mouse('mousePressed', await center('关于我们'), true)
    const letterbox = { x: 500, y: top - 60 }
    await mouse('mouseMoved', letterbox, true)
    const dragCursor = await cursorAt()
    await takeLog()
    await mouse('mouseReleased', letterbox, false)
    const up2a = await takeLog()
    readings['2a 拖到舞台外（黑边）松开'] = {
      松开: up2a,
      拖动中光标: dragCursor,
      松开后光标: await cursorAt(),
      松开后3秒内关于展开: await waitFor(`document.querySelector('[data-testid="start-about"]')`, 3000),
    }

    // —— 2b. 按下后拖到视口外松开（CDP 近似，不是操作系统的窗口外）——
    await fresh()
    await mouse('mouseMoved', await center('关于我们'), false)
    await mouse('mousePressed', await center('关于我们'), true)
    const outside = { x: -80, y: top + 300 }
    await mouse('mouseMoved', outside, true)
    await takeLog()
    await mouse('mouseReleased', outside, false)
    const up2b = await takeLog()
    const opened2b = await waitFor(`document.querySelector('[data-testid="start-about"]')`, 3000)
    readings['2b 拖到视口外松开（CDP）'] = { 松开: up2b, 松开后光标: await cursorAt(), 松开后3秒内关于展开: opened2b }

    // —— 2c. 在背景上按下（按钮之外，面板不拦默认动作）、拖一段、松开：图片的原生拖放会不会起 ——
    await fresh()
    const from = { x: 600, y: top + 100 }
    const to = { x: 700, y: top + 300 }
    await mouse('mouseMoved', from, false)
    await mouse('mousePressed', from, true)
    await mouse('mouseMoved', { x: 620, y: top + 140 }, true)
    await mouse('mouseMoved', to, true)
    const dragCursor2c = await cursorAt()
    await mouse('mouseReleased', to, false)
    const log2c = await takeLog()
    await mouse('mouseMoved', { x: 710, y: top + 310 }, false)
    readings['2c 背景上按下拖动松开'] = { 日志: log2c, 拖到终点时光标: dragCursor2c, 再无键移动后光标: await cursorAt(), 补移动的日志: await takeLog() }

    // —— 3. 鼠标按过按钮（preventDefault 挡了焦点）之后，Tab + 回车 / 空格还按不按得动 ——
    await fresh()
    await mouse('mouseMoved', await center('关于我们'), false)
    await takeLog()
    await mouse('mousePressed', await center('关于我们'), true)
    await mouse('mouseReleased', await center('关于我们'), false)
    const pressLog = await takeLog()
    const focusAfterMouse = await focused()
    const goBackShown = await waitFor(`document.querySelector('[aria-label="返回标题"]')`, 15_000)
    await sleep(300)
    const tabs: string[] = []
    let enterLog: unknown[] = []
    let closedByEnter: boolean | null = null
    for (let i = 0; i < 6 && goBackShown; i++) {
      await key('Tab')
      tabs.push(await focused())
      if (tabs.at(-1) === '返回标题') {
        await takeLog()
        await key('Enter')
        enterLog = await takeLog()
        closedByEnter = await waitFor(`!document.querySelector('[aria-label="返回标题"]')`, 10_000)
        break
      }
    }
    await sleep(300)
    const tabs2: string[] = []
    let spaceOn: string | null = null
    let spaceLog: unknown[] = []
    let leftTitle: boolean | null = null
    for (let i = 0; i < 6; i++) {
      await key('Tab')
      tabs2.push(await focused())
      if (tabs2.at(-1) === '开始新游戏') {
        spaceOn = tabs2.at(-1)!
        await takeLog()
        const before = await scrollSnap()
        await key('Space')
        spaceLog = await takeLog()
        // 「起」的头一段是载入动画（`panelState.ts` 的 loadTimer），切场景要等它数完 —— 判「按动了」
        // 看载入动画出没出来，不等切走。
        leftTitle = await changedFrom(before)
        break
      }
    }
    readings['3 鼠标按过之后键盘'] = {
      鼠标按下松开: pressLog,
      鼠标按过之后的焦点: focusAfterMouse,
      返回标题出现: goBackShown,
      关于展开后逐次Tab: tabs,
      回车: enterLog,
      回车后关于收起: closedByEnter,
      收起后逐次Tab: tabs2,
      空格按在: spaceOn,
      空格: spaceLog,
      空格后卷轴或载入动了: leftTitle,
      _aboutOpenNow: await aboutOpen(),
    }

    // —— 3 的对照：新开页面、鼠标一下都没按过，直接 Tab 到「开始新游戏」按空格 / 回车 ——
    for (const name of ['Space', 'Enter'] as const) {
      await fresh()
      const seen: string[] = []
      let log: unknown[] = []
      let started: boolean | null = null
      for (let i = 0; i < 8; i++) {
        await key('Tab')
        seen.push(await focused())
        if (seen.at(-1) === '开始新游戏') {
          await takeLog()
          const before = await scrollSnap()
          await key(name)
          log = await takeLog()
          started = await changedFrom(before)
          break
        }
      }
      readings[`3 对照 新页面 Tab + ${name}`] = { 逐次Tab: seen, 键: log, 卷轴或载入动了: started }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  console.log(JSON.stringify(readings, null, 1))
  // 探针一下都没记到就是量法坏了，不是「浏览器不派」。
  const any = Object.values(readings).some((r) => JSON.stringify(r).includes('window-capture'))
  if (!any) {
    console.error('探针一下都没记到 —— 量法坏了')
    process.exit(1)
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
