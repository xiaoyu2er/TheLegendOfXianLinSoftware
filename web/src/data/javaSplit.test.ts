import { describe, expect, it } from 'vitest'
import { javaSplit } from './javaSplit'

describe('javaSplit', () => {
  it('丢掉尾部的空串', () => {
    expect(javaSplit('a b ', ' ')).toEqual(['a', 'b'])
    expect(javaSplit('a b   ', ' ')).toEqual(['a', 'b'])
  })

  it('保留中间的空串', () => {
    expect(javaSplit('a  b', ' ')).toEqual(['a', '', 'b'])
  })

  it('全是分隔符时结果为空数组', () => {
    expect(javaSplit('   ', ' ')).toEqual([])
    expect(javaSplit('', ' ')).toEqual([])
  })

  it('复刻大地图 NPC 段那条行尾带空格的真实数据', () => {
    // script/大地图.txt 的 NPC 段，真值 大地图.json 里这条是 6 段。
    const raw = '2 37 38 11 商塔阿威哥 我大商塔天下无敌! '
    expect(javaSplit(raw, ' ')).toHaveLength(6)
    expect(raw.split(' ')).toHaveLength(7) // JS 原生的行为，作为对照
  })
})
