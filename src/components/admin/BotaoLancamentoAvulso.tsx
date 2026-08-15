"use client";

import { useState } from "react";
import {
  LancamentoAvulso,
  type VeiculoOpcao,
} from "@/components/admin/LancamentoAvulso";

/** Abre o lançamento de gasto do veículo (sem carga) a partir de uma página server. */
export function BotaoLancamentoAvulso({
  veiculos,
  tipoInicial = "abastecimento",
  rotulo = "+ Lançar pelo painel",
}: {
  veiculos: VeiculoOpcao[];
  tipoInicial?: "abastecimento" | "despesa";
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);

  if (veiculos.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
      >
        {rotulo}
      </button>
      {aberto && (
        <LancamentoAvulso
          veiculos={veiculos}
          tipoInicial={tipoInicial}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}
