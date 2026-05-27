# AGENTS.md — Kontext für KI-Agents

Diese Datei richtet sich an KI-Assistenten (Claude Code, Cursor, Aider, …),
die an diesem Repo arbeiten. Wer als Mensch beiträgt, findet relevante
Informationen in [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md)
und [`docs/`](docs/).

## TL;DR

**Perlin Studio** ist ein single-page Browser-Tool für parametrische 3D/4D-
Perlin-Animationen. Vanilla JS, keine Dependencies, kein Backend, kein
Build-Step. Funktioniert per Doppelklick auf `index.html` (`file://`) und
auf jedem statischen Webhoster.

## Wichtige Konventionen

### Sprache
- **Code-Kommentare und User-facing Strings: Deutsch**, ebenso die
  Commit-Messages und PR-Beschreibungen.
- Code-Bezeichner bleiben **Englisch** (`fbm3`, `loopProgress`, `colorize`).
- Mathematische Begriffe (Octaves, Persistence, Lacunarity, fBm) bleiben in
  ihrer Standardform.
- Ä/Ö/Ü/ß werden korrekt geschrieben — nie `ae`/`oe`/`ue`/`ss`.

### Stil
- **Keine Dependencies** dazunehmen ohne expliziten Anlass.
  Begründung: das Tool soll statisch deploybar und als Web-Component
  embeddbar bleiben. Eine 12-KB-Library für ein Feature ist ok, aber
  bitte vorab mit dem Maintainer diskutieren.
- **Keine Tooling-Migration** (TypeScript, Bundler, Framework) ohne Diskussion.
  Vanilla-JS-Konstanz ist ein Feature.
- Defensive Programmierung **nicht** an internen Boundaries — nur an
  externen (User-Input, File-Upload). Trust internal data flow.
- Kommentare erklären das **Warum**, nicht das *Was*. Code muss ohne
  Kommentare lesbar sein; Kommentare adressieren Non-Obvious, Edge-Cases,
  Math-Hintergrund.
- Keine Emojis in Code/Doku, außer der User fragt explizit danach.

### Datei-Layout
```
.
├── index.html             # UI-Markup
├── styles.css             # gesamtes Styling (Dark + Light auto)
├── perlin.js              # math/api (Noise, Color-Modi, Worker-Source)
├── perlin-studio.js       # Controller (RAF-Loop, Recording, Presets, UI-Bindings)
├── assets/                # statische Assets (favicon.svg, hero.png,
│                          #   gallery-*.png + legacy default-atlas.webp
│                          #   fürs Archiv)
├── scripts/
│   └── render-readme-images.js  # rendert assets/*.png aus perlin.js
├── _archiv/               # historische Vorgänger (READ-ONLY!)
│   ├── perlin_noise/      # Python-Original
│   ├── texturizer.ipynb   # Texturizer-Notebook
│   └── old_texturizer_combined/   # erste Browser-Version
├── docs/
│   ├── ARCHITECTURE.md    # technische Doku
│   └── USAGE.md           # ausführliche Bedienungsanleitung
├── .editorconfig          # konsistente Indentation/Encoding/EOL
├── .forgejo/
│   └── workflows/         # Codeberg Pages Auto-Deploy
├── .gitea/
│   └── issue_template/    # Bug-Report + Feature-Request Forms
├── README.md              # Einstieg + Quickstart
├── CONTRIBUTING.md        # Entwickler-Workflow
├── SECURITY.md            # Threat-Model + Meldewege
├── CHANGELOG.md
├── LICENSE                # AGPL-3.0
└── AGENTS.md              # diese Datei
```

**`_archiv/` ist tabu für aktive Änderungen.** Diese Dateien dokumentieren
die Projekt-Genese und dürfen nur ergänzt werden (z. B. wenn weiterer
Snapshot dazukommt), nicht editiert oder gelöscht.

## Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **fBm** | Fractal Brownian Motion — Summe von Perlin-Oktaven mit fallender Amplitude und steigender Frequenz |
| **Oktave** | Eine Frequenz-Stufe in fBm. Mehr Oktaven = mehr Detail, mehr Rechenzeit |
| **Persistence** | Amplitudenfaktor zwischen Oktaven (typisch 0.5) |
| **Lacunarity** | Frequenzfaktor zwischen Oktaven (typisch 2.0) |
| **scaleT** | Im UI **„Wabern-Geschwindigkeit"** — skaliert die Zeit-Achse des Noise. Default 0.15 |
| **loop** | Wenn `true`: 4D-Pfad mit Kreisbahn in `(z, w)`. Wenn `false`: 3D-Pfad mit linearem `t` |
| **loopProgress** | Aktuelle Position auf der Kreisbahn in `[0, 1)`. Wird zu `α = 2π·progress` |
| **loopRadius** | Wie weit sich das Bild über eine volle Umdrehung bewegt |
| **safeProgress** | `((p % 1) + 1) % 1` — sichert die Loop-Identität gegen Float-Rundung von `Math.sin(2π)` |
| **Worker-Source** | Der komplette `perlin.js`-Code als String in `MTPerlin.WORKER_SOURCE`. Wird in einen Inline-Blob-Worker geladen — `file://`-kompatibel |

