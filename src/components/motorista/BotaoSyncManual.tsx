"use client";

import { useState } from "react";
import { manualSync } from "@/lib/sync/trigger";

interface Props {
  pendentes: number;
  online: boolean;
  onSyncDone: () => void;
}

export function BotaoSyncManual({ pendentes, online, onSyncDone }: Props) {
  const [carregando, setCarregando] = useState(false);
  const [debouncedAt, setDebouncedAt] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (pendentes === 0 || !online) return null;

  async function enviar() {
    const agora = Date.now();
    if (agora - debouncedAt < 10_000) return;
    setDebouncedAt(agora);
    setCarregando(true);
    setFeedback(null);

    const result = await manualSync();

    if (result.falhas === 0) {
      setFeedback(`✅ Tudo enviado (${result.enviadas})`);
    } else if (result.enviadas > 0) {
      setFeedback(`Enviou ${result.enviadas} de ${result.total}. Tenta de novo.`);
    } else {
      setFeedback("Não consegui enviar. Verifica o sinal.");
    }
    setCarregando(false);
    onSyncDone();
    setTimeout(() => setFeedback(null), 4000);
  }

  return (
    <div className="card bg-atencao/5 border-atencao space-y-2">
      <button
        onClick={enviar}
        disabled={carregando}
        className="btn-primario bg-atencao active:bg-atencao/90"
      >
        {carregando ? "Enviando..." : `📤 Enviar agora`}
      </button>
      <p className="text-center text-base text-cinza-suave">
        {pendentes} {pendentes === 1 ? "coleta pendente" : "coletas pendentes"}
      </p>
      {feedback && (
        <p className="text-center text-base font-medium">{feedback}</p>
      )}
    </div>
  );
}
