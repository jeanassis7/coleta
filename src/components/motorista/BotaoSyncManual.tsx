"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { manualSync } from "@/lib/sync/trigger";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { logEvent } from "@/lib/events/log";
import type { SyncErrorKind } from "@/lib/sync/queue";

interface Props {
  pendentes: number;
  online: boolean;
  onSyncDone: () => void;
  motoristaId: string;
}

interface Feedback {
  texto: string;
  detalhe?: string;
  tipo: "sucesso" | "parcial" | "erro";
  kind?: SyncErrorKind;
}

export function BotaoSyncManual({ pendentes, online, onSyncDone, motoristaId }: Props) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [debouncedAt, setDebouncedAt] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (pendentes === 0 || !online) return null;

  async function enviar() {
    const agora = Date.now();
    if (agora - debouncedAt < 10_000) return;
    setDebouncedAt(agora);
    setCarregando(true);
    setFeedback(null);

    await logEvent(motoristaId, "enviar_agora_clicked", { pendentes });
    await logEvent(motoristaId, "sync_started", { trigger: "manual" });

    const result = await manualSync();

    await logEvent(motoristaId, "sync_completed", {
      trigger: "manual",
      total: result.total,
      enviadas: result.enviadas,
      falhas: result.falhas,
      ultimo_erro: result.ultimo_erro,
      ultimo_erro_kind: result.ultimo_erro_kind,
    });

    if (result.falhas === 0 && result.enviadas > 0) {
      setFeedback({
        texto: `✅ Tudo enviado (${result.enviadas})`,
        tipo: "sucesso",
      });
    } else if (result.enviadas > 0 && result.falhas > 0) {
      setFeedback({
        texto: `Enviou ${result.enviadas} de ${result.total}.`,
        detalhe: result.ultimo_erro
          ? `Erro restante: ${result.ultimo_erro}`
          : undefined,
        tipo: "parcial",
        kind: result.ultimo_erro_kind,
      });
    } else {
      // 0 enviadas, alguma falha
      const erroMsg = mensagemPorKind(result.ultimo_erro_kind);
      setFeedback({
        texto: erroMsg.principal,
        detalhe: erroMsg.detalhe(result.ultimo_erro),
        tipo: "erro",
        kind: result.ultimo_erro_kind,
      });
    }
    setCarregando(false);
    onSyncDone();
    setTimeout(() => setFeedback(null), 12_000);
  }

  async function relogar() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/motorista/login");
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
        <div
          className={`rounded-xl p-3 text-center ${
            feedback.tipo === "sucesso"
              ? "bg-verde/10 text-verde-escuro"
              : feedback.tipo === "parcial"
              ? "bg-atencao/10 text-cinza-texto"
              : "bg-alerta/10 text-alerta"
          }`}
        >
          <p className="font-medium text-base">{feedback.texto}</p>
          {feedback.detalhe && (
            <p className="text-sm mt-1 break-words">{feedback.detalhe}</p>
          )}
          {feedback.kind === "auth" && (
            <button
              onClick={relogar}
              className="mt-2 px-4 py-2 bg-alerta text-white rounded-lg font-medium text-sm"
            >
              Sair e entrar de novo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function mensagemPorKind(kind?: SyncErrorKind): {
  principal: string;
  detalhe: (raw?: string) => string | undefined;
} {
  switch (kind) {
    case "auth":
      return {
        principal: "Sua sessão expirou.",
        detalhe: () => "Toque em 'Sair e entrar de novo' abaixo.",
      };
    case "network":
      return {
        principal: "Sem conexão com o servidor.",
        detalhe: () => "Verifica se tem sinal real (4G ou Wi-Fi).",
      };
    case "storage":
      return {
        principal: "Erro ao enviar a foto.",
        detalhe: (raw) => raw || "Tenta de novo. Se persistir, fala com o Jean.",
      };
    case "data":
      return {
        principal: "Dado inválido na coleta.",
        detalhe: (raw) => raw || "Fala com o Jean — precisa ajustar manualmente.",
      };
    default:
      return {
        principal: "Não consegui enviar.",
        detalhe: (raw) =>
          raw ? `Motivo: ${raw}` : "Tenta de novo. Se persistir, fala com o Jean.",
      };
  }
}
