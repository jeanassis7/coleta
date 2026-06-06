"use client";

import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatBRL, formatLitros, formatDataHora } from "@/lib/format";

const CORES_MOTORISTAS = ["#16a34a", "#2563eb", "#f59e0b", "#dc2626", "#7c3aed"];
const COR_LOCAL_CURADO = "#16a34a";

/**
 * Pin com badge de contagem (quando frequência > 1) ou cor por motorista.
 */
function iconePin(cor: string, badge?: number) {
  const badgeHtml = badge && badge > 1 ? `
    <circle cx="26" cy="6" r="9" fill="white" stroke="${cor}" stroke-width="2"/>
    <text x="26" y="9.5" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle" fill="${cor}">${badge > 99 ? "99+" : badge}</text>
  ` : "";

  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
        <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24c0-8.84-7.16-16-16-16z" fill="${cor}"/>
        <circle cx="16" cy="16" r="6" fill="white"/>
        ${badgeHtml}
      </svg>`,
    className: "",
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

interface LocalAgregado {
  tipo: "local";
  local_id: string;
  nome_canonico: string;
  latitude: number;
  longitude: number;
  visitas: number;
  total_litros: number;
  total_pago: number;
  ultima_visita: string | null;
  motoristas_lista: { nome: string; visitas: number }[];
}

interface ColetaIndividual {
  tipo: "coleta";
  coleta_id: string;
  local_nome: string;
  motorista_id: string;
  motorista_nome: string;
  latitude: number;
  longitude: number;
  litros: number;
  valor_pago: number;
  criado_em: string;
}

type PontoMapa = LocalAgregado | ColetaIndividual;

interface Props {
  pontos: PontoMapa[];
  motoristasUnicos: { id: string; nome: string }[];
}

export default function MapaAgregado({ pontos, motoristasUnicos }: Props) {
  if (pontos.length === 0) {
    return (
      <div className="card text-center text-cinza-suave py-12">
        Nenhum dado com GPS no período. Mude o filtro ou aguarde os motoristas
        registrarem coletas com localização.
      </div>
    );
  }

  // Cor por motorista (pra pins individuais)
  const corPorMotorista = new Map<string, string>();
  motoristasUnicos.forEach((m, i) => {
    corPorMotorista.set(m.id, CORES_MOTORISTAS[i % CORES_MOTORISTAS.length]);
  });

  // Centraliza no centro das coordenadas
  const lats = pontos.map((p) => p.latitude);
  const lngs = pontos.map((p) => p.longitude);
  const centro: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm card py-3">
        <div className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: COR_LOCAL_CURADO }}
          />
          <span>Local cadastrado (com badge de visitas)</span>
        </div>
        {motoristasUnicos.map((m) => (
          <div key={m.id} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: corPorMotorista.get(m.id) }}
            />
            <span>{m.nome} (coleta solta)</span>
          </div>
        ))}
      </div>

      <div className="h-[700px] rounded-xl overflow-hidden border border-cinza-borda">
        <MapContainer
          center={centro}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {pontos.map((p) => {
            if (p.tipo === "local") {
              return (
                <Marker
                  key={`local-${p.local_id}`}
                  position={[p.latitude, p.longitude]}
                  icon={iconePin(COR_LOCAL_CURADO, p.visitas)}
                >
                  <Tooltip direction="top" offset={[0, -40]} permanent={false}>
                    <strong>{p.nome_canonico}</strong> · {p.visitas}{" "}
                    {p.visitas === 1 ? "visita" : "visitas"} ·{" "}
                    {formatLitros(p.total_litros)}
                  </Tooltip>
                  <Popup>
                    <div className="text-sm space-y-1">
                      <p className="font-bold text-base">{p.nome_canonico}</p>
                      <p>
                        <strong>{p.visitas}</strong> {p.visitas === 1 ? "visita" : "visitas"}{" "}
                        · {formatLitros(p.total_litros)} ·{" "}
                        {formatBRL(Math.round(p.total_pago))}
                      </p>
                      {p.ultima_visita && (
                        <p className="text-xs">
                          Última: {formatDataHora(p.ultima_visita)}
                        </p>
                      )}
                      {p.motoristas_lista.length > 0 && (
                        <div className="pt-1 mt-1 border-t">
                          <p className="font-semibold text-xs mb-1">Por motorista:</p>
                          {p.motoristas_lista.map((m) => (
                            <p key={m.nome} className="text-xs">
                              {m.nome}: {m.visitas} {m.visitas === 1 ? "vis" : "vis"}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            }

            // Coleta individual sem local cadastrado
            return (
              <Marker
                key={`coleta-${p.coleta_id}`}
                position={[p.latitude, p.longitude]}
                icon={iconePin(corPorMotorista.get(p.motorista_id) || "#64748b")}
              >
                <Tooltip direction="top" offset={[0, -40]} permanent={false}>
                  {p.local_nome} · {p.motorista_nome}
                </Tooltip>
                <Popup>
                  <div className="text-sm space-y-1">
                    <p className="font-bold">{p.local_nome}</p>
                    <p>{p.motorista_nome}</p>
                    <p className="text-xs text-cinza-suave">
                      {formatDataHora(p.criado_em)}
                    </p>
                    <p>
                      {formatLitros(p.litros)} ·{" "}
                      {formatBRL(p.valor_pago)}
                    </p>
                    <p className="text-xs italic text-cinza-suave pt-1 border-t">
                      ⚠ não vinculado a local — curar em /admin/curadoria
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

export type { PontoMapa, LocalAgregado, ColetaIndividual };
