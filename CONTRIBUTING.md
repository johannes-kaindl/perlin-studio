# Mitmachen

Danke fürs Interesse! Dieses Dokument beschreibt den Entwickler-Workflow.
Es soll niedrigschwellig bleiben — der Stack ist absichtlich klein.

## Setup

Es gibt keinen Build-Step und keine Dependencies. Du brauchst nur:

- Einen modernen Browser (Chrome, Firefox, Safari)
- Optional: Python 3 für einen lokalen Server während der Entwicklung
- Optional: Node.js für die Sanity-Checks

```bash
git clone https://codeberg.org/jkaindl/perlin-studio.git
cd perlin-studio
python3 -m http.server 8000
# → http://localhost:8000
```

`index.html` direkt per Doppelklick öffnen funktioniert auch, aber während
der Entwicklung ist der HTTP-Server praktischer (Hot-Reload via
Browser-Refresh, keine `file://`-CORS-Stolpersteine beim Debuggen).

## Code-Stil

- **Vanilla JS**, ES2020+ Browser-Targets. Keine TypeScript-Migration ohne
  Diskussion.
- **Keine Dependencies** ohne klaren Anlass — das Tool soll statisch
  deploybar bleiben.
- **Kommentare auf Deutsch**, ebenso UI-Strings. Code-Bezeichner bleiben
  englisch.
- Diakritische Zeichen korrekt (Ä, Ö, Ü, ß), keine ASCII-Substitutionen.
- Funktionsnamen in `camelCase`, Konstanten in `UPPER_SNAKE_CASE`.

Pragmatisch: Wenn dir etwas nicht passt im bestehenden Stil, sag es im
Issue/PR — wir entscheiden gemeinsam.

## Tests

Es gibt keine formale Test-Suite. Stattdessen drei Ebenen:

### 1. Syntax-Checks (Pflicht vor jedem Commit)

```bash
node --check perlin.js && node --check perlin-studio.js
```

### 2. Math-Sanity-Checks (bei Änderungen an `perlin.js`)

Lege ein temporäres Node-Script an, das die Perlin-Properties verifiziert.
Beispiel-Template:

```js
global.window = {};
require("./perlin.js");
const P = global.window.MTPerlin;

const perm = P.makePermutation(42);

// 1. Reproduzierbarkeit
console.assert(P.perlin3(perm, 1.3, 2.7, 0.5) === P.perlin3(perm, 1.3, 2.7, 0.5));

// 2. Gitterpunkt-Wert = 0
console.assert(Math.abs(P.perlin3(perm, 1, 1, 0)) < 1e-10);

// 3. Wertebereich
let min = Infinity, max = -Infinity;
for (let i = 0; i < 10000; i++) {
  const v = P.perlin3(perm, Math.random()*100, Math.random()*100, Math.random()*100);
  if (v < min) min = v; if (v > max) max = v;
}
console.assert(min > -1 && max < 1);
console.log("perlin3 range:", min, max);

// 4. Loop-Identität (für perlin4 mit Kreisbahn)
const r = 0.5;
const a = P.perlin4(perm, 1, 1, Math.cos(0)*r, Math.sin(0)*r);
const b = P.perlin4(perm, 1, 1, Math.cos(2*Math.PI)*r, Math.sin(2*Math.PI)*r);
// In der Praxis nicht ganz identisch wegen Float — `safeProgress` macht's robust
console.log("Loop endpoints diff:", Math.abs(a - b));
```

### 3. Manueller Browser-Test

Mindestens vor PR-Submission:

- [ ] Default-Preset rendert direkt nach Page-Load
- [ ] Play startet eine sanfte Animation (kein Flackern)
- [ ] Loop-Toggle wechselt zwischen Loop- und Linear-Modus, Slider
      passt sich an
- [ ] Alle 6 Builtin-Presets laden ohne Konsolen-Fehler
- [ ] WebM-Export erzeugt downloadbare Datei, die in VLC abspielt
- [ ] WebM mit Loop=an wiederholt sich nahtlos
- [ ] Resize von `width`/`height` rendert in neuer Auflösung
- [ ] FPS-Counter zeigt sinnvolle Zahlen während Play

Wenn dein Browser den Worker blockiert: der FPS-Counter sagt `… (main)` —
das ist der Main-Thread-Fallback, kein Fehler.

## Pull Requests

1. **Branch** vom `main` mit beschreibendem Namen (`feature/gradient-editor`,
   `fix/loop-float-edge`).
2. **Commit-Messages auf Deutsch**, im Imperativ (z. B. `Loop-Toggle
   aktualisiert Slider-Range`).
3. **CHANGELOG.md updaten** im Abschnitt `[Unreleased]`.
4. **Beschreibung**: was wurde geändert, warum, wie getestet.

PRs ohne erkennbaren Test-Aufwand werden zurückgegeben.

## Issues

Bug-Reports gerne mit:
- Browser + Version
- Schritt-für-Schritt-Reproduktion
- Konsolen-Output (sofern vorhanden)
- Was du erwartet hast vs. was passiert ist

Feature-Requests gerne mit einem konkreten Use-Case — gerade die
Mathe/Render-Architektur ist sensibel gegen unmotivierte Änderungen.

## Was nicht gewünscht ist

Bitte **vor** der Arbeit klären:

- Migration auf Frameworks (React, Vue, Svelte) oder Bundler (Webpack, Vite)
- Hinzufügen von Dependencies, die nicht klein und essentiell sind
- Mocks/Stubs für interne Module — Sanity-Checks sind ausreichend
- Datei-Renamings ohne Refactoring-Anlass
- Auto-Formatierung über das gesamte Repo

## Lizenz

Beiträge stehen unter [GNU AGPL-3.0](LICENSE). Mit dem Einreichen eines
PRs erklärst du dich einverstanden, dass dein Beitrag unter dieser Lizenz
veröffentlicht wird.
