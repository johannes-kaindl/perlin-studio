# Perlin-Rauschen-Animationsgenerator

Dieses Projekt verwendet Perlin-Rauschen, um einzigartige, organisch anmutende Animationen zu erzeugen. Mit einem Satz von Parametern, die in einer JSON-Datei definiert sind, wird eine Reihe von Bildern generiert und in eine Animation zusammengefügt, die als GIF-Datei gespeichert wird.

## Installationsanweisungen

1. Ein Klon des Repositories wird erstellt, indem der Befehl `git clone [repository URL]` ausgeführt wird.
2. In das Repository-Verzeichnis wird mit dem Befehl `cd [Verzeichnisname]` gewechselt.
3. Alle erforderlichen Python-Bibliotheken werden installiert, indem `pip install -r requirements.txt` ausgeführt wird.

## Ausführungsanleitung

1. Das Python-Skript `main.py` wird ausgeführt, um eine Animation mit den Standardparametern zu generieren.
2. Zur Anpassung der Parameter wird die Datei `params.json` geöffnet und bearbeitet. Die Parameter steuern verschiedene Aspekte der Animation, einschließlich der Größe, Farbgebung und der Komplexität des Perlin-Rauschens.
3. Nach der Anpassung der Parameter wird `main.py` erneut ausgeführt, um eine neue Animation zu generieren.
4. Die erzeugte Animation wird in einer GIF-Datei im `export`-Verzeichnis gespeichert.

## Dateistruktur

- `main.py`: Die Hauptausführungsdatei. Sie initialisiert die Parameter, generiert eine einzelne Bildvorschau, erstellt eine Animation und speichert sie in einer Datei.
- `utils/functions.py`: Enthält alle Funktionen, die zum Generieren von Perlin-Rauschen und zum Erstellen von Animationen benötigt werden.
- `params/params.json`: Eine JSON-Datei, in der die Parameter für die Animation gespeichert sind. Hier können Anpassungen vorgenommen werden, um die generierte Animation zu beeinflussen.
- `export/`: Das Verzeichnis, in dem die erzeugte GIF-Animation gespeichert wird.

## Parameter

### 1. **breite**
- **Beschreibung**: Bestimmt die Breite des generierten Rauschens in Pixeln.
- **Wichtigkeit**: Definiert die horizontale Größe des Ausgabebildes. Größere Werte erzeugen breitere Bilder.

### 2. **hoehe**
- **Beschreibung**: Legt die Höhe des generierten Rauschens in Pixeln fest.
- **Wichtigkeit**: Bestimmt die vertikale Größe des Ausgabebildes. Höhere Werte führen zu höheren Bildern.

### 3. **t**
- **Beschreibung**: Der Zeitpunkt für das generierte Rauschen.
- **Wichtigkeit**: Ermöglicht animiertes Rauschen durch Variation über die Zeit, ideal für dynamische Effekte.

### 4. **scale_x** & **scale_y**
- **Beschreibung**: Skalierungsfaktoren in x- bzw. y-Richtung.
- **Wichtigkeit**: Beeinflussen die Zoom-Ebene des Rauschens. Niedrigere Werte erzeugen detailliertere Texturen.

### 5. **scale_t**
- **Beschreibung**: Skalierungsfaktor in der Zeitdimension.
- **Wichtigkeit**: Bestimmt die Geschwindigkeit der Änderungen zwischen den Frames bei Animationen.

### 6. **octaves**
- **Beschreibung**: Die Anzahl der Oktaven für das Perlin-Rauschen.
- **Wichtigkeit**: Mehr Oktaven führen zu komplexeren und detaillierteren Mustern, erhöhen aber die Berechnungszeit.

### 7. **persistence**
- **Beschreibung**: Die Persistenz des Rauschens.
- **Wichtigkeit**: Ein niedrigerer Wert erzeugt eine glattere Textur, indem die Amplitude der Oktaven schnell abfällt.

### 8. **lacunarity**
- **Beschreibung**: Die Lacunarität des Rauschens.
- **Wichtigkeit**: Ein höherer Wert erhöht den Detailgrad und die Rauheit der Textur.

### 9. **repeatx, repeaty, repeatz**
- **Beschreibung**: Wiederholungsperioden in den jeweiligen Dimensionen.
- **Wichtigkeit**: Ermöglichen nahtlose Muster und zyklische Texturen, ideal für Spiele und Grafikanwendungen.

### 10. **base**
- **Beschreibung**: Startwert für den Zufallsgenerator.
- **Wichtigkeit**: Gewährleistet Reproduzierbarkeit von Rauschmustern für Konsistenz in der Entwicklung.

### 11. **rot_scale, gruen_scale, blau_scale**
- **Beschreibung**: Skalierungsfaktoren für Farbkomponenten.
- **Wichtigkeit**: Bestimmen die Intensität der Farben im Rauschen, ermöglichen vielfältige visuelle Effekte.

### 12. **rot_invertiert, gruen_invertiert, blau_invertiert**
- **Beschreibung**: Invertierung der Farbkomponenten.
- **Wichtigkeit**: Verändert das visuelle Erscheinungsbild durch Umkehrung der Intensität der Farben.

### 13. **frames**
- **Beschreibung**: Die Anzahl der Frames für die Animation.
- **Wichtigkeit**: Bestimmt die Länge der Animation, mehr Frames ergeben eine längere Sequenz.

### 14. **interval**
- **Beschreibung**: Das Intervall zwischen Frames in Millisekunden.
- **Wichtigkeit**: Steuert die Geschwindigkeit der Animation, niedrigere Werte beschleunigen die Sequenz.

## Verwendung

Passen Sie die Parameter an Ihre Bedürfnisse an, um das gewünschte Rauschen zu erzeugen. Diese können für visuelle Effekte, Terrain-Generierung in Spielen oder als Grundlage für weitere grafische Anwendungen dienen.


## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Weitere Informationen finden Sie in der Datei `LICENSE`.

