#import utils.functions as func

import src.file_handling as file_handling
import src.animation_generation as animation_generation
import src.image_generation as image_generation
import src.user_interface as user_interface

import matplotlib.pyplot as plt

def main():
    """
    Hauptfunktion des Skripts.

    Initialisiert die Parameter, generiert ein Bild, zeigt es an, erstellt eine Animation und speichert sie in einer Datei.
    """
    params_datei = user_interface.user_params_datei_auswahl()

    #params = file_handling.laden_params('params/default_params.json')
    params = file_handling.laden_params(params_datei)

    auswahl = user_interface.benutzer_parameter_abfrage()
    
    if auswahl == '2':
        # User Eingabe zur Bestimmung der Parameter
        params_datei = user_interface.benutzer_parameter_eingabe_und_speichern(params)
            
    #else:
        # User Eingabe zur Auswahl der params Datei
        #params_datei = user_interface.user_params_datei_auswahl()
        
    # Laden Sie die Parameter aus der Datei
    params = file_handling.laden_params(params_datei)

    # Speichern Sie die Parameter in einer Datei
    file_handling.speichern_params(params, 'params/params.json')

    # Laden Sie die Parameter aus der Datei
    #params = file_handling.laden_params('params/params.json')

    # Generieren Sie ein Bild
    image = image_generation.generiere_bild(params)
        
    # Zeige das Bild an
    image_generation.show_image(image, (16, 16))

    # Erstelle und speichere die Animation
    animation_breite = int(input('Breite der Animation in Pixel: '))
    animation_hoehe = int(input('Höhe der Animation in Pixel: '))
    animation_dateiname = input('Mit welchem Namen soll die gif-Datei gespeichert werden?\n> ')
    
    animation_generation.erstelle_und_speichere_animation(params, f'export/{animation_dateiname}.gif', (animation_breite,animation_hoehe), 100)

if __name__ == "__main__":
    main()