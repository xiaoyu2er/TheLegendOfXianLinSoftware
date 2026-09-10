import { describe, expect, it } from 'vitest'
import { checkMapSize } from './mapSize'

/**
 * 地图图片尺寸与碰撞网格对不对得上（xl-i06.12 追出来的）。三种处境各一条，
 * 数都是 2026-09-10 从 `maps/` 与烘好的场景 JSON 现量的真实场景。
 */
describe('地图图片与碰撞网格', () => {
  it('正好是 瓦片数 × 32：照画', () => {
    // 宿舍：1024×640，32×20 瓦片。
    expect(() => checkMapSize('宿舍.txt', '宿舍.png', { width: 1024, height: 640 }, 32, 20)).not.toThrow()
  })

  it('比网格大：照画 —— 原版的源矩形按世界像素取，多出来的那几像素永远取不到', () => {
    // 脚本20：大迷宫.png 2865×699，89×21 瓦片（2848×672）。
    expect(() => checkMapSize('脚本20.txt', '大迷宫.png', { width: 2865, height: 699 }, 89, 21)).not.toThrow()
  })

  it('比网格小：硬失败，并点名接它的那张票 —— 原版在这里走的是另一种画法', () => {
    // 仙一教学楼一楼：1022×640，32×20 瓦片。
    expect(() =>
      checkMapSize('仙一教学楼一楼.txt', '仙一教学楼一楼.png', { width: 1022, height: 640 }, 32, 20),
    ).toThrow(/1022×640.*1024×640.*xl-/)
    // 只短一个方向也算（基础实验楼乙五层：1024×639）。
    expect(() => checkMapSize('脚本7.txt', '基础实验楼乙五层.png', { width: 1024, height: 639 }, 32, 20)).toThrow()
  })
})
