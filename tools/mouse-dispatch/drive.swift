// 「舞台外按着键拖进来」那一族票的鼠标序列驱动器（xl-zs6 现搭，xl-sij 收进来，xl-g9w 加落点开关）。
//
// 它做两件事：
//   ⚠️ 探针只驱动**标题页**（src=start.StartPanel）。所以 D 组量到的读数直接管的是
//      web/src/start/StartPanel.tsx 那一支；web/src/app/App.tsx 那四块宿主仍然是**推理**
//      （同一个 JFrame 里 CardLayout 的几块面板，「到不到得了这个窗口」由操作系统按窗口定）。
//      写回读数时别把这一份当成四块宿主的实测。
//
//   1. 按 `--where` 选一个「窗口外」的落点（见下面那张表），
//   2. 用 CGEvent 往 HID tap 上合成五组序列（A 对照 / B / B2 / C / D，见下），
//      让原版那侧的 devtools.MouseDispatchProbe 记下它到底收到了哪几下。
//
// ⚠️ 它接管物理鼠标：跑的这十几秒里光标会自己动、会真的按下去。跑之前要先问人。
// ⚠️ 没有「辅助功能」授权时，合成的事件被**静默丢弃**，Java 侧同样是零事件 ——
//    与「原版真的收不到」长得一模一样。所以起手先打印 CGPreflightPostEventAccess 与
//    AXIsProcessTrusted 两个读数，外面的脚本按它们判；A 对照（窗口内单击必须被
//    start.StartPanel 收到）是判据的另一半。
//
// 用法（由 tools/mouse-dispatch-probe.sh 调，不必手工拼）：
//
//     swiftc -O -o <可执行文件> tools/mouse-dispatch/drive.swift
//     <可执行文件> <几何文件> [--where <落点>] [--outside-geometry <文件>] [--outside-point X,Y]
//     <可执行文件> --preflight          # 只打印两个权限读数就退出，一个事件都不发
//     <可执行文件> <几何文件> --where <落点> --dry-point
//                                       # 只把「窗口外」那一下的落点算出来打印，**一下鼠标都不碰**。
//                                       # desktop 那一支扫不到桌面时，它连带把挡路的窗口列出来 ——
//                                       # 这样「去挪哪一块窗口」不用人自己猜。
//
// 几何文件由探针写：x y 宽 高，全局坐标、左上原点。
//
// 三种落点（`--where`，认不出来的名字是**硬失败**，不猜；这一点照抄 ExportTrace 对 driver 的处置）：
//
//     outside-window   （默认）在原版窗口右边开一块**自己的**空白窗口 —— 「另一个 app 的窗口」。
//                      按下只落在它自己的窗口上，不去点用户桌面上的东西。这是 xl-zs6 量的那一种。
//     desktop          落在**露出来的桌面**上。本驱动器不开窗；落点由 CGWindowList 现扫出来
//                      （要求周围 30 像素内没有任何在屏窗口），扫不到就**硬失败**并让人挪窗口 ——
//                      随便挑一个点的话，很可能落在别人的窗口上，而那份读数**看起来仍然正常**。
//                      ⚠️ **落点会在轮与轮之间漂**（xl-23v 实测：三轮扫到 3320,1260 / 1220 / 1180，
//                      每轮往上跳一个 40 像素的扫描格 —— 光标停在右下角之后 Dock 之类的窗口冒了出来）。
//                      漂了之后 D2「松左」那一行的 xy 跟着变，于是「三轮逐字一致」量的是**扫描器的环境**，
//                      不是原版的派发。所以 probe.sh 把第 1 轮扫到的点用 `--outside-point` 钉给后面几轮；
//                      钉住的点**照样校验**，被盖住就硬失败（不是静默漂过去）。
//     same-app-window  落在**原版自己那个 JVM 开的另一块窗口**上（探针用 --extra-window 开的那块），
//                      几何由 `--outside-geometry` 给。这一种是三支里唯一可能与另两支**结论不同**的：
//                      按下落在同一个进程的另一个顶层窗口上，Java 收得到，只是收它的是另一个
//                      LightweightDispatcher。web 端 grabbedElsewhere 的口径押在它上面。
//
// ⚠️ **原生全屏 app 那一种量不了，而且不是「难」是「不存在」**：macOS 的原生全屏把那个 app
//    放进**自己的 Space**，原版窗口同时不在屏幕上，于是「在外面按下、拖进原版窗口」这件事
//    构造上就发生不了。而「铺满整块屏幕但仍在同一个 Space 的普通窗口」是另一个 app 的普通窗口，
//    等价于 outside-window 那一支。⚠️ 这一段是**推理，没量过** —— 标在这里，不要当成读数转抄。
//
// 五组序列（每组之间把光标挪回落点、停 0.7 秒，让上一组的状态落定；D 组内部再按段打标，
// 段间停 0.25 秒 —— 分段读数按 MARK 的时间戳分桶，掉队的事件会被算进下一桶）：
//
// ⚠️ **D 组只在默认落点上量过**（xl-8eg）。换 `--where` 之后 D 组照样会跑，但那两支没有量过的
//    读数，外面的脚本把它报成「没核成」（退出码 3），不当成红。
//
//     A  对照：窗口内空白处左键单击                      —— 必须被 start.StartPanel 收到
//     B  票面顺序：外按左 → 拖进 → 按右 → 松右 → 松左
//     B2 换松手顺序：外按左 → 拖进 → 按右 → 松左 → 松右
//     C  外按左 → 拖进 → 只松左
//     D  内按左 → 拖出 → 外按右 → 松左 → 只剩右键拖回 → 松右，末尾再加一段右键正对照
//        （xl-8eg；D3 段是要量的，D1 与 D5 两段是它的正对照 —— 一个证左键拖动进得来、
//         一个证右键拖动进得来，缺任一个，D3 那个「没有」都不止一种读法）
//
// 落点 (600,300) 是面板内坐标，离所有按钮都远 —— 标题页上「结」那个按钮会 System.exit。
//
// 期望读数与「跑不跑得进 CI」写在 tools/src/devtools/MouseDispatchProbe.java 的类注释里。

