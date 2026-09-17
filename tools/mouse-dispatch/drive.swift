// 「舞台外按着键拖进来」那一族票的鼠标序列驱动器（xl-zs6 现搭，xl-sij 收进来）。
//
// 它做两件事：
//   1. 在原版窗口右边开一块**自己的**空白窗口当「窗口外」—— 按下只落在它自己的窗口上，
//      不去点用户桌面上的东西。⚠️ 这个落点是读数的限定之一：换成桌面、全屏 app 或
//      同一个 app 的另一块窗口，都没量过。
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
//     <可执行文件> <几何文件>            # 几何文件由探针写：x y 宽 高，全局坐标、左上原点
//     <可执行文件> --preflight          # 只打印两个权限读数就退出，一个事件都不发
//
// 五组序列（每组之间把光标挪回外窗、停 0.7 秒，让上一组的状态落定；D 组内部再按段打标，段间停 0.25 秒）：
//
//     A  对照：窗口内空白处左键单击                      —— 必须被 start.StartPanel 收到
//     B  票面顺序：外按左 → 拖进 → 按右 → 松右 → 松左
//     B2 换松手顺序：外按左 → 拖进 → 按右 → 松左 → 松右
//     C  外按左 → 拖进 → 只松左
//     D  内按左 → 拖出 → 外按右 → 松左 → 只剩右键拖回 → 松右（xl-8eg；D1 段是正对照，D3 段是要量的）
//
// 落点 (600,300) 是面板内坐标，离所有按钮都远 —— 标题页上「结」那个按钮会 System.exit。
//
// 期望读数与「跑不跑得进 CI」写在 tools/src/devtools/MouseDispatchProbe.java 的类注释里。

import Cocoa

let args = CommandLine.arguments

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

guard args.count == 2 else {
    FileHandle.standardError.write("用法：drive <几何文件> | drive --preflight\n".data(using: .utf8)!)
    exit(2)
}

let geo = try! String(contentsOfFile: args[1], encoding: .utf8)
    .split(whereSeparator: { $0 == " " || $0 == "\n" }).map { Double($0)! }
guard geo.count == 4 else {
    FileHandle.standardError.write("几何文件要四个数（x y 宽 高），读到 \(geo.count) 个\n".data(using: .utf8)!)
    exit(2)
}
let (px, py, pw, ph) = (geo[0], geo[1], geo[2], geo[3])
// 落点写死在面板内的 (600,300)，所以面板本身得比它大 —— 面板小了的话光标会落到窗口外，
// 量出来的是另一件事，而那份读数**看起来仍然是一份正常的读数**。
guard 600 < pw, 300 < ph else {
    FileHandle.standardError.write("面板只有 \(pw)x\(ph)，装不下落点 (600,300)\n".data(using: .utf8)!)
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let primaryH = NSScreen.screens[0].frame.height
let ox = px + pw + 80, oy = py + 100   // 外窗内容区左上角（左上原点）
let win = NSWindow(contentRect: NSRect(x: ox, y: primaryH - oy - 300, width: 300, height: 300),
                   styleMask: [.titled], backing: .buffered, defer: false)
win.title = "xl-zs6 outside"
win.makeKeyAndOrderFront(nil)

let O = CGPoint(x: ox + 150, y: oy + 150)   // 外窗中心 = 「窗口外」那一下的落点
let P = CGPoint(x: px + 600, y: py + 300)   // 面板 (600,300)，离所有按钮都远
let src = CGEventSource(stateID: .hidSystemState)

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
    // D1 有 DRAGGED 而 D3 没有，才叫量到了「原版收不到」；两段都没有 = 事件根本没进来
    //（探针瞎了），与 A 对照同一个道理。⚠️ D3 的读数**没有期望值**：两种结果都说得通，
    // 这一趟就是去取它的（见 tools/mouse-dispatch/expected-events.txt 开头）。
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

    mark("END")
    DispatchQueue.main.async { app.terminate(nil) }
}
app.activate(ignoringOtherApps: true)
app.run()
