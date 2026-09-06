import AppKit
import os

let logFolder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/trade-flow")
try? FileManager.default.createDirectory(at: logFolder, withIntermediateDirectories: true)
func record(_ message: String) {
    try? (Date().description + " " + message + "\n").write(to: logFolder.appendingPathComponent("launcher.log"), atomically: true, encoding: .utf8)
}
record("启动器已运行")
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let logger = Logger(subsystem: "local.tradeflow.quotation", category: "launcher")
logger.notice("Desktop launcher started")

func showError(_ message: String) {
    app.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "trade flow 启动未完成"
    alert.informativeText = message
    alert.addButton(withTitle: "好")
    alert.runModal()
}

do {
    let resources = Bundle.main.resourceURL!
    let project = try String(contentsOf: resources.appendingPathComponent("project-path.txt"), encoding: .utf8)
        .trimmingCharacters(in: .newlines)
    let task = Process()
    let output = Pipe()
    task.executableURL = URL(fileURLWithPath: "/bin/zsh")
    task.arguments = [project + "/启动 trade flow.command"]
    task.standardOutput = output
    task.standardError = output
    task.terminationHandler = { process in
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? "请检查项目文件夹是否仍在原位置。"
        logger.notice("Startup script completed with status \(process.terminationStatus)")
        record("启动结束，状态 \(process.terminationStatus)。" + message)
        DispatchQueue.main.async {
            if process.terminationStatus != 0 {
                showError(message + "\n项目移动后，请重新运行「安装桌面入口.command」。")
            }
            app.terminate(nil)
        }
    }
    try task.run()
    app.run()
} catch {
    logger.error("Desktop launcher failed: \(error.localizedDescription)")
    record(error.localizedDescription)
    showError(error.localizedDescription)
}
