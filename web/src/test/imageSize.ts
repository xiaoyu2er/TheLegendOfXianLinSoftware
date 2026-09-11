import { readFileSync } from 'node:fs'

/**
 * 读一张 PNG / JPEG 原始素材的宽高（xl-czb.3）—— 只读文件头，不解码。
 *
 * **测试侧自己一份，不借 `scripts/bake.ts` 的 `imageSize`**：被守的是渲染器对
 * 「图与网格对不对得上」的判断，而那张表的真值要是由烘焙那一侧读出来的，
 * 烘焙读错了，判据跟着错、两边一起绿（真值与被测对象同源）。
 */
export function imageSize(file: string): { readonly width: number; readonly height: number } {
  const b = readFileSync(file)
  if (b[0] === 0x89 && b[1] === 0x50) {
    // IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后。
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // 顺着段链走到 SOF：C0..CF 里除掉 C4（霍夫曼表）、C8（扩展）、CC（算术编码表）。
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) throw new Error(`${file}：偏移 ${i} 不是段标记`)
      const marker = b[i + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
    throw new Error(`${file}：走完段链也没找到 SOF`)
  }
  throw new Error(`${file} 既不是 PNG 也不是 JPEG`)
}
