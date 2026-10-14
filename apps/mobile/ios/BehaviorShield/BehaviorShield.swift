import ManagedSettings
import ManagedSettingsUI
import UIKit

final class BehaviorShield: ShieldConfigurationDataSource {
    private func make(_ rule: BehaviorRule?, target: String) -> ShieldConfiguration {
        if let rule = rule { BehaviorStore.shared.record(rule, target: target, action: "block", reason: "系统屏蔽已显示") }
        return ShieldConfiguration(backgroundBlurStyle: .systemThinMaterial,
            backgroundColor: UIColor(red: 0.96, green: 0.97, blue: 0.95, alpha: 1),
            icon: UIImage(systemName: "leaf.fill"),
            title: .init(text: rule?.name ?? "行为规则正在生效", color: .label),
            subtitle: .init(text: rule?.message ?? "先把注意力留给想做的事。可以回到行为规则App暂时放行。", color: .secondaryLabel),
            primaryButtonLabel: .init(text: rule?.buttonText ?? "关闭此应用", color: .white),
            primaryButtonBackgroundColor: UIColor(red: 0.09, green: 0.43, blue: 0.38, alpha: 1),
            secondaryButtonLabel: nil)
    }
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        make(BehaviorStore.shared.matchingRule(application: application.token, category: nil), target: application.localizedDisplayName ?? "所选应用")
    }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        make(BehaviorStore.shared.matchingRule(application: application.token, category: category.token), target: application.localizedDisplayName ?? "所选应用分类")
    }
}