import Cocoa

let args = CommandLine.arguments

func die(_ s: String, _ code: Int32 = 2) -> Never {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
    exit(code)
}

func permissions() -> (post: Bool, ax: Bool) {
    (CGPreflightPostEventAccess(), AXIsProcessTrusted())
}

let perm = permissions()
print("PERMISSIONS CGPreflightPostEventAccess=\(perm.post) AXIsProcessTrusted=\(perm.ax)")
fflush(stdout)

if args.contains("--preflight") {
    // 预检：只读权限，不开窗、不发事件。退出码仍是 0 —— 权限够不够由外面的脚本按
    // 上面那一行判，这里不把「没授权」变成一个读起来像别的东西的失败。
    exit(0)
}

let KNOWN_WHERE = ["outside-window", "desktop", "same-app-window"]

var geoPath: String? = nil
var whereMode = "outside-window"
var outsideGeoPath: String? = nil
var dryPoint = false
/// 钉住的「窗口外」落点（只对 desktop 有意义）。给了就不再现扫 —— 但**仍然照样校验**它是不是
/// 露出来的桌面，盖住了就硬失败。理由见 findDesktopPoint 上面那段。
var outsidePoint: CGPoint? = nil
var i = 1
while i < args.count {
    switch args[i] {
    case "--where":
        guard i + 1 < args.count else { die("--where 后面要跟一个落点名：\(KNOWN_WHERE.joined(separator: " / "))") }
        whereMode = args[i + 1]; i += 2
    case "--outside-geometry":
        guard i + 1 < args.count else { die("--outside-geometry 后面要跟一个文件") }
        outsideGeoPath = args[i + 1]; i += 2
    case "--dry-point":
        dryPoint = true; i += 1
    case "--outside-point":
        guard i + 1 < args.count else { die("--outside-point 后面要跟一个 X,Y") }
        let parts = args[i + 1].split(separator: ",").compactMap { Double($0) }
        guard parts.count == 2 else { die("--outside-point 要 X,Y 两个数，收到：\(args[i + 1])") }
        outsidePoint = CGPoint(x: parts[0], y: parts[1]); i += 2
    default:
        guard geoPath == nil else { die("多余的参数：\(args[i])") }
        geoPath = args[i]; i += 1
    }
}
// 认不出来的落点是硬失败，不退回默认 —— 默认掉的话，一份「量的其实是另一种落点」的读数
// 和真读数长得一模一样。
guard KNOWN_WHERE.contains(whereMode) else {
    die("不认识的落点 --where \(whereMode)，只接受：\(KNOWN_WHERE.joined(separator: " / "))")
}
guard let geoPath else { die("用法：drive <几何文件> [--where <落点>] [--outside-geometry <文件>] | drive --preflight") }

