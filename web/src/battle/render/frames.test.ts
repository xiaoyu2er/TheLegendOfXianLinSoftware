import { describe, expect, it } from 'vitest'
import { fileFrame, restartFrame, trailingFrame } from './frames'

/**
 * 判据不是手写的期望值，是**把原版那三段 `update()` 各照抄成一个模拟器**，
 * 让它自己带着一个 `currentImage` 指针跑，再逐拍和 `frames.ts` 的反推对。
 *
 * 为什么不手写期望：写实现和写期望的是同一个人、同一个上下文。手写
 * `[3,0,1,2,3,0]` 只是把同一个理解抄了两遍，抄错了两边一起错、测试还是绿的。
 * 模拟器抄的是**原版的控制流**（哪一句改 code、哪一句改指针、顺序如何），
 * 那是一份独立的来源。
 */

/** `else if(code==length){code=0;}` —— 绕回时指针不动。 */
function trailingSim(length: number, ticks: number): { code: number; image: number | null }[] {
  let code = 0
  let image: number | null = null
  const out: { code: number; image: number | null }[] = []
  for (let i = 0; i < ticks; i++) {
    if (code < length) {
      image = code
      code++
    } else if (code === length) {
      code = 0
    }
    out.push({ code, image })
  }
  return out
}

/** `if(code==length){code=0; currentImage=Images.get(0);}` —— 绕回时指针回第一张。 */
function restartSim(length: number, ticks: number): { code: number; image: number | null }[] {
  let code = 0
  let image: number | null = 0 // 构造函数里就 `currentImage=images.get(0)`
  const out: { code: number; image: number | null }[] = []
  for (let i = 0; i < ticks; i++) {
    if (code < length) {
      image = code
      code++
    }
    if (code === length) {
      code = 0
      image = 0
    }
    out.push({ code, image })
  }
  return out
}

/** `currentImage=readImage(code+1); code++`，收摊时置空。 */
function fileSim(length: number, ticks: number): { code: number; image: number | null }[] {
  let code = 0
  let image: number | null = null
  const out: { code: number; image: number | null }[] = []
  for (let i = 0; i < ticks; i++) {
    if (code < length) {
      image = code + 1
      code++
    }
    if (code === length) {
      code = 0
      image = null
    }
    out.push({ code, image })
  }
  return out
}

describe('从 code 反推出这一拍画的是哪一张', () => {
  // 长度覆盖原版真的用到的那几个：主角 4/8/6、怪物 4、指示图 5、鼠标图 8、
  // 被击 2/6、死亡 4、胜利 8/12、怒气槽 4、技能动画 16..25。
  const LENGTHS = [1, 2, 4, 5, 6, 8, 12, 16, 25]

  for (const length of LENGTHS) {
    it(`长度 ${length}：绕回不动那一类，逐拍与原版控制流一致`, () => {
      // 跑够两圈半，绕回那一拍一定被覆盖到（分母是 length*2+3，数得出来）。
      const sim = trailingSim(length, length * 2 + 3)
      // 第 0 拍之前指针是 null（还没 update 过），模拟器从第一拍起才有值。
      for (const step of sim) {
        expect(trailingFrame(step.code, length), `code=${step.code}`).toBe(step.image)
      }
      // 反方向：这一串里**真的出现过**绕回（否则上面是空转的）。
      expect(sim.filter((s) => s.code === 0).length).toBeGreaterThan(0)
    })

    it(`长度 ${length}：绕回回第一张那一类，逐拍与原版控制流一致`, () => {
      const sim = restartSim(length, length * 2 + 3)
      for (const step of sim) {
        expect(restartFrame(step.code, length), `code=${step.code}`).toBe(step.image)
      }
      expect(sim.filter((s) => s.code === 0).length).toBeGreaterThan(0)
    })

    it(`长度 ${length}：逐帧读盘那一类，逐拍与原版控制流一致`, () => {
      const sim = fileSim(length, length * 2 + 3)
      for (const step of sim) {
        expect(fileFrame(step.code, length), `code=${step.code}`).toBe(step.image)
      }
      expect(sim.filter((s) => s.image === null).length).toBeGreaterThan(0)
    })
  }

  it('两条绕回规则只在绕回那一拍上不同 —— 挑错了别处看不出来', () => {
    // 这一条是上面那张表的可执行版本：如果哪天有人把两条规则合并成一条，
    // 「它们只差一拍」这句话就必须先在这里变红。
    const length = 6
    const differ: number[] = []
    for (let code = 0; code <= length; code++) {
      if (trailingFrame(code, length) !== restartFrame(code, length)) differ.push(code)
    }
    expect(differ).toEqual([0])
  })

  it('长度非法、计数器越界 —— 抛，不返回一个取不到纹理的下标', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => trailingFrame(0, bad)).toThrow(/动画长度/)
      expect(() => restartFrame(0, bad)).toThrow(/动画长度/)
      expect(() => fileFrame(0, bad)).toThrow(/动画长度/)
    }
    for (const bad of [-1, 5, 1.5]) {
      expect(() => trailingFrame(bad, 4)).toThrow(/帧计数器越界/)
      expect(() => restartFrame(bad, 4)).toThrow(/帧计数器越界/)
      expect(() => fileFrame(bad, 4)).toThrow(/帧计数器越界/)
    }
  })
})
