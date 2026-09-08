# 量「标题这一屏哑多久」（xl-w16）

`game/useGame.ts` 那条 pump 的注释里有一组毫秒读数。**这份文件是那组数的
测法**，入库是为了让它可复现 —— 只写在注释里的数字和写在注释里的判据一样，
别人没法复核，只能采信自述。

⚠️ **这是手工探针，不在 CI 里，也没有判据会因为它变红。** 它需要一个能接
CDP 的浏览器（这一趟用的是 Chrome DevTools MCP 起的 Chrome 152）。要它进 CI
得先给 `web/` 加一个浏览器驱动依赖，那是另一张票的事。

## 量的是哪两个时刻

| 读数 | 取法 |
|---|---|
| 标题这一屏画出来 | `.start-back`（标题背景图）的 `load` |
| 主题曲开始要 | 那唯一一个 `Audio` 对象被赋 `src` 的那一刻 |

两个都在页面自己的 `performance.now()` 上取，差值就是哑场长度。**负数是有
意义的**：曲子的请求比标题背景图画出来还早。

`src` 的 setter 是从 `HTMLMediaElement.prototype` 上劫的 —— **源码一个字
都不用改**，所以量的就是要发布的那份产物。赋 `src` 而不是 `play()` 解析成功
当读数，是因为后者受自动播放策略摆布（见下）。

## 步骤

```bash
cd web
pnpm build
pnpm preview --port 4173 --strictPort
```

浏览器侧：**每次冷缓存都要开一个全新的隔离浏览器上下文**（换句话说，不是
reload，是新 profile）。同一个上下文里的第二次导航是热缓存，两者要分开记。

导航**之前**注入下面这段（Chrome DevTools MCP 是 `navigate_page` 的
`initScript`；用别的驱动就是 `Page.addScriptToEvaluateOnNewDocument` /
puppeteer 的 `evaluateOnNewDocument`）：

```js
window.__m = {}
const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
Object.defineProperty(HTMLMediaElement.prototype, 'src', {
  configurable: true,
  get() { return d.get.call(this) },
  set(v) {
    window.__el = this
    if (window.__m.bgmSrc === undefined) window.__m.bgmSrc = performance.now()
    d.set.call(this, v)
  },
})
const tick = () => {
  if (window.__m.panelInDom === undefined && document.querySelector('[data-testid="start-panel"]')) {
    window.__m.panelInDom = performance.now()
    const img = document.querySelector('.start-back')
    if (img) {
      if (img.complete) window.__m.backLoaded = performance.now()
      else img.addEventListener('load', () => { window.__m.backLoaded = performance.now() })
    }
  }
  if (window.__m.bgmSrc === undefined || window.__m.backLoaded === undefined) requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
```

载入之后（等几秒，让曲子真的开起来）读：

```js
const m = window.__m, el = window.__el
;({
  backLoaded: Math.round(m.backLoaded),
  bgmSrc: Math.round(m.bgmSrc),
  gap: Math.round(m.bgmSrc - m.backLoaded),   // ← 这个数
  paused: el.paused,                           // ← 见下，必须一起看
  currentTime: el.currentTime,
})
```

## ⚠️ 一个会让整组数失去意义的坑

**先确认这台浏览器有没有拦自动播放。** devtools 起的 Chrome 通常**不拦**，
于是 `play()` 直接 resolve、`currentTime` 在走 —— 上表里那两个字段就是用来
判断这件事的：`paused === false` 且 `currentTime > 0` 才说明量到的是「代码
路径的延迟」。

真实浏览器第一次访问会拦下来，那时哑多久由**用户什么时候给出第一次手势**
决定，跟这个 `gap` 无关。所以这组数只能这么说：**没有自动播放门槛时的纯
代码路径延迟**。说宽一点就成了「用户实际听到主题曲的等待时间」，而那是另一
回事，没量过。

顺带：`gap` 变成负数**并不**等于用户马上听得到声音 —— 被拦下来那条路上，
它的意义是「手势监听器装得够早，用户第一次点击不会被浪费」。理由写在
`game/useGame.ts` 那条 pump 的注释里。

## 量到的那组数在哪

**不在这里**，在 `src/game/useGame.ts` 那条 pump 的注释里 —— 数字要跟它
支撑的那个决定放在一起，而且**只留一份**：抄成两份之后，重测一次就要改两
处，漏改的那一处看起来仍然像量过的数。

只提醒一句：冷缓存那组的离散度不小（几百毫秒的量级里差出一倍），别把其中
任何一个读数当成常数引用 —— 要一个数就照上面自己再跑一遍。