func readGeometry(_ path: String, _ what: String) -> (Double, Double, Double, Double) {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { die("读不了\(what)：\(path)") }
    let nums = text.split(whereSeparator: { $0 == " " || $0 == "\n" }).compactMap { Double($0) }
    guard nums.count == 4 else { die("\(what)要四个数（x y 宽 高），读到 \(nums.count) 个：\(path)") }
    return (nums[0], nums[1], nums[2], nums[3])
}

let (px, py, pw, ph) = readGeometry(geoPath, "几何文件")
// 落点写死在面板内的 (600,300)，所以面板本身得比它大 —— 面板小了的话光标会落到窗口外，
// 量出来的是另一件事，而那份读数**看起来仍然是一份正常的读数**。
guard 600 < pw, 300 < ph else { die("面板只有 \(pw)x\(ph)，装不下落点 (600,300)") }
let panelRect = CGRect(x: px, y: py, width: pw, height: ph)

let app = NSApplication.shared

/// 现扫一个**露出来的桌面**上的点：周围 `margin` 像素内不能有任何在屏窗口。
/// 扫不到就硬失败 —— 随便挑一个点的话多半落在别人的窗口上，而那份读数看起来仍然正常。
func onScreenWindows() -> [[String: Any]] {
    // .excludeDesktopElements 把桌面自己那块窗口与桌面图标排除在「障碍」之外 —— 它们正是我们要落上去的东西。
    let all = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
               as? [[String: Any]]) ?? []
    // ⚠️ **光标自己也是一块在屏窗口**（owner "Window Server"，约 17x23，跟着光标走），而驱动器
    //    每一轮结束时正把光标停在落点上 —— 下一轮扫描就把它当成障碍，落点往上让一个 40 像素的格。
    //    xl-23v 实测到的就是这个：三轮扫到 3320,1260 / 1220 / 1180，单调往上跳，于是 D2「松左」
    //    那一行的 xy 跟着变、三轮对不上，**读起来像原版的派发不确定**。
    //    光标层按构造挡不住任何点击（点下去直接穿过去落到底下那块窗口），所以它不是障碍。
    //    ⚠️ 只排这一层，不排别的：排宽了的话，真正挡路的窗口会被当成「没挡」，而那份读数看起来仍然正常。
    let cursorLevel = Int(CGWindowLevelForKey(.cursorWindow))
    return all.filter { (($0[kCGWindowLayer as String] as? Int) ?? 0) < cursorLevel }
}

/// 扫不到桌面时，把**挡在主屏上的那几块窗口**按面积从大到小列出来（谁的、多大、在哪）。
/// 没有这一段的话，报错只说「找不到」，而人要挪哪一块得自己猜。
func describeBlockers() -> String {
    let screen = CGDisplayBounds(CGMainDisplayID())
    var rows: [(String, CGRect)] = []
    for w in onScreenWindows() {
        guard let b = w[kCGWindowBounds as String] as? [String: Any],
              let r = CGRect(dictionaryRepresentation: b as CFDictionary),
              r.intersects(screen), r.width * r.height > 100_000 else { continue }
        rows.append((w[kCGWindowOwnerName as String] as? String ?? "?", r))
    }
    rows.sort { $0.1.width * $0.1.height > $1.1.width * $1.1.height }
    return rows.prefix(10).map {
        "     \($0.0)  \(Int($0.1.minX)),\(Int($0.1.minY)) \(Int($0.1.width))x\(Int($0.1.height))"
    }.joined(separator: "\n")
}

