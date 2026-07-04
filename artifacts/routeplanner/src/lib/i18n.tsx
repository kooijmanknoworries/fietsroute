import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Lang = "nl" | "en";

const STORAGE_KEY = "fietsrouteplanner.lang";
export const DEFAULT_LANG: Lang = "nl";

const en = {
  "app.subtitle": "Plan your cycling adventure in NL/BE",
  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.signInTitle": "Welcome back",
  "auth.signInSubtitle": "Sign in to access your saved cycling routes",
  "auth.signUpTitle": "Create your account",
  "auth.signUpSubtitle": "Save your cycling routes and reach them from any device",

  "lang.switchToDutch": "Switch to Dutch",
  "lang.switchToEnglish": "Switch to English",

  "quickJump.label": "Quick Jump to Region",
  "quickJump.placeholder": "Select a region...",

  "muni.label": "Your home town (default start)",
  "muni.searchButton": "Search a town or village (NL/BE)...",
  "muni.inputPlaceholder": "Type a town or village name...",
  "muni.searching": "Searching...",
  "muni.noResults": "No places found.",
  "muni.typeMore": "Type at least 2 characters to search.",
  "muni.removeFavorite": "Remove home town",
  "muni.setFavorite": "Set as home town (default start)",
  "muni.opensAtPrefix": "Opens at",
  "muni.clearFavorite": "Clear home town",

  "network.loading": "Loading network...",
  "network.zoomInTitle": "Zoom in",
  "network.zoomInDesc": "Zoom in closer to see all cycling nodes in this area.",
  "network.noNodes": "No nodes found in current view.",
  "network.preparingTitle": "Map data is still loading",
  "network.preparingDesc": "We're preparing the cycling network for your area. The map may load a little slower until it's ready — this usually only takes a moment.",

  "route.yourRoute": "Your Route",
  "route.undo": "Undo last node",
  "route.clear": "Clear route",
  "route.emptyHint": "Click on a numbered node on the map to start planning your route.",
  "route.errorTitle": "Routing Error",
  "route.totalDistance": "Total Distance:",
  "route.saveRoute": "Save route",
  "route.signInToSave": "Sign in to save",
  "route.nodesCount": "{count} nodes",

  "ride.start": "Start ride",
  "ride.stop": "Stop ride",
  "ride.riding": "Ride in progress",
  "ride.progress": "{done} of {total} ridden",
  "ride.gpsDenied": "Location access is blocked. Enable location permission for this site to track your ride.",
  "ride.gpsUnavailable": "Can't get your location right now. Recolouring will resume once a GPS signal returns.",
  "ride.signInToSaveHistory": "Sign in to keep a permanent record of the segments you've ridden.",
  "ride.waitingForGps": "Waiting for GPS signal…",
  "ride.recenter": "Recenter on me",
  "ride.recenterTitle": "Resume following your live position",
  "ride.summary.title": "Ride complete!",
  "ride.summary.subtitle": "Nice work — here's how this ride went.",
  "ride.summary.distance": "Distance ridden",
  "ride.summary.newSegments": "New segments unlocked",
  "ride.summary.totalSegments": "Lifetime segments",
  "ride.summary.signInHint": "Sign in to keep these segments in your lifetime history.",
  "ride.summary.done": "Done",

  "saved.title": "Saved Routes",
  "saved.signInPrompt": "Sign in to save routes and reach them from any device.",
  "saved.loading": "Loading saved routes...",
  "saved.empty": 'No saved routes yet. Plan a route and tap "Save route" to keep it.',
  "saved.openRoute": "Open route",
  "saved.renameRoute": "Rename route",
  "saved.deleteRoute": "Delete route",

  "gpx.title": "Import & Export",
  "gpx.export": "Export GPX",
  "gpx.import": "Import GPX",
  "gpx.loaded": "GPX track loaded",

  "common.clear": "Clear",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.rename": "Rename",

  "dialog.save.title": "Save route",
  "dialog.save.desc": "Give your route a name so you can reopen it later.",
  "dialog.save.placeholder": "e.g. Sunday loop along the Maas",
  "dialog.rename.title": "Rename route",
  "dialog.rename.desc": "Update the name of your saved route.",
  "dialog.rename.placeholder": "Route name",
  "dialog.import.title": "Import routes from this device?",
  "dialog.import.desc":
    "We found cycling routes you saved on this device before signing in. Import them into your account so you can reach them from anywhere.",
  "dialog.import.notNow": "Not now",
  "dialog.import.confirm": "Import routes",

  "map.center": "Center",
  "map.centerTitle": "Center on default area",
  "map.street": "Map",
  "map.streetTitle": "Street map view",
  "map.satellite": "Satellite",
  "map.satelliteTitle": "Satellite view",
  "map.styleTitle": "Choose a map style",
  "map.lfRoutes": "LF-routes",
  "map.lfRoutesTitle": "Show long-distance LF cycling routes",
  "map.style.voyager": "Voyager",
  "map.style.positron": "Light",
  "map.style.dark": "Dark",
  "map.style.osm": "OpenStreetMap",
  "map.webglError":
    "The interactive map could not start because this browser or environment does not support WebGL. Try opening the app in a standard desktop browser with hardware acceleration enabled.",

  "notFound.title": "404 Page Not Found",
  "notFound.desc": "Did you forget to add the page to the router?",

  "toast.favRemoved.title": "Home town removed",
  "toast.favRemoved.desc": '"{name}" is no longer your default start.',
  "toast.favSet.title": "Home town set",
  "toast.favSet.desc": 'The map will open at "{name}" next time.',
  "toast.favCleared.title": "Home town cleared",
  "toast.favCleared.desc": "The map will open at the default area.",
  "toast.routeSaved.title": "Route saved",
  "toast.routeSaved.desc": '"{name}" added to your saved routes.',
  "toast.routeRenamed.title": "Route renamed",
  "toast.routeRenamed.desc": 'Renamed to "{name}".',
  "toast.renameFailed.title": "Rename failed",
  "toast.renameFailed.desc": "Could not rename the route.",
  "toast.routesImported.title": "Routes imported",
  "toast.routesImported.descOne": "1 route saved on this device is now in your account.",
  "toast.routesImported.descMany": "{count} routes saved on this device are now in your account.",
  "toast.nothingToImport.title": "Nothing to import",
  "toast.nothingToImport.desc": "No routes from this device were found.",
  "toast.importFailed.title": "Import failed",
  "toast.importFailed.desc": "Could not import your routes.",
  "toast.gpxImportFailed.title": "Couldn't import this file",
  "toast.gpxImportFailed.desc": "No valid track points found in this file.",

  "error.noPath": "Could not find a connecting path between these nodes.",
  "error.computeFailed": "Failed to compute route.",
  "error.openFailed": "Failed to open saved route.",
} as const;

