"use client";

import { useEffect, useState } from "react";
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
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * "Hoje 15/08 · 14:32" / "Ontem 14/08 · 09:10" / "Ter 12/08 · 16:05"
 *
 * A DATA aparece sempre — é ela que bate com a nota e com o caderno dele.
 * O nome ao lado é só o atalho de leitura.
 *
 * Escolhi DIA DA SEMANA em vez de "3 dias atrás" (ideia do Evaner) por dois
 * motivos: motorista lembra a rota por dia da semana ("segunda eu fui pra
 * Toledo"), e "3 dias atrás" obriga a fazer conta de cabeça pra chegar na
 * data quando ele precisa conferir com papel. Trocar é uma linha, se na
 * prática ele preferir o contrário.
 */
function formatDataCurta(ms: number, agora: number): string {
  const d = new Date(ms);
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const data = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  // Diferença em DIAS DE CALENDÁRIO, não em horas: 23h atrás pode ser
  // ontem e 25h atrás pode ser hoje, dependendo da hora da coleta.
  const meiaNoite = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round(
    (meiaNoite(new Date(agora)) - meiaNoite(d)) / 86400000
  );

  if (dias === 0) return `Hoje ${data} · ${hora}`;
  if (dias === 1) return `Ontem ${data} · ${hora}`;
  return `${DIAS_SEMANA[d.getDay()]} ${data} · ${hora}`;
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

  // O app fica aberto no celular dele por horas. Sem isso, uma coleta feita
  // 23h50 continuaria escrita "Hoje" na manhã seguinte — e "Hoje" errado
  // parece bug, não parece detalhe.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const atualizar = () => setAgora(Date.now());
    document.addEventListener("visibilitychange", atualizar);
    window.addEventListener("focus", atualizar);
    return () => {
      document.removeEventListener("visibilitychange", atualizar);
      window.removeEventListener("focus", atualizar);
    };
  }, []);

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
          // Números em cima (é o que ele confere), data e local embaixo em
          // texto menor — junto na mesma linha grande estouraria a largura
          // do celular e quebraria feio.
          <div key={c.client_id} className="card">
            <div className="flex items-center gap-2">
              <span className="text-xl">{enviada ? "☁️" : "📱"}</span>
              <span className="text-lg font-semibold">
                {formatLitros(c.litros)}
              </span>
              <span className="text-lg text-cinza-suave">·</span>
              <span className="text-lg font-semibold text-verde">
                {formatBRL(c.valor_pago)}
              </span>
            </div>
            <p className="text-sm text-cinza-suave mt-1">
              {formatDataCurta(c.criado_em, agora)}
            </p>
            <p className="text-base truncate">{c.local_nome}</p>
          </div>
        );
      })}
    </div>
  );
}
