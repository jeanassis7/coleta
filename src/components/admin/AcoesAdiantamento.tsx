"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalConfirmar } from "./Modais";
import { formatBRL, formatData } from "@/lib/format";

/**
 * "Estornar" um adiantamento ACEITO — só pra quando o dinheiro voltou de
 * verdade (pix devolvido, mandado errado). O servidor recusa se o
 * adiantamento já entrou num acerto fechado.
 */
export function EstornarAdiantamento({
  adiantamentoId,
  valor,
  motoristaNome,
}: {
  adiantamentoId: string;
  valor: number;
  motoristaNome: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function estornar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/adiantamentos/${adiantamentoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "estornar" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao estornar.");
        setAberto(false);
        return;
      }
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
        Estornar
      </button>
      {erro && <p className="text-xs text-alerta mt-1 max-w-[16rem]">{erro}</p>}
      {aberto && (
        <ModalConfirmar
          titulo={`Estornar ${formatBRL(valor)} de ${motoristaNome}?`}
          descricao="Só use se o dinheiro VOLTOU de verdade (pix devolvido, mandado errado). O valor volta pro saldo da conta de onde saiu e deixa de contar na mão do motorista. Se ele gastou o dinheiro, o caminho é o Acerto — não o estorno."
          confirmarLabel="Estornar"
          perigo
          carregando={salvando}
          onConfirmar={estornar}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

/** Apagar uma devolução lançada errado — os dois saldos recalculam. */
export function ApagarDevolucao({
  devolucaoId,
  valor,
  data,
}: {
  devolucaoId: string;
  valor: number;
  data: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function apagar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/devolucoes/${devolucaoId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao apagar.");
        setAberto(false);
        return;
      }
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
        Apagar
      </button>
      {erro && <p className="text-xs text-alerta mt-1 max-w-[16rem]">{erro}</p>}
      {aberto && (
        <ModalConfirmar
          titulo="Apagar devolução"
          descricao={`${formatBRL(valor)} de ${formatData(data)}. O valor sai da conta que o recebeu e volta a contar na mão do motorista.`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={apagar}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}
