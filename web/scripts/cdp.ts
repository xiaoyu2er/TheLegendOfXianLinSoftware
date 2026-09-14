import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 一个够用就好的 Chrome DevTools Protocol 客户端。
 *
 * 为什么不装 puppeteer：这里要做的事只有四件 —— 起一个无头 Chrome、开一个标签页、
 * 执行几段 JS、截图。Node 22 起 `WebSocket` 与 `fetch` 都是内建的，整件事一百行
 * 出头，而 puppeteer 会带进来一整个 Chromium 下载步骤和一条与 CI 无关的依赖。
 *
 * **必须是真浏览器**：跨端比对要比的是 Pixi 真的画出来的像素。在 Node 里拿一个
 * 软件光栅器重画一遍，比的就是那个光栅器，不是被移植的渲染代码 —— 那种测试会
 * 一直绿，而线上是花的。
 */
export interface Browser {
  /** 在标签页里执行一段表达式，返回它 await 之后的值。 */
  evaluate<T>(expression: string): Promise<T>
  /** 截取页面左上角 `width × height` 的位图，返回 PNG 字节。 */
  screenshot(width: number, height: number): Promise<Uint8Array>
  /**
   * 对这个标签页直接发一条 CDP 命令（xl-qzx 起）。派真输入要走它 ——
   * `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` 走浏览器的输入管线、执行默认动作，
   * 页面里手造的 `new MouseEvent(...)` 不执行（数 click 恒 0）。
   */
  send<T>(method: string, params?: unknown): Promise<T>
  close(): Promise<void>
}

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => typeof p === 'string' && p.length > 0)

export function findChrome(): string {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!found) {
    throw new Error(
      `找不到 Chrome。试过：\n  ${CHROME_CANDIDATES.join('\n  ')}\n` +
        `装一个，或者用环境变量 CHROME=/path/to/chrome 指过去。`,
    )
  }
  return found
}

export async function launch(url: string): Promise<Browser> {
  const chrome = findChrome()
  const profile = mkdtempSync(join(tmpdir(), 'xl-cdp-'))
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // 窗口要比逻辑画布**大**。窗口不够大时模拟视口会被缩放着截图 —— 实测
      // 1024×640 的窗口配 1024×640 的模拟视口，截出来的内容是原图的 0.992 倍：
      // 位图尺寸仍是 1024×640，内容却整体缩了一点点，于是逐帧比对整屏红，
      // 而画面用眼睛看完全正常。
      '--window-size=1400,900',
      // WebGL 必须真的能用：Pixi v8 没有 canvas 后端，跑不起来就没有像素可比。
      // SwiftShader 是软件实现，无头环境里唯一可靠的那个。
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const stderr: string[] = []
  child.stderr?.on('data', (b: Buffer) => stderr.push(b.toString()))

  const port = await readDevToolsPort(profile, child, stderr)
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string
  }
  const socket = await connect(version.webSocketDebuggerUrl)

  const target = await socket.send<{ targetId: string }>('Target.createTarget', { url })
  const attached = await socket.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  const session = attached.sessionId
  await socket.send('Page.enable', {}, session)
  await socket.send('Runtime.enable', {}, session)
  // 视口写死成逻辑画布的大小。
  //
  // 不能指望 --window-size：新版无头 Chrome 里那是**外框**尺寸，实测视口只有
  // 1024×576，底下 64 像素被窗口装饰吃掉了。截图照样返回一张 1024×640 的图，
  // 只是最后 64 行是黑的 —— 尺寸对、能解码、看着像"渲染少画了一条"，
  // 又是一个失败长得像成功的地方。
  await socket.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false },
    session,
  )

  return {
    async evaluate<T>(expression: string): Promise<T> {
      const result = await socket.send<{
        result: { value?: T; description?: string }
        exceptionDetails?: { exception?: { description?: string }; text: string }
      }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
      if (result.exceptionDetails) {
        const d = result.exceptionDetails
        throw new Error(`页面里抛了异常：${d.exception?.description ?? d.text}`)
      }
      return result.result.value as T
    },
    async screenshot(width: number, height: number): Promise<Uint8Array> {
      const shot = await socket.send<{ data: string }>(
        'Page.captureScreenshot',
        {
          format: 'png',
          // 只截逻辑画布那一块，`scale: 1` 保证位图就是 1024×640。
          // 走截图而不是 canvas.toDataURL：WebGL 的绘制缓冲在合成之后就没了，
          // 除非开 preserveDrawingBuffer —— 那要改渲染器，为取图改被测对象是本末倒置。
          clip: { x: 0, y: 0, width, height, scale: 1 },
          captureBeyondViewport: false,
        },
        session,
      )
      return new Uint8Array(Buffer.from(shot.data, 'base64'))
    },
    send<T>(method: string, params: unknown = {}): Promise<T> {
      return socket.send<T>(method, params, session)
    },
    async close(): Promise<void> {
      socket.close()
      child.kill()
      await new Promise((r) => child.once('exit', r))
      rmSync(profile, { recursive: true, force: true })
    },
  }
}

/**
 * Chrome 把它实际监听的端口写进 profile 目录下的 `DevToolsActivePort`。
 *
 * 轮询而不是等固定时长：固定时长在慢机器上偶发失败，而那种失败会表现为
 * "连不上"，看不出是没起来还是起晚了。进程中途退出要立刻报出它的 stderr，
 * 否则这里只会卡到超时，什么都不说。
 */
async function readDevToolsPort(
  profile: string,
  child: ChildProcess,
  stderr: string[],
): Promise<number> {
  const file = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome 起来就退了（exit ${child.exitCode}）：\n${stderr.join('')}`)
    }
    if (existsSync(file)) {
      const line = readFileSync(file, 'utf8').split('\n')[0]!.trim()
      if (line.length > 0) return Number(line)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`30 秒内没等到 Chrome 写出 ${file}：\n${stderr.join('')}`)
}

interface Socket {
  send<T>(method: string, params?: unknown, sessionId?: string): Promise<T>
  close(): void
}

async function connect(url: string): Promise<Socket> {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`连不上 ${url}`)), { once: true })
  })
  let nextId = 1
  const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()
  ws.addEventListener('message', (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number
      result?: unknown
      error?: { message: string }
    }
    if (msg.id === undefined) return // 事件，本客户端不订阅
    const pending = waiting.get(msg.id)
    if (!pending) return
    waiting.delete(msg.id)
    if (msg.error) pending.reject(new Error(`CDP 报错：${msg.error.message}`))
    else pending.resolve(msg.result as never)
  })
  // 连接断了要把所有还在等的请求**拒掉**。不接这两个事件的话，Chrome 中途
  // 崩掉的表现是驱动器永远挂在某一次 evaluate 上，一个字都不说。
  const abort = (why: string) => {
    for (const [, pending] of waiting) pending.reject(new Error(`CDP 连接断了：${why}`))
    waiting.clear()
  }
  ws.addEventListener('close', () => abort('socket closed'))
  ws.addEventListener('error', () => abort('socket error'))

  return {
    send<T>(method: string, params: unknown = {}, sessionId?: string): Promise<T> {
      const id = nextId++
      return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (v: never) => void, reject })
        ws.send(JSON.stringify({ id, method, params, sessionId }))
      })
    },
    close(): void {
      ws.close()
    },
  }
}
