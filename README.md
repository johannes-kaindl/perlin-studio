# Perlin Studio

> Parametrische 3D/4D-Perlin-Animationen im Browser — Worker-beschleunigt,
> WebM-Export, nahtlos loopbar. Komplett clientseitig, keine Dependencies,
> kein Build-Step.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-8a4dff?style=flat-square)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none-39ff7a?style=flat-square)](#quickstart)
[![No dependencies](https://img.shields.io/badge/dependencies-0-16e0e0?style=flat-square)](#)
[![Runtime: Browser](https://img.shields.io/badge/runtime-browser-orange?style=flat-square)](#browser-kompatibilität)

<p align="center">
  <a href="https://jkaindl.codeberg.page/perlin-studio/">
    <img alt="Launch the web app" src="https://img.shields.io/badge/Launch_Web_App-16e0e0?style=for-the-badge&logo=pwa&logoColor=060709">
  </a>
</p>

<p align="center">
  <a href="https://jkaindl.codeberg.page/perlin-studio/">
    <img src="assets/hero.png" alt="Perlin Studio — Lava-Preset, 1200×630" width="100%">
  </a>
</p>

Aus zwei alten Hobbyprojekten (`_archiv/texturizer.ipynb` Anfang 2023 +
`_archiv/perlin_noise/` Mai 2023) zu einem fokussierten Browser-Tool
zusammengewachsen. Geeignet für statisches Hosting, Embedding auf der
Homepage und als Grundlage für ein Obsidian-Plugin.

---

## Quickstart

```bash
# Variante A — Doppelklick reicht
open index.html       # macOS
start index.html      # Windows
xdg-open index.html   # Linux

# Variante B — lokaler Server (für Hot-Reload während Entwicklung)
python3 -m http.server 8000
# → http://localhost:8000
```

Drücke **▶** oder **Leertaste**, klicke einen Preset-Chip, oder drehe an
den Reglern — die Live-Vorschau aktualisiert sich nach jedem Input.

## Was kann es?

- **Live-Vorschau** parametrischer Perlin-Animationen (fBm mit Oktaven,
  Persistence, Lacunarity, Seed)
- **Vier Farb-Modi**: RGB (pro Kanal), Gradient (8 Presets), HSV, Posterize
- **Nahtloser Loop** — 4D-Perlin mit Kreisbahn in `(z, w)`, mathematisch
  perfekt schließend, ohne „Atmen"-Effekt
- **WebM-Export** beliebiger Länge/Framerate via `MediaRecorder`
- **PNG-Snapshot** des aktuellen Frames
- **Preset-System** mit 6 Builtin-Presets und JSON-Import/Export
- **Worker-beschleunigt** — Main-Thread bleibt frei, Frame-Skip ohne Drift,
  Wall-Clock-Zeit als Animation-Basis

## Galerie

Alle vier Bilder sind mit dem Tool selbst gerendert, jeweils ein einzelnes
Frame aus dem 4D-Loop. Reproduzierbar via Seed (`base`) + Parameter.

<table>
  <tr>
    <td width="50%"><img src="assets/gallery-aurora.png" alt="Aurora — HSV-Modus mit Grün-Cyan-Blau-Spanne" width="100%"></td>
    <td width="50%"><img src="assets/gallery-ocean.png" alt="Ocean-Gradient — fließende Cyan-Wolken" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Aurora</b> · HSV-Modus, scaleY ≫ scaleX → horizontale Bänder</sub></td>
    <td align="center"><sub><b>Ocean</b> · Gradient, 6 Oktaven für weiche, organische Strömung</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/gallery-terrain.png" alt="Terrain — Posterize mit Forest-Gradient (Höhenlinien-Look)" width="100%"></td>
    <td width="50%"><img src="assets/gallery-circuit.png" alt="Circuit — Posterize 4-stufig mit Sunset-Gradient" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Terrain</b> · Posterize-Modus mit 7 Stufen → Höhenkarten-Look</sub></td>
    <td align="center"><sub><b>Circuit</b> · Posterize 4-stufig, hohe Lacunarity → harte Kanten</sub></td>
  </tr>
</table>

## Bedienung

Komplette Bedienungsanleitung mit allen Parametern erklärt:
**[docs/USAGE.md](docs/USAGE.md)**.

Kurzfassung der wichtigsten Bedienelemente:

| Element | Funktion |
|---------|----------|
| Linke Sidebar | Alle Parameter (Auflösung, Rauschen, Loop, Farbe, Presets, Export) |
| Großes Canvas | Live-Vorschau (immer aktuell zum Slider-/Input-Stand) |
| **▶ / Space** | Play/Pause |
| **⏮** | Slider zurück auf 0 |
| **t-Slider** | Zeit-Scrubbing (Loop: `[0, 1)`, sonst frei) |
| **fps / frames** | Wirken nur beim WebM-Export |

## Architektur in einem Bild

```
Main-Thread (UI)              Web Worker
┌─────────────────┐           ┌────────────────┐
│ RAF-Loop        │ params/t  │ makePermutation│
│ gatherParams()  │──────────▶│ fbm3/fbm4      │
│                 │           │ colorize()     │
│ putImageData    │ ImageData │                │
│ (zero-copy)     │◀──────────│ postMessage    │
│                 │           │  (transferable)│
└─────────────────┘           └────────────────┘
```

Vollständige technische Doku (Math, Pipeline, Edge-Cases):
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Browser-Kompatibilität

| Browser | Status |
|---------|--------|
| Chrome / Edge (Chromium) ≥ 90 | ✅ voll inkl. Worker + VP9-WebM |
| Firefox ≥ 90 | ✅ voll, WebM via VP8 |
| Safari ≥ 14 | ✅ Live-Vorschau; WebM-Export funktioniert, manche Versionen unter `file://` blockieren den Worker → Fallback auf Main-Thread |
| Mobile Safari / Chrome Mobile | ✅ Live-Vorschau; Export erfordert evtl. längere Touch-Geste |

Die App ist responsive und funktioniert auf Mobilgeräten — der Worker-Pfad
hält die Animation auch bei niedriger Auflösung flüssig.

## Projektstruktur

```
.
├── index.html             # UI-Markup
├── styles.css             # Theme (Dark + Light auto via prefers-color-scheme)
├── perlin.js              # Math/API (3D+4D-Noise, Farb-Modi, Worker-Source)
├── perlin-studio.js       # Controller (RAF-Loop, Recording, Presets, Events)
├── assets/                # leer (Platzhalter für künftige statische Assets)
├── docs/
│   ├── ARCHITECTURE.md    # technische Doku
│   └── USAGE.md           # ausführliche Bedienungsanleitung
├── _archiv/               # historische Vorgänger (READ-ONLY)
│   ├── perlin_noise/      # Python-Original
│   ├── texturizer.ipynb   # Texturizer-Notebook
│   └── old_texturizer_combined/   # erste Browser-Version inkl. Texturizer
├── LICENSE                # AGPL-3.0
├── CHANGELOG.md
├── CONTRIBUTING.md
└── AGENTS.md              # Kontext für KI-Assistenten
```

## Mitmachen

Issues und PRs willkommen. Quickstart für Entwickler:
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

Sicherheitsrelevante Probleme bitte nicht öffentlich melden — siehe
**[SECURITY.md](SECURITY.md)**.

Für KI-Assistenten (Claude Code etc.) liegt eine Orientierung in
**[AGENTS.md](AGENTS.md)**.

## Roadmap

- [ ] **Gradient-Editor** — eigene Color Stops definieren statt nur Presets
- [ ] **Tileable Noise** — `repeatx`/`repeaty`/`repeatz` wie in der
  Python-Library, für nahtlos kachelbare Texturen
- [ ] **GIF-Export** als Alternative zu WebM (`gif.js`, ~12 KB)
- [ ] **Obsidian-Plugin** — `main.ts` mit Modal + Canvas-Embed
- [ ] **Web-Component** — embed-bare `<perlin-studio>`-Variante für Homepage

## Lizenz

[GNU AGPL-3.0](LICENSE) — Copyleft mit Network-Use-Klausel. Wenn du das
Tool (oder einen Fork) öffentlich übers Netz anbietest, muss der Quellcode
deiner Variante ebenfalls unter AGPL verfügbar sein.

Die Perlin-Permutationstabelle und die „Improved Noise"-Algorithmik stammen
aus Ken Perlins frei publizierter Java-Referenz (2002), die hier in JS
nachimplementiert ist.