export type TranslationKey = keyof typeof en;

const nl: Record<TranslationKey, string> = {
  "app.subtitle": "Plan je fietsavontuur in NL/BE",
  "auth.signIn": "Inloggen",
  "auth.signOut": "Uitloggen",
  "auth.signInTitle": "Welkom terug",
  "auth.signInSubtitle": "Log in om je opgeslagen fietsroutes te bekijken",
  "auth.signUpTitle": "Maak je account aan",
  "auth.signUpSubtitle": "Sla je fietsroutes op en bekijk ze op elk apparaat",

  "lang.switchToDutch": "Schakel naar Nederlands",
  "lang.switchToEnglish": "Schakel naar Engels",

  "quickJump.label": "Snel naar regio",
  "quickJump.placeholder": "Kies een regio...",

  "muni.label": "Je woonplaats (standaard start)",
  "muni.searchButton": "Zoek een plaats of dorp (NL/BE)...",
  "muni.inputPlaceholder": "Typ een plaats- of dorpsnaam...",
  "muni.searching": "Zoeken...",
  "muni.noResults": "Geen plaatsen gevonden.",
  "muni.typeMore": "Typ minstens 2 tekens om te zoeken.",
  "muni.removeFavorite": "Woonplaats verwijderen",
  "muni.setFavorite": "Instellen als woonplaats (standaard start)",
  "muni.opensAtPrefix": "Opent bij",
  "muni.clearFavorite": "Woonplaats wissen",

  "network.loading": "Netwerk laden...",
  "network.zoomInTitle": "Zoom in",
  "network.zoomInDesc": "Zoom verder in om alle knooppunten in dit gebied te zien.",
  "network.noNodes": "Geen knooppunten in huidig beeld.",
  "network.preparingTitle": "Kaartgegevens worden nog geladen",
  "network.preparingDesc": "We bereiden het fietsknooppuntennetwerk voor jouw gebied voor. De kaart laadt mogelijk iets langzamer totdat alles klaar is — dit duurt meestal maar even.",

  "route.yourRoute": "Jouw route",
  "route.undo": "Laatste knooppunt ongedaan maken",
  "route.clear": "Route wissen",
  "route.emptyHint": "Klik op een genummerd knooppunt op de kaart om je route te plannen.",
  "route.errorTitle": "Routefout",
  "route.totalDistance": "Totale afstand:",
  "route.saveRoute": "Route opslaan",
  "route.signInToSave": "Log in om op te slaan",
  "ride.start": "Rit starten",
  "ride.stop": "Rit stoppen",
  "ride.riding": "Rit bezig",
  "ride.progress": "{done} van {total} gereden",
  "ride.gpsDenied": "Locatietoegang is geblokkeerd. Sta locatietoegang toe voor deze site om je rit te volgen.",
  "ride.gpsUnavailable": "Je locatie is nu niet beschikbaar. Het herkleuren gaat verder zodra er weer een gps-signaal is.",
  "ride.signInToSaveHistory": "Log in om een blijvend overzicht van je gereden segmenten te bewaren.",
  "ride.waitingForGps": "Wachten op gps-signaal…",
  "ride.recenter": "Centreer op mij",
  "ride.recenterTitle": "Ga verder met het volgen van je live positie",
  "ride.summary.title": "Rit voltooid!",
  "ride.summary.subtitle": "Goed gedaan — dit is hoe je rit ging.",
  "ride.summary.distance": "Gereden afstand",
  "ride.summary.newSegments": "Nieuwe segmenten ontgrendeld",
  "ride.summary.totalSegments": "Totaal aantal segmenten",
  "ride.summary.signInHint": "Log in om deze segmenten in je totaaloverzicht te bewaren.",
  "ride.summary.done": "Klaar",
  "route.nodesCount": "{count} knooppunten",

  "saved.title": "Opgeslagen routes",
  "saved.signInPrompt": "Log in om routes op te slaan en op elk apparaat te bekijken.",
  "saved.loading": "Opgeslagen routes laden...",
  "saved.empty": 'Nog geen opgeslagen routes. Plan een route en tik op "Route opslaan".',
  "saved.openRoute": "Route openen",
  "saved.renameRoute": "Route hernoemen",
  "saved.deleteRoute": "Route verwijderen",

  "gpx.title": "Importeren & Exporteren",
  "gpx.export": "GPX exporteren",
  "gpx.import": "GPX importeren",
  "gpx.loaded": "GPX-track geladen",

  "common.clear": "Wissen",
  "common.cancel": "Annuleren",
  "common.save": "Opslaan",
  "common.rename": "Hernoemen",

  "dialog.save.title": "Route opslaan",
  "dialog.save.desc": "Geef je route een naam zodat je hem later kunt openen.",
  "dialog.save.placeholder": "bijv. zondagrondje langs de Maas",
  "dialog.rename.title": "Route hernoemen",
  "dialog.rename.desc": "Wijzig de naam van je opgeslagen route.",
  "dialog.rename.placeholder": "Routenaam",
  "dialog.import.title": "Routes van dit apparaat importeren?",
  "dialog.import.desc":
    "We vonden fietsroutes die je op dit apparaat hebt opgeslagen voordat je inlogde. Importeer ze in je account zodat je ze overal kunt bekijken.",
  "dialog.import.notNow": "Niet nu",
  "dialog.import.confirm": "Routes importeren",

  "map.center": "Centreren",
  "map.centerTitle": "Centreren op standaardgebied",
  "map.street": "Kaart",
  "map.streetTitle": "Stratenkaart",
  "map.satellite": "Satelliet",
  "map.satelliteTitle": "Satellietweergave",
  "map.styleTitle": "Kies een kaartstijl",
  "map.lfRoutes": "LF-routes",
  "map.lfRoutesTitle": "Toon landelijke fietsroutes (LF)",
  "map.style.voyager": "Voyager",
  "map.style.positron": "Licht",
  "map.style.dark": "Donker",
  "map.style.osm": "OpenStreetMap",
  "map.webglError":
    "De interactieve kaart kon niet starten omdat deze browser of omgeving geen WebGL ondersteunt. Open de app in een normale desktopbrowser met hardwareversnelling ingeschakeld.",

  "notFound.title": "404 Pagina niet gevonden",
  "notFound.desc": "Ben je vergeten de pagina aan de router toe te voegen?",

  "toast.favRemoved.title": "Woonplaats verwijderd",
  "toast.favRemoved.desc": '"{name}" is niet langer je standaard start.',
  "toast.favSet.title": "Woonplaats ingesteld",
  "toast.favSet.desc": 'De kaart opent volgende keer bij "{name}".',
  "toast.favCleared.title": "Woonplaats gewist",
  "toast.favCleared.desc": "De kaart opent bij het standaardgebied.",
  "toast.routeSaved.title": "Route opgeslagen",
  "toast.routeSaved.desc": '"{name}" toegevoegd aan je opgeslagen routes.',
  "toast.routeRenamed.title": "Route hernoemd",
  "toast.routeRenamed.desc": 'Hernoemd naar "{name}".',
  "toast.renameFailed.title": "Hernoemen mislukt",
  "toast.renameFailed.desc": "Kon de route niet hernoemen.",
  "toast.routesImported.title": "Routes geïmporteerd",
  "toast.routesImported.descOne": "1 route van dit apparaat staat nu in je account.",
  "toast.routesImported.descMany": "{count} routes van dit apparaat staan nu in je account.",
  "toast.nothingToImport.title": "Niets te importeren",
  "toast.nothingToImport.desc": "Geen routes van dit apparaat gevonden.",
  "toast.importFailed.title": "Importeren mislukt",
  "toast.importFailed.desc": "Kon je routes niet importeren.",
  "toast.gpxImportFailed.title": "Kon dit bestand niet importeren",
  "toast.gpxImportFailed.desc": "Geen geldige trackpunten in dit bestand gevonden.",

  "error.noPath": "Kon geen verbindende route tussen deze knooppunten vinden.",
  "error.computeFailed": "Kon de route niet berekenen.",
  "error.openFailed": "Kon de opgeslagen route niet openen.",
};

const translations: Record<Lang, Record<TranslationKey, string>> = { en, nl };

export type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "nl" || stored === "en") return stored;
  } catch {
    // ignore storage access errors
  }
  return DEFAULT_LANG;
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage access errors
    }
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      let str = translations[lang][key] ?? en[key] ?? key;
      if (vars) {
        for (const name of Object.keys(vars)) {
          str = str.replace(new RegExp(`\\{${name}\\}`, "g"), String(vars[name]));
        }
      }
      return str;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
