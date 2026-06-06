import Foundation

/// Hex colour parsing, ported from the web studio. Colours are [r,g,b] 0...255.
enum Hex {
    /// "#rrggbb" / "rrggbb" / "#rgb" / "rgb" → [r,g,b], or nil if invalid.
    static func parse(_ str: String) -> [Int]? {
        var s = str.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3, s.allSatisfy(\.isHexDigit) { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, s.allSatisfy(\.isHexDigit),
              let r = Int(s.prefix(2), radix: 16),
              let g = Int(s.dropFirst(2).prefix(2), radix: 16),
              let b = Int(s.dropFirst(4), radix: 16) else { return nil }
        return [r, g, b]
    }
    /// [r,g,b] → "#rrggbb".
    static func string(_ rgb: [Int]) -> String {
        let c = rgb.count >= 3 ? rgb : [0, 0, 0]
        return String(format: "#%02x%02x%02x", c[0], c[1], c[2])
    }
    /// Scan free text for hex tokens (palette paste); ignores non-hex.
    static func parseList(_ str: String) -> [[Int]] {
        var out: [[Int]] = []
        let pattern = "#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return out }
        let ns = str as NSString
        for m in re.matches(in: str, range: NSRange(location: 0, length: ns.length)) {
            if let rgb = parse(ns.substring(with: m.range(at: 1))) { out.append(rgb) }
        }
        return out
    }
}
