"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";
import type { ClusterCuradoria, ColetaSemLocal } from "@/lib/admin/curadoria";
import type { LocalComStats } from "@/lib/types";

interface Props {
  cluster: ClusterCuradoria;
  locaisExistentes: LocalComStats[];
}

// Raio fixo pra novos locais: 100m. Motorista vê como sugestão qualquer
// local a até 100m dele (aparece só o nome, sem distância).
const RAIO_MATCH_FIXO = 100;

/**
 * Calcula centro geográfico (lat/lng médio) de um grupo de coletas.
 * Retorna null se nenhuma tem GPS.
 */
function centroGeografico(coletas: ColetaSemLocal[]): { lat: number; lng: number } | null {
  const comGps = coletas.filter((c) => c.latitude !== null && c.longitude !== null);
  if (comGps.length === 0) return null;
  const lat = comGps.reduce((s, c) => s + (c.latitude || 0), 0) / comGps.length;
  const lng = comGps.reduce((s, c) => s + (c.longitude || 0), 0) / comGps.length;
  return { lat, lng };
}

export function ClusterCard({ cluster, locaisExistentes }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modoVincular, setModoVincular] = useState(false);

  // Modo 1 local (padrão)
  const [nomeCanonico, setNomeCanonico] = useState(cluster.nome_sugerido);
  const [notas, setNotas] = useState("");

  // Modo separar em 2 locais: quais coletas ficam no grupo "outro"?
  const [separadas, setSeparadas] = useState<Set<string>>(new Set());
  const [nomeGrupo1, setNomeGrupo1] = useState(cluster.nome_sugerido);
  const [nomeGrupo2, setNomeGrupo2] = useState("");

  const [localExistenteId, setLocalExistenteId] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Erro inline no card — alert() é proibido no projeto inteiro.
  const [erro, setErro] = useState<string | null>(null);

  const temGps = cluster.latitude !== 0 || cluster.longitude !== 0;

  const coletasGrupo1 = cluster.coletas.filter((c) => !separadas.has(c.id));
  const coletasGrupo2 = cluster.coletas.filter((c) => separadas.has(c.id));
  const modoSeparado =
    separadas.size > 0 && separadas.size < cluster.coletas.length;

  function toggleSeparar(coletaId: string) {
    const nova = new Set(separadas);
    if (nova.has(coletaId)) nova.delete(coletaId);
    else nova.add(coletaId);
    setSeparadas(nova);
  }

  async function criarLocalUnico() {
    setErro(null);
    if (!temGps) {
      setErro("Esse cluster não tem GPS — vincule manualmente a um local existente.");
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
          raio_match_m: RAIO_MATCH_FIXO,
          apelidos: cluster.nomes_distintos.filter((n) => n !== nomeCanonico),
          notas_internas: notas || null,
          coleta_ids: cluster.coletas.map((c) => c.id),
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setErro("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setSalvando(false);
    }
  }

  async function criarLocaisSeparados() {
    setErro(null);
    const c1 = centroGeografico(coletasGrupo1);
    const c2 = centroGeografico(coletasGrupo2);
    if (!c1 || !c2) {
      setErro(
        "Alguma das divisões não tem coleta com GPS. Não dá pra separar em 2 locais."
      );
      return;
    }
    if (!nomeGrupo1.trim() || !nomeGrupo2.trim()) {
      setErro("Preencha os dois nomes.");
      return;
    }
    setSalvando(true);
    try {
      // Cria local 1
      const nomesGrupo1 = Array.from(
        new Set(coletasGrupo1.map((c) => c.local_nome))
      );
      const res1 = await fetch("/api/admin/locais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_canonico: nomeGrupo1.trim(),
          latitude: c1.lat,
          longitude: c1.lng,
          raio_match_m: RAIO_MATCH_FIXO,
          apelidos: nomesGrupo1.filter((n) => n !== nomeGrupo1.trim()),
          coleta_ids: coletasGrupo1.map((c) => c.id),
        }),
      });
      const data1 = await res1.json();
      if (!res1.ok && res1.status !== 207) {
        setErro("Erro no local 1: " + data1.error);
        return;
      }

      // Cria local 2
      const nomesGrupo2 = Array.from(
        new Set(coletasGrupo2.map((c) => c.local_nome))
      );
      const res2 = await fetch("/api/admin/locais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_canonico: nomeGrupo2.trim(),
          latitude: c2.lat,
          longitude: c2.lng,
          raio_match_m: RAIO_MATCH_FIXO,
          apelidos: nomesGrupo2.filter((n) => n !== nomeGrupo2.trim()),
          coleta_ids: coletasGrupo2.map((c) => c.id),
        }),
      });
      const data2 = await res2.json();
      if (!res2.ok && res2.status !== 207) {
        setErro(
          "Local 1 criado, mas erro no local 2: " +
            data2.error +
            ". Refaça a curadoria."
        );
        return;
      }

      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function vincularExistente() {
    if (!localExistenteId) return;
    setErro(null);
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
        setErro("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card">
      <div
        onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAberto(!aberto);
          }
        }}
        role="button"
        tabIndex={0}
        className="cursor-pointer"
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
                  {" "}· 📍{" "}
                  <a
                    href={`https://www.google.com/maps?q=${cluster.latitude},${cluster.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-verde hover:underline font-medium"
                    title="Abrir no Google Maps"
                  >
                    {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
                  </a>
                </>
              )}
              {!temGps && " · 📍 sem GPS"}
            </p>
          </div>
          <span className="text-cinza-suave">{aberto ? "▼" : "▶"}</span>
        </div>
      </div>

      {aberto && (
        <div className="mt-4 space-y-4 border-t border-cinza-borda pt-4">
          {erro && (
            <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
              {erro}
            </div>
          )}
          {/* Lista de coletas com checkboxes pra separar em outro local */}
          <div>
            <p className="text-sm font-semibold mb-2">
              Coletas do cluster:{" "}
              <span className="text-cinza-suave font-normal">
                (marque as que são de outro local pra separar)
              </span>
            </p>
            <div className="space-y-1 max-h-56 overflow-y-auto text-sm">
              {cluster.coletas.map((c) => {
                const marcada = separadas.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 rounded p-2 cursor-pointer ${
                      marcada ? "bg-atencao/10" : "bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() => toggleSeparar(c.id)}
                      className="w-4 h-4"
                    />
                    <div className="flex-1 flex justify-between gap-2">
                      <span>
                        <span className="text-cinza-suave">
                          {formatDataHora(c.criado_em)}
                        </span>{" "}
                        · &quot;{c.local_nome}&quot; · {c.profiles?.nome}
                        {c.latitude !== null && c.longitude !== null && (
                          <>
                            {" "}·{" "}
                            <a
                              href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-verde hover:underline text-xs"
                            >
                              📍
                            </a>
                          </>
                        )}
                      </span>
                      <span className="text-cinza-suave shrink-0">
                        {formatLitros(c.litros)}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Modo separação ativa: 2 formulários lado a lado */}
          {modoSeparado ? (
            <div className="space-y-4">
              <div className="bg-atencao/10 border border-atencao rounded-xl p-3 text-sm">
                <strong>Modo separação:</strong> vão ser criados{" "}
                <strong>2 locais diferentes</strong> — um pras coletas não marcadas
                e outro pras marcadas.
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="border border-cinza-borda rounded-xl p-3 space-y-2">
                  <p className="text-sm font-semibold">
                    Local 1 ({coletasGrupo1.length}{" "}
                    {coletasGrupo1.length === 1 ? "coleta" : "coletas"})
                  </p>
                  <input
                    type="text"
                    value={nomeGrupo1}
                    onChange={(e) => setNomeGrupo1(e.target.value)}
                    placeholder="Nome oficial"
                    className="input-grande text-base"
                  />
                </div>
                <div className="border border-atencao rounded-xl p-3 space-y-2 bg-atencao/5">
                  <p className="text-sm font-semibold">
                    Local 2 ({coletasGrupo2.length}{" "}
                    {coletasGrupo2.length === 1 ? "coleta" : "coletas"})
                  </p>
                  <input
                    type="text"
                    value={nomeGrupo2}
                    onChange={(e) => setNomeGrupo2(e.target.value)}
                    placeholder="Nome oficial"
                    className="input-grande text-base"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={criarLocaisSeparados}
                  disabled={
                    salvando || !nomeGrupo1.trim() || !nomeGrupo2.trim()
                  }
                  className="flex-1 px-4 py-2 bg-verde text-white rounded-xl font-semibold"
                >
                  {salvando ? "Criando..." : "✓ Criar 2 locais separados"}
                </button>
                <button
                  onClick={() => setSeparadas(new Set())}
                  className="px-4 py-2 bg-slate-100 rounded-xl text-sm"
                >
                  Cancelar separação
                </button>
              </div>
            </div>
          ) : (
            <>
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
                    onClick={criarLocalUnico}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
