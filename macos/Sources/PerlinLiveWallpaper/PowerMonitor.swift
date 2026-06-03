import Foundation
import IOKit.ps

/// Reports the power source — running on battery vs. plugged into AC. Drives the
/// wallpaper's power policy: full rate on AC, paused (or reduced) on battery.
/// Polls every few seconds; plug/unplug latency of a few seconds is irrelevant
/// for a wallpaper, and polling avoids the IOPS C-callback dance.
final class PowerMonitor {
    /// Called with `true` when the Mac goes onto battery, `false` when back on AC.
    var onChange: ((Bool) -> Void)?
    private(set) var onBattery = false
    private var timer: Timer?

    func start() {
        onBattery = PowerMonitor.isOnBattery()
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in self?.evaluate() }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    deinit { timer?.invalidate() }

    private func evaluate() {
        let battery = PowerMonitor.isOnBattery()
        guard battery != onBattery else { return }
        onBattery = battery
        onChange?(battery)
    }

    /// True when running on battery. A desktop Mac (no battery source) → false.
    static func isOnBattery() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else {
            return false
        }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  let state = desc[kIOPSPowerSourceStateKey] as? String else { continue }
            if state == kIOPSBatteryPowerValue { return true }
        }
        return false
    }
}
