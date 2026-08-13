"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
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

export function CardSaldo({ motoristaId }: { motoristaId: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    (async () => {
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
        const carry = acerto?.valor_saldo || 0;

        const [
          { data: adiantamentos },
          { data: coletas },
          { data: despesas },
          { data: abast },
          { data: ultimo },
        ] = await Promise.all([
          supabase
            .from("adiantamentos")
            .select("valor")
            .eq("motorista_id", motoristaId)
            .eq("status", "aceito")
            .gt("aceito_em", corte),
          supabase
            .from("coletas")
            .select("valor_pago")
            .eq("motorista_id", motoristaId)
            .gt("criado_em", corte),
          supabase
            .from("despesas")
            .select("valor")
            .eq("motorista_id", motoristaId)
            .gt("criado_em", corte),
          supabase
            .from("abastecimentos")
            .select("valor")
            .eq("motorista_id", motoristaId)
            .gt("criado_em", corte),
          supabase
            .from("adiantamentos")
            .select("valor, data_envio, forma_pagamento")
            .eq("motorista_id", motoristaId)
            .eq("status", "aceito")
            .order("aceito_em", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const somaAd = (adiantamentos || []).reduce(
          (s, a) => s + Number(a.valor),
          0
        );
        const somaC = (coletas || []).reduce(
          (s, c) => s + Number(c.valor_pago),
          0
        );
        const somaD = (despesas || []).reduce((s, d) => s + Number(d.valor), 0);
        const somaA = (abast || []).reduce((s, a) => s + Number(a.valor), 0);

        // Centavos existem (despesas/combustível) — arredonda pra 2 casas
        const cent = (x: number) => Math.round(x * 100) / 100;
        setDados({
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
          saldo: cent(somaAd - somaC - somaD - somaA + carry),
        });
      } catch {
        // silencioso — card só aparece se conseguir dados
      }
    })();
  }, [motoristaId]);

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
