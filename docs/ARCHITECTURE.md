# Architektur

Tiefergehende technische Dokumentation. Lies zuerst die
[README](../README.md) für den groben Überblick.

## Inhalt

1. [Code-Layout](#code-layout)
2. [Math: Perlin-Noise in 3D und 4D](#math-perlin-noise-in-3d-und-4d)
3. [fBm — Fractal Brownian Motion](#fbm--fractal-brownian-motion)
4. [Loop-Mechanik: Kreisbahn in 4D](#loop-mechanik-kreisbahn-in-4d)
5. [Worker-Pipeline](#worker-pipeline)
6. [Animation-Loop](#animation-loop)
7. [WebM-Recording](#webm-recording)
8. [Farb-Modi](#farb-modi)
9. [Bekannte Edge-Cases](#bekannte-edge-cases)

---

## Code-Layout

Zwei JS-Dateien teilen sich die Verantwortung:

```
perlin.js                    perlin-studio.js
├── Math (perlin3, perlin4)  ├── DOM-Bindings
├── fBm (fbm3, fbm4)         ├── Worker-Setup + Fallback
├── colorize()               ├── RAF-Loop (Play/Pause)
├── generatePerlinImage()    ├── Recording (MediaRecorder)
└── WORKER_SOURCE (String)   └── Preset-System (Builtin + JSON)
```

`perlin.js` ist **reine Funktion** — keine Globals, keine DOM-Zugriffe.
Eine IIFE exportiert nach `window.MTPerlin`. Die gesamte Modul-Logik ist
zusätzlich als String unter `MTPerlin.WORKER_SOURCE` verfügbar; daraus
wird im Studio ein Blob-Worker gebaut. Das ist wichtig, damit der Worker
auch unter `file://` läuft (manche Browser blockieren externe Worker-URLs).

`perlin-studio.js` ist der **Controller** — er liest UI-Zustand, schickt
Frames an den Worker, zeichnet die Antworten auf das Canvas, treibt die
Animation und exportiert WebM.

---

## Math: Perlin-Noise in 3D und 4D

### Improved Noise (Ken Perlin, 2002)

Die Standard-Variante mit:
- Permutationstabelle der Größe 256, verdoppelt auf 512 für Lookup ohne
  Modulo
- `fade(t) = 6t⁵ − 15t⁴ + 10t³` — erzwingt C²-Stetigkeit
- Gradient-Funktion mit 12 (3D) bzw. 32 (4D) Standard-Vektoren

### Werte-Eigenschaften

- **An Gitterpunkten** (ganze Koordinaten) → exakt 0. Das ist kein Bug,
  sondern Definition: am Eckpunkt verschwindet der Beitrag aller
  Gradienten.
- **Wertebereich** ca. `[-0.88, 0.88]` für `perlin3`, `[-1.08, 1.08]` für
  `perlin4` (4D-Gradienten sind länger im Mittel).
- **Stetigkeit**: C² überall, dank `fade`-Polynom.

### Permutation-Seeding

`makePermutation(base)` verschiebt die fixe Standard-Permutation um
`base mod 256`:

```js
for (let i = 0; i < 256; i++) perm[i] = BASE_PERM[(i + offset) & 255];
```

Damit ist jeder ganzzahlige Seed reproduzierbar und gibt visuell
unterschiedliche Muster. **Nicht** kryptografisch zufällig.

### 4D-Hash-Konvention

Im 4D-Code haben die 16 Hyperwürfel-Eckpunkte konsistente Namen:

```
AAAA = (X,   Y,   Z,   W  ) → perm[AAA]      mit offset (x,   y,   z,   w  )
AAAB = (X,   Y,   Z,   W+1) → perm[AAA + 1]  mit offset (x,   y,   z,   w-1)
AABA = (X,   Y,   Z+1, W  ) → perm[AAB]      mit offset (x,   y,   z-1, w  )
AABB = (X,   Y,   Z+1, W+1) → perm[AAB + 1]  mit offset (x,   y,   z-1, w-1)
...
```

Wichtig: `AAB = perm[AA+1]+W` ist ein **Z-Shift**, während `AAA+1` ein
**W-Shift** ist. Die Offsets bei `grad4(...)` müssen entsprechend passen
— sonst entsteht eine Diskontinuität bei `w ≈ 0` (Sign-Flip in
`Math.floor`).

Die Lerp-Reihenfolge von innen nach außen ist `u (X) → v (Y) → s (Z) →
tt (W)`. Die äußerste Lerp ist über die W-Achse, die mittlere über Z.

---

## fBm — Fractal Brownian Motion

```
fBm(x, y, z) = Σ amp_i · perlin3(x · freq_i, y · freq_i, z · freq_i)
                normalisiert durch Σ amp_i
                und gemappt auf [0, 1]

mit  amp_i  = persistence^i
     freq_i = lacunarity^i
     i = 0 .. octaves-1
```

- **`octaves`** — Anzahl Frequenz-Stufen. Mehr = mehr Detail, mehr
  Rechenzeit (linear).
- **`persistence`** — Amplitudenfaktor pro Oktave. Klein (0.3) ⇒ glatte
  Wolken; groß (0.7) ⇒ raues Terrain.
- **`lacunarity`** — Frequenzfaktor pro Oktave. Klein (1.5) ⇒
  selbstähnliche Strukturen; groß (3.0) ⇒ stark variierte Detailebenen.

Normalisierung auf `[0, 1]` macht die nachfolgende Farb-Berechnung
einfacher: `colorize(n)` nimmt immer Werte in diesem Bereich.

---

## Loop-Mechanik: Kreisbahn in 4D

Linearer `t`-Fortschritt ist nicht loopbar — am Ende der Animation springt
das Bild zurück. Klassischer Trick: **Zwei zusätzliche Koordinaten
durchlaufen einen Kreis im Noise-Space**.

```
α = loopProgress · 2π
z = cos(α) · loopRadius · scaleT
w = sin(α) · loopRadius · scaleT
output = fbm4(perm, x·scaleX, y·scaleY, z, w, octaves, ...)
```

Bei `loopProgress = 0` ist `(z, w) = (loopRadius·scaleT, 0)`.
Bei `loopProgress = 1` ist `α = 2π` und `(cos, sin) = (1, 0)` — exakt der
Startwert. → mathematisch nahtlos.

### Float-Sicherung: `safeProgress`

`Math.sin(2 * Math.PI)` ist nicht exakt `0`, sondern ca. `-2.4·10⁻¹⁶`.
`Math.floor(-1.7·10⁻¹⁶)` ist `-1`, was nach `& 255` als `255` indexiert —
ein völlig anderer Hash, also ein **komplett anderes Bild** an genau dem
einen Loop-Endpunkt.

Lösung:
```js
const safeProgress = ((p % 1) + 1) % 1;
```

→ `progress = 1` und `progress = 0` produzieren `α = 0` (exakt), nicht
`α = 2π` (mit Rundungsfehler). In der Praxis rendert die App ohnehin nie
Frame `progress = 1` (der RAF-Loop wrappt mit `% 1` vorher), aber der
manuelle Slider und Test-Code könnten den Edge-Case treffen.

### `loopRadius` und Detail-Frequenzen

Der Kreis hat im höchsten fBm-Octave Radius `loopRadius · scaleT ·
lacunarity^(octaves-1)`. Mit Default `loopRadius=1`, `scaleT=0.15`,
`octaves=6`, `lacunarity=2` ist das `1 · 0.15 · 32 = 4.8` — der Kreis
durchläuft 4.8 Perlin-Zellen im höchsten Detail.

Pro Frame ist der Schritt entsprechend klein: `(2π/totalFrames) ·
loopRadius · scaleT` im Basis-Octave, multipliziert mit der
Detail-Frequenz im höchsten Octave. Bei 120 Frames pro Loop ≈ 0.005 pro
Frame im Basis-Octave — sanftes Wabern.

---

## Worker-Pipeline

### Aufbau

```
Main-Thread                     Web Worker (Inline-Blob)
┌─────────────────────┐         ┌─────────────────────┐
│ initWorker()        │ blob:// │ const BASE_PERM=... │
│   new Worker(blob)  │────────▶│ const GRAD4=...     │
│                     │         │ (Funktionen aus     │
│                     │         │  perlin.js via      │
│                     │         │  .toString())       │
│                     │         │                     │
│ requestFrame(p)     │ params  │ self.onmessage      │
│   workerBusy=true   │────────▶│   perm = ...        │
│   postMessage({id,p})│         │   for x, y:         │
│                     │         │     fbm3/fbm4       │
│                     │         │     colorize        │
│                     │         │   buf = Uint8...    │
│ onWorkerMessage     │ buffer  │   postMessage(      │
│   ImageData(...)    │◀────────│     {id, buffer},   │
│   putImageData      │ transfer│     [buffer])       │
│   workerBusy=false  │         │                     │
└─────────────────────┘         └─────────────────────┘
```

### Idle-Tracking

```js
function requestFrame(params) {
  if (state.workerBusy) return;   // skip, kein Stau
  state.workerBusy = true;
  state.latestJobId = ++state.workerJobId;
  worker.postMessage({ id: state.workerJobId, params });
}
```

Während der Worker rechnet, werden weitere `requestFrame`-Aufrufe
verworfen. Das verhindert Latenz-Aufbau, wenn die Berechnung langsamer
ist als die Display-Refresh-Rate.

### Veraltete Antworten ignorieren

```js
function onWorkerMessage(e) {
  if (e.data.id < state.latestJobId) return;
  // ...
}
```

Wenn der User schneller die Parameter ändert als der Worker rechnet,
treffen alte Frame-Antworten ein, nachdem schon ein neuer Job angefordert
wurde. Diese werden verworfen, um Flackern zu vermeiden.

### Transferable für zero-copy

```js
self.postMessage({ id, width, height, buffer: buf.buffer }, [buf.buffer]);
```

Der zweite Parameter ist die **Transferable-Liste**: der `ArrayBuffer`
wird *übertragen* statt kopiert. Der Worker verliert die Eigentümerschaft
am Buffer, der Main-Thread bekommt sie sofort. Das spart bei 256×256
ca. 256 KB pro Frame an Kopier-Aufwand.

### Main-Thread-Fallback

`initWorker()` umschließt die Worker-Erzeugung in `try/catch`. Schlägt sie
fehl (manche Safari-Versionen unter `file://`), bleibt `state.worker =
null` und `requestFrame` ruft synchron `renderInMain(params)` auf — das
nutzt `generatePerlinImage` direkt aus `perlin.js`.

Erkennbar: FPS-Counter zeigt `... fps (main)`.

---

## Animation-Loop

### Wall-Clock-Zeit als Basis

Statt mit `frameIndex` zu rechnen, koppelt die Animation an
`performance.now()`:

```js
function rafTick(now) {
  const elapsedSec = (now - animStartTime) / 1000;
  if (params.loop) {
    params.loopProgress = (animStartSlider + elapsedSec / loopDuration) % 1;
  } else {
    params.t = animStartSlider + elapsedSec;
  }
  requestFrame(params);
  state.rafHandle = requestAnimationFrame(rafTick);
}
```

Egal ob der Browser 60 fps oder nur 15 fps rendert — die Animation läuft
genauso schnell „weiter". Bei niedriger Framerate gibt es größere
Sprünge zwischen den Frames, aber die Geschwindigkeit ist konsistent.

### Slider-Modus-Switch

Der `t`-Slider hat zwei Modi:
- **Loop-an**: Range `[0, 1]` step `0.001` — zeigt den `loopProgress`
- **Loop-aus**: Range `[-200, 2000]` step `0.01` — zeigt die freie
  Zeitkoordinate

`updateLoopMode()` schaltet zwischen den Modi um, passt min/max/step und
das Label an.

### Live-Vorschau (ohne Play)

`schedulePreview()` wird bei jedem Parameter-Input aufgerufen und
debounced (`setTimeout` 20 ms). Im Play-Modus ist `schedulePreview` ein
No-Op — die RAF-Loop rendert sowieso.

---

## WebM-Recording

### Pipeline

```
1. recordWebm():
   - pause() falls Live-Animation läuft
   - canvas.captureStream(0) — manueller Modus, wenn `track.requestFrame` da
     sonst captureStream(fps) — Browser tickt selbst
   - MediaRecorder mit VP9 (Fallback VP8)

2. Pro Frame i in [0, totalFrames):
   - params = paramsForRecordingFrame(...)
   - await renderFrameAndWait(params) — synchron auf Worker warten
   - track.requestFrame() — Frame in den Stream pushen
   - setTimeout(frameDelayMs) — Browser-Repaint sicherstellen

3. recorder.stop() + await onstop:
   - chunks → Blob → <video>.src = URL.createObjectURL(blob)
   - btnWebmDownload aktivieren
```

### Loop-an: exakt N Frames pro Loop

```js
params.loopProgress = (startSlider + i / totalFrames) % 1;
```

Frame `i = 0` hat `progress = startSlider`. Frame `i = totalFrames - 1`
hat `progress = startSlider + (N-1)/N`. Frame `N` würde `progress =
startSlider` wieder ergeben — und wird nicht gerendert, weil der Player
zurück zum ersten Frame springt.

→ Die exportierte WebM ist exakt ein Loop, sauber schließend.

### Loop-aus: konsistent mit Live

```js
params.t = startSlider + i / fps;
```

Live-Animation läuft mit `t += elapsedSec`. Bei `fps = 30` ist 1 Frame
= 1/30 Sekunde = `t += 1/30`. Damit ist die Recording-Geschwindigkeit
exakt gleich der Live-Geschwindigkeit.

### Codec-Auswahl

`chooseRecorderMime()` probiert in dieser Reihenfolge:
1. `video/webm;codecs=vp9` — beste Qualität, in Chrome/Edge sicher
2. `video/webm;codecs=vp8` — Firefox-kompatibel
3. `video/webm` — Browser-Default

Wenn keine Variante unterstützt wird, bricht die Aufnahme mit Fehler ab.

---

## Farb-Modi

`colorize(n, params)` mappt einen Noise-Wert `n ∈ [0, 1]` auf RGB. Vier
Varianten:

### `rgb` — Pro Kanal

```
r = (rInvert ? 1-n : n) · rScale  · 255
g = (gInvert ? 1-n : n) · gScale  · 255
b = (bInvert ? 1-n : n) · bScale  · 255
```

Drei Slider pro Kanal, drei Invert-Toggles. Identisch zur Python-Original-
Implementation.

### `gradient` — Color Stops

`gradientLookup(stops, n)` interpoliert linear in einer Liste von Stops:
```js
[{ pos: 0.0, color: [68, 1, 84] },
 { pos: 0.5, color: [33, 145, 140] },
 { pos: 1.0, color: [253, 231, 37] }]
```

Acht vordefinierte Maps: `viridis`, `magma`, `fire`, `ocean`, `forest`,
`grayscale`, `sunset`, `ice`.

### `hsv` — Hue aus Noise

```
hue = (hsvHueShift + n · hsvHueRange) % 1
output = hsvToRgb(hue, hsvSat, hsvVal)
```

Saturation und Value sind konstant, nur der Hue variiert. Gut für
Aurora-, Plasma- und Spektral-Effekte.

### `posterize` — N Stufen + Gradient

```
quantized = floor(n · steps) / (steps - 1)
output = gradientLookup(palette, quantized)
```

Reduziert den Noise auf wenige diskrete Stufen, ergibt cartoon-artige
Effekte. Gut für Terrain-Höhenkarten und Stilisierung.

---

## Bekannte Edge-Cases

### Worker-Auflösungswechsel

Bei Auflösungs-Änderungen (Width/Height geändert) kann ein Worker-Frame
in alter Auflösung zurückkommen, nachdem das Canvas schon resized wurde.
`onWorkerMessage` setzt `canvas.width = width` und
`canvas.height = height`, bevor `putImageData` aufgerufen wird — kein
Crash, kein verzerrtes Bild.

### Browser ohne `requestFrame`

`captureStream(0)` braucht `track.requestFrame()`. Wenn nicht verfügbar,
fällt der Code auf `captureStream(fps)` zurück — der Browser entscheidet
selbst, wann er ein Frame capturet. Mit `await
setTimeout(frameDelayMs)` zwischen Frames bekommt der Browser genug Zeit,
das aktuelle Canvas-Bild zu sehen.

### `preset.gradient` darf nicht serialisiert werden

`savePreset()` löscht `gradient` vor dem JSON-Dump — die Stop-Liste ist
groß und kann aus `gradientName` rekonstruiert werden.

### Slider bei `loop = false`

Maximum `2000` reicht für ~33 Minuten Animation (bei 1 t-Einheit pro
Sekunde). Danach ist der Slider am Anschlag, die Animation läuft aber
intern weiter.
