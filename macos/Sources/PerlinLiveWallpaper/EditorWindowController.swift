import AppKit
import WebKit

/// Hosts the bundled Perlin Studio in a `WKWebView`. A `WKUserScript` (injected
/// only here, feature-gated on the message handler) polls the studio's live
/// params and forwards changes to native code — so the wallpaper updates live
/// while you edit, and the web app's own source is never touched.
final class EditorWindowController: NSObject, WKUIDelegate {
    /// Called with the raw resolved-preset JSON whenever the editor's params change.
    var onParams: ((String) -> Void)?
    /// Called with `{image,invert}` or `{clear:true}` JSON when the mask changes.
    var onMask: ((String) -> Void)?

    private var window: NSWindow?
    private let handler = BridgeMessageHandler()

    func show() {
        if let window = window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        handler.onParams = { [weak self] json in self?.onParams?(json) }
        handler.onMask = { [weak self] json in self?.onMask?(json) }

        let contentController = WKUserContentController()
        contentController.add(handler, name: "perlinWallpaper")
        contentController.add(handler, name: "perlinMask")
        contentController.addUserScript(WKUserScript(
            source: EditorWindowController.bridgeSource,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = contentController

        let frame = NSRect(x: 0, y: 0, width: 1140, height: 800)
        let webView = WKWebView(frame: frame, configuration: config)
        webView.uiDelegate = self   // required for <input type=file> open panels
        if let indexURL = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "studio") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            FileHandle.standardError.write(Data("editor: studio/index.html missing from bundle\n".utf8))
        }

        let w = NSWindow(contentRect: frame,
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = "Perlin Studio — Editor"
        w.contentView = webView
        w.isReleasedWhenClosed = false
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window = w
    }

    // WKWebView needs this to honour <input type=file> (preset JSON import, mask
    // image picker). Without it the file dialog never appears.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // Injected only inside the app; inert in a normal browser (no such message
    // handler there). Polls every 250 ms and posts the resolved params on change.
    private static let bridgeSource = """
    (function () {
      var mh = window.webkit && window.webkit.messageHandlers;
      if (!(mh && mh.perlinWallpaper)) return;

      var last = "";
      function tick() {
        try {
          if (typeof gatherParams === "function" && window.MTPerlinPresets) {
            var resolved = window.MTPerlinPresets.resolveParams(gatherParams());
            var json = JSON.stringify(resolved);
            if (json !== last) { last = json; mh.perlinWallpaper.postMessage(json); }
          }
        } catch (e) {}
      }
      setInterval(tick, 250);

      // The image mask isn't part of gatherParams — read it from the studio's
      // `state` and forward it (rasterised) only when it changes. Start at null
      // (not "") so the first poll always reports the editor's actual mask state
      // — clearing any mask the wallpaper carried that the editor doesn't have.
      var lastMaskKey = null;
      function maskTick() {
        try {
          var st = (typeof state !== "undefined") ? state : null;
          var applied = !!(st && st.maskApplied && st.maskSourceImage);
          var img = applied ? st.maskSourceImage : null;
          var invert = applied ? !!st.maskInvert : false;
          // Key includes the source dimensions so a different image with the
          // same filename (the studio allows re-picking the same name) still
          // re-forwards.
          var key = applied ? ((st.maskName || "?") + "|" + img.width + "x" + img.height + "|" + invert) : "";
          if (key === lastMaskKey) return;
          lastMaskKey = key;
          if (!applied) { mh.perlinMask.postMessage(JSON.stringify({ clear: true })); return; }
          var s = Math.min(1, 2048 / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * s));
          var h = Math.max(1, Math.round(img.height * s));
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          mh.perlinMask.postMessage(JSON.stringify({ image: cv.toDataURL("image/png"), invert: invert }));
        } catch (e) {}
      }
      if (mh.perlinMask) setInterval(maskTick, 400);
    })();
    """
}

/// A leaf message handler — holds only callbacks, never a back-reference to the
/// controller, so the WKUserContentController's strong retain can't form a cycle.
private final class BridgeMessageHandler: NSObject, WKScriptMessageHandler {
    var onParams: ((String) -> Void)?
    var onMask: ((String) -> Void)?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let json = message.body as? String else { return }
        if message.name == "perlinMask" { onMask?(json) } else { onParams?(json) }
    }
}
