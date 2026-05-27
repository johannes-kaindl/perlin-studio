# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
- README-Showcase: Hero-Bild (Lava-Preset) + Galerie mit 4 Beispielen
  (Aurora, Ocean, Terrain, Circuit) — alle mit dem Tool selbst gerendert.
- `scripts/render-readme-images.js` — pur Node (zlib + crc32) PNG-Encoder,
  nutzt das echte `perlin.js`-Modul. Reproduzierbar via dokumentierten
  Parameter-Sets im Script.
- `og:image` und `twitter:image` Meta-Tags zeigen jetzt auf `hero.png` →
  Link-Preview-Karten zeigen das Hero-Bild.

## [0.4.0] — 2026-05-27

### Hinzugefügt
- Open-Source-Veröffentlichung auf Codeberg:
  <https://codeberg.org/jkaindl/perlin-studio>, live unter
  <https://jkaindl.codeberg.page/perlin-studio/>.
- Open-Source-Basisdateien: `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`,
  `AGENTS.md`, `CHANGELOG.md`, `.gitignore`.
- `docs/ARCHITECTURE.md` und `docs/USAGE.md` mit detaillierter technischer
  und bedienungsorientierter Dokumentation.
- JSDoc-Blöcke an den öffentlichen API-Funktionen in `perlin.js` und
  `perlin-studio.js`.
- `.forgejo/workflows/deploy.yml` — Forgejo-Actions-Workflow, der jeden
  Push auf `main` automatisch auf den `pages`-Branch mirrort.
- `assets/favicon.svg` — SVG-Favicon in den Akzentfarben (Cyan/Violett/Grün).
- `<head>`-Meta-Tags in `index.html`: `description`, Open-Graph,
  Twitter-Card, `canonical`, `theme-color` — für Link-Preview-Karten
  bei Social-Sharing.

### Geändert
- Lizenz von MIT auf **GNU AGPL-3.0** umgestellt — Konsistenz mit anderen
  Repos des Autors; Network-Use-Copyleft passt zum web-deployten Tool.
- README/AGENTS/CONTRIBUTING entsprechend der neuen Lizenz angepasst,
  Codeberg-Launch-Badge hinzugefügt.

## [0.3.0] — 2026-05-20

### Hinzugefügt
- 4D-Perlin-Noise (`perlin4`, `fbm4`) für nahtlosen Loop via Kreisbahn in
  `(z, w)`.
- Toggle **Nahtloser Loop** (Default an) mit konfigurierbarer Dauer und Radius.
- Korrekte Animationsgeschwindigkeit: `t` läuft mit 1 Einheit pro Sekunde
  statt vorher `fps` Einheiten pro Sekunde — sanftes Wabern statt Flackern.

### Geändert
- UI-Label `scale t` → **Wabern-Geschwindigkeit**, Default `0.5` → `0.15`.
- Alle 6 Builtin-Presets nutzen jetzt Loop-Mode mit angepasstem `scaleT`.

## [0.2.0] — 2026-05-20

### Hinzugefügt
- Web Worker (inline via Blob-URL) für die Perlin-Berechnung — Main-Thread
  bleibt frei für UI.
- Vier Farb-Modi: **RGB** (pro Kanal), **Gradient** (8 Presets), **HSV**,
  **Posterize**.
- Preset-System: 6 Builtin-Chips + Speichern/Laden als JSON.
- WebM-Export via `MediaRecorder` + `canvas.captureStream`.
- Play/Pause-Steuerung (Button + Leertaste) mit Wall-Clock-Zeit für
  framerate-unabhängige Animation.

### Geändert
- Reduziert auf reines Perlin Studio; der Texturizer-Modus liegt als
  Snapshot in `_archiv/old_texturizer_combined/`.

## [0.1.0] — 2026-05-20

### Hinzugefügt
- Erste Browser-Version mit Texturizer (Bild → Minecraft-Block-Mosaik)
  und Perlin-Vorschau.
- Default-Texture-Atlas als base64-Fallback ins JS eingebettet.
- Drag-and-Drop für Eingangsbild und Atlas.

## Quellen

Das Projekt ist aus zwei älteren Hobbyprojekten gewachsen, die im
`_archiv/`-Verzeichnis als Referenz erhalten bleiben:
- `_archiv/texturizer.ipynb` (Januar 2023) — Atlas-Tile-Analyse als Jupyter
- `_archiv/perlin_noise/` (Mai 2023, Updates 2024) — Python +
  `noise`-Library + matplotlib für GIF-Export
