"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalConfirmar } from "./Modais";
import { formatBRL } from "@/lib/format";

/**
 * Botão "Desfazer" do ÚLTIMO acerto de um motorista.
 *
 * O servidor só aceita desfazer o mais recente (e recusa se o vale já foi
 * descontado num salário) — aqui é só a porta. O ciclo reabre: os
 * lançamentos que o acerto fechou voltam a contar no saldo.
 */
export function DesfazerAcerto({
  acertoId,
  motoristaNome,
  valorDevolvido,
  valorVale,
  valorSaldo,
}: {
  acertoId: string;
  motoristaNome: string;
  valorDevolvido: number;
  valorVale: number;
  valorSaldo: number;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[] | null>(null);

  async function desfazer() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/acertos/${acertoId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao desfazer.");
        setAberto(false);
        return;
      }
      setAvisos(json.avisos ?? []);
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="text-alerta hover:underline text-xs"
      >
        Desfazer
      </button>

      {erro && (
        <p className="text-xs text-alerta mt-1 max-w-[16rem]">{erro}</p>
      )}
      {avisos && avisos.length > 0 && (
        <div className="text-xs text-cinza-suave mt-1 max-w-[16rem]">
          Desfeito. {avisos.join("; ")}.
        </div>
      )}

      {aberto && (
        <ModalConfirmar
          titulo={`Desfazer o último acerto de ${motoristaNome}`}
          descricao={`Devolvido ${formatBRL(valorDevolvido)} · vale ${formatBRL(valorVale)} · saldo ${formatBRL(valorSaldo)}. O ciclo reabre: tudo que esse acerto fechou volta a contar no saldo do motorista, e o dinheiro devolvido sai da conta que o recebeu. Use pra corrigir um acerto lançado errado — depois é só refazer certo.`}
          confirmarLabel="Desfazer acerto"
          perigo
          carregando={salvando}
          onConfirmar={desfazer}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}
