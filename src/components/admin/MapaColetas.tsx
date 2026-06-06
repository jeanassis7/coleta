"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";

const CORES = ["#16a34a", "#2563eb", "#f59e0b", "#dc2626", "#7c3aed"];

function iconePin(cor: string) {
  return L.icon({
    iconUrl:
      "data:image/svg+xml;base64," +
      btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 32 40">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24c0-8.84-7.16-16-16-16z" fill="${cor}"/>
  <circle cx="16" cy="16" r="6" fill="white"/>
</svg>
`),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

interface ColetaMapa {
  id: string;
  motorista_id: string;
  local_nome: string;
  litros: number;
  valor_pago: number;
  latitude: number | null;
  longitude: number | null;
  criado_em: string;
  profiles: { nome: string } | null;
}

export default function MapaColetas({ coletas }: { coletas: ColetaMapa[] }) {
  const comGps = coletas.filter((c) => c.latitude && c.longitude);
  const semGps = coletas.length - comGps.length;

  if (comGps.length === 0) {
    return (
      <div className="card text-center text-cinza-suave py-12">
        Nenhuma coleta com GPS no período.
        {semGps > 0 && (
          <p className="text-sm mt-2">
            ({semGps} sem coordenadas — veja a aba Lista)
          </p>
        )}
      </div>
    );
  }

  // Mapeia motoristas pra cores
  const motoristas = Array.from(new Set(comGps.map((c) => c.motorista_id)));
  const corPorMotorista = new Map<string, string>();
  motoristas.forEach((id, i) => corPorMotorista.set(id, CORES[i % CORES.length]));

  // Calcula bounds
  const lats = comGps.map((c) => c.latitude!);
  const lngs = comGps.map((c) => c.longitude!);
  const centro: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        {Array.from(corPorMotorista.entries()).map(([id, cor]) => {
          const m = comGps.find((c) => c.motorista_id === id);
          return (
            <div key={id} className="flex items-center gap-1">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: cor }}
              />
              <span>{m?.profiles?.nome || "—"}</span>
            </div>
          );
        })}
        {semGps > 0 && (
          <span className="text-cinza-suave">
            ({semGps} coletas sem GPS)
          </span>
        )}
      </div>
      <div className="h-[600px] rounded-xl overflow-hidden border border-cinza-borda">
        <MapContainer
          center={centro}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {comGps.map((c) => (
            <Marker
              key={c.id}
              position={[c.latitude!, c.longitude!]}
              icon={iconePin(corPorMotorista.get(c.motorista_id)!)}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{c.local_nome}</p>
                  <p>{c.profiles?.nome}</p>
                  <p>{formatDataHora(c.criado_em)}</p>
                  <p>
                    {formatLitros(c.litros)} · {formatBRL(c.valor_pago)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
