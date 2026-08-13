"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatDataHora } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
  reaisParaCentavos,
} from "@/components/InputDinheiro";
import type { MotoristaComSaldo } from "@/lib/admin/queries";
import { ModalConfirmar } from "./Modais";

interface Motorista {
  id: string;
  nome: string;
}

export function AdiantamentosPanel({
  motoristas,
  saldos,
}: {
  motoristas: Motorista[];
  saldos: MotoristaComSaldo[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<"novo" | "acerto" | null>(null);
  const [motoristaSelId, setMotoristaSelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalCancelar, setModalCancelar] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function abrirNovo(motoristaId: string) {
    setMotoristaSelId(motoristaId);
    setModal("novo");
  }
  function abrirAcerto(motoristaId: string) {
    setMotoristaSelId(motoristaId);
    setModal("acerto");
  }

  async function cancelarPendente(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/adiantamentos/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setAviso("Erro: " + data.error);
        setTimeout(() => setAviso(null), 8000);
      } else {
        router.refresh();
      }
    } finally {
      setLoading(false);
      setModalCancelar(null);
    }
  }

  const saldoSelecionado = saldos.find((s) => s.id === motoristaSelId);

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-cinza-suave border-b border-cinza-borda">
              <th className="py-2 pr-3">Motorista</th>
              <th className="py-2 pr-3">Último envio</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Saldo atual</th>
              <th className="py-2 pr-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => {
              const u = s.ultimo_adiantamento;
              return (
                <tr key={s.id} className="border-b border-cinza-borda">
                  <td className="py-3 pr-3 font-medium">
                    <a
                      href={`/admin/adiantamentos/${s.id}`}
                      className="hover:text-verde hover:underline"
                      title="Ver histórico completo"
                    >
                      {s.nome}
                    </a>
                    {s.is_teste && (
                      <span title="Motorista de teste — invisível pro admin">
                        {" "}🧪
                      </span>
                    )}
                    {s.pular_contador_atual >= 10 && (
                      <span className="ml-2 text-xs font-semibold text-yellow-800 bg-yellow-100 border border-yellow-300 rounded px-1.5 py-0.5">
                        ⏸ pulou {s.pular_contador_atual}×
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {u ? (
                      <>
                        {formatBRL(u.valor)} · {u.forma_pagamento} ·{" "}
                        {formatDataHora(u.data_envio)}
                      </>
                    ) : (
                      <span className="text-cinza-suave italic">nenhum</span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    {u ? <StatusBadge status={u.status} /> : "—"}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono font-semibold">
                    {u?.status === "pendente" ? "—" : formatBRL(s.saldo_atual)}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex gap-3 text-sm">
                      <button
                        onClick={() => abrirNovo(s.id)}
                        className="text-verde hover:underline"
                        disabled={loading}
                      >
                        + R$
                      </button>
                      {u?.status === "pendente" ? (
                        <button
                          onClick={() => setModalCancelar(u.id)}
                          className="text-alerta hover:underline"
                          disabled={loading}
                        >
                          Cancelar
                        </button>
                      ) : (
                        <button
                          onClick={() => abrirAcerto(s.id)}
                          className="text-slate-700 hover:underline"
                          disabled={loading}
                        >
                          Acerto
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {aviso && (
        <div className="mt-3 bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {aviso}
        </div>
      )}

      {modalCancelar && (
        <ModalConfirmar
          titulo="Cancelar esse adiantamento pendente?"
          descricao="O motorista não vai mais ver a tela de aceite. Se precisar, cria outro."
          confirmarLabel="Cancelar adiantamento"
          perigo
          carregando={loading}
          onConfirmar={() => cancelarPendente(modalCancelar)}
          onFechar={() => setModalCancelar(null)}
        />
      )}

      {modal === "novo" && motoristaSelId && (
        <ModalNovoAdiantamento
          motoristas={motoristas}
          motoristaId={motoristaSelId}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "acerto" && saldoSelecionado && (
        <ModalAcerto
          motoristaId={saldoSelecionado.id}
          motoristaNome={saldoSelecionado.nome}
          saldoAtual={saldoSelecionado.saldo_atual}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "pendente"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : status === "aceito"
        ? "bg-green-100 text-green-800 border-green-300"
        : "bg-slate-100 text-slate-600 border-slate-300";
  const label =
    status === "pendente" ? "⏳ Pendente" : status === "aceito" ? "✓ Aceito" : "✗ Cancelado";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

function ModalNovoAdiantamento({
  motoristas,
  motoristaId,
  onClose,
}: {
  motoristas: Motorista[];
  motoristaId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [forma, setForma] = useState<"dinheiro" | "pix">("dinheiro");
  const [obs, setObs] = useState("");

  const nome = motoristas.find((m) => m.id === motoristaId)?.nome || "—";

  async function enviar() {
    if (valorCentavos === null || valorCentavos <= 0) {
      setErro("Valor inválido");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/adiantamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motorista_id: motoristaId,
          valor: centavosParaReais(valorCentavos),
          forma_pagamento: forma,
          observacao: obs.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-xl font-bold">Novo adiantamento — {nome}</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Valor</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Forma</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForma("dinheiro")}
              className={`flex-1 px-3 py-2 rounded-xl border-2 ${
                forma === "dinheiro"
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              Dinheiro
            </button>
            <button
              type="button"
              onClick={() => setForma("pix")}
              className={`flex-1 px-3 py-2 rounded-xl border-2 ${
                forma === "pix"
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              PIX
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Observação <span className="text-cinza-suave">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="ex: Adiantamento agosto"
          />
        </div>
        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={salvando}
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Enviando..." : "Enviar adiantamento"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalAcerto({
  motoristaId,
  motoristaNome,
  saldoAtual,
  onClose,
}: {
  motoristaId: string;
  motoristaNome: string;
  saldoAtual: number;
  onClose: () => void;
}) {
  const router = useRouter();
  // Tudo em CENTAVOS — validação exata sem surpresa de arredondamento
  const saldoCent = reaisParaCentavos(saldoAtual);
  const [devolvido, setDevolvido] = useState<number | null>(
    saldoCent > 0 ? saldoCent : null
  );
  const [vale, setVale] = useState<number | null>(null);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const d = devolvido ?? 0;
  const v = vale ?? 0;
  const s = saldo ?? 0;
  const soma = d + v + s;
  const bate = soma === saldoCent;

  async function confirmar() {
    if (!bate) {
      setErro(
        `Soma (${formatBRL(soma / 100)}) não bate com saldo (${formatBRL(saldoAtual)}).`
      );
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/acertos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motorista_id: motoristaId,
          valor_devolvido: centavosParaReais(d),
          valor_vale: centavosParaReais(v),
          valor_saldo: centavosParaReais(s),
          observacao: obs.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-xl font-bold">Acerto — {motoristaNome}</h2>
        <div className="bg-slate-50 rounded-xl p-3 text-sm">
          Saldo atual: <strong className="font-mono">{formatBRL(saldoAtual)}</strong>
          <p className="text-cinza-suave text-xs mt-1">
            Divide entre devolvido em cash, desconto salário (vale), ou saldo que fica pro
            próximo ciclo. A soma tem que bater com o saldo.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Devolvido (em cash)
          </label>
          <InputDinheiro centavos={devolvido} onChange={setDevolvido} grande={false} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Vale (desconto salário)
          </label>
          <InputDinheiro centavos={vale} onChange={setVale} grande={false} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Fica de saldo (próximo ciclo)
          </label>
          <InputDinheiro centavos={saldo} onChange={setSaldo} grande={false} />
        </div>

        <div className={`text-sm ${bate ? "text-green-700" : "text-alerta"}`}>
          Total: {formatBRL(soma / 100)}{" "}
          {bate ? "✓" : `(precisa ser ${formatBRL(saldoAtual)})`}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Observação <span className="text-cinza-suave">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
          />
        </div>

        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando || !bate}
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Confirmar acerto"}
          </button>
        </div>
      </div>
    </div>
  );
}
