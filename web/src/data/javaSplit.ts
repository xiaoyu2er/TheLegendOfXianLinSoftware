/**
 * Java `String.split(regex)` 的**尾部空串截断**语义。
 *
 * 原版解析器全篇用 `s.split(" ")` / `s.split("/")` 切数据。Java 的 split 在
 * limit 为 0 时会**丢掉结果末尾所有的空串**，JS 的 `String.prototype.split`
 * 不会。数据里正好踩到了这条：`script/大地图.txt` 的 NPC 段里
 *
 *     "2 37 38 11 商塔阿威哥 我大商塔天下无敌! "
 *                                            ↑ 行尾多一个空格
 *
 * Java 切出 6 段（真值 `大地图.json` 里就是 6 段），JS 会切出 7 段，多的那段
 * 是空串。地图网格行也有多处行尾空格。
 *
 * 只截断**尾部**：中间的空串（连续分隔符）Java 是保留的，这里也保留。
 *
 * 分隔符按字面量处理，不是正则 —— 原版用到的两个分隔符 " " 与 "/" 在正则里
 * 也无特殊含义，两种解释等价。
 */
export function javaSplit(s: string, separator: string): string[] {
  const parts = s.split(separator)
  let end = parts.length
  while (end > 0 && parts[end - 1] === '') end -= 1
  return parts.slice(0, end)
}
