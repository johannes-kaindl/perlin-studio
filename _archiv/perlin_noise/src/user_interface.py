from glob import glob
import os
import json


def benutzer_parameter_abfrage():
    """
    Fragt den Benutzer, ob er Parameter aus einer Datei laden oder neue Parameter eingeben möchte.

    Returns:
        str: 'l' für Laden, 'n' für neue Parameter.
    """
    while True:
        auswahl = input('Möchten Sie Parameter aus der Datei:\n1: unverändert übernehmen\n2: Parameter anpassen\n> ')
        if auswahl.lower() in ('1', '2'):
            return auswahl.lower()
        else:
            print("Ungültige Auswahl, bitte geben Sie '1' oder '2' ein.")

import os
import json

def lade_standardwerte(dateiname):
    """
    Lädt die Standardwerte aus einer JSON-Datei.

    Args:
        dateiname (str): Der Name der JSON-Datei.

    Returns:
        dict: Die geladenen Standardwerte.
    """
    pfad = os.path.join('params', f'{dateiname}.json')
    try:
        with open(pfad, 'r') as f:
            standardwerte = json.load(f)
    except Exception as e:
        print(f"Fehler beim Laden der Standardwerte: {e}")
        return None
    return standardwerte

def benutzer_parameter_eingabe_und_speichern(standardwerte):
    """
    Erlaubt dem Benutzer, Parameter einzugeben und speichert sie in einer Datei.

    Args:
        params (dict): Ein Wörterbuch mit den Standardwerten der Parameter.

    Returns:
        str: Der Pfad zur Datei, in der die Parameter gespeichert sind.

    Raises:
        Exception: Wenn ein Fehler beim Speichern der Parameter auftritt.
    """
    #standardwerte = lade_standardwerte(params) # Laden der Standardwerte
    if standardwerte is None: # Falls das Laden der Standardwerte fehlschlägt
        return None

    params = {
        'breite': validiere_input('Die Breite des Rauschens.\nbreite (int >= 1): ', int, min=1, default=standardwerte.get('breite', 16)),
        'hoehe': validiere_input('Die Höhe des Rauschens.\nhoehe (int >= 1): ', int, min=1, default=standardwerte.get('hoehe', 16)),
        't': validiere_input('Der Zeitpunkt, für den das Rauschen generiert wird.\nt (float): ', float, default=0.0),
        'scale_x': validiere_input('Der Skalierungsfaktor in x-Richtung.\nscale_x (float >= 0): ', float, min=0.0, default=0.19),
        'scale_y': validiere_input('Der Skalierungsfaktor in y-Richtung.\nscale_y (float >= 0): ', float, min=0.0, default=0.19),
        'scale_t': validiere_input('Der Skalierungsfaktor in der Zeitdimension.\nscale_t (float >= 0): ', float, min=0.0, default=0.5),
        'octaves': validiere_input('Die Anzahl der Oktaven für das Perlin-Rauschen.\noctaves (int >= 1): ', int, min=1, default=6),
        'persistence': validiere_input('Die Persistenz für das Perlin-Rauschen.\npersistence (float zwischen 0 und 1): ', float, min=0.0, max=1.0, default=0.4),
        'lacunarity': validiere_input('Die Lacunarität für das Perlin-Rauschen.\nlacunarity (float >= 1): ', float, min=1.0, default=2.0),
        'repeatx': validiere_input('Die Wiederholungsperiode des Rauschens in x-Richtung.\nrepeatx (int >= 0): ', int, min=0, default=1024),
        'repeaty': validiere_input('Die Wiederholungsperiode des Rauschens in y-Richtung.\nrepeaty (int >= 0): ', int, min=0, default=1024),
        'repeatz': validiere_input('Die Wiederholungsperiode des Rauschens in der Zeitdimension.\nrepeatz (int >= 0): ', int, min=0, default=1024),
        'base': validiere_input('Ein Startwert für den Zufallsgenerator.\nbase (int): ', int, default=0),
        'rot_scale': validiere_input('Der Skalierungsfaktor für die rote Farbkomponente.\nrot_scale (float zwischen 0 und 1): ', float, min=0.0, max=1.0, default=0),
        'gruen_scale': validiere_input('Der Skalierungsfaktor für die grüne Farbkomponente.\ngruen_scale (float zwischen 0 und 1): ', float, min=0.0, max=1.0, default=1.0),
        'blau_scale': validiere_input('Der Skalierungsfaktor für die blaue Farbkomponente.\nblau_scale (float zwischen 0 und 1): ', float, min=0.0, max=1.0, default=0),
        'rot_invertiert': validiere_input('Soll die rote Farbkomponente invertiert werden?\nrot_invertiert (bool): ', bool, default=False),
        'gruen_invertiert': validiere_input('Soll die grüne Farbkomponente invertiert werden?\ngruen_invertiert (bool): ', bool, default=True),
        'blau_invertiert': validiere_input('Soll die blaue Farbkomponente invertiert werden?\nblau_invertiert (bool): ', bool, default=True),
        'frames': validiere_input('Die Anzahl der Frames.\nframes (int >= 1): ', int, min=1, default=200),
        'interval': validiere_input('Das Interval zwischen den Frames.\ninterval (int >= 1): ', int, min=1, default=200)
    }

    dateiname = input('Dateiname für die Speicherung der Parameter: ')
    if dateiname == '':
        dateiname = 'params'
    pfad = os.path.join('params', f'{dateiname}.json')
    try:
        with open(pfad, 'w') as f:
            json.dump(params, f)
        print(f"Parameter erfolgreich gespeichert unter {pfad}")
    except Exception as e:
        print(f"Fehler beim Speichern der Parameter: {e}")
        return None

    return pfad

