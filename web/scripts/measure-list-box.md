# 量菜单里两个列表框的内区（xl-6lo.13）

`menu/scroll.ts` 里 `EQUIP_LIST_BOX` / `DRUG_LIST_BOX` 那两组数是**量出来的**：
列表框是画在背景图上的，框的边界既不在 Java 源码里、也不在任何真值里，它只在
像素里。而「一屏放得下几行」——滚动条存在的全部理由——由框底决定。

**与 `measure-title-bgm.md` 不同的是，这一份的测量进了 CI。** `menu/scroll.test.ts`
第一条判据每跑一次 `pnpm test` 就把两张图重新解一遍、重扫一遍，与常量逐字对。
所以下面这段脚本不是"判据"，是**第一次量它时用的东西**，留在这里是为了让别人
能用一条独立于测试代码的路子复核同一组数。

## 测法

框线是亮的、框里是暗的。从框里的一个种子点出发，沿横竖两个方向走到暗区尽头
（亮度阈值 80，`ITU-R BT.601` 的整数近似）。

| 图 | 种子点 | 量到的内区 |
|---|---|---|
| `sources/菜单/装备/装备4.png` | (650, 300) | x 536..777、y 142..521 |
| `sources/菜单/物品/物品3.png` | (500, 300) | x 427..730、y 155..532 |

种子点与 `tools/traces/scripts/menu-scroll.json` 的 `description` 里那次测量
（xl-6lo.7）用的是同两个 —— **两次独立测量量到同一组数**。

⚠️ **物品页的框顶不稳**：沿不同的列扫，上沿会在 129..156 之间跳（框的上边有
一段渐变）。**滚动条只用到框底**，而框底（532）在 41 条扫描线上完全一致。
拿上沿去推别的东西之前先自己再量一遍。

推出来的行数（`viewportRows`，基线还没掉出框底就算放得下）：

- 装备页：`(521-177)/22 = 15.6` → **16 行**，末行基线 507，第 17 行的 529 掉在框外；
- 物品页：`(532-190)/32 = 10.7` → **11 行**，而 `sources/Shop/drug.txt` 一共只有
  6 种药 —— **物品页在原版数据下撑不满**。

## 脚本

Python 3，零依赖（`zlib` 在标准库里）。两张图都是 8 位 RGBA、非隔行。

```python
import struct, zlib

def decode(path):
    b = open(path, 'rb').read()
    assert b[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat = 8, b''
    while pos < len(b):
        ln, typ = struct.unpack('>I4s', b[pos:pos+8]); pos += 8
        data = b[pos:pos+ln]; pos += ln + 4
        if typ == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', data)
            assert bd == 8 and ct == 6 and il == 0, (bd, ct, il)
        elif typ == b'IDAT': idat += data
        elif typ == b'IEND': break
    raw = zlib.decompress(idat)
    bpp, stride, p = 4, w*4, 0
    out, prev = bytearray(w*h*4), bytearray(stride)
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                c = prev[i-bpp] if i >= bpp else 0
                g = a + prev[i] - c
                pa, pb, pc = abs(g-a), abs(g-prev[i]), abs(g-c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else prev[i] if pb <= pc else c)) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, out

def lum(px, w, x, y):
    i = (y*w + x) * 4
    return (px[i]*299 + px[i+1]*587 + px[i+2]*114) // 1000

def run(arr, seed, thr=80):
    a = b = seed
    while a > 0 and arr[a-1] < thr: a -= 1
    while b + 1 < len(arr) and arr[b+1] < thr: b += 1
    return a, b

for path, sx, sy in [('sources/菜单/装备/装备4.png', 650, 300),
                     ('sources/菜单/物品/物品3.png', 500, 300)]:
    w, h, px = decode(path)
    col = [lum(px, w, sx, y) for y in range(h)]
    row = [lum(px, w, x, sy) for x in range(w)]
    print(path, w, h, 'y', run(col, sy), 'x', run(row, sx))
```

把上面那段存成文件，**从仓库根跑**（图的路径是相对的，`web/` 下跑会得到
`FileNotFoundError`）。下面这行输出是照抄这份文档里的代码块跑出来的，不是
转述的：

```
$ pbpaste > /tmp/measure-list-box.py     # 或者别的什么方式把上面那段存下来
$ cd <仓库根> && python3 /tmp/measure-list-box.py
sources/菜单/装备/装备4.png 1024 640 y (142, 521) x (536, 777)
sources/菜单/物品/物品3.png 1024 640 y (155, 532) x (427, 730)
```

⚠️ 种子点落在**亮处**（框挪了、图换了）时这个脚本不会报错，它会返回一个长度为
1 的区间 —— 与"量到了一个很窄的框"长得一样。`web/src/test/png.ts` 的
`scanDarkBox` 那一版在这种情况下**抛**，那是它与这份脚本唯一实质的差别。
