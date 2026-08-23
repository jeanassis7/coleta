"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";
import { DrawerDetalhe } from "@/components/admin/DrawerDetalhe";
import { ModalInputTexto } from "@/components/admin/Modais";

interface Coleta {
  id: string;
  client_id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  valor_pago: number;
  certificado_tipo: string;
  litros_certificado: number | null;
  observacao: string | null;
  pago_pela_sede?: boolean;
  valor_sede?: number;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  foto_path: string | null;
  criado_em: string;
  sincronizado_em: string | null;
  profiles: { nome: string } | null;
}

export function ListaColetas({ coletas }: { coletas: Coleta[] }) {
  const router = useRouter();
  const [selecionada, setSelecionada] = useState<Coleta | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [apagando, setApagando] = useState(false);
  const [modalApagar, setModalApagar] = useState(false);
  const [resultadoApagar, setResultadoApagar] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // Alerta do dashboard aponta pra UMA coleta (?coleta=<id>)
  // ---------------------------------------------------------------------
  // O alerta diz "vale corrigir" e o link mandava pra lista inteira: o
  // gestor lia o texto, clicava, e tinha que caçar a linha na mão — sendo
  // que o alerta já sabe exatamente qual é. Com o id na URL a gaveta abre
  // sozinha, JÁ no formulário de edição.
  //
  // O guard `abriuFoco` é o que impede a gaveta de renascer sozinha depois
  // que ele fecha (o parâmetro continua na URL enquanto ele mexe nos
  // filtros, porque o Filtros preserva tudo que já estava lá).
  const pathname = usePathname();
  const params = useSearchParams();
  const focoId = params.get("coleta");
  const [abriuFoco, setAbriuFoco] = useState<string | null>(null);
  const [abrirEditando, setAbrirEditando] = useState(false);
  const focoForaDaLista =
    !!focoId && !coletas.some((c) => c.id === focoId);

  useEffect(() => {
    if (!focoId || abriuFoco === focoId) return;
    setAbriuFoco(focoId);
    const alvo = coletas.find((c) => c.id === focoId);
    if (!alvo) return;
    setSelecionada(alvo);
    setAbrirEditando(true);
  }, [focoId, coletas, abriuFoco]);

  function fecharDrawer() {
    setSelecionada(null);
    setAbrirEditando(false);
    // Tira o ?coleta= da URL — senão ele viaja junto em cada troca de
    // filtro e o link fica com cara de "essa coleta está selecionada".
    if (focoId) {
      const p = new URLSearchParams(params);
      p.delete("coleta");
      router.replace(p.toString() ? `${pathname}?${p}` : pathname, {
        scroll: false,
      });
    }
  }

  if (coletas.length === 0) {
    return (
      <div className="card text-center text-cinza-suave py-12">
        Nenhuma coleta no período.
      </div>
    );
  }

  function toggleMarcada(id: string) {
    const nova = new Set(marcadas);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    setMarcadas(nova);
  }

  function toggleTodas() {
    if (marcadas.size === coletas.length) {
      setMarcadas(new Set());
    } else {
      setMarcadas(new Set(coletas.map((c) => c.id)));
    }
  }

  async function apagarMarcadas() {
    if (marcadas.size === 0) return;
    setApagando(true);
    try {
      const res = await fetch("/api/admin/coletas/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(marcadas) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResultadoApagar("Erro: " + data.error);
      } else {
        setResultadoApagar(
          `${data.apagadas} coleta(s) apagadas${data.fotos_apagadas > 0 ? ` (${data.fotos_apagadas} fotos)` : ""}.${data.aviso ? ` ${data.aviso}.` : ""}`
        );
        setMarcadas(new Set());
        router.refresh();
      }
    } finally {
      setApagando(false);
      setModalApagar(false);
      setTimeout(() => setResultadoApagar(null), 8000);
    }
  }

  const todasMarcadas = marcadas.size === coletas.length;

  return (
    <>
      {/* Barra de bulk action */}
      <div className="card mb-3 flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={toggleTodas}
            className="w-5 h-5"
          />
          <span className="text-sm">
            {marcadas.size === 0
              ? "Selecionar todas"
              : `${marcadas.size} de ${coletas.length} selecionadas`}
          </span>
        </label>
        {marcadas.size > 0 && (
          <button
            onClick={() => setModalApagar(true)}
            disabled={apagando}
            className="px-4 py-2 bg-alerta text-white rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50"
          >
            {apagando
              ? "Apagando..."
              : `🗑 Apagar ${marcadas.size} ${marcadas.size === 1 ? "coleta" : "coletas"}`}
          </button>
        )}
      </div>

      {focoForaDaLista && (
        <div className="card mb-3 bg-amber-50 border border-amber-300 text-sm">
          A coleta do alerta não está nesta lista — provavelmente o filtro de
          período ou de motorista foi trocado depois. Volte ao dashboard e
          clique no link do alerta de novo.
        </div>
      )}

      {resultadoApagar && (
        <div className="card mb-3 bg-slate-50 text-sm text-cinza-texto">
          {resultadoApagar}
        </div>
      )}

      {modalApagar && (
        <ModalInputTexto
          titulo={`Apagar ${marcadas.size} ${marcadas.size === 1 ? "coleta" : "coletas"}?`}
          descricao="Apaga permanentemente, incluindo fotos. Digite APAGAR pra confirmar."
          placeholder="APAGAR"
          confirmarLabel="Apagar de vez"
          perigo
          carregando={apagando}
          validar={(v) =>
            v.trim() === "APAGAR" ? null : "Digite exatamente APAGAR pra confirmar"
          }
          onConfirmar={() => apagarMarcadas()}
          onFechar={() => setModalApagar(false)}
        />
      )}

      <div className="space-y-2">
        {coletas.map((c) => {
          const custoLitro = c.litros > 0 ? c.valor_pago / c.litros : 0;
          const marcada = marcadas.has(c.id);
          return (
            <div
              key={c.id}
              className={`card flex gap-3 items-start ${
                marcada ? "border-alerta bg-alerta/5" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={marcada}
                onChange={() => toggleMarcada(c.id)}
                className="w-5 h-5 mt-1 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setSelecionada(c)}
                className="flex-1 min-w-0 text-left hover:bg-slate-50 -m-2 p-2 rounded transition-colors"
              >
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">
                      {formatDataHora(c.criado_em)} · {c.profiles?.nome || "—"} · {c.local_nome}
                    </p>
                    <p className="text-base text-cinza-suave">
                      {formatLitros(c.litros)} · {formatBRL(c.valor_pago)} · R$ {custoLitro.toFixed(2).replace(".", ",")}/L
                      {c.pago_pela_sede &&
                        (() => {
                          // Parcial (0058) precisa se distinguir do total na
                          // lista: são situações de dinheiro diferentes e o
                          // mesmo selo pras duas escondia isso.
                          const sede = c.valor_sede ?? c.valor_pago;
                          const parcial = sede < c.valor_pago;
                          return (
                            <span
                              className="ml-2 inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium align-middle"
                              title={
                                parcial
                                  ? `A sede pagou ${formatBRL(sede)} direto ao fornecedor; ${formatBRL(c.valor_pago - sede)} saiu do bolso do motorista.`
                                  : "O escritório paga o fornecedor direto — não desconta do saldo do motorista."
                              }
                            >
                              🏢 sede{parcial ? ` ${formatBRL(sede)}` : ""}
                            </span>
                          );
                        })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-base shrink-0">
                    {c.gps_capturado ? (
                      <span title={`±${Math.round(c.gps_accuracy || 0)}m`}>📍</span>
                    ) : (
                      <span className="text-cinza-suave" title="Sem GPS">📍❌</span>
                    )}
                    {c.foto_path ? <span>📷</span> : null}
                    {c.certificado_tipo !== "nao" ? (
                      <span title={c.certificado_tipo}>📄</span>
                    ) : null}
                    {c.observacao ? <span title="Tem observação">💬</span> : null}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {selecionada && (
        <DrawerDetalhe
          // key: força remontar ao trocar de coleta — sem isso o estado
          // interno (inclusive "já abre editando") ficaria o da anterior.
          key={selecionada.id}
          coleta={selecionada}
          abrirEditando={abrirEditando}
          onClose={fecharDrawer}
        />
      )}
    </>
  );
}
