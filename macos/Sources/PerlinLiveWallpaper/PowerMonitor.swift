import Foundation
import IOKit.ps

/// Reports whether the machine should be saving power — on battery or in Low
/// Power Mode. Polls every 10s (latency is irrelevant for a wallpaper) and also
/// reacts immediately to Low-Power-Mode toggles.
final class PowerMonitor {
    /// Called with `true` when power-saving starts, `false` when it ends.
    var onChange: ((Bool) -> Void)?
    private(set) var savingPower = false
    private var timer: Timer?

    func start() {
        evaluate()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            self?.evaluate()
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(powerStateChanged),
            name: .NSProcessInfoPowerStateDidChange, object: nil)
    }

    deinit {
        timer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func powerStateChanged() { evaluate() }

    private func evaluate() {
        let saving = PowerMonitor.isOnBattery() || ProcessInfo.processInfo.isLowPowerModeEnabled
        guard saving != savingPower else { return }
        savingPower = saving
        onChange?(saving)
    }

    static func isOnBattery() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else {
            return false   // no battery (desktop Mac) → never "on battery"
        }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  let state = desc[kIOPSPowerSourceStateKey] as? String else { continue }
            if state == kIOPSBatteryPowerValue { return true }
        }
        return false
    }
}
