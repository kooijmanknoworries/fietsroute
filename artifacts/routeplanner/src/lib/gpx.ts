export function exportGPX(coordinates: number[][], name: string = "Fietsroute") {
  const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fietsrouteplanner" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${coordinates.map(coord => `      <trkpt lat="${coord[1]}" lon="${coord[0]}"></trkpt>`).join("\n")}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/\s+/g, "_")}.gpx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseGPX(gpxString: string): number[][] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxString, "application/xml");
  
  const trkpts = doc.querySelectorAll("trkpt, rtept");
  const coords: number[][] = [];
  
  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute("lat") || "0");
    const lon = parseFloat(pt.getAttribute("lon") || "0");
    if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
      coords.push([lon, lat]);
    }
  });
  
  return coords;
}
