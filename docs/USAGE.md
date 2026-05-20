# Bedienungsanleitung

Ausführliche Erklärung aller UI-Elemente und Parameter. Für den schnellen
Einstieg siehe [README](../README.md), für die Technik dahinter
[ARCHITECTURE](ARCHITECTURE.md).

## Inhalt

1. [UI-Übersicht](#ui-übersicht)
2. [Auflösung](#auflösung)
3. [Rauschen](#rauschen)
4. [Loop](#loop)
5. [Farb-Modus](#farb-modus)
6. [Presets](#presets)
7. [Export](#export)
8. [Transport-Leiste](#transport-leiste)
9. [Tipps und Workflows](#tipps-und-workflows)

---

## UI-Übersicht

```
┌────────────────────────────────┬───────────────────────────────────┐
│ SIDEBAR                        │ MAIN OUTPUT                       │
│                                │                                   │
│  Auflösung                     │  ┌─────────────────────────────┐  │
│   Breite, Höhe                 │  │                             │  │
│                                │  │   Live-Vorschau-Canvas      │  │
│  Rauschen                      │  │                             │  │
│   scale x, scale y,            │  │                             │  │
│   Wabern-Geschwindigkeit,      │  └─────────────────────────────┘  │
│   base, octaves, persistence,  │                                   │
│   lacunarity                   │  ▶  ⏮   ━━●━━━━━ t=0.42  fps 30   │
│                                │                            f 120  │
│  Loop                          │                                   │
│   ☑ Nahtloser Loop              │  Status: …                  fps   │
│   Dauer, Radius                │  ────────────────────             │
│                                │                                   │
│  Farb-Modus                    │                                   │
│   Dropdown + Mode-Inputs       │                                   │
│                                │                                   │
│  Presets                       │                                   │
│   Speichern | Laden            │                                   │
│   [Chip] [Chip] [Chip] …       │                                   │
│                                │                                   │
│  Export                        │                                   │
│   PNG | WebM                   │                                   │
└────────────────────────────────┴───────────────────────────────────┘
```

---

## Auflösung

| Parameter | Bereich | Default | Wirkung |
|-----------|---------|---------|---------|
| **Breite** | 4–1024 | 256 | Pixel-Breite des Canvas |
| **Höhe**   | 4–1024 | 256 | Pixel-Höhe des Canvas |

**Praktische Empfehlung:**
- 128–256 für Live-Spielerei mit Parametern
- 384–512 für hochwertigen Export
- 768+ rechnet pro Frame spürbar länger — der Worker bleibt schnell genug
  für die Vorschau, aber die Animation könnte unter 30 fps fallen

Aspekt: das Canvas zeigt das Bild gestreckt auf die Container-Breite,
deshalb beeinflusst das Verhältnis Breite/Höhe die Anzeige.

---

## Rauschen

### `scale x`, `scale y`

Pixel-zu-Noise-Skalierung in den Raum-Achsen.

| Wert | Effekt |
|------|--------|
| 0.005 | sehr grobe Strukturen, wenig Details |
| 0.02 | mittlere Wolken (Default) |
| 0.05 | feine, dichtere Strukturen |
| 0.1+ | quasi-rauschiges Pattern |

Unterschiedliche x/y geben gestreckte Strukturen (gut für Aurora-Bänder
oder horizontale Wellen).

### `Wabern-Geschwindigkeit` (intern: `scaleT`)

Skaliert die Zeit-Achse des Noise.

| Wert | Effekt |
|------|--------|
| 0.05 | extrem langsames, fast statisches Wabern |
| 0.15 | sanftes Wabern (Default) |
| 0.3 | sichtbare Bewegung |
| 0.5+ | hektisches Flackern (vermutlich zu schnell für „natürlich") |

**Faustregel**: ähnlich klein wie `scale x` / `scale y`. Default 0.15 ist
ein guter Startwert für 30-fps-Animationen.

### `base` (Seed)

Ganze Zahl (auch negativ). Verschiebt die Permutationstabelle
deterministisch. Verschiedene Seeds → komplett unterschiedliche Muster
bei gleichen sonstigen Parametern. Gut zum „Würfeln", wenn dir das
aktuelle Muster nicht gefällt.

### `octaves`

Anzahl der fBm-Frequenz-Stufen. 1–10.

| Wert | Effekt |
|------|--------|
| 1 | reine glatte Wolken, keine Details |
| 3 | sanfte Strukturen mit etwas Variation |
| 6 | klassischer fBm-Look (Default) |
| 8+ | sehr feine Details, ggf. rauschig |

**Performance**: jeder zusätzliche Octave verdoppelt etwa die Frequenz
und somit die nötige Sampling-Dichte — pro Octave linear mehr
Rechenzeit.

### `persistence`

Amplitudenfaktor zwischen Oktaven, 0–2. Default 0.5.

| Wert | Effekt |
|------|--------|
| 0.3 | obere Oktaven sehr schwach → glatte, wolkige Strukturen |
| 0.5 | klassisch (Default) |
| 0.7 | obere Oktaven prominenter → raues Terrain |
| 1.0 | alle Oktaven gleich stark → sehr rauschig |

### `lacunarity`

Frequenzfaktor zwischen Oktaven, 1–8. Default 2.0.

| Wert | Effekt |
|------|--------|
| 1.5 | selbstähnliche, „organische" Strukturen |
| 2.0 | klassisch (Default) |
| 3.0+ | stark unterschiedliche Detailebenen, fast „elektrisch" |

`circuit`-Preset nutzt `lacunarity = 3.0` für den charakteristischen
Schaltkreis-artigen Look.

---

## Loop

### `Nahtloser Loop` (Checkbox, Default an)

Schaltet zwischen zwei Animations-Modi um:

- **Aktiviert (Loop-Modus)**: 4D-Perlin auf einer Kreisbahn. Nach
  `Loop-Dauer` Sekunden schließt die Animation nahtlos zurück zum Start.
- **Deaktiviert (Linear-Modus)**: 3D-Perlin mit linearer Zeit. Die
  Animation wabert sanft, ist aber nicht loopbar (am Ende des
  WebM-Exports gibt es einen sichtbaren Sprung).

### `Loop-Dauer (Sek)`

Wie lange ein Loop dauert. 0.5–60 Sekunden, Default 4.

Empfehlungen:
- 2–4 Sek für „atmende" GIF-artige Loops
- 6–10 Sek für entspannte Hintergrund-Animationen
- 15+ Sek wenn der Loop kaum als solcher wahrnehmbar sein soll

### `Loop-Radius`

Wie weit das Bild über eine volle Umdrehung im Noise-Space „reist". 0–4,
Default 1.0.

| Wert | Effekt |
|------|--------|
| 0.2 | sehr subtile Bewegung, fast statisch |
| 0.5 | leichtes Wabern |
| 1.0 | spürbare Animation (Default) |
| 2.0+ | starke Veränderung, ggf. schon Detail-Diskontinuität in hohen Oktaven |

**Vorsicht** bei großen Werten + hohen Oktaven: Loop-Radius wird intern
mit der Frequenz jeder Oktave multipliziert. Bei `loopRadius = 2`,
`octaves = 8`, `lacunarity = 2` ist die Kreisbahn im höchsten Octave
schon 256 Cells groß — der Loop ist mathematisch trotzdem nahtlos, sieht
aber unruhig aus.

---

## Farb-Modus

Dropdown wählt zwischen vier Modi, jeder mit eigenen Reglern.

### RGB (pro Kanal)

```
r scale | g scale | b scale  (jeweils 0–2 Slider)
r invert | g invert | b invert  (jeweils Checkbox)
```

Drei unabhängige Kanäle. Jeder Kanal:
- **Scale** multipliziert den Noise-Wert (0 = Kanal aus, 1 = voll, 2 =
  überbelichtet)
- **Invert** dreht den Wert um (`1 - n` statt `n`)

**Beispiele:**
- nur grün, normal:  `r=0, g=1, b=0, invert: -, g, -`
- Magenta: `r=1, g=0, b=1, all invert off`
- Gelb-auf-Schwarz: `r=1, g=1, b=0`

### Gradient (Preset)

Wählt eine von acht vordefinierten Farb-Maps:

| Name | Charakter |
|------|-----------|
| Viridis | Wissenschaftlich, Lila → Gelb |
| Magma | Schwarz → Magenta → Gelb |
| Fire | Schwarz → Rot → Orange → Weiß |
| Ocean | Tiefblau → Hellblau → Weiß |
| Forest | Dunkelgrün → Hellgrün → Beige |
| Grayscale | Schwarz → Weiß |
| Sunset | Dunkellila → Orange → Cream |
| Ice | Tiefblau → Eisblau → Weiß |

Die kleine Leiste unter dem Dropdown zeigt eine Vorschau des Gradienten.

### HSV (Hue aus Noise)

```
hue shift   (0–1)  — Verschiebung des Farbtons
hue range   (0–1)  — Bandbreite des Farbtons im Bild
saturation  (0–1)  — Sättigung (konstant)
value       (0–1)  — Helligkeit (konstant)
```

Der Noise-Wert wird nur auf den Farbton gemappt. Sättigung und
Helligkeit sind konstant über das ganze Bild → ergibt gleichmäßig
gesättigte, „neon-artige" Looks.

**Beispiele:**
- Aurora: `shift=0.45, range=0.25, sat=0.9, val=1.0` (Türkis → Grün)
- Plasma: `shift=0, range=1, sat=1, val=1` (volles Regenbogenspektrum)
- Sepia-Tönung: `shift=0.08, range=0.1, sat=0.6, val=0.9`

### Posterize (Stufen + Gradient)

```
Stufen           (2–16) — Anzahl diskreter Farbstufen
Gradient-Preset  — eine der acht Farb-Maps
```

Der Noise wird auf N gleich große Stufen quantisiert (`floor(n · N) /
(N-1)`), dann auf den Gradient gemappt. Ergibt cartoon-artige
Stufenfarben, gut für Terrain-Höhenkarten oder stilistische Effekte.

---

## Presets

### Speichern

Lädt den aktuellen Parameter-Stand als JSON herunter
(`perlin-preset-<timestamp>.json`).

### Laden

Lädt eine zuvor gespeicherte JSON-Datei oder eine selbst geschriebene.
Ungültige JSONs erzeugen eine Fehlermeldung in der Statusleiste.

JSON-Struktur (Beispiel):
```json
{
  "width": 384,
  "height": 256,
  "scaleX": 0.015,
  "scaleY": 0.015,
  "scaleT": 0.12,
  "base": 7,
  "octaves": 5,
  "persistence": 0.65,
  "lacunarity": 2.2,
  "colorMode": "gradient",
  "gradientName": "fire",
  "loop": true,
  "loopDuration": 6,
  "loopRadius": 1.0,
  "t": 0
}
```

Nicht enthaltene Felder behalten ihren aktuellen UI-Wert.

### Builtin-Presets (Chips)

| Preset | Look |
|--------|------|
| `default` | grünes, sanft waberndes Standardrauschen (RGB-Modus) |
| `lava` | tiefrot-orange-glühende Lava-Strömungen (Gradient `fire`) |
| `aurora` | Türkis-grünes Polarlicht (HSV, kleiner Hue-Range) |
| `clouds` | weiche Schwarz-Weiß-Wolken (Gradient `grayscale`) |
| `terrain` | gestufte Landschaft mit Höhenlinien-Look (Posterize `forest`) |
| `circuit` | hartkantiges Cyan/Black-Muster (Posterize 3-Stufen `ocean`) |

Klick auf einen Chip lädt das Preset sofort und rendert es.

---

## Export

### PNG (aktuelles Bild)

Speichert den aktuell sichtbaren Frame als PNG. Dateiname:
`perlin-<timestamp>.png`. Auflösung entspricht den Canvas-Maßen.

### WebM-Animation

Rendert `frames` Frames bei `fps` fps und exportiert als WebM (VP9 wenn
möglich, sonst VP8). Während der Aufnahme:
- Buttons sind disabled
- Eine Progress-Bar zeigt den Fortschritt
- Statuszeile zeigt den aktuellen Frame

Nach Abschluss erscheint statt des Canvas ein `<video>`-Element mit
Vorschau. Der **WebM herunterladen**-Button wird sichtbar. Dateiname:
`perlin-animation-<timestamp>.webm`.

**Loop-an + WebM**: exakt `frames` Frames pro Loop, perfekt schließend.
**Loop-aus + WebM**: linear durch die Zeit, am Ende des Videos springt
das Bild beim Replay zurück.

### Empfohlene Export-Einstellungen

| Use-Case | frames | fps | Dauer | Loop |
|----------|--------|-----|-------|------|
| Social-Media-Snippet | 90 | 30 | 3 s | an |
| Website-Header-Loop | 180 | 30 | 6 s | an |
| Hintergrund-Video lang | 600 | 24 | 25 s | aus |
| Test/Vorschau | 30 | 15 | 2 s | beides |

WebM-Dateien sind etwa 50–500 KB für kurze Loops bei moderater Auflösung.

---

## Transport-Leiste

| Bedienelement | Funktion |
|---------------|----------|
| **▶** / **⏸** | Play/Pause der Live-Animation. Alternative: **Leertaste** |
| **⏮** | Slider zurück auf 0 (`t = 0` oder `loopProgress = 0`) |
| **t-Slider** | Scrubbing: Range hängt vom Loop-Modus ab |
| **fps** (1–60) | Export-Framerate; im Live-Modus rendert die App so schnell wie möglich |
| **frames** (1–600) | Anzahl der Frames beim WebM-Export |

Rechts vom Status: live FPS-Counter (während Play).

---

## Tipps und Workflows

### „Ich will einen Hintergrund-Loop für meine Homepage"
1. `clouds` oder `aurora` Preset laden
2. `loopDuration` auf 6–10 Sek
3. Breite/Höhe an dein Layout anpassen (z. B. 1280×360 für ein Banner)
4. WebM exportieren, fps=24, frames=144 (= 6 Sek)
5. Im HTML: `<video autoplay muted loop playsinline>`

### „Ich will eine generative Textur für ein Spiel"
1. `terrain` oder `circuit` Preset
2. Loop ausschalten (für ein Standbild reicht das)
3. Auflösung auf die Zielgröße (512 oder 1024)
4. PNG-Export

### „Ich teste verschiedene Seeds"
1. Bei `base` herumklicken (Pfeile rauf/runter)
2. Live-Vorschau aktualisiert sich sofort
3. Wenn was gefällt: Preset speichern als JSON

### „Mein Browser ist langsam"
- Auflösung reduzieren (128 oder 192)
- Octaves reduzieren (3–4 reichen oft)
- Im Status sehen, ob „(main)" angezeigt wird — dann läuft der
  Main-Thread-Fallback, was deutlich langsamer als Worker ist (manche
  Safari unter `file://`). Lokalen HTTP-Server starten:
  `python3 -m http.server 8000`.

### „Ich will eigene Gradients"
Aktuell nur Code-seitig: in `perlin-studio.js` das `GRADIENTS`-Objekt
erweitern und einen `<option>`-Eintrag in `index.html` hinzufügen.
Custom-Gradient-Editor steht auf der [Roadmap](../README.md#roadmap).
