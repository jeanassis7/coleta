"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDB } from "@/lib/db/dexie";
import { reabastecerHistoricoLocal } from "@/lib/motorista/historico";
import { formatBRL, formatLitros } from "@/lib/format";

/**
 * "Coletas dessa carga" — o que substitui o caderno.
 *
 * Antes esta lista mostrava só o dia (`criado_em >= início do dia`) E o
 * celular apagava a coleta 24h depois de sincronizar. Resultado: no dia
 * seguinte a tela estava zerada, e o motorista voltava a anotar no papel —
 * o controle da empresa virava decoração.
 *
 * Agora a fronteira é a CARGA. Enquanto features.carga não está ligada,
 * `cargaId` é null e a lista mostra tudo o que ele coletou; quando a carga
 * existir, ela zera sozinha na descarga, que é o comportamento certo.
 *
 * Lê sempre do IndexedDB (abre sem sinal). Quando há sinal, o
 * reabastecimento traz do banco o que faltar — celular novo, app
 * reinstalado, coleta apagada no painel.
 */
function formatDataCurta(ms: number): string {
  const d = new Date(ms);
  const hoje = new Date();
  const mesmoDia =
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear();
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (mesmoDia) return `Hoje ${hora}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hora}`;
}

export function ListaColetasCarga({
  motoristaId,
  cargaId,
}: {
  motoristaId: string;
  cargaId: string | null;
}) {
  const coletas = useLiveQuery(async () => {
    const db = getLocalDB();
    const todas = await db.coletas_locais
      .filter((c) => c.motorista_id === motoristaId)
      .toArray();
    const doEscopo = cargaId
      ? todas.filter((c) => c.carga_id === cargaId)
      : todas;
    return doEscopo.sort((a, b) => b.criado_em - a.criado_em);
  }, [motoristaId, cargaId]);

  // Silencioso de propósito: se falhar, a lista local continua valendo.
  useEffect(() => {
    reabastecerHistoricoLocal(motoristaId, cargaId).catch(() => {});
  }, [motoristaId, cargaId]);

  if (!coletas || coletas.length === 0) {
    return (
      <div className="text-center text-cinza-suave text-lg py-8">
        Nenhuma coleta ainda.
      </div>
    );
  }

  const totalLitros = coletas.reduce((s, c) => s + c.litros, 0);
  const totalPago = coletas.reduce((s, c) => s + c.valor_pago, 0);

  return (
    <div className="space-y-3">
      <div className="card bg-slate-50 flex items-center justify-around text-center">
        <div>
          <div className="text-sm text-cinza-suave">Óleo</div>
          <div className="text-2xl font-bold">{formatLitros(totalLitros)}</div>
        </div>
        <div className="w-px self-stretch bg-cinza-borda" />
        <div>
          <div className="text-sm text-cinza-suave">Pago</div>
          <div className="text-2xl font-bold text-verde">
            {formatBRL(totalPago)}
          </div>
        </div>
      </div>

      {coletas.map((c) => {
        const enviada = c.registro_subido && c.foto_subida;
        return (
          <div key={c.client_id} className="card">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{enviada ? "☁️" : "📱"}</span>
              <span className="text-lg font-semibold">
                {formatDataCurta(c.criado_em)}
              </span>
              <span className="text-lg">·</span>
              <span className="text-lg font-semibold">
                {formatLitros(c.litros)}
              </span>
            </div>
            <p className="text-base text-cinza-suave truncate">
              {c.local_nome} · {formatBRL(c.valor_pago)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