/// 一个点周围 `margin` 像素内有没有在屏窗口。扫描与「钉住的点还作不作数」用的是同一段判断 ——
/// 两边分开写的话，钉住那条路可能比扫描那条路松，而松掉的那份读数看起来仍然正常。
func isDesktopPoint(_ p: CGPoint, margin: CGFloat) -> Bool {
    for w in onScreenWindows() {
        guard let b = w[kCGWindowBounds as String] as? [String: Any],
              let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { continue }
        if r.insetBy(dx: -margin, dy: -margin).contains(p) { return false }
    }
    return true
}

/// 盖住某个点的窗口**逐块列出来**（谁的、多大、在哪）。
/// ⚠️ 不要拿 describeBlockers() 顶这件事：它只列面积 > 10 万的大窗口，而盖住一个点的
/// 常常是一小块（xl-23v 实测：钉住的点被盖住时，describeBlockers 列出来的那一块根本不含那个点）——
/// **一份不含真凶的挡路名单，与一份正确的名单长得一样**。
func describeCovering(_ p: CGPoint, margin: CGFloat) -> String {
    var rows: [String] = []
    for w in onScreenWindows() {
        guard let b = w[kCGWindowBounds as String] as? [String: Any],
              let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { continue }
        if r.insetBy(dx: -margin, dy: -margin).contains(p) {
            rows.append("     \(w[kCGWindowOwnerName as String] as? String ?? "?")  " +
                        "\(Int(r.minX)),\(Int(r.minY)) \(Int(r.width))x\(Int(r.height))")
        }
    }
    return rows.isEmpty ? "     （一块都列不出来 —— 那就不是「被盖住」，是这段判断本身错了）"
                        : rows.joined(separator: "\n")
}

func findDesktopPoint(margin: CGFloat) -> CGPoint {
    var blockers: [CGRect] = []
    for w in onScreenWindows() {
        guard let b = w[kCGWindowBounds as String] as? [String: Any],
              let r = CGRect(dictionaryRepresentation: b as CFDictionary) else { continue }
        blockers.append(r.insetBy(dx: -margin, dy: -margin))
    }
    let screen = CGDisplayBounds(CGMainDisplayID())
    var best: CGPoint? = nil
    var bestDist: CGFloat = -1
    let panelCenter = CGPoint(x: panelRect.midX, y: panelRect.midY)
    var y = screen.minY + 60      // 让开菜单栏
    while y <= screen.maxY - 120 { // 让开 Dock
        var x = screen.minX + 40
        while x <= screen.maxX - 40 {
            let p = CGPoint(x: x, y: y)
            if !blockers.contains(where: { $0.contains(p) }) {
                let d = hypot(p.x - panelCenter.x, p.y - panelCenter.y)
                if d > bestDist { bestDist = d; best = p }
            }
            x += 40
        }
        y += 40
    }
    guard let p = best else {
        die("屏幕上找不到一块露出来的桌面（周围 \(Int(margin)) 像素内无窗口）—— 把别的窗口挪开或最小化再跑。\n" +
            "   不硬挑一个点：挑错了会落在别人的窗口上，而那份读数看起来仍然是一份正常的读数。\n" +
            "   主屏上挡着的窗口（按面积，最多列 10 块）：\n" + describeBlockers())
    }
    return p
}

let O: CGPoint          // 「窗口外」那一下的落点
/// 持着自己那块空白窗口，**不是为了用它，是为了别让它死**：没人持的 NSWindow
/// 会被释放掉，那一下「窗口外」就落到它后面的东西上了 —— 而那份读数看起来仍然正常。
var ownWindow: NSWindow? = nil

