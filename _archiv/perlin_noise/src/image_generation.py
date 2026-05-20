import numpy as np
import noise

def extrahiere_parameter(params):
    """
    Extrahiert Parameter aus einem Wörterbuch.

    Args:
        params (dict): Ein Wörterbuch mit den Parametern für das Bild.

    Returns:
        tuple: Ein Tupel, das alle extrahierten Parameter enthält.
    """
    return (params[key] for key in ('breite', 'hoehe', 't', 'scale_x', 'scale_y', 'scale_t', 
                                    'octaves', 'persistence', 'lacunarity', 'repeatx', 'repeaty', 
                                    'repeatz', 'base', 'rot_scale', 'gruen_scale', 'blau_scale', 
                                    'rot_invertiert', 'gruen_invertiert', 'blau_invertiert'))

def generiere_bild(params):
    """
    Generiert ein Bild mit Perlin-Rauschen.

    Args:
        params (dict): Ein Wörterbuch mit den Parametern für das Bild.

    Returns:
        numpy.ndarray: Ein Array mit den Bildpixeln.
    """
    # Extrahiere die Parameter aus dem Wörterbuch
    breite, hoehe, t, scale_x, scale_y, scale_t, octaves, persistence, lacunarity, repeatx, repeaty, repeatz, base, \
    rot_scale, gruen_scale, blau_scale, rot_invertiert, gruen_invertiert, blau_invertiert = extrahiere_parameter(params)

    # Generiere Perlin-Rauschen
    rauschen = generiere_perlin_rauschen(breite, hoehe, t, scale_x, scale_y, scale_t, octaves, persistence, 
                                         lacunarity, repeatx, repeaty, repeatz, base)

    # Leeres Array für das Bild
    bild = np.zeros((hoehe, breite, 3))

    # Setze die Farben basierend auf dem Perlin-Rauschen
    for y in range(hoehe):
        for x in range(breite):
            n = rauschen[y, x]
            bild[y, x, 0] = (1 - n if rot_invertiert else n) * rot_scale  # Rot
            bild[y, x, 1] = (1 - n if gruen_invertiert else n) * gruen_scale  # Grün
            bild[y, x, 2] = (1 - n if blau_invertiert else n) * blau_scale  # Blau

    return bild

def generiere_perlin_rauschen(breite, hoehe, t, scale_x, scale_y, scale_t, octaves, persistence, 
                              lacunarity, repeatx, repeaty, repeatz, base):
    """
    Generiert ein 2D-Array mit Perlin-Rauschen.

    Args:
        breite (int): Die Breite des Rauschens.
        hoehe (int): Die Höhe des Rauschens.
        t (float): Der Zeitpunkt, für den das Rauschen generiert wird.
        scale_x (float): Der Skalierungsfaktor in x-Richtung.
        scale_y (float): Der Skalierungsfaktor in y-Richtung.
        scale_t (float): Der Skalierungsfaktor in der Zeitdimension.
        octaves (int): Die Anzahl der Oktaven für das Perlin-Rauschen.
        persistence (float): Die Persistenz für das Perlin-Rauschen.
        lacunarity (float): Die Lacunarität für das Perlin-Rauschen.
        repeatx (int): Die Wiederholungsperiode des Rauschens in x-Richtung.
        repeaty (int): Die Wiederholungsperiode des Rauschens in y-Richtung.
        repeatz (int): Die Wiederholungsperiode des Rauschens in der Zeitdimension.
        base (int): Ein Startwert für den Zufallsgenerator.

    Returns:
        numpy.ndarray: Ein 2D-Array mit Perlin-Rauschen.
    """
    # Leeres Array für das Rauschen
    rauschen = np.zeros((hoehe, breite))

    # Fülle das Array mit Perlin-Rauschen
    for x in range(breite):
        for y in range(hoehe):
            # Generiere Perlin-Rauschen (Wert zwischen -1 und 1)
            n = noise.pnoise3(x*scale_x, y*scale_y, t*scale_t, octaves=octaves, persistence=persistence,
                              lacunarity=lacunarity, repeatx=repeatx, repeaty=repeaty, repeatz=repeatz, base=base)

            # Normalisiere auf [0, 1]
            rauschen[y, x] = (n + 1) / 2.0

    return rauschen

import matplotlib.pyplot as plt

def show_image(image, figsize=(10, 10)):
    """
    Zeigt ein Bild in einer matplotlib-Figur mit einer spezifischen Größe an.
    Die Funktion schaltet die Achsenbeschriftung aus und zeigt das Bild sofort an.

    Parameters:
    -----------
    image : array-like or PIL image
        Das darzustellende Bild. Es kann in vielen Formaten vorliegen - als PIL-Bild, 
        als NumPy-Array (typischerweise mit Form (Höhe, Breite, 3) oder (Höhe, Breite, 4)), usw.
        Die Funktion plt.imshow, die intern genutzt wird, handhabt die Konvertierung.
        
    figsize : tuple of integers, optional, default: (10, 10)
        Die Größe der erstellten Matplotlib-Figur, angegeben als (Breite, Höhe) in Zoll.
        Wenn nicht angegeben, wird der Standardwert (10, 10) verwendet.

    Returns:
    --------
    None
        Diese Funktion gibt nichts zurück. Sie erzeugt eine Matplotlib-Figur und zeigt diese an.
    """

    # Erstellen einer neuen Figur mit der gegebenen Größe
    plt.figure(figsize=figsize)

    # Anzeigen des Bildes innerhalb der Figur
    plt.imshow(image)

    # Deaktivieren der Achsenbeschriftung
    plt.axis('off')

    # Anzeigen der erstellten Figur
    plt.show()
