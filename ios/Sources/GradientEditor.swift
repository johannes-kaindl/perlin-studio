import SwiftUI

/// Edits the working preset's gradient stops: a row per stop with a colour well
/// and a position slider, plus add/remove. Writing any stop updates
/// `model.preset.gradient`, which the live preview + export consume.
struct GradientEditor: View {
    @ObservedObject var model: EditorModel
    @State private var paletteText = ""

    var body: some View {
        let stops = model.preset.gradient ?? []
        ForEach(stops.indices, id: \.self) { i in
            HStack {
                ColorPicker("", selection: colorBinding(i), supportsOpacity: false).labelsHidden()
                HexField(color: stops[i].color) { setColor(i, $0) }
                Slider(value: posBinding(i), in: 0...1) { editing in
                    // Re-sort on release (not per tick) so the gradient lookup
                    // gets a monotonic list and rows reorder if positions
                    // crossed — the web editor's behaviour.
                    if !editing { model.preset.gradient?.sort { $0.pos < $1.pos } }
                }
                if stops.count > 2 {
                    Button(role: .destructive) { remove(i) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                }
            }
        }
        Button { add() } label: { Label("Add stop", systemImage: "plus") }
        HStack {
            TextField("Paste palette (hex list)", text: $paletteText)
                .font(.system(.caption, design: .monospaced)).autocorrectionDisabled().textInputAutocapitalization(.never)
            Button("Apply") { applyPalette() }.disabled(Hex.parseList(paletteText).count < 2)
        }
    }

    /// Pasted hex list → evenly-spread gradient (≥2, capped at 16).
    private func applyPalette() {
        let colors = Array(Hex.parseList(paletteText).prefix(16))
        guard colors.count >= 2 else { return }
        let n = colors.count
        model.preset.gradient = colors.enumerated().map { idx, c in
            GradientStop(pos: Double(idx) / Double(n - 1), color: c)
        }
        paletteText = ""
    }

    // The bindings guard the live array, not the body's copy: SwiftUI can still
    // read/write a row's bindings after remove()/applyPalette() shrank the stops.
    private func colorBinding(_ i: Int) -> Binding<Color> {
        Binding(get: {
            guard let g = model.preset.gradient, g.indices.contains(i) else { return .white }
            let c = g[i].color
            return Color(red: Double(c[0]) / 255, green: Double(c[1]) / 255, blue: Double(c[2]) / 255)
        }, set: { newColor in
            setColor(i, Self.rgb255(newColor))
        })
    }
    private func posBinding(_ i: Int) -> Binding<Double> {
        Binding(get: {
            guard let g = model.preset.gradient, g.indices.contains(i) else { return 0 }
            return g[i].pos
        }, set: {
            guard model.preset.gradient?.indices.contains(i) == true else { return }
            model.preset.gradient?[i].pos = $0
        })
    }
    private func setColor(_ i: Int, _ rgb: [Int]) {
        guard model.preset.gradient?.indices.contains(i) == true else { return }
        model.preset.gradient?[i].color = rgb
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
    /// getRed returns *extended* sRGB, so wide-gamut (P3) picks can fall outside
    /// 0...1 — clamp, or the hex formatter and the shader get garbage.
    private static func rgb255(_ color: Color) -> [Int] {
        let ui = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        _ = ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        func channel(_ v: CGFloat) -> Int { Int(min(255, max(0, (v * 255).rounded()))) }
        return [channel(r), channel(g), channel(b)]
    }
}

/// Hex text field for one stop. Owns its text while focused so the model's
/// canonical "#rrggbb" echo never interrupts typing (a computed binding would
/// hijack 6-digit entry as soon as the first 3 digits parse as shorthand).
/// Valid input commits live; blur re-syncs to the canonical form — the web
/// editor's input/blur split.
private struct HexField: View {
    let color: [Int]
    let onColor: ([Int]) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("#rrggbb", text: $text)
            .font(.system(.caption, design: .monospaced))
            .autocorrectionDisabled().textInputAutocapitalization(.never)
            .frame(width: 90)
            .focused($focused)
            .onAppear { text = Hex.string(color) }
            .onChange(of: color) { if !focused { text = Hex.string(color) } }
            .onChange(of: text) { if focused, let rgb = Hex.parse(text) { onColor(rgb) } }
            .onChange(of: focused) { if !focused { text = Hex.string(color) } }
    }
}
