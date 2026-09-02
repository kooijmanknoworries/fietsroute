export interface HolidayPark {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  zoom: number;
}

/**
 * Curated list of popular holiday parks in the Netherlands.
 * Includes Landal GreenParks, Center Parcs, Airstop, and other well-known parks.
 */
export const holidayParks: HolidayPark[] = [
  // Landal GreenParks
  { id: "landal-hogeveluwe", name: "Landal GreenParks De Hoge Veluwe", displayName: "Otterlo", lat: 52.0667, lon: 5.8833, zoom: 14 },
  { id: "landal-ter-nederen", name: "Landal GreenParks Ter Nederen", displayName: "Nijverdal", lat: 52.2780, lon: 6.9230, zoom: 14 },
  { id: "landal-de-groote", name: "Landal GreenParks De Groote", displayName: "Slochteren", lat: 53.0100, lon: 6.5200, zoom: 14 },
  { id: "landal-de-haam", name: "Landal GreenParks De Haam", displayName: "Haamstede", lat: 51.5400, lon: 4.2400, zoom: 14 },
  { id: "landal-de-boshoek", name: "Landal GreenParks De Boshoek", displayName: "Beverwijk", lat: 52.4800, lon: 4.6500, zoom: 14 },
  { id: "landal-landal-ter-meer", name: "Landal GreenParks Ter Meer", displayName: "Berkelland", lat: 52.2500, lon: 6.8500, zoom: 14 },
  { id: "landal-de-linde", name: "Landal GreenParks De Linde", displayName: "Gieten", lat: 52.9700, lon: 6.8300, zoom: 14 },
  { id: "landal-de-ravestein", name: "Landal GreenParks De Ravestein", displayName: "Maasbree", lat: 51.1200, lon: 6.1100, zoom: 14 },
  { id: "landal-het-holt", name: "Landal GreenParks Het Holt", displayName: "Vught", lat: 51.5700, lon: 5.3500, zoom: 14 },
  { id: "landal-de-kamp", name: "Landal GreenParks De Kamp", displayName: "Norg", lat: 52.9000, lon: 6.6200, zoom: 14 },
  { id: "landal-de-waldhoeve", name: "Landal GreenParks De Waldhoeve", displayName: "Epe", lat: 52.2000, lon: 6.0500, zoom: 14 },
  { id: "landal-de-vijf-meer", name: "Landal GreenParks De Vijf Meer", displayName: "Goor", lat: 52.5200, lon: 6.9200, zoom: 14 },
  { id: "landal-de-zeepolder", name: "Landal GreenParks De Zeepolder", displayName: "IJsselmuiden", lat: 52.3200, lon: 6.1200, zoom: 14 },
  { id: "landal-de-woudforst", name: "Landal GreenParks De Woudforst", displayName: "Beuningen", lat: 51.8000, lon: 5.7800, zoom: 14 },
  { id: "landal-de-schans", name: "Landal GreenParks De Schans", displayName: "Lunteren", lat: 52.1300, lon: 5.8700, zoom: 14 },
  { id: "landal-de-hofstee", name: "Landal GreenParks De Hofstee", displayName: "Nes aan de Amstel", lat: 52.3700, lon: 4.6800, zoom: 14 },
  { id: "landal-de-wetering", name: "Landal GreenParks De Wetering", displayName: "Houwerzijl", lat: 53.2500, lon: 6.2500, zoom: 14 },
  { id: "landal-de-heuvelrug", name: "Landal GreenParks De Heuvelrug", displayName: "Houten", lat: 51.9300, lon: 5.3300, zoom: 14 },
  { id: "landal-de-broek", name: "Landal GreenParks De Broek", displayName: "Wolvega", lat: 53.0000, lon: 6.2200, zoom: 14 },
  { id: "landal-de-tolhoeve", name: "Landal GreenParks De Tolhoeve", displayName: "De Punt", lat: 52.3700, lon: 5.6200, zoom: 14 },
  { id: "landal-de-hoeven", name: "Landal GreenParks De Hoeven", displayName: "Gorssel", lat: 52.1700, lon: 6.4700, zoom: 14 },
  { id: "landal-de-kruin", name: "Landal GreenParks De Kruin", displayName: "Ede", lat: 51.9500, lon: 5.6500, zoom: 14 },
  { id: "landal-de-haamslager", name: "Landal GreenParks De Haamslager", displayName: "Haamstede", lat: 51.5350, lon: 4.2350, zoom: 14 },
  { id: "landal-de-houtwijk", name: "Landal GreenParks De Houtwijk", displayName: "Lauwersoog", lat: 53.4400, lon: 6.4700, zoom: 14 },
  { id: "landal-beekbergen", name: "Landal GreenParks Beekbergen", displayName: "Beekbergen", lat: 52.3667, lon: 6.0667, zoom: 14 },
  { id: "landal-heideheuvel", name: "Landal GreenParks De Heideheuvel", displayName: "Beekbergen (Hoge Bergweg)", lat: 52.1403, lon: 6.0019, zoom: 15 },

  // Center Parcs
  { id: "center-parcs-velsemeersen", name: "Center Parcs Veluwezoom", displayName: "Otterlo", lat: 52.0500, lon: 5.9000, zoom: 14 },
  { id: "center-parcs-langrad", name: "Center Parcs Langrad", displayName: "Beuningen", lat: 51.8100, lon: 5.7700, zoom: 14 },
  { id: "center-parcs-limburg", name: "Center Parcs De Meinweg", displayName: "Maasbree", lat: 51.1100, lon: 6.1000, zoom: 14 },
  { id: "center-parcs-norburg", name: "Center Parcs Norburg", displayName: "Norg", lat: 52.9100, lon: 6.6300, zoom: 14 },
  { id: "center-parcs-eifel", name: "Center Parcs Eifel", displayName: "Duitsland (bij Grens)", lat: 50.5200, lon: 6.4500, zoom: 14 },
  { id: "center-parcs-tourtenhout", name: "Center Parcs Tourtenhout", displayName: "Mheer", lat: 50.8300, lon: 5.9500, zoom: 14 },
  { id: "center-parcs-beekbergen", name: "Center Parcs Beekbergen", displayName: "Beekbergen", lat: 52.3700, lon: 6.0700, zoom: 14 },

  // Airstop
  { id: "airstop-haamstede", name: "Airstop Haamstede", displayName: "Haamstede", lat: 51.5450, lon: 4.2450, zoom: 15 },
  { id: "airstop-haarlem", name: "Airstop Haarlem", displayName: "Haarlem", lat: 52.3800, lon: 4.6400, zoom: 15 },
  { id: "airstop-denhaag", name: "Airstop Den Haag", displayName: "Den Haag", lat: 52.0700, lon: 4.3000, zoom: 15 },

  // Kamping & Recreatieparken
  { id: "de-linde-van-den-berg", name: "Landal De Linde van den Berg", displayName: "Hapert", lat: 51.7000, lon: 5.5300, zoom: 14 },
  { id: "parcs-centraal-park", name: "Center Parcs De Boschpoort", displayName: "Geldersch", lat: 51.2100, lon: 6.2100, zoom: 14 },
];

export function searchHolidayParks(query: string): HolidayPark[] {
  const q = query.toLowerCase().trim();
  if (q.length < 1) return [];
  return holidayParks.filter(
    (park) =>
      park.name.toLowerCase().includes(q) ||
      park.displayName.toLowerCase().includes(q),
  );
}
