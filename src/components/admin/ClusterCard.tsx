"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";
import type { ClusterCuradoria } from "@/lib/admin/curadoria";
import type { LocalComStats } from "@/lib/types";

interface Props {
  cluster: ClusterCuradoria;
  locaisExistentes: LocalComStats[];
}

export function ClusterCard({ cluster, locaisExistentes }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modoVincular, setModoVincular] = useState(false);
  const [nomeCanonico, setNomeCanonico] = useState(cluster.nome_sugerido);
  const [raio, setRaio] = useState(50);
  const [notas, setNotas] = useState("");
  const [localExistenteId, setLocalExistenteId] = useState("");
  const [salvando, setSalvando] = useState(false);

  const temGps = cluster.latitude !== 0 || cluster.longitude !== 0;

  async function criarECurar() {
    if (!temGps) {
      alert("Esse cluster não tem GPS — vincule manualmente a um local existente.");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/locais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_canonico: nomeCanonico,
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          raio_match_m: raio,
          apelidos: cluster.nomes_distintos.filter((n) => n !== nomeCanonico),
          notas_internas: notas || null,
          coleta_ids: cluster.coletas.map((c) => c.id),
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        alert("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setSalvando(false);
    }
  }

  async function vincularExistente() {
    if (!localExistenteId) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/locais/${localExistenteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coleta_ids: cluster.coletas.map((c) => c.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card">
      <button
        onClick={() => setAberto(!aberto)}
        className="w-full text-left"
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg">
              {cluster.nome_sugerido}
              <span className="ml-2 text-cinza-suave text-base">
                ({cluster.coletas.length} {cluster.coletas.length === 1 ? "coleta" : "coletas"})
              </span>
            </p>
            <p className="text-sm text-cinza-suave mt-1">
              {cluster.nomes_distintos.length > 1
                ? `${cluster.nomes_distintos.length} grafias diferentes`
                : "1 grafia"}{" "}
              · {cluster.motoristas.join(", ")}
            </p>
            <p className="text-sm text-cinza-suave">
              {formatLitros(cluster.total_litros)} · {formatBRL(Math.round(cluster.total_pago))}
              {temGps && (
                <>
                  {" "}· 📍 {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
                </>
              )}
              {!temGps && " · 📍 sem GPS"}
            </p>
          </div>
          <span className="text-cinza-suave">{aberto ? "▼" : "▶"}</span>
        </div>
      </button>

      {aberto && (
        <div className="mt-4 space-y-4 border-t border-cinza-borda pt-4">
          {/* Lista de coletas */}
          <div>
            <p className="text-sm font-semibold mb-2">Coletas do cluster:</p>
            <div className="space-y-1 max-h-40 overflow-y-auto text-sm">
              {cluster.coletas.map((c) => (
                <div
                  key={c.id}
                  className="flex justify-between bg-slate-50 rounded p-2"
                >
                  <span>
                    <span className="text-cinza-suave">
                      {formatDataHora(c.criado_em)}
                    </span>{" "}
                    · "{c.local_nome}" · {c.profiles?.nome}
                  </span>
                  <span className="text-cinza-suave">
                    {formatLitros(c.litros)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Toggle: criar novo OU vincular existente */}
          <div className="flex gap-2 border-b border-cinza-borda pb-2">
            <button
              onClick={() => setModoVincular(false)}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                !modoVincular
                  ? "bg-verde text-white"
                  : "bg-slate-100"
              }`}
            >
              Criar novo local
            </button>
            <button
              onClick={() => setModoVincular(true)}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                modoVincular
                  ? "bg-verde text-white"
                  : "bg-slate-100"
              }`}
            >
              Vincular a existente
            </button>
          </div>

          {!modoVincular ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nome oficial
                </label>
                <input
                  type="text"
                  value={nomeCanonico}
                  onChange={(e) => setNomeCanonico(e.target.value)}
                  className="input-grande text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Raio de match (m)
                </label>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={raio}
                  onChange={(e) => setRaio(parseInt(e.target.value || "50", 10))}
                  className="input-grande text-base"
                />
                <p className="text-xs text-cinza-suave mt-1">
                  Distância máxima pra novas coletas serem sugeridas como esse local.
                  Padrão 50m. Use 30m em centros urbanos densos, 100m em áreas rurais soltas.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Notas internas (opcional)
                </label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  className="input-grande text-base min-h-[80px] resize-none"
                  rows={3}
                  placeholder="Tel, dono, horários, etc..."
                />
              </div>
              <button
                onClick={criarECurar}
                disabled={salvando || !temGps || !nomeCanonico.trim()}
                className="w-full px-4 py-2 bg-verde text-white rounded-xl font-semibold"
              >
                {salvando
                  ? "Criando..."
                  : `✓ Criar e vincular ${cluster.coletas.length} ${cluster.coletas.length === 1 ? "coleta" : "coletas"}`}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Local existente
                </label>
                <select
                  value={localExistenteId}
                  onChange={(e) => setLocalExistenteId(e.target.value)}
                  className="input-grande text-base"
                >
                  <option value="">— Escolha um local —</option>
                  {locaisExistentes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome_canonico} ({l.total_visitas} visitas)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={vincularExistente}
                disabled={salvando || !localExistenteId}
                className="w-full px-4 py-2 bg-verde text-white rounded-xl font-semibold"
              >
                {salvando ? "Vinculando..." : `✓ Vincular ao local escolhido`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
