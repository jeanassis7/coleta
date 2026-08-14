"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";
import { ModalConfirmar } from "@/components/admin/Modais";
import type { CompradorComSaldo } from "@/lib/admin/queries";

export function CompradoresPainel({
  compradores,
}: {
  compradores: CompradorComSaldo[];
}) {
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<CompradorComSaldo | null>(null);

  const devendo = compradores.reduce((s, c) => s + Math.max(0, c.saldo), 0);

  return (
    <>
      <div className="card mb-4 flex items-center justify-between">
        <span className="text-cinza-suave">Total a receber</span>
        <span className="text-2xl font-bold font-mono">{formatBRL(devendo)}</span>
      </div>

      {!formAberto && !editando && (
        <div className="mb-4">
          <button
            onClick={() => setFormAberto(true)}
            className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
          >
            + Novo comprador
          </button>
        </div>
      )}

      {(formAberto || editando) && (
        <FormComprador
          editando={editando}
          onFim={() => {
            setFormAberto(false);
            setEditando(null);
          }}
        />
      )}

      <Tabela compradores={compradores} onEditar={setEditando} />
    </>
  );
}

function FormComprador({
  editando,
  onFim,
}: {
  editando: CompradorComSaldo | null;
  onFim: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(editando?.nome || "");
  const [cidade, setCidade] = useState(editando?.cidade || "");
  const [contato, setContato] = useState(editando?.contato || "");
  const [observacao, setObservacao] = useState(editando?.observacao || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (nome.trim().length < 2) return setErro("Diga o nome do comprador");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(
        editando ? `/api/admin/compradores/${editando.id}` : "/api/admin/compradores",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: nome.trim(),
            cidade: cidade.trim() || null,
            contato: contato.trim() || null,
            observacao: observacao.trim() || null,
          }),
        }
      );
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      router.refresh();
      onFim();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card mb-6 space-y-4">
      <h2 className="text-lg font-semibold">
        {editando ? "Editar comprador" : "Novo comprador"}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cidade</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Contato</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={contato}
            onChange={(e) => setContato(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Observação</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onFim}
          disabled={salvando}
          className="px-4 py-2 rounded-xl border border-cinza-borda"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function Tabela({
  compradores,
  onEditar,
}: {
  compradores: CompradorComSaldo[];
  onEditar: (c: CompradorComSaldo) => void;
}) {
  const router = useRouter();
  const [apagando, setApagando] = useState<CompradorComSaldo | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function apagar(c: CompradorComSaldo) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/compradores/${c.id}`, { method: "DELETE" });
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
      setApagando(null);
    }
  }

  if (compradores.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhum comprador cadastrado. São as fundições pra quem o óleo é vendido.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm mb-3">
          {erro}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Nome</th>
            <th className="py-2 pr-3">Cidade</th>
            <th className="py-2 pr-3">Contato</th>
            <th className="py-2 pr-3 text-right">Comprou</th>
            <th className="py-2 pr-3 text-right">Pagou</th>
            <th className="py-2 pr-3 text-right">Saldo</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {compradores.map((c) => (
            <tr key={c.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 font-medium">
                {c.nome}
                {!c.ativo && (
                  <span className="ml-2 text-xs text-cinza-suave">(inativo)</span>
                )}
              </td>
              <td className="py-2 pr-3 text-cinza-suave">{c.cidade || "—"}</td>
              <td className="py-2 pr-3 text-cinza-suave">{c.contato || "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {formatBRL(c.vendido)}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {formatBRL(c.recebido)}
              </td>
              <td className="py-2 pr-3 text-right">
                <div
                  className={`font-mono font-semibold ${
                    c.saldo > 0 ? "text-alerta" : c.saldo < 0 ? "text-verde" : ""
                  }`}
                >
                  {formatBRL(Math.abs(c.saldo))}
                </div>
                <div className="text-xs text-cinza-suave">
                  {c.saldo > 0 ? "deve" : c.saldo < 0 ? "crédito dele" : "em dia"}
                </div>
                {/* O saldo tem que se explicar: sem isso o Jean vê o número
                    e vai caçar o motivo no WhatsApp. */}
                {c.devolvido > 0 && (
                  <div className="text-xs text-alerta mt-0.5">
                    inclui {formatBRL(c.devolvido)} de cheque devolvido
                  </div>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => onEditar(c)}
                    className="text-verde hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setApagando(c)}
                    className="text-alerta hover:underline"
                  >
                    Apagar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {apagando && (
        <ModalConfirmar
          titulo="Apagar esse comprador?"
          descricao={`${apagando.nome}. Só dá pra apagar quem não tem venda lançada — com histórico, o certo é desativar.`}
          confirmarLabel="Apagar"
          perigo
          carregando={loading}
          onConfirmar={() => apagar(apagando)}
          onFechar={() => setApagando(null)}
        />
      )}
    </div>
  );
}
