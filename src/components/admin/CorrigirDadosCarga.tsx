"use client";

import { useState } from "react";
import { ModalEditarCarga } from "@/components/admin/ModalEditarCarga";
import type { Caminhao } from "@/lib/admin/queries";

/**
 * Botão discreto no cabeçalho da carga que abre o ModalEditarCarga.
 * Fica em componente próprio só pra guardar o "aberto/fechado" fora do
 * server component da página.
 */
export function CorrigirDadosCarga({
  carga,
  caminhoes,
}: {
  carga: {
    id: string;
    caminhao_id: string;
    km_inicial: number;
    km_final: number | null;
    iniciada_em: string;
  };
  caminhoes: Pick<Caminhao, "id" | "placa" | "marca">[];
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="text-xs text-cinza-suave hover:text-verde hover:underline"
      >
        ✏️ Corrigir dados da carga
      </button>
      {aberto && (
        <ModalEditarCarga
          carga={carga}
          caminhoes={caminhoes}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}
