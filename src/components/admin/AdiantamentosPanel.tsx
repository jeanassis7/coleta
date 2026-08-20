"use client";

import { useState } from "react";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
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
  contas,
}: {
  motoristas: Motorista[];
  saldos: MotoristaComSaldo[];
  /** Contas financeiras — de onde o dinheiro sai / pra onde volta. */
  contas: ContaOpcao[];
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
          contas={contas}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "acerto" && saldoSelecionado && (
        <ModalAcerto
          motoristaId={saldoSelecionado.id}
          motoristaNome={saldoSelecionado.nome}
          saldoAtual={saldoSelecionado.saldo_atual}
          contas={contas}
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
  contas,
  onClose,
}: {
  motoristas: Motorista[];
  motoristaId: string;
  contas: ContaOpcao[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [forma, setForma] = useState<"dinheiro" | "pix">("dinheiro");
  const [obs, setObs] = useState("");
  const [contaId, setContaId] = useState("");
  // Vazio = agora. Data no passado é pra regularização: dinheiro mandado
  // por fora do sistema antes do módulo de saldo existir.
  const [quandoFoi, setQuandoFoi] = useState("");

  const nome = motoristas.find((m) => m.id === motoristaId)?.nome || "—";

  async function enviar() {
    if (valorCentavos === null || valorCentavos <= 0) {
      setErro("Valor inválido");
      return;
    }
    if (!contaId) {
      setErro("Diga de qual conta saiu o dinheiro");
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
          conta_id: contaId,
          observacao: obs.trim() || null,
          ...(quandoFoi ? { data_envio: quandoFoi } : {}),
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
        <SelectConta
          contas={contas}
          valor={contaId}
          onChange={setContaId}
          label="De qual conta saiu"
        />
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
            Quando foi <span className="text-cinza-suave">(vazio = agora)</span>
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={quandoFoi}
            onChange={(e) => setQuandoFoi(e.target.value)}
          />
          <p className="text-xs text-cinza-suave mt-1">
            Data no passado é pra <strong>regularização</strong> — dinheiro que
            foi mandado por fora antes do sistema controlar. Datado antes do
            corte da conta, ele conserta o saldo do motorista{" "}
            <strong>sem descontar o caixa de novo</strong> (aquele dinheiro já
            está embutido no saldo de partida).
          </p>
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
  contas,
  onClose,
}: {
  motoristaId: string;
  motoristaNome: string;
  saldoAtual: number;
  contas: ContaOpcao[];
  onClose: () => void;
}) {
  const router = useRouter();
  // Tudo em CENTAVOS — validação exata sem surpresa de arredondamento.
  // Saldo NEGATIVO = motorista gastou do próprio bolso (empresa deve pra
  // ele). Os 3 campos viram o espelho (pagar agora / somar no salário /
  // levar pro próximo ciclo) e são gravados com sinal negativo.
  const saldoCent = reaisParaCentavos(saldoAtual);
  const negativo = saldoCent < 0;
  // Só faz sentido quando ele devolve dinheiro de verdade: aí o dinheiro
  // entra em algum caixa. Vale e saldo não movem conta nenhuma.
  const [contaId, setContaId] = useState("");
  const alvo = Math.abs(saldoCent);
  const [devolvido, setDevolvido] = useState<number | null>(
    !negativo && saldoCent > 0 ? saldoCent : null
  );
  const [vale, setVale] = useState<number | null>(null);
  const [saldo, setSaldo] = useState<number | null>(
    // No modo dívida, o caso mais comum é o próximo adiantamento cobrir
    negativo && alvo > 0 ? alvo : null
  );
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const d = devolvido ?? 0;
  const v = vale ?? 0;
  const s = saldo ?? 0;
  const soma = d + v + s;
  const bate = soma === alvo;

  async function confirmar() {
    if (!bate) {
      setErro(
        `Soma (${formatBRL(soma / 100)}) não bate com ${negativo ? "a dívida" : "o saldo"} (${formatBRL(alvo / 100)}).`
      );
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const sinal = negativo ? -1 : 1;
      const res = await fetch(`/api/admin/acertos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motorista_id: motoristaId,
          valor_devolvido: centavosParaReais(sinal * d),
          valor_vale: centavosParaReais(sinal * v),
          valor_saldo: centavosParaReais(sinal * s),
          conta_id: contaId || null,
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
        {negativo ? (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-3 text-sm">
            O motorista gastou{" "}
            <strong className="font-mono">{formatBRL(alvo / 100)}</strong> do
            próprio bolso — <strong>a empresa deve {formatBRL(alvo / 100)} pra ele</strong>.
            <p className="text-cinza-suave text-xs mt-1">
              Divide como resolver. A soma tem que bater com a dívida.
            </p>
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 text-sm">
            Saldo atual:{" "}
            <strong className="font-mono">{formatBRL(saldoAtual)}</strong>
            <p className="text-cinza-suave text-xs mt-1">
              Divide entre devolvido em cash, desconto salário (vale), ou saldo
              que fica pro próximo ciclo. A soma tem que bater com o saldo.
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            {negativo ? "Pagar agora em dinheiro" : "Devolvido (em cash)"}
          </label>
          <InputDinheiro centavos={devolvido} onChange={setDevolvido} grande={false} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {negativo ? "Somar no próximo salário" : "Vale (desconto salário)"}
          </label>
          <InputDinheiro centavos={vale} onChange={setVale} grande={false} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {negativo
              ? "Levar pro próximo ciclo (o próximo adiantamento cobre)"
              : "Fica de saldo (próximo ciclo)"}
          </label>
          <InputDinheiro centavos={saldo} onChange={setSaldo} grande={false} />
        </div>

        {devolvido !== null && devolvido !== 0 && (
          <SelectConta
            contas={contas}
            valor={contaId}
            onChange={setContaId}
            label={negativo ? "De qual conta você vai pagar" : "Em qual conta o dinheiro entrou"}
          />
        )}

        <div className={`text-sm ${bate ? "text-green-700" : "text-alerta"}`}>
          Total: {formatBRL(soma / 100)}{" "}
          {bate ? "✓" : `(precisa ser ${formatBRL(alvo / 100)})`}
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
