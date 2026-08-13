"use client";

import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface PontoCarga {
  tipo: "coleta" | "despesa" | "abastecimento" | "descarga";
  ordem: number;
  latitude: number;
  longitude: number;
  titulo: string;
  detalhe: string;
  quando: string;
}

const CORES: Record<PontoCarga["tipo"], string> = {
  coleta: "#16a34a",
  abastecimento: "#1e293b",
  despesa: "#f59e0b",
  descarga: "#dc2626",
};

function pin(cor: string, numero: number) {
  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 32 40">
        <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24c0-8.84-7.16-16-16-16z" fill="${cor}"/>
        <circle cx="16" cy="16" r="9" fill="white"/>
        <text x="16" y="20" font-family="sans-serif" font-size="11" font-weight="700"
              text-anchor="middle" fill="${cor}">${numero}</text>
      </svg>`,
    className: "",
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -38],
  });
}

/**
 * Trajeto da carga: cada parada numerada em ordem cronológica, ligadas por
 * linha reta (ponto A → B → C).
 *
 * ATENÇÃO: a linha é RETA entre os pontos, não o caminho real das ruas.
 * Traçar a rota de verdade exigiria um serviço de roteamento (OSRM está
 * no backlog). Pra ver se o trajeto faz sentido, a reta já resolve.
 */
export default function MapaCarga({ pontos }: { pontos: PontoCarga[] }) {
  if (pontos.length === 0) return null;

  const lats = pontos.map((p) => p.latitude);
  const lngs = pontos.map((p) => p.longitude);
  const centro: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];
  const linha: [number, number][] = pontos.map((p) => [p.latitude, p.longitude]);

  // Zoom grosseiro pela extensão da área (evita depender de fitBounds)
  const span = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lngs) - Math.min(...lngs)
  );
  const zoom = span > 1 ? 8 : span > 0.3 ? 10 : span > 0.1 ? 11 : span > 0.02 ? 13 : 15;

  return (
    <div className="h-[420px] rounded-xl overflow-hidden border border-cinza-borda">
      <MapContainer
        center={centro}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {linha.length > 1 && (
          <Polyline
            positions={linha}
            pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.6, dashArray: "6 6" }}
          />
        )}
        {pontos.map((p) => (
          <Marker
            key={`${p.tipo}-${p.ordem}`}
            position={[p.latitude, p.longitude]}
            icon={pin(CORES[p.tipo], p.ordem)}
          >
            <Popup>
              <div className="text-sm">
                <strong>
                  {p.ordem}. {p.titulo}
                </strong>
                <br />
                {p.detalhe}
                <br />
                <span className="text-slate-500">{p.quando}</span>
                <br />
                <a
                  href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir no Google Maps →
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