def user_params_datei_auswahl():
    """
    Lässt den Benutzer eine Parameterdatei aus dem Ordner 'params' auswählen.

    Gibt den Dateinamen der ausgewählten Datei zurück.

    Returns:
        str: Der Pfad zur ausgewählten Datei.
    """
    files = glob('params/*.json')

    print(f'Aus welcher Datei sollen die Parameter geladen werden? (0 bis {len(files) - 1})')

    # Liste die Dateien auf
    for i, file in enumerate(files):
        print(f'{i}: {file}')

    while True:
        # Frage den Benutzer, welche Datei geladen werden soll
        dateiauswahl = input('> ')

        # Validiere die Benutzereingabe
        if dateiauswahl.isdigit() and 0 <= int(dateiauswahl) < len(files):
            return files[int(dateiauswahl)]
        else:
            print("Ungültige Auswahl, bitte versuchen Sie es erneut.")

def validiere_input(nachricht, typ, min=None, max=None, default=None):
    """
    Fordert den Benutzer zur Eingabe eines Werts auf und validiert diesen.

    Args:
        nachricht (str): Die Nachricht, die dem Benutzer angezeigt wird.
        typ (type): Der erwartete Datentyp des Werts.
        min (Optional[Number]): Der minimale akzeptable Wert.
        max (Optional[Number]): Der maximale akzeptable Wert.
        default (Optional[Number]): Der Standardwert, falls der Benutzer keinen Wert eingibt.

    Returns:
        Der validierte Wert.
    """
    if default is not None:
        nachricht += f" (Standardwert: {default})"

    while True:
        try:
            ein = input(nachricht)
            if not ein and default is not None:
                return default
            ein = typ(ein)
            if min is not None and ein < min:
                print(f"Der Wert darf nicht kleiner sein als {min}. Bitte versuchen Sie es erneut.")
                continue
            if max is not None and ein > max:
                print(f"Der Wert darf nicht größer sein als {max}. Bitte versuchen Sie es erneut.")
                continue
            return ein
        except ValueError:
            print(f"Ungültige Eingabe. Bitte geben Sie einen Wert des Typs {typ.__name__} ein.")
