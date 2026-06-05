import SwiftUI

struct ContentView: View {
    @StateObject private var model = EditorModel()
    var body: some View {
        MetalPreviewView(model: model).ignoresSafeArea()
    }
}
