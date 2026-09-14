"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";
import { ModalConfirmar } from "@/components/admin/Modais";
import type { DespesaAdmin } from "@/lib/admin/queries";

/**
 * Apagar uma despesa lançada pelo motorista.
 *
 * A confirmação não é um "tem certeza?" genérico: ela diz o que vai
 * acontecer com o DINHEIRO — o saldo do motorista aumenta, porque o gasto
 * deixa de contar. Por isso mora em arquivo próprio, com os dois donos
 * (tabela de /admin/despesas e linha do tempo da carga) lendo a MESMA
 * frase. Duas cópias divergem, e a tela que ficar velha passa a mentir
 * sobre o saldo.
 */
export function ModalApagarDespesa({
  despesa,
  onFechar,
  onAviso,
}: {
  despesa: DespesaAdmin;
  onFechar: () => void;
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function apagar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/despesas/${despesa.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        onAviso("Erro: " + data.error);
        setTimeout(() => onAviso(null), 8000);
      } else {
        if (data.aviso) onAviso(data.aviso);
        router.refresh();
      }
    } finally {
      setLoading(false);
      onFechar();
    }
  }

  return (
    <ModalConfirmar
      titulo="Apagar essa despesa?"
      descricao={`"${despesa.descricao}" · ${formatBRL(despesa.valor)} · ${despesa.motorista_nome}. A foto do comprovante também será apagada. Atenção: o saldo do motorista vai AUMENTAR ${formatBRL(despesa.valor)}, porque esse gasto deixa de contar.`}
      confirmarLabel="Apagar"
      perigo
      carregando={loading}
      onConfirmar={apagar}
      onFechar={onFechar}
    />
  );
}
