import json

def laden_params(dateiname):
    """
    Lädt die Parameter aus einer JSON-Datei.

    Args:
        dateiname (str): Der Name der Datei, aus der die Parameter geladen werden sollen.

    Returns:
        dict: Ein Wörterbuch mit den geladenen Parametern.
    """
    with open(dateiname, 'r') as f:
        params = json.load(f)
    return params

def speichern_params(params, dateiname):
    """
    Speichert die Parameter in einer JSON-Datei.

    Args:
        params (dict): Ein Wörterbuch mit den Parametern.
        dateiname (str): Der Name der Datei, in der die Parameter gespeichert werden sollen.
    """
    with open(dateiname, 'w') as f:
        json.dump(params, f)

        