"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { selectTudo } from "@/lib/supabase/select-tudo";
import { formatBRL, formatDataHora } from "@/lib/format";

interface Dados {
  ultimo_recebido: {
    valor: number;
    data_envio: string;
    forma_pagamento: string;
  } | null;
  gasto_coletas: number;
  gasto_despesas: number;
  gasto_abast: number;
  saldo: number;
}

const CACHE_KEY = "coleta_saldo_cache_";

export function CardSaldo({ motoristaId }: { motoristaId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  // true = número veio do cache (sem sinal agora)
  const [offline, setOffline] = useState(false);
  const [desdeQuando, setDesdeQuando] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
      const supabase = getSupabaseBrowser();
      try {
        // Último acerto pra saber corte
        const { data: acerto } = await supabase
          .from("acertos")
          .select("corte_em, valor_saldo")
          .eq("motorista_id", motoristaId)
          .order("corte_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        const corte = acerto?.corte_em || "1970-01-01T00:00:00Z";

        // O NÚMERO GRANDE vem da fórmula oficial do servidor (meu_saldo →
        // saldos_motoristas, migration 0033). O card já recalculou isso na
        // mão uma vez e esqueceu duas exceções — painel e celular mostravam
        // saldos diferentes. Uma fórmula só, pra sempre.
        const [
          { data: saldoRpc, error: eSaldo },
          { data: coletas },
          { data: despesas },
          { data: abast },
          { data: ultimo },
        ] = await Promise.all([
          supabase.rpc("meu_saldo"),
          // As linhas de detalhe seguem a mesma regra do saldo: só o que
          // saiu DA MÃO DELE (coleta paga pela sede e nota assinada ficam
          // fora — o dinheiro não era dele).
          //
          // PAGINADAS (selectTudo): motorista que nunca teve acerto lê o
          // histórico INTEIRO — truncado em 1000, o detalhe não fecharia
          // com o número grande da RPC, na tela dele.
          // Desde a 0058 a sede pode ter bancado SÓ UMA PARTE: filtrar por
          // "não é da sede" jogaria fora a coleta inteira e o detalhe deixaria
          // de fechar com o número grande da RPC.
          selectTudo<{ valor_pago: number; valor_sede: number }>((de, ate) =>
            supabase
              .from("coletas")
              .select("valor_pago, valor_sede")
              .eq("motorista_id", motoristaId)
              .gt("criado_em", corte)
              .order("id")
              .range(de, ate)
          ).then((rows) => ({ data: rows, error: null })),
          selectTudo<{ valor: number }>((de, ate) =>
            supabase
              .from("despesas")
              .select("valor")
              .eq("motorista_id", motoristaId)
              .eq("pago_na_hora", true)
              .gt("criado_em", corte)
              .order("id")
              .range(de, ate)
          ).then((rows) => ({ data: rows, error: null })),
          selectTudo<{ valor: number }>((de, ate) =>
            supabase
              .from("abastecimentos")
              .select("valor")
              .eq("motorista_id", motoristaId)
              .eq("pago_na_hora", true)
              .gt("criado_em", corte)
              .order("id")
              .range(de, ate)
          ).then((rows) => ({ data: rows, error: null })),
          supabase
            .from("adiantamentos")
            .select("valor, data_envio, forma_pagamento")
            .eq("motorista_id", motoristaId)
            .eq("status", "aceito")
            .order("aceito_em", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (eSaldo) return; // sem número oficial não mostra número nenhum

        const somaC = (coletas || []).reduce(
          (s, c) => s + (Number(c.valor_pago) - Number(c.valor_sede || 0)),
          0
        );
        const somaD = (despesas || []).reduce((s, d) => s + Number(d.valor), 0);
        const somaA = (abast || []).reduce((s, a) => s + Number(a.valor), 0);

        // Centavos existem (despesas/combustível) — arredonda pra 2 casas
        const cent = (x: number) => Math.round(x * 100) / 100;
        const novo = {
          ultimo_recebido: ultimo
            ? {
                valor: Number(ultimo.valor),
                data_envio: ultimo.data_envio,
                forma_pagamento: ultimo.forma_pagamento,
              }
            : null,
          gasto_coletas: cent(somaC),
          gasto_despesas: cent(somaD),
          gasto_abast: cent(somaA),
          saldo: cent(Number(saldoRpc ?? 0)),
        };
        setDados(novo);
        setOffline(false);
        // Guarda o último saldo conhecido: sem isto o card SUMIA inteiro
        // offline — justo quando ele está na rota com dinheiro no bolso e
        // quer conferir quanto ainda tem (varredura 22/08).
        try {
          localStorage.setItem(
            CACHE_KEY + motoristaId,
            JSON.stringify({ dados: novo, em: Date.now() })
          );
        } catch {
          // localStorage cheio — o card só perde a memória, não quebra
        }
      } catch {
        // Sem sinal: mostra o último número conhecido, nomeado como tal.
        try {
          const raw = localStorage.getItem(CACHE_KEY + motoristaId);
          if (raw) {
            const c = JSON.parse(raw) as { dados: Dados; em: number };
            setDados(c.dados);
            setDesdeQuando(c.em);
            setOffline(true);
          }
        } catch {
          // cache ilegível — segue sem card, como era antes
        }
      }
  }, [motoristaId]);

  useEffect(() => {
    carregar();
    // Recarrega na hora quando um adiantamento é aceito (evento do app,
    // disparado pelo AdiantamentoBlocking) — sem precisar de F5.
    const onMudou = () => carregar();
    window.addEventListener("coleta-saldo-mudou", onMudou);
    return () => window.removeEventListener("coleta-saldo-mudou", onMudou);
  }, [carregar]);

  if (!dados) return null;

  return (
    <div className="bg-white border border-cinza-borda rounded-2xl p-4 mb-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold">💰 Seu dinheiro</h3>
        <button
          onClick={() => setAberto((a) => !a)}
          className="text-sm text-verde"
        >
          {aberto ? "Fechar" : "Ver detalhes"}
        </button>
      </div>
      <div className="mt-3 text-lg font-bold text-right">
        Na mão: {formatBRL(dados.saldo)}
      </div>
      {offline && (
        <p className="text-xs text-cinza-suave text-right mt-1">
          Sem sinal — último número que o app viu
          {desdeQuando
            ? `, ${new Date(desdeQuando).toLocaleDateString("pt-BR")} às ${new Date(
                desdeQuando
              ).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </p>
      )}
      {aberto && (
        <div className="mt-4 space-y-2 text-sm border-t border-cinza-borda pt-3">
          {dados.ultimo_recebido && (
            <div>
              <div className="text-cinza-suave text-xs">Último recebido</div>
              <div>
                {formatBRL(dados.ultimo_recebido.valor)} ·{" "}
                {formatDataHora(dados.ultimo_recebido.data_envio)} via{" "}
                {dados.ultimo_recebido.forma_pagamento}
              </div>
            </div>
          )}
          <div className="flex justify-between">
            <span>Gastou em coletas</span>
            <span className="font-mono">{formatBRL(dados.gasto_coletas)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gastou em despesas</span>
            <span className="font-mono">{formatBRL(dados.gasto_despesas)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gastou em combustível</span>
            <span className="font-mono">{formatBRL(dados.gasto_abast)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
