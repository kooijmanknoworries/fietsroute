export interface Region {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  zoom: number;
}

export const REGIONS: Region[] = [
  { id: "amsterdam", name: "Amsterdam", country: "NL", lat: 52.3676, lon: 4.9041, zoom: 12 },
  { id: "utrecht", name: "Utrecht", country: "NL", lat: 52.0907, lon: 5.1214, zoom: 12 },
  { id: "rotterdam", name: "Rotterdam", country: "NL", lat: 51.9244, lon: 4.4777, zoom: 12 },
  { id: "den-haag", name: "Den Haag", country: "NL", lat: 52.0705, lon: 4.3007, zoom: 12 },
  { id: "eindhoven", name: "Eindhoven", country: "NL", lat: 51.4416, lon: 5.4697, zoom: 12 },
  { id: "groningen", name: "Groningen", country: "NL", lat: 53.2194, lon: 6.5665, zoom: 12 },
  { id: "maastricht", name: "Maastricht", country: "NL", lat: 50.8514, lon: 5.691, zoom: 12 },
  { id: "nijmegen", name: "Nijmegen", country: "NL", lat: 51.8126, lon: 5.8372, zoom: 12 },
  { id: "zwolle", name: "Zwolle", country: "NL", lat: 52.5168, lon: 6.083, zoom: 12 },
  { id: "leeuwarden", name: "Leeuwarden", country: "NL", lat: 53.2012, lon: 5.7999, zoom: 12 },
  { id: "antwerpen", name: "Antwerpen", country: "BE", lat: 51.2194, lon: 4.4025, zoom: 12 },
  { id: "gent", name: "Gent", country: "BE", lat: 51.0543, lon: 3.7174, zoom: 12 },
  { id: "brugge", name: "Brugge", country: "BE", lat: 51.2093, lon: 3.2247, zoom: 12 },
  { id: "leuven", name: "Leuven", country: "BE", lat: 50.8798, lon: 4.7005, zoom: 12 },
  { id: "hasselt", name: "Hasselt", country: "BE", lat: 50.9307, lon: 5.3377, zoom: 12 },
];
