/**
 * 「这一拍该画第几张图」的四条规则（xl-rh9.9）。
 *
 * 原版每个动画类都有一对 `code` 与 `currentImage`：`update()` 先把
 * `currentImage` 指到某一张，再动 `code`。状态层（xl-rh9.7）记的是 `code`，
 * **`currentImage` 那个指针没有进真值** —— 它只被 `paint()` 读。
 *
 * 所以渲染这一层要把指针**从 `code` 反推回来**。反推得成立，靠的是一条不变式：
 * `currentImage` 只在 `code` 变化的同一句里被改，所以两者之间是个函数。可
 * **那个函数不是同一个** —— 原版四类写法各写各的，差别就在"绕回 0 那一拍
 * 把图指到哪"：
 *
 * | 写法 | 绕回时 | 谁在用 |
 * |---|---|---|
 * | `else if(code==len){code=0;}` | 图**留在最后一张** | 主角走图、怪物走图、指示图、鼠标图 |
 * | `if(code==len){code=0; img=get(0);}` | 图**回到第一张** | 被击 / 死亡 / 胜利动画、怒气槽 |
 * | `img=readImage(code+1); code++` | 1 基帧号 = `code` | 技能动画、背景动画 |
 *
 * **这个差别肉眼看不出来**：两条规则只在绕回的那一拍上不同，而那一拍在一段
 * 循环播放里每 `len` 拍才来一次。挑错规则的表现是"某个动画偶尔闪一下"。
 *
 * 这里三个函数各自只做一件事，判据在 `frames.test.ts`：那里不是手写期望值，
 * 而是**照原版那三段 `update()` 各写一个模拟器**，逐拍比对指针 —— 手写期望
 * 会把同一个误解抄两遍。
 */

/**
 * 绕回时**图留在最后一张**的那一类。
 *
 * ```java
 * if(!isStop && code<length){ currentImage=Images.get(code); code++; }
 * else if(code==length){ code=0; }          // ← currentImage 不动
 * ```
 *
 * 因此 `code` 与图的下标恒差 1，绕回之后 `code==0` 对应的仍是 `length-1`。
 */
export function trailingFrame(code: number, length: number): number {
  assertLength(length, code)
  return (code + length - 1) % length
}

/**
 * 绕回时**图回到第一张**的那一类。
 *
 * ```java
 * if(!isStop && code<length){ currentImage=Images.get(code); code++; }
 * else if(code==length){ code=0; currentImage=Images.get(code); … }
 * ```
 *
 * 与上面只差绕回那一拍：`code==0` 对应第 0 张，不是最后一张。
 */
export function restartFrame(code: number, length: number): number {
  assertLength(length, code)
  return code === 0 ? 0 : code - 1
}

/**
 * 逐帧从磁盘读图的那一类（技能动画 / 背景动画），文件名是 **1 基**的帧号。
 *
 * ```java
 * if(code<length){ currentImage=readImage(name+"/"+(code+1)+".png"); code++; }
 * …
 * if(code==length){ code=0; currentImage=null; }   // ← 收摊时置空
 * ```
 *
 * 于是 `code` 本身就是 1 基帧号，而 `code==0` 意味着**没有图**（返回 `null`）。
 *
 * ⚠️ 一个例外不在这里：`SkillAnimation.set()` 会在 `code` 还是 0 的时候把图
 * 指到第 1 帧。那一拍的处置在 `drawList.ts` 里（`isDraw` 为真而 `code` 为 0），
 * 因为判它要看 `isDraw`，而这个函数只看 `code`。
 */
export function fileFrame(code: number, length: number): number | null {
  assertLength(length, code)
  if (code === 0) return null
  return code
}

function assertLength(length: number, code: number): void {
  // 长度为 0 会让 `%` 得到 NaN，而 NaN 当下标取不到纹理 —— 表现是"这个动画
  // 偶尔不画"，正是查不出来的那种。
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`动画长度要是正整数，实际 ${length}`)
  }
  if (!Number.isInteger(code) || code < 0 || code > length) {
    throw new Error(`帧计数器越界：code=${code}，长度 ${length}（原版只在 0..length 之间走）`)
  }
}