## Workflow-Hinweise

### Tests
Es gibt **keine Test-Suite**. Stattdessen:

1. **Syntax-Check beider JS-Dateien** nach jeder Änderung:
   ```bash
   node --check perlin.js && node --check perlin-studio.js
   ```
2. **Math-Sanity** für Perlin-Änderungen — temporäres Node-Script anlegen,
   `global.window = {}` setzen, `perlin.js` requiren, gegen erwartete
   Eigenschaften prüfen (Reproduzierbarkeit, Wertebereich, Loop-Identität).
   Siehe historische Beispiele in der Commit-History.
3. **Manueller Browser-Test** — `python3 -m http.server` und durchklicken.

Sandbox-Hinweis: Die Permission-Konfiguration verbietet evtl. das Starten
eines HTTP-Servers aus `/Users/Shared/`. Bei Blocker den User auffordern,
selbst zu testen.

### Häufige Fallstricke

#### Math-Bug-Klasse 1: Float-Rundung bei Loop-Endpunkten
`Math.sin(2π)` ist nicht `0`, sondern ca. `-2.4e-16`. `Math.floor(-1.7e-16)`
ist `-1`, was im Hash-Lookup auf `255` maskiert — das ergibt ein
*komplett anderes* Bild. Lösung: `safeProgress = ((p % 1) + 1) % 1`.

#### Math-Bug-Klasse 2: Z/W-Achsen-Vertauschung in `perlin4`
Im 4D-Hash-Baum sind `AAB` und `AAA+1` unterschiedliche Konstrukte:
`AAB = perm[AA+1]+W` ist ein **Z-Shift**, `AAA+1 = perm[AA]+W+1` ist ein
**W-Shift**. Die Offsets müssen passen: `AAB` nutzt `z-1`, `AAA+1` nutzt
`w-1`. Die äußere Lerp ist über `tt` (W), nicht `s` (Z).

#### Animation-Bug: zu schneller `t`-Fortschritt
Die initiale Implementierung hatte `t += fps` pro Sekunde — Faktor 30× zu
schnell. Korrekt ist `t += 1` pro Sekunde, und `scaleT` skaliert das im
Noise-Space. So ist pro Frame der Schritt ~`scaleT / fps` ≈ 0.005 — sanftes
Wabern statt Flackern.

#### Worker-CSP
Unter `file://` blockieren manche Browser den Worker. Der Code fällt
automatisch auf Main-Thread-Rendering zurück (siehe `initWorker` /
`renderInMain`). Beim Debuggen darauf achten, ob FPS-Counter
„(main)" anzeigt — dann läuft der Fallback.

### Kommunikationsmuster mit Worker
- **Frames niemals stauen.** `requestFrame` skippt, wenn `state.workerBusy`
  noch `true` ist. Für Aufnahmen gibt es `renderFrameAndWait`, das via
  `state.pendingResolves` synchronisiert.
- **Transferable verwenden.** `postMessage({ ..., buffer: buf.buffer }, [buf.buffer])`
  → zero-copy zurück.

## Wenn du etwas änderst

1. **Auf den Fluss achten.** Performance-Tweaks in `perlin3`/`perlin4`
   nicht ohne Sanity-Checks committen. Subtile Math-Bugs sehen visuell
   normal aus, bis der Loop nicht mehr schließt oder kanten flackern.
2. **UI-Strings deutsch lassen.** Auch in neuen Buttons/Sektionen.
3. **`CHANGELOG.md` updaten** für jedes nutzersichtbare Feature/Fix.
4. **Keine Kosmetik in `_archiv/`.**

## Erweiterungs-Roadmap (nice-to-have)

Siehe `README.md` Abschnitt **Roadmap**. Bei Interesse an einem dieser
Punkte — vorher mit Maintainer kurz abstimmen, damit Scope und Approach
gleich klar sind:

- Gradient-Editor (eigene Color Stops)
- Tileable Noise (`repeatx`/`repeaty`/`repeatz`)
- GIF-Export (`gif.js`, ~12 KB)
- Obsidian-Plugin-Port
- Web-Component-Variante
