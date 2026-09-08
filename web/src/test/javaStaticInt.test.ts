import { describe, expect, it } from 'vitest'
import { javaSource } from './javaSource'
import { javaStaticInt } from './javaStaticInt'

/**
 * `javaStaticInt` 自己的判据。
 *
 * 抽公共 helper 最贵的失败是**把判据抽哑**：四个调用点原先各有各的失败反应，
 * 合成一个之后，只要这一个在抓不到时安静地返回点什么，四条判据一起变成恒真的。
 * 所以这里**每一条失败路径都单独验一遍**，而不是只验「正常情况读得对」。
 */
describe('javaStaticInt', () => {
  const FAKE = [
    'public class Foo{',
    '    public static int skillNumber=2;',
    '    public static int  level =  13 ;',
    '    public static int expToLevelUp;',
    '    public static int exp=0;',
    '    public static int myexp=99;',
    '    int notStatic=7;',
    '}',
  ].join('\r\n')

  it('读出初值，认得空格与 CRLF', () => {
    expect(javaStaticInt(FAKE, 'skillNumber', 'Foo.java')).toBe(2)
    expect(javaStaticInt(FAKE, 'level', 'Foo.java')).toBe(13)
    expect(javaStaticInt(FAKE, 'exp', 'Foo.java')).toBe(0)
  })

  it('零匹配是抛，不是返回空 —— 这条是这个 helper 存在的理由', () => {
    // 字段不存在
    expect(() => javaStaticInt(FAKE, 'noSuchField', 'Foo.java')).toThrow(/匹配到 0 处/)
    // 源码整个是乱码（没按 GBK 解）：与「这一行不存在」长得一样，也必须响
    expect(() => javaStaticInt('����������', 'level', 'Foo.java')).toThrow(/解析器空转/)
    // 空字符串同理
    expect(() => javaStaticInt('', 'level', 'Foo.java')).toThrow(/匹配到 0 处/)
  })

  it('两处以上也是抛 —— 「读的是哪一处」不许由 helper 替调用方挑', () => {
    const dup = `${FAKE}\r\npublic static int level=1;`
    expect(() => javaStaticInt(dup, 'level', 'Foo.java')).toThrow(/匹配到 2 处/)
  })

  it('边界：不匹配同名前缀的别的字段，也不匹配没有初值的声明', () => {
    // `myexp=99` 不该被 `exp` 抓走 —— 抓走了上面那条 `exp` 就会读成 2 处，
    // 而「读成了 99」在调用方看来只是一个数。
    expect(javaStaticInt(FAKE, 'exp', 'Foo.java')).toBe(0)
    // `expToLevelUp` 没有初值，读不出出厂值，要按「零匹配」算
    expect(() => javaStaticInt(FAKE, 'expToLevelUp', 'Foo.java')).toThrow(/匹配到 0 处/)
    // 非 static / 非 public 的不算
    expect(() => javaStaticInt(FAKE, 'notStatic', 'Foo.java')).toThrow(/匹配到 0 处/)
  })

  it('字段名不是标识符就抛 —— 别让正则元字符拼进去', () => {
    // `.` 拼进正则会匹配到 `exp` 上去，读出一个数来，看起来完全正常
    expect(() => javaStaticInt(FAKE, 'e.p', 'Foo.java')).toThrow(/不是合法的 Java 标识符/)
    expect(() => javaStaticInt(FAKE, 'level|exp', 'Foo.java')).toThrow(/不是合法的 Java 标识符/)
  })

  it('报错信息里带得上是哪个文件', () => {
    expect(() => javaStaticInt(FAKE, 'noSuchField', 'ZhangXiaoFan.java')).toThrow(/ZhangXiaoFan\.java/)
  })

  it('对真的原版源码跑得通（上面那份 FAKE 不是自己给自己签字）', () => {
    // FAKE 是手写的，它证明不了这条正则认得**原版实际的排版**。所以再对一份
    // 真源码跑一遍：原版写的是 `    public static int skillNumber=2;`，等号
    // 两边一个空格都没有。
    const src = javaSource('src/battle/ZhangXiaoFan.java')
    expect(javaStaticInt(src, 'skillNumber', 'ZhangXiaoFan.java')).toBeGreaterThan(0)
    expect(javaStaticInt(src, 'level', 'ZhangXiaoFan.java')).toBeGreaterThan(0)
  })
})
