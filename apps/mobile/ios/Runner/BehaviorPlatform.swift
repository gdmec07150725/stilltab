import Flutter
import UIKit
import SwiftUI
import FamilyControls
import DeviceActivity
import UniformTypeIdentifiers

final class BehaviorPlatform: NSObject, FlutterPlugin, UIDocumentPickerDelegate {
    private let store = BehaviorStore.shared
    private weak var presenter: UIViewController?
    private var documentResult: FlutterResult?
    private var exporting = false
    private var exportURL: URL?
    private var selectionOpen = false

    static func register(with registrar: FlutterPluginRegistrar) {
        let instance = BehaviorPlatform()
        instance.presenter = registrar.viewController()
        registrar.addMethodCallDelegate(instance, channel: FlutterMethodChannel(name: "behavior_rules/platform", binaryMessenger: registrar.messenger()))
    }
    private func currentPresenter() -> UIViewController? {
        var root = presenter ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        while let next = root?.presentedViewController { root = next }
        return root
    }
    private var extensionsReady: Bool {
        guard store.groupAvailable, let plugins = Bundle.main.builtInPlugInsURL else { return false }
        return ["BehaviorMonitor", "BehaviorShield", "BehaviorShieldAction"].allSatisfy {
            FileManager.default.fileExists(atPath: plugins.appendingPathComponent($0 + ".appex").path)
        }
    }
    private func status() -> [String: Any] {
        let authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        let ready = extensionsReady
        let message: String
        if !ready {
            message = "iOS系统适配尚未完成签名配置。请在Mac上配置Family Controls、App Group与三个Screen Time扩展。Windows中未构建或验证iOS。"
        } else if !authorized {
            message = "需要你主动授权屏幕使用时间。iOS首版支持全天系统屏蔽与临时放行，暂不支持提醒、等待、时段和额度。"
        } else {
            message = "系统屏蔽已授权。iOS首版支持全天屏蔽；临时放行到期由系统回调恢复。未提供应用用时统计。"
        }
        return ["platform": "ios", "permissionGranted": authorized, "monitoring": ready && authorized,
                "availability": !ready ? "unavailable" : authorized ? "ready" : "permissionRequired",
                "message": message, "batteryOptimized": false, "lastEventAt": 0,
                "capabilities": ["appSelection": true, "remind": false, "delay": false, "block": true,
                                 "schedules": false, "quotas": false, "exceptions": false]]
    }
    private func state() throws -> [String: Any] {
        if extensionsReady { try store.applyShields() }
        let saved = try store.read()
        let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return ["config": try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved.config)),
                "grants": saved.grants.filter { $0.value > BehaviorConstants.now },
                "logs": try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved.logs)),
                "usage": [String: Any](), "status": status(), "today": formatter.string(from: Date()), "now": BehaviorConstants.now]
    }
    private func requireReady() throws {
        guard extensionsReady else { throw BehaviorFailure(message: "请先在Mac上配置并签名Screen Time扩展；当前无法执行系统屏蔽") }
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { throw BehaviorFailure(message: "请先在运行页授权屏幕使用时间") }
    }
    private func refresh() throws { if extensionsReady { try store.applyShields() } }
    private func cancelMonitor(_ id: String) { DeviceActivityCenter().stopMonitoring([DeviceActivityName("br-grant-" + id)]) }
    private func requiredID(_ args: [String: Any]) throws -> String {
        guard let id = args["id"] as? String, try store.read().config.rules.contains(where: { $0.id == id }) else { throw BehaviorFailure(message: "找不到这条规则") }
        return id
    }
    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let args = call.arguments as? [String: Any] ?? [:]
        do {
            switch call.method {
            case "getState": result(try state())
            case "listApps": throw BehaviorFailure(message: "iOS请使用系统应用选择器，不能列出Android包名")
            case "saveRule":
                guard let input = args["rule"] as? [String: Any] else { throw BehaviorFailure(message: "规则格式无效") }
                let rule = try JSONDecoder().decode(BehaviorRule.self, from: JSONSerialization.data(withJSONObject: input))
                var config = try store.read().config
                if let index = config.rules.firstIndex(where: { $0.id == rule.id }) { config.rules[index] = rule } else { config.rules.append(rule) }
                try store.validate(config)
                if rule.enabled { try requireReady() }
                try store.update { $0.config = config; $0.grants.removeValue(forKey: rule.id) }
                cancelMonitor(rule.id); try refresh(); result(try state())
            case "deleteRule":
                let id = try requiredID(args)
                try store.update { $0.config.rules.removeAll { $0.id == id }; $0.grants.removeValue(forKey: id) }
                cancelMonitor(id); try refresh(); result(try state())
            case "toggleRule":
                let id = try requiredID(args)
                guard let enabled = args["enabled"] as? Bool else { throw BehaviorFailure(message: "启用状态无效") }
                if enabled { try requireReady() }
                try store.update { saved in
                    guard let index = saved.config.rules.firstIndex(where: { $0.id == id }) else { return }
                    saved.config.rules[index].enabled = enabled; saved.grants.removeValue(forKey: id)
                }
                cancelMonitor(id); try refresh(); result(try state())
            case "bypassRule":
                let id = try requiredID(args); try requireReady()
                guard let minutes = args["minutes"] as? Int, minutes == 15 else { throw BehaviorFailure(message: "iOS当前仅支持放行15分钟") }
                let before = try store.read()
                guard let rule = before.config.rules.first(where: { $0.id == id && $0.enabled }) else { throw BehaviorFailure(message: "请先启用这条规则") }
                // Use the same whole-second deadline for persistent grants and the system schedule.
                // Start slightly before now to ensure the scheduled interval exceeds Apple's minimum.
                let end = Date(timeIntervalSince1970: ceil(Date().timeIntervalSince1970 + 15 * 60))
                let components: Set<Calendar.Component> = [.era, .year, .month, .day, .hour, .minute, .second]
                let schedule = DeviceActivitySchedule(intervalStart: Calendar.current.dateComponents(components, from: Date().addingTimeInterval(-60)),
                    intervalEnd: Calendar.current.dateComponents(components, from: end), repeats: false)
                try store.update { $0.grants[id] = Int64(end.timeIntervalSince1970 * 1000) }
                do {
                    try DeviceActivityCenter().startMonitoring(DeviceActivityName("br-grant-" + id), during: schedule)
                } catch {
                    try store.update { $0.grants[id] = before.grants[id] }
                    throw BehaviorFailure(message: "系统未能安排放行结束时间，规则仍保持原状态：\(error.localizedDescription)")
                }
                store.record(rule, target: "所选应用", action: "bypass", reason: "临时放行15分钟")
                try refresh(); result(try state())
            case "revokeBypass":
                let id = try requiredID(args)
                try store.update { $0.grants.removeValue(forKey: id) }
                cancelMonitor(id); try refresh(); result(try state())
            case "clearLogs": try store.update { $0.logs = [] }; result(try state())
            case "getConfigJson": result(try store.configJSON())
            case "importConfig":
                guard let json = args["json"] as? String else { throw BehaviorFailure(message: "配置内容无效") }
                let config = try store.parseConfig(json)
                if config.rules.contains(where: \.enabled) { try requireReady() }
                let oldIDs = try store.read().config.rules.map(\.id)
                try store.update { $0.config = config; $0.grants = [:] }
                oldIDs.forEach(cancelMonitor); try refresh(); result(try state())
            case "exportConfig": try beginDocument(export: true, result: result)
            case "readImportFile": try beginDocument(export: false, result: result)
            case "openAppSettings":
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                result(nil)
            case "requestAuthorization":
                Task { @MainActor in
                    do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual); result(self.status()) }
                    catch { result(FlutterError(code: "authorization", message: "屏幕使用时间授权未完成：\(error.localizedDescription)", details: nil)) }
                }
            case "pickTargets": try pickTargets(args, result: result)
            default: result(FlutterMethodNotImplemented)
            }
        } catch {
            result(FlutterError(code: "behavior_rules", message: error.localizedDescription, details: nil))
        }
    }
    private func pickTargets(_ args: [String: Any], result: @escaping FlutterResult) throws {
        guard !selectionOpen, let parent = currentPresenter() else { throw BehaviorFailure(message: "请关闭当前弹窗后再选择应用") }
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { throw BehaviorFailure(message: "请先授权屏幕使用时间") }
        let selectionID = args["selectionId"] as? String
        let initial = try selectionID.map { try store.selection($0) } ?? FamilyActivitySelection()
        selectionOpen = true
        let view = BehaviorSelectionView(initial: initial, onCancel: { [weak self] in
            self?.currentPresenter()?.dismiss(animated: true); self?.selectionOpen = false; result(nil)
        }, onSave: { [weak self] selection in
            guard let self = self else { return }
            do {
                guard selection.webDomainTokens.isEmpty else { throw BehaviorFailure(message: "移动端首版只选择应用和应用分类，请取消网站选择") }
                guard !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty else { throw BehaviorFailure(message: "请至少选择一个应用或应用分类") }
                // New identity each time: editing a draft must not mutate a selection shared by saved rules.
                let id = UUID().uuidString
                try self.store.saveSelection(selection, id: id)
                self.currentPresenter()?.dismiss(animated: true); self.selectionOpen = false
                result([["platform": "ios", "id": id, "label": "\(selection.applicationTokens.count)个应用、\(selection.categoryTokens.count)个分类"]])
            } catch {
                self.currentPresenter()?.dismiss(animated: true); self.selectionOpen = false
                result(FlutterError(code: "selection", message: error.localizedDescription, details: nil))
            }
        })
        let hosting = UIHostingController(rootView: view)
        hosting.isModalInPresentation = true
        parent.present(hosting, animated: true)
    }
    private func beginDocument(export: Bool, result: @escaping FlutterResult) throws {
        guard documentResult == nil, let parent = currentPresenter() else { throw BehaviorFailure(message: "文件选择器已打开") }
        let picker: UIDocumentPickerViewController
        if export {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("behavior-rules-ios-\(UUID().uuidString).json")
            try store.configJSON().write(to: url, atomically: true, encoding: .utf8)
            exportURL = url; picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        } else { picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: false) }
        exporting = export; documentResult = result
        picker.delegate = self; picker.allowsMultipleSelection = false
        parent.present(picker, animated: true)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishDocument(nil) }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if exporting { finishDocument("配置已导出"); return }
        guard let url = urls.first else { finishDocument(nil); return }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= BehaviorConstants.maxBytes else { throw BehaviorFailure(message: "配置文件超过2MiB") }
            let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
            let data = try handle.read(upToCount: BehaviorConstants.maxBytes + 1) ?? Data()
            guard data.count <= BehaviorConstants.maxBytes, let text = String(data: data, encoding: .utf8) else { throw BehaviorFailure(message: "文件超过2MiB或不是UTF-8格式") }
            finishDocument(text)
        } catch { finishDocument(FlutterError(code: "file", message: error.localizedDescription, details: nil)) }
    }
    private func finishDocument(_ value: Any?) {
        let callback = documentResult; documentResult = nil
        if let url = exportURL { try? FileManager.default.removeItem(at: url); exportURL = nil }
        callback?(value)
    }
}

private struct BehaviorSelectionView: View {
    @State private var selection: FamilyActivitySelection
    let onCancel: () -> Void
    let onSave: (FamilyActivitySelection) -> Void
    init(initial: FamilyActivitySelection, onCancel: @escaping () -> Void, onSave: @escaping (FamilyActivitySelection) -> Void) {
        _selection = State(initialValue: initial); self.onCancel = onCancel; self.onSave = onSave
    }
    var body: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("选择应用或应用分类")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消", action: onCancel) }
                    ToolbarItem(placement: .confirmationAction) { Button("使用所选应用") { onSave(selection) } }
                }
        }
    }
}
