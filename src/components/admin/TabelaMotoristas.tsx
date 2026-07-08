"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatData } from "@/lib/format";

interface Motorista {
  id: string;
  nome: string;
  email: string | null;
  role: string;
  ativo: boolean;
  exige_foto: boolean;
  senha_visivel: string | null;
  criado_em: string;
}

export function TabelaMotoristas({ motoristas }: { motoristas: Motorista[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [senhasVisiveis, setSenhasVisiveis] = useState<Set<string>>(new Set());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");

  function iniciarEdicao(id: string, nomeAtual: string) {
    setEditandoId(id);
    setNomeEdit(nomeAtual);
  }

  async function salvarNome(id: string) {
    const novo = nomeEdit.trim();
    if (!novo) {
      alert("O nome não pode ficar vazio.");
      return;
    }
    await atualizar(id, { nome: novo });
    setEditandoId(null);
  }

  async function atualizar(id: string, body: Record<string, unknown>) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/admin/motoristas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  async function resetSenha(id: string, nome: string) {
    const senha = prompt(`Nova senha para ${nome}:`);
    if (!senha) return;
    if (senha.length < 6) {
      alert("Senha precisa ter ao menos 6 caracteres");
      return;
    }
    setLoadingId(id);
    try {
      const res = await fetch(`/api/admin/motoristas/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  async function deletar(id: string, nome: string) {
    const confirmacao = prompt(
      `Pra deletar ${nome}, digita o nome exato:`
    );
    if (confirmacao !== nome) {
      if (confirmacao !== null) alert("Nome não bateu, operação cancelada.");
      return;
    }

    setLoadingId(id);
    try {
      let res = await fetch(`/api/admin/motoristas/${id}`, {
        method: "DELETE",
      });
      let data = await res.json();

      if (res.status === 409 && data.error === "tem_coletas") {
        const forcar = confirm(
          `${nome} tem ${data.coletas} coleta(s). Deletar mesmo assim apaga TODAS as coletas e fotos dele permanentemente. Continuar?`
        );
        if (!forcar) return;

        res = await fetch(`/api/admin/motoristas/${id}?forcado=1`, {
          method: "DELETE",
        });
        data = await res.json();
      }

      if (!res.ok) {
        alert("Erro: " + data.error);
      } else {
        const apagadas = data.coletas_deletadas || 0;
        alert(
          `${nome} deletado${apagadas > 0 ? ` (${apagadas} coletas apagadas)` : ""}.`
        );
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  function toggleSenha(id: string) {
    const s = new Set(senhasVisiveis);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSenhasVisiveis(s);
  }

  return (
    <div className="card overflow-x-auto">
      <div className="mb-3 p-3 bg-slate-50 border border-cinza-borda rounded-xl text-sm text-cinza-suave">
        Senhas mostradas abaixo são as que você definiu na criação ou no último
        reset. Use pra lembrar e passar pros motoristas.
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-left text-sm text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Nome</th>
            <th className="py-2 pr-3">Email (login)</th>
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3">Senha</th>
            <th className="py-2 pr-3">Criado</th>
            <th className="py-2 pr-3">Ativo</th>
            <th className="py-2 pr-3">Exige foto</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {motoristas.map((m) => (
            <tr key={m.id} className="border-b border-cinza-borda last:border-0">
              <td className="py-3 pr-3 font-medium">
                {editandoId === m.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nomeEdit}
                      onChange={(e) => setNomeEdit(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") salvarNome(m.id);
                        if (e.key === "Escape") setEditandoId(null);
                      }}
                      className="px-2 py-1 border border-cinza-borda rounded-lg text-sm w-40"
                    />
                    <button
                      onClick={() => salvarNome(m.id)}
                      disabled={loadingId === m.id}
                      className="text-verde hover:underline text-sm"
                    >
                      Salvar
                    </button>
                    <button
                      onClick={() => setEditandoId(null)}
                      className="text-cinza-suave hover:underline text-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{m.nome}</span>
                    <button
                      onClick={() => iniciarEdicao(m.id, m.nome)}
                      className="text-cinza-suave hover:text-verde"
                      title="Editar nome"
                    >
                      ✏️
                    </button>
                  </div>
                )}
              </td>
              <td className="py-3 pr-3 text-sm text-cinza-suave font-mono">
                {m.email || <span className="italic">sem email</span>}
              </td>
              <td className="py-3 pr-3 text-sm">
                <span
                  className={`px-2 py-1 rounded ${
                    m.role === "admin"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-slate-100"
                  }`}
                >
                  {m.role}
                </span>
              </td>
              <td className="py-3 pr-3 text-sm font-mono">
                {m.senha_visivel ? (
                  <button
                    onClick={() => toggleSenha(m.id)}
                    className="text-left hover:underline"
                    title="Clica pra mostrar/esconder"
                  >
                    {senhasVisiveis.has(m.id) ? (
                      <span className="bg-yellow-100 px-2 py-1 rounded">
                        {m.senha_visivel}
                      </span>
                    ) : (
                      <span className="text-cinza-suave">👁 mostrar</span>
                    )}
                  </button>
                ) : (
                  <span className="text-cinza-suave italic">não salva</span>
                )}
              </td>
              <td className="py-3 pr-3 text-sm text-cinza-suave">
                {formatData(m.criado_em)}
              </td>
              <td className="py-3 pr-3">
                <input
                  type="checkbox"
                  checked={m.ativo}
                  disabled={loadingId === m.id}
                  onChange={(e) => atualizar(m.id, { ativo: e.target.checked })}
                  className="w-5 h-5 cursor-pointer"
                />
              </td>
              <td className="py-3 pr-3">
                <input
                  type="checkbox"
                  checked={m.exige_foto}
                  disabled={loadingId === m.id || m.role === "admin"}
                  onChange={(e) =>
                    atualizar(m.id, { exige_foto: e.target.checked })
                  }
                  className="w-5 h-5 cursor-pointer"
                />
              </td>
              <td className="py-3 pr-3">
                <div className="flex flex-col gap-1 text-sm">
                  <button
                    onClick={() => resetSenha(m.id, m.nome)}
                    disabled={loadingId === m.id}
                    className="text-verde hover:underline text-left"
                  >
                    Resetar senha
                  </button>
                  <button
                    onClick={() => deletar(m.id, m.nome)}
                    disabled={loadingId === m.id}
                    className="text-alerta hover:underline text-left"
                  >
                    Deletar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
