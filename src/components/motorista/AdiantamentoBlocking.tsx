"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { captureGPS } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { formatBRL, formatDataHora } from "@/lib/format";

interface AdiantamentoPendente {
  id: string;
  valor: number;
  data_envio: string;
  forma_pagamento: "dinheiro" | "pix";
  observacao: string | null;
}

/**
 * Tela BLOCKING que aparece na home se motorista tem adiantamento pendente.
 * Motorista pode aceitar ou pular. Se pular, aparece novamente na próxima
 * abertura do app (contador incrementa). Aceite é atômico no servidor.
 */
export function AdiantamentoBlocking({ motoristaId }: { motoristaId: string }) {
  const [pendente, setPendente] = useState<AdiantamentoPendente | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Confirmação em DUAS ETAPAS dentro do próprio app — nada de confirm()
  // do navegador (regra do Evaner: todo popup é do app).
  const [etapa, setEtapa] = useState<"pergunta" | "confirmacao">("pergunta");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("adiantamentos")
        .select("id, valor, data_envio, forma_pagamento, observacao")
        .eq("motorista_id", motoristaId)
        .eq("status", "pendente")
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setPendente(data as AdiantamentoPendente);
    })();
  }, [motoristaId]);

  async function aceitar() {
    if (!pendente) return;
    setErro(null);
    setConfirmando(true);
    try {
      const supabase = getSupabaseBrowser();
      const gps = await captureGPS();
      // Update atômico: só se ainda pendente
      const { data, error } = await supabase
        .from("adiantamentos")
        .update({
          status: "aceito",
          aceito_em: new Date().toISOString(),
          gps_aceite_lat: gps.ok ? gps.latitude : null,
          gps_aceite_lng: gps.ok ? gps.longitude : null,
        })
        .eq("id", pendente.id)
        .eq("status", "pendente")
        .select()
        .maybeSingle();
      if (error) {
        setErro(error.message);
        return;
      }
      if (!data) {
        setErro("Esse adiantamento foi cancelado pelo Jean. Fala com ele.");
        // Some da tela
        setTimeout(() => setPendente(null), 3000);
        return;
      }
      await logEvent(motoristaId, "adiantamento_aceito", {
        adiantamento_id: pendente.id,
        valor: pendente.valor,
        forma_pagamento: pendente.forma_pagamento,
      });
      setPendente(null);
      // Avisa o CardSaldo pra recarregar na hora (sem F5 manual)
      window.dispatchEvent(new Event("coleta-saldo-mudou"));
    } finally {
      setConfirmando(false);
    }
  }

  async function pular() {
    if (!pendente) return;
    try {
      const supabase = getSupabaseBrowser();
      // Incrementa pular_contador (via update simples)
      const { data: atual } = await supabase
        .from("adiantamentos")
        .select("pular_contador")
        .eq("id", pendente.id)
        .maybeSingle();
      const novo = (atual?.pular_contador ?? 0) + 1;
      await supabase
        .from("adiantamentos")
        .update({ pular_contador: novo })
        .eq("id", pendente.id)
        .eq("status", "pendente");
      await logEvent(motoristaId, "adiantamento_pulado", {
        adiantamento_id: pendente.id,
        pular_contador: novo,
      });
    } finally {
      setPendente(null);
    }
  }

  if (!pendente) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md space-y-5">
        <div className="text-center space-y-3">
          <div className="text-5xl">💰</div>
          <h1 className="text-2xl font-bold">
            Recebimento de {formatBRL(pendente.valor)}
          </h1>
          <p className="text-cinza-suave">
            Jean enviou {formatBRL(pendente.valor)} pra você em{" "}
            {formatDataHora(pendente.data_envio)}
          </p>
          <div className="text-base">
            Forma:{" "}
            <strong>
              {pendente.forma_pagamento === "pix" ? "PIX" : "Dinheiro"}
            </strong>
          </div>
          {pendente.observacao && (
            <div className="text-sm text-cinza-suave italic">
              &ldquo;{pendente.observacao}&rdquo;
            </div>
          )}
        </div>

        <div className="border-t border-cinza-borda pt-4">
          {erro && (
            <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 mb-3 text-center text-sm">
              {erro}
            </div>
          )}
          {etapa === "pergunta" ? (
            <>
              <p className="text-center text-lg font-medium mb-4">
                Você já recebeu esse dinheiro?
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setEtapa("confirmacao")}
                  disabled={confirmando}
                  className="w-full bg-verde text-white rounded-2xl p-4 text-lg font-bold shadow active:bg-verde-escuro disabled:opacity-50"
                >
                  ✓ JÁ RECEBI
                </button>
                <button
                  onClick={pular}
                  disabled={confirmando}
                  className="w-full bg-slate-100 text-slate-700 rounded-2xl p-4 text-lg font-medium border border-cinza-borda disabled:opacity-50"
                >
                  ⏸ AINDA NÃO RECEBI
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-center text-lg font-medium mb-4">
                Tem certeza que já recebeu {formatBRL(pendente.valor)}?
                <span className="block text-base text-cinza-suave mt-1">
                  Isso não tem volta.
                </span>
              </p>
              <div className="space-y-2">
                <button
                  onClick={aceitar}
                  disabled={confirmando}
                  className="w-full bg-verde text-white rounded-2xl p-4 text-lg font-bold shadow active:bg-verde-escuro disabled:opacity-50"
                >
                  {confirmando ? "Confirmando..." : "✓ SIM, TENHO CERTEZA"}
                </button>
                <button
                  onClick={() => setEtapa("pergunta")}
                  disabled={confirmando}
                  className="w-full bg-slate-100 text-slate-700 rounded-2xl p-4 text-lg font-medium border border-cinza-borda disabled:opacity-50"
                >
                  ← VOLTAR
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
