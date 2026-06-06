"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ListaColetas } from "@/components/admin/ListaColetas";
import { BotaoExportCsv } from "@/components/admin/BotaoExportCsv";

const MapaColetas = dynamic(() => import("@/components/admin/MapaColetas"), {
  ssr: false,
  loading: () => (
    <div className="card text-center text-cinza-suave py-12">
      Carregando mapa...
    </div>
  ),
});

export function AbasView({ coletas }: { coletas: any[] }) {
  const [aba, setAba] = useState<"lista" | "mapa">("lista");

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setAba("lista")}
            className={`px-4 py-2 rounded-xl text-base font-medium transition-colors ${
              aba === "lista"
                ? "bg-verde text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            Lista ({coletas.length})
          </button>
          <button
            onClick={() => setAba("mapa")}
            className={`px-4 py-2 rounded-xl text-base font-medium transition-colors ${
              aba === "mapa"
                ? "bg-verde text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            Mapa
          </button>
        </div>
        <BotaoExportCsv coletas={coletas} />
      </div>

      {aba === "lista" ? (
        <ListaColetas coletas={coletas} />
      ) : (
        <MapaColetas coletas={coletas} />
      )}
    </div>
  );
}
