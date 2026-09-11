import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../generated/assets.json'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { sfxAssetId } from './ids'
import { listFiles } from './listFiles'
import { SFX_ROOT, sfxProductPath } from './sfxAssets'

const MANIFEST = manifest as Record<string, string>

describe('音效素材进烘焙管线（xl-03x.5）', () => {
  it('ID 不带扩展名，去扩展名不认大小写', () => {
    expect(sfxAssetId('换list.wav')).toBe('sfx:换list')
    // `Check.java` 调的是 `.MP3`，磁盘上是 `.mp3`。
    expect(sfxAssetId('战斗胜利.MP3')).toBe(sfxAssetId('战斗胜利.mp3'))
  })

  it(`${SFX_ROOT}/ 下的每一个文件都进了映射表，且指向它自己的产物`, () => {
    // 分母现扫：少烘一个的表现是「那一声是哑的」，没人听得出来。
    const files = readdirSync(repoPath(SFX_ROOT)).filter((f) => !f.startsWith('.')).sort()
    expect(files.length).toBeGreaterThan(0)
    const wrong = files.filter((f) => MANIFEST[sfxAssetId(f)] !== sfxProductPath(f))
    expect(wrong).toEqual([])
  })

  it('映射表里的音效条目与源目录一一对应（不多不少）', () => {
    const files = readdirSync(repoPath(SFX_ROOT)).filter((f) => !f.startsWith('.'))
    const ids = Object.keys(MANIFEST).filter((k) => k.startsWith('sfx:')).sort()
    expect(ids).toEqual([...new Set(files.map(sfxAssetId))].sort())
  })

  /**
   * 原版每一处 `MusicReader.readmusic("…")` 点到的文件，都得查得到。
   *
   * 名单从 GBK 源码现读，不抄。两道防「零匹配恒真」：调用次数 > 0；
   * **调用次数与字面量次数相等** —— 哪天有人写成 `readmusic(name)`，
   * 字面量正则扫不到它，这里就红，而不是悄悄少验一个。
   */
  it('原版每一处 readmusic 点名的文件都查得到', () => {
    const javaFiles = listFiles(repoPath('src')).filter((f) => f.endsWith('.java'))
    expect(javaFiles.length).toBeGreaterThan(0)
    let calls = 0
    let literals = 0
    const names = new Set<string>()
    for (const file of javaFiles) {
      for (const line of javaSource(`src/${file}`).split(/\r?\n/)) {
        if (line.trim().startsWith('//')) continue
        calls += line.split('MusicReader.readmusic(').length - 1
        for (const m of line.matchAll(/MusicReader\.readmusic\("([^"]+)"\)/g)) {
          literals++
          names.add(m[1]!)
        }
      }
    }
    expect(calls).toBeGreaterThan(0)
    expect(literals).toBe(calls)
    const unresolved = [...names].filter((n) => MANIFEST[sfxAssetId(n)] === undefined).sort()
    expect(unresolved).toEqual([])
  })

  it('产物目录 sfx/ 下的每个文件都有人指', () => {
    const products = listFiles(repoPath('web/src/generated/assets/sfx')).map((f) => `sfx/${f}`)
    expect(products.length).toBeGreaterThan(0)
    const mapped = new Set(Object.values(MANIFEST))
    expect(products.filter((p) => !mapped.has(p))).toEqual([])
  })
})
