import SwiftUI

/// Edits the working preset's gradient stops: a row per stop with a colour well
/// and a position slider, plus add/remove. Writing any stop updates
/// `model.preset.gradient`, which the live preview + export consume.
struct GradientEditor: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        let stops = model.preset.gradient ?? []
        ForEach(stops.indices, id: \.self) { i in
            HStack {
                ColorPicker("", selection: colorBinding(i), supportsOpacity: false).labelsHidden()
                Slider(value: posBinding(i), in: 0...1)
                if stops.count > 2 {
                    Button(role: .destructive) { remove(i) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                }
            }
        }
        Button { add() } label: { Label("Add stop", systemImage: "plus") }
    }

    private func colorBinding(_ i: Int) -> Binding<Color> {
        Binding(get: {
            let c = model.preset.gradient?[i].color ?? [255, 255, 255]
            return Color(red: Double(c[0]) / 255, green: Double(c[1]) / 255, blue: Double(c[2]) / 255)
        }, set: { newColor in
            model.preset.gradient?[i].color = Self.rgb255(newColor)
        })
    }
    private func posBinding(_ i: Int) -> Binding<Double> {
        Binding(get: { model.preset.gradient?[i].pos ?? 0 },
                set: { model.preset.gradient?[i].pos = $0 })
    }
    private func add() {
        var g = model.preset.gradient ?? []
        g.append(GradientStop(pos: 1.0, color: [255, 255, 255]))
        model.preset.gradient = g.sorted { $0.pos < $1.pos }
    }
    private func remove(_ i: Int) {
        guard var g = model.preset.gradient, g.indices.contains(i) else { return }
        g.remove(at: i); model.preset.gradient = g
    }
    /// SwiftUI Color → [r,g,b] in 0...255 via its resolved sRGB components.
    private static func rgb255(_ color: Color) -> [Int] {
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        _ = ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return [Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded())]
    }
}