switch whereMode {
case "outside-window":
    let primaryH = NSScreen.screens[0].frame.height
    let ox = px + pw + 80, oy = py + 100   // 外窗内容区左上角（左上原点）
    if !dryPoint {                          // --dry-point 连这块窗口都不开
        app.setActivationPolicy(.regular)
        let win = NSWindow(contentRect: NSRect(x: ox, y: primaryH - oy - 300, width: 300, height: 300),
                           styleMask: [.titled], backing: .buffered, defer: false)
        win.title = "xl-zs6 outside"
        win.makeKeyAndOrderFront(nil)
        ownWindow = win
    }
    O = CGPoint(x: ox + 150, y: oy + 150)   // 外窗中心
case "desktop":
    app.setActivationPolicy(.accessory)     // 不开窗，也别在 Dock 里冒出来
    if let pinned = outsidePoint {
        // 钉住的点**照样校验**：环境在两轮之间变了（Dock 冒出来、别的窗口挪过来）的话，
        // 这一下就落在别人的窗口上了，而那份读数看起来仍然是一份正常的读数。
        guard isDesktopPoint(pinned, margin: 30) else {
            die("钉住的落点 \(Int(pinned.x)),\(Int(pinned.y)) 现在被窗口盖住了 —— 这一下会落在别人的窗口上。\n" +
                "   盖住它的（周围 \(Int(30)) 像素内）是：\n" + describeCovering(pinned, margin: 30))
        }
        O = pinned
    } else {
        O = findDesktopPoint(margin: 30)
    }
case "same-app-window":
    app.setActivationPolicy(.accessory)
    guard let outsideGeoPath else { die("--where same-app-window 要配一个 --outside-geometry <文件>") }
    let (ox, oy, ow, oh) = readGeometry(outsideGeoPath, "另一块窗口的几何")
    let other = CGRect(x: ox, y: oy, width: ow, height: oh)
    // 「外面」得真在外面：两块窗口叠上了的话，那一下按下落在哪一块由 z 序定，
    // 而那份读数看起来仍然是一份正常的读数。
    guard !other.intersects(panelRect) else {
        die("另一块窗口 \(other) 与原版面板 \(panelRect) 叠在一起了 —— 这一下按下落在哪一块说不准。")
    }
    O = CGPoint(x: other.midX, y: other.midY)
default:
    die("不该走到这里：\(whereMode)")   // 上面已经拦过了
}
_ = ownWindow   // 引用一下，把「赋了值没人用」的警告压掉；理由见上面那段注释。

let P = CGPoint(x: px + 600, y: py + 300)   // 面板 (600,300)，离所有按钮都远
let src = CGEventSource(stateID: .hidSystemState)

print("WHERE \(whereMode) outside=\(Int(O.x)),\(Int(O.y)) panel=\(Int(P.x)),\(Int(P.y))")
fflush(stdout)

if dryPoint {
    // 只算落点，不发事件、不碰鼠标。落点算不出来的那一支上面已经硬失败过了。
    exit(0)
}

func mark(_ s: String) { print("\(Int(Date().timeIntervalSince1970 * 1000)) MARK \(s)"); fflush(stdout) }
func post(_ t: CGEventType, _ p: CGPoint, _ b: CGMouseButton) {
    CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: b)!.post(tap: .cghidEventTap)
    usleep(80_000)
}
func at(_ p: CGPoint, _ dx: Double) -> CGPoint { CGPoint(x: p.x + dx, y: p.y + dx) }
// 12 步匀速拖一段。⚠️ 拖动的事件类型要跟**当前按着的那只键**走（macOS 分
// leftMouseDragged / rightMouseDragged / otherMouseDragged），传错了合成出来的是另一件事。
func drag(_ type: CGEventType, _ button: CGMouseButton, from a: CGPoint, to b: CGPoint) {
    for i in 1...12 {
        let t = Double(i) / 12
        post(type, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), button)
    }
}
func dragLeft(from a: CGPoint, to b: CGPoint) { drag(.leftMouseDragged, .left, from: a, to: b) }
// 分组之间停一下，让上一段的事件在下一个 MARK 之前落定 —— 对账是按 MARK 的时间戳
// 分桶的（tools/mouse-dispatch/reckon.py），掉队的事件会被算进下一桶。
func settlePhase() { usleep(250_000) }
func settleOutside() { post(.mouseMoved, O, .left); usleep(700_000) }

