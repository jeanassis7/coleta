"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";
import { ModalConfirmar } from "@/components/admin/Modais";
import type { AbastecimentoAdmin } from "@/lib/admin/queries";

/**
 * Apagar um abastecimento lançado pelo motorista.
 *
 * A confirmação não é um "tem certeza?" genérico: ela diz o que vai
 * acontecer com o DINHEIRO — o saldo do motorista aumenta, porque o gasto
 * deixa de contar. Por isso mora em arquivo próprio, com os dois donos
 * (tabela de /admin/abastecimentos e linha do tempo da carga) lendo a
 * MESMA frase. Duas cópias divergem, e a tela que ficar velha passa a
 * mentir sobre o saldo.
 */
export function ModalApagarAbastecimento({
  abastecimento,
  onFechar,
  onAviso,
}: {
  abastecimento: AbastecimentoAdmin;
  onFechar: () => void;
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function apagar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/abastecimentos/${abastecimento.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        onAviso("Erro: " + data.error);
        setTimeout(() => onAviso(null), 8000);
      } else {
        // O servidor às vezes avisa algo importante junto do ok (ex.: a
        // conta da nota já estava paga) — descartar isso deixava a rede de
        // proteção invisível.
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
      titulo="Apagar esse abastecimento?"
      descricao={`${abastecimento.posto_nome} · ${formatBRL(abastecimento.valor)} · ${abastecimento.motorista_nome}. A foto do cupom também será apagada. Atenção: o saldo do motorista vai AUMENTAR ${formatBRL(abastecimento.valor)}, porque esse gasto deixa de contar.`}
      confirmarLabel="Apagar"
      perigo
      carregando={loading}
      onConfirmar={apagar}
      onFechar={onFechar}
    />
  );
}
