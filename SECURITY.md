<!--
SPDX-FileCopyrightText: 2026 Johannes Kaindl
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Sicherheits-Meldungen

Perlin Studio ist ein **Hobbyprojekt** ohne Security-Team, ohne SLA und
ohne Bug-Bounty. Trotzdem freue ich mich über Hinweise auf
sicherheitsrelevante Probleme und versuche, sie zeitnah zu beheben.

## Was hier rein gehört

- **Cross-Site Scripting** in den UI-Steuerungen (Settings-Inputs,
  URL-Params, localStorage-gerenderter Inhalt).
- **Malformed WebM-Output** der durch `MediaRecorder` so erzeugt wird,
  dass beim Öffnen im Standardplayer böses passieren könnte.
- **Worker-Isolations-Bypass** — der Render-Worker tauscht Buffer mit dem
  Main-Thread; manipulierte Settings sollten den Worker nicht zur Code-
  Ausführung außerhalb des Sandbox bringen.
- **CSP-/Same-Origin-Bypass** beim Embedding der Live-Demo in Drittseiten
  (z.B. Iframe-Sandbox-Escapes).

Wenn du dir nicht sicher bist, ob etwas reinfällt: lieber melden.

## Was nicht hier rein gehört

- Allgemeine Bug-Reports (kein Sicherheitsbezug) — bitte als
  öffentliches Issue: <https://codeberg.org/jkaindl/perlin-studio/issues>.
- Browser-Bugs (Safari/Chrome/Firefox-WebGL-/WebM-Quirks ohne Security-
  Implikation) — gehören zu den Vendoren.
- Allgemeine Härtungs-Vorschläge ohne konkretes Angriffsszenario —
  gerne als normales Issue mit `enhancement`-Label.

## Wie melden

**Bevorzugt:** privates Codeberg-Issue im Repo, oder PM via Codeberg an
[@jkaindl](https://codeberg.org/jkaindl). Codeberg unterstützt private
Issues — beim Anlegen das Privacy-Häkchen setzen.

**Alternativ:** E-Mail an die Adresse, die im
[Codeberg-Profil](https://codeberg.org/jkaindl) hinterlegt ist.

PGP ist nicht aufgesetzt; für sensible Reports kann ich auf Anfrage
einen Schlüssel veröffentlichen.

## Was du erwarten kannst

- **Eingangsbestätigung** innerhalb von 7 Tagen.
- **Erste Einschätzung** (Reproduktion, Schweregrad, geplantes Vorgehen)
  innerhalb von 14 Tagen.
- **Fix oder dokumentierter Workaround** so schnell wie für ein
  Hobbyprojekt realistisch ist — kritisch: Tage, normal: Wochen.
- **Credit** im `CHANGELOG.md` und Release-Notes, wenn du das möchtest.

## Scope und Threat-Model

Perlin Studio ist **vollständig clientseitig**:

- Kein Backend, keine Server-Calls, keine externen API-Keys.
- Kein Auth, keine Sessions, keine Multi-User-Daten.
- Settings + Presets in `localStorage` des jeweiligen Browsers.
- WebM-Export läuft komplett im Browser über `MediaRecorder`.

Reports, die diese Annahmen verletzen (heimliche Network-Calls, Tracking,
synchronisierte Daten), sind im Scope und besonders willkommen.

## Bekannte Designentscheidungen, die kein Bug sind

- **Kein CSP-Header in der Live-Demo.** Codeberg Pages liefert Pages
  ohne Custom-Header. Mitigation: keine Inline-`<script>`-Konstrukte
  mit Nutzer-Input, kein `eval`.
- **WebM-Export-Größe ist nicht limitiert.** Lange Captures können
  mehrere hundert MB werden; das ist gewollt. Kein DoS-Bug.
- **Keine Update-Strategie für vorgenerierte Presets.** Wer Presets im
  localStorage gespeichert hat, sieht beim Update neue Felder
  möglicherweise nicht — bewusst, vermeidet Migration-Komplexität.