DispatchQueue.global().async {
    sleep(2)
    mark("A 对照：窗口内空白处左键单击")
    post(.mouseMoved, P, .left); post(.leftMouseDown, P, .left); post(.leftMouseUp, P, .left)
    post(.mouseMoved, at(P, 3), .left)
    settleOutside()

    mark("B 票面：外按左 → 拖进 → 按右 → 松右 → 松左")
    post(.leftMouseDown, O, .left); dragLeft(from: O, to: P)
    post(.rightMouseDown, P, .right); post(.rightMouseUp, P, .right); post(.leftMouseUp, P, .left)
    post(.mouseMoved, at(P, 3), .left); post(.mouseMoved, at(P, 6), .left)
    settleOutside()

    mark("B2：外按左 → 拖进 → 按右 → 松左 → 松右")
    post(.leftMouseDown, O, .left); dragLeft(from: O, to: P)
    post(.rightMouseDown, P, .right); post(.leftMouseUp, P, .left); post(.rightMouseUp, P, .right)
    post(.mouseMoved, at(P, 3), .left); post(.mouseMoved, at(P, 6), .left)
    settleOutside()

    mark("C：外按左 → 拖进 → 松左")
    post(.leftMouseDown, O, .left); dragLeft(from: O, to: P); post(.leftMouseUp, P, .left)
    post(.mouseMoved, at(P, 3), .left); post(.mouseMoved, at(P, 6), .left)
    settleOutside()

    // D 组（xl-8eg）：**起 grab 那只键松开后、只剩那只被挡掉的键按着时的拖动**，原版收不收得到。
    // 分五段打标，因为其中两段互为对照：
    //   D1 起 grab 那只键（左，按在面板**里**）按着拖出去 —— 已量过：越界 DRAGGED 一路
    //      src=start.StartPanel（xl-40m / xl-bg3），所以它是**这一轮的正对照**；
    //   D3 右键在外窗上按下、左键松开之后，只剩右键按着拖回面板 —— **本票要量的就是这一段**。
    //   D5 面板里按右 → 拖一段 → 松右（全程在面板里）—— 证「合成的**右键**拖动进得了 Java」。
    // D1 与 D5 都有 DRAGGED 而 D3 没有，才叫量到了「原版收不到」；缺任一个正对照，D3 那个
    //「没有」就不止一种读法（事件压根没进来 / 右键拖动这套组合本来就到不了）。
    // ⚠️ D3 的读数**没有期望值**：两种结果都说得通，这一趟就是去取它的
    //（见 tools/mouse-dispatch/expected-events-D.txt）。
    mark("D0 内按左：在面板里按下，起 grab")
    post(.mouseMoved, P, .left); post(.leftMouseDown, P, .left)
    settlePhase()
    mark("D1 拖出：起 grab 那只键按着（正对照，已量过 xl-40m）")
    dragLeft(from: P, to: O)
    settlePhase()
    mark("D2 外按右、再松左：外窗上按下第二个键，然后松掉起 grab 那只键")
    post(.rightMouseDown, O, .right); post(.leftMouseUp, O, .left)
    settlePhase()
    mark("D3 拖回：只剩被挡掉的那只键按着（xl-8eg 要量的就是这一段）")
    drag(.rightMouseDragged, .right, from: O, to: P)
    settlePhase()
    mark("D4 松右、之后的移动")
    post(.rightMouseUp, P, .right)
    post(.mouseMoved, at(P, 3), .left); post(.mouseMoved, at(P, 6), .left)
    settleOutside()

    // D5 是 D3 的**第二个正对照，管另一件事**：D1 只证「合成的**左**键拖动进得了 Java 窗口」。
    // D3 空着还有一解 —— 合成的 rightMouseDragged 在这套 AWT + CGEvent 组合下根本到不了探针
    //（仓库里从没量过右键的拖动；B / B2 量到的是右键**按下**，而且那一下按在窗口里）。
    // 这一段全程在面板里、除右键外没有别的键按着：它有 DRAGGED 而 D3 没有，「原版收不到」才立得住。
    // 落点 at(P,60) = 面板内 (660,360)，四个按钮的命中框在 x 185–235 与 785–835，都不沾。
    mark("D5 右键正对照：面板里按右 → 拖一段 → 松右（全程在面板里，没有别的键）")
    post(.mouseMoved, P, .right); post(.rightMouseDown, P, .right)
    drag(.rightMouseDragged, .right, from: P, to: at(P, 60))
    post(.rightMouseUp, at(P, 60), .right)
    post(.mouseMoved, at(P, 63), .left)
    settleOutside()

    mark("END")
    DispatchQueue.main.async { app.terminate(nil) }
}
app.activate(ignoringOtherApps: true)
app.run()
