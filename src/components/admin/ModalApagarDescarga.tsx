"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalConfirmar } from "@/components/admin/Modais";

/**
 * Apagar uma descarga — desfaz a pesagem na balança inteira.
 *
 * Não é um apagar comum: tira o óleo do estoque, reabre a carga no celular
 * do motorista e pode desalinhar comissão já PAGA. O endpoint
 * (DELETE /api/admin/descargas/[id]) já conhece todas as nuances — este
 * modal é só o segundo caminho até ele, mesmo desenho do
 * ModalApagarDespesa/Abastecimento.
 *
 * Segundo clique quando apagar deixaria o estoque de óleo fino NEGATIVO (o
 * óleo já foi vendido): o servidor responde 409 com `precisa_confirmar` e a
 * mensagem PRONTA, já com o número. Não inventa texto próprio pro saldo —
 * usa exatamente o que o servidor mandou, e reenvia com `?confirmado=1`.
 *
 * 409 SEM `precisa_confirmar` é bloqueio de verdade (outra carga ativa do
 * motorista, ou compra direta amarrada) — não tem segundo clique que passe.
 *
 * O aviso de comissão paga (200 com `aviso`) NÃO expira sozinho — os avisos
 * de despesa/abastecimento somem em 8s porque tudo bem sumir; este diz que
 * uma conta JÁ PAGA deixou de bater, e só fica pra trás quando outra ação
 * sobrescrever o aviso ou o gestor sair da tela.
 */
export function ModalApagarDescarga({
  descarga,
  onFechar,
  onAviso,
}: {
  descarga: { id: string; peso_liquido_kg: number };
  onFechar: () => void;
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Preenchido quando o servidor pede o segundo clique — a mensagem É a
  // dele, já traz o número do estoque negativo.
  const [pedidoServidor, setPedidoServidor] = useState<string | null>(null);

  async function apagar(confirmado: boolean) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/descargas/${descarga.id}${confirmado ? "?confirmado=1" : ""}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.precisa_confirmar) {
          setPedidoServidor(data.error);
          return;
        }
        // Bloqueio de verdade — não tem segundo clique que resolva.
        onAviso("Erro: " + data.error);
        setTimeout(() => onAviso(null), 8000);
        onFechar();
        return;
      }
      // Sucesso. O aviso de comissão (quando vem) fica na tela até o
      // gestor sair — nada aqui agenda um setTimeout pra apagá-lo.
      if (data.aviso) onAviso(data.aviso);
      router.refresh();
      onFechar();
    } finally {
      setLoading(false);
    }
  }

  if (pedidoServidor) {
    return (
      <ModalConfirmar
        titulo="Confirma mesmo assim?"
        descricao={pedidoServidor}
        confirmarLabel="Apagar mesmo assim"
        perigo
        carregando={loading}
        onConfirmar={() => apagar(true)}
        onFechar={onFechar}
      />
    );
  }

  return (
    <ModalConfirmar
      titulo="Apagar essa descarga?"
      descricao={`Essa descarga tem ${descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg líquidos. Apagar vai: tirar esse óleo do estoque, reabrir a carga do motorista — ela volta a aparecer ABERTA no celular dele — e mudar a comissão do período.`}
      confirmarLabel="Apagar"
      perigo
      carregando={loading}
      onConfirmar={() => apagar(false)}
      onFechar={onFechar}
    />
  );
}
