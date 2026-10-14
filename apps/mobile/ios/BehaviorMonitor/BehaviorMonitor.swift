import DeviceActivity
import Foundation

final class BehaviorMonitor: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        try? BehaviorStore.shared.applyShields()
    }
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Deadline is read from shared persistent state, never from process memory.
        // Apple invokes this callback when the device is being used after the interval ends.
        try? BehaviorStore.shared.applyShields()
    }
}
