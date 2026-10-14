import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity
import Darwin

// Shared by Runner and the three Screen Time extensions. No Android package IDs.
enum BehaviorConstants {
    static let appGroup = "group.com.behaviorrules.mobile"
    static let maxBytes = 2 * 1024 * 1024
    static var now: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

struct BehaviorFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct BehaviorTarget: Codable { let platform: String; let id: String; let label: String }
struct BehaviorSchedule: Codable { let enabled: Bool; let days: [Int]; let start: String; let end: String }
struct BehaviorRule: Codable {
    let id: String
    let name: String
    var enabled: Bool
    let targets: [BehaviorTarget]
    let exceptions: [BehaviorTarget]
    let schedule: BehaviorSchedule
    let quotaMinutes: Int
    let action: String
    let delaySeconds: Int
    let message: String
    let buttonText: String
    let priority: Int
    let createdAt: Int64
}
struct BehaviorConfig: Codable {
    let version: Int
    let platform: String
    var rules: [BehaviorRule]
    static let empty = BehaviorConfig(version: 1, platform: "ios", rules: [])
}
struct BehaviorLog: Codable {
    let at: Int64
    let ruleId: String
    let ruleName: String
    let targetLabel: String
    let action: String
    let reason: String
}
struct BehaviorSavedState: Codable {
    var config: BehaviorConfig = .empty
    var grants: [String: Int64] = [:]
    var logs: [BehaviorLog] = []
}

final class BehaviorStore {
    static let shared = BehaviorStore()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    var groupAvailable: Bool { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: BehaviorConstants.appGroup) != nil }
    private func folder() throws -> URL {
        // Drafts can be edited in Runner without pretending extensions are configured.
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: BehaviorConstants.appGroup)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("BehaviorRules", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
    private func locked<T>(_ action: (URL) throws -> T) throws -> T {
        let root = try folder()
        let descriptor = open(root.appendingPathComponent("state.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw BehaviorFailure(message: "无法锁定本机数据文件") }
        defer { flock(descriptor, LOCK_UN); close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw BehaviorFailure(message: "数据正在被其他进程使用") }
        return try action(root)
    }
    private func read(at root: URL) throws -> BehaviorSavedState {
        let url = root.appendingPathComponent("state.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return BehaviorSavedState() }
        return try decoder.decode(BehaviorSavedState.self, from: Data(contentsOf: url))
    }
    func read() throws -> BehaviorSavedState { try locked { try read(at: $0) } }
    @discardableResult func update(_ change: (inout BehaviorSavedState) throws -> Void) throws -> BehaviorSavedState {
        try locked { root in
            var state = try read(at: root)
            try change(&state)
            state.logs = Array(state.logs.prefix(300))
            try encoder.encode(state).write(to: root.appendingPathComponent("state.json"), options: .atomic)
            return state
        }
    }
    func selection(_ id: String) throws -> FamilyActivitySelection {
        guard id.range(of: "^[a-zA-Z0-9_-]{1,80}$", options: .regularExpression) != nil else {
            throw BehaviorFailure(message: "应用选择标识无效")
        }
        return try locked { root in
            let url = root.appendingPathComponent("selection-\(id).json")
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw BehaviorFailure(message: "这组iOS应用尚未在当前设备选择，请重新选择应用")
            }
            return try decoder.decode(FamilyActivitySelection.self, from: Data(contentsOf: url))
        }
    }
    func saveSelection(_ selection: FamilyActivitySelection, id: String) throws {
        try locked { root in
            try encoder.encode(selection).write(to: root.appendingPathComponent("selection-\(id).json"), options: .atomic)
        }
    }
    func validate(_ config: BehaviorConfig, requireSelections: Bool = true) throws {
        func require(_ valid: Bool, _ message: String) throws { if !valid { throw BehaviorFailure(message: message) } }
        try require(config.version == 1 && config.platform == "ios", "请选择本工具导出的 iOS 配置；Android和浏览器配置不能混用")
        try require(config.rules.count <= 200, "最多支持200条规则")
        try require(Set(config.rules.map(\.id)).count == config.rules.count, "配置包含重复规则标识")
        for rule in config.rules {
            try require(rule.id.range(of: "^[a-zA-Z0-9_-]{1,80}$", options: .regularExpression) != nil, "规则标识无效")
            try require((1...80).contains(rule.name.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count), "规则名称需1至80字")
            try require((1...1000).contains(rule.message.utf16.count) && (1...40).contains(rule.buttonText.utf16.count), "提示语或按钮文字长度无效")
            try require((1...100).contains(rule.targets.count) && rule.exceptions.count <= 100, "应用选择数量无效")
            for targets in [rule.targets, rule.exceptions] {
                try require(Set(targets.map(\.id)).count == targets.count, "应用选择不可重复")
                for target in targets {
                    try require(target.platform == "ios" && (1...255).contains(target.id.count) && !target.label.isEmpty && target.label.utf16.count <= 255, "iOS应用标识无效")
                    if requireSelections { _ = try selection(target.id) }
                }
            }
            try require(!rule.schedule.days.isEmpty && Set(rule.schedule.days).count == rule.schedule.days.count && rule.schedule.days.allSatisfy { (0...6).contains($0) }, "日期选择无效")
            for time in [rule.schedule.start, rule.schedule.end] {
                try require(time.range(of: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", options: .regularExpression) != nil, "时段格式无效")
            }
            try require((0...1440).contains(rule.quotaMinutes) && (1...3600).contains(rule.delaySeconds) && (-1000...1000).contains(rule.priority) && rule.createdAt >= 0 && rule.createdAt <= 8640000000000000, "规则数值超出范围")
            // This first iOS adapter intentionally exposes only the verified API surface in its capabilities.
            try require(rule.action == "block", "iOS适配当前只接入系统屏蔽，不支持提醒或等待")
            try require(!rule.schedule.enabled && rule.quotaMinutes == 0 && rule.exceptions.isEmpty, "iOS首版暂未接入时段、额度及例外，请使用全天屏蔽")
        }
        try require(try encoder.encode(config).count <= BehaviorConstants.maxBytes, "配置超过2MiB")
    }
    func parseConfig(_ json: String) throws -> BehaviorConfig {
        guard let data = json.data(using: .utf8), data.count <= BehaviorConstants.maxBytes else { throw BehaviorFailure(message: "配置文件超过2MiB或编码无效") }
        let config = try decoder.decode(BehaviorConfig.self, from: data)
        try validate(config)
        return config
    }
    func configJSON() throws -> String {
        let pretty = JSONEncoder(); pretty.outputFormatting = [.prettyPrinted, .sortedKeys]
        let config = try read().config
        let formatted = try pretty.encode(config)
        let data = formatted.count <= BehaviorConstants.maxBytes ? formatted : try encoder.encode(config)
        return String(data: data, encoding: .utf8)!
    }
    func activeRules(_ state: BehaviorSavedState) -> [BehaviorRule] {
        state.config.rules.filter { $0.enabled && (state.grants[$0.id] ?? 0) <= BehaviorConstants.now }
            .sorted { a, b in a.priority != b.priority ? a.priority > b.priority : a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.id < b.id }
    }
    func applyShields() throws {
        let shieldStore = ManagedSettingsStore(named: .init("behavior-rules"))
        guard groupAvailable, AuthorizationCenter.shared.authorizationStatus == .approved else {
            shieldStore.clearAllSettings(); return
        }
        var applications = Set<ApplicationToken>()
        var categories = Set<ActivityCategoryToken>()
        for rule in activeRules(try read()) {
            for target in rule.targets {
                let chosen = try selection(target.id)
                applications.formUnion(chosen.applicationTokens)
                categories.formUnion(chosen.categoryTokens)
            }
        }
        shieldStore.shield.applications = applications.isEmpty ? nil : applications
        shieldStore.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
    }
    func matchingRule(application: ApplicationToken?, category: ActivityCategoryToken?) -> BehaviorRule? {
        guard let state = try? read() else { return nil }
        for rule in activeRules(state) {
            for target in rule.targets {
                guard let chosen = try? selection(target.id) else { continue }
                if let app = application, chosen.applicationTokens.contains(app) { return rule }
                if let cat = category, chosen.categoryTokens.contains(cat) { return rule }
            }
        }
        return nil
    }
    func record(_ rule: BehaviorRule, target: String, action: String, reason: String) {
        // Shield configuration can be requested repeatedly. Deduplicate the same trigger within 5 seconds.
        _ = try? update { state in
            if let first = state.logs.first, first.ruleId == rule.id, first.action == action,
               first.targetLabel == target, BehaviorConstants.now - first.at < 5000 { return }
            state.logs.insert(BehaviorLog(at: BehaviorConstants.now, ruleId: rule.id, ruleName: rule.name,
                targetLabel: String(target.prefix(200)), action: action, reason: reason), at: 0)
        }
    }
}
