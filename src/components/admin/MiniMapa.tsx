"use client";

import { MapContainer, TileLayer, Marker, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Workaround para ícones do Leaflet com Next bundler
const icon = L.icon({
  iconUrl: "data:image/svg+xml;base64," + btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24c0-8.84-7.16-16-16-16z" fill="#16a34a"/>
  <circle cx="16" cy="16" r="6" fill="white"/>
</svg>
`),
  iconSize: [32, 40],
  iconAnchor: [16, 40],
});

interface Props {
  lat: number;
  lng: number;
  accuracy?: number;
}

export default function MiniMapa({ lat, lng, accuracy }: Props) {
  return (
    <div className="h-64 rounded-xl overflow-hidden border border-cinza-borda">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={icon} />
        {accuracy && accuracy < 500 && (
          <Circle
            center={[lat, lng]}
            radius={accuracy}
            pathOptions={{ color: "#16a34a", fillColor: "#16a34a", fillOpacity: 0.15 }}
          />
        )}
      </MapContainer>
    </div>
  );
}
