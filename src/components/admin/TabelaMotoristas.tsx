"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatData } from "@/lib/format";
import { ModalConfirmar, ModalInputTexto } from "./Modais";

interface Motorista {
  id: string;
  nome: string;
  email: string | null;
  role: string;
  ativo: boolean;
  exige_foto: boolean;
  senha_visivel: string | null;
  mostra_saldo_app?: boolean | null;
  /** profiles.features (jsonb) — hoje só "carga" mora aqui sem coluna própria. */
  features?: Record<string, unknown> | null;
  /** Blindado contra apagar (0049) — motorista de verdade nunca se apaga. */
  protegido?: boolean;
  criado_em: string;
}

/**
 * O que cada toggle FAZ, em português, no title de cada um.
 *
 * Cabeçalho de duas palavras ("Exige foto", "🔒") só faz sentido pra quem
 * escreveu. O texto aqui responde a pergunta do gestor — "o que acontece se
 * eu marcar isso?" — e mora num lugar só, pra cabeçalho e caixinha nunca
 * contarem histórias diferentes.
 */
const AJUDA = {
  ativo:
    "Deixa (ou impede) esta pessoa de entrar no aplicativo. Desmarcar NÃO apaga nada do que ela já lançou — é assim que se tira do ar quem saiu da empresa.",
  exige_foto:
    "Obriga a foto da fachada em toda coleta desse motorista. Sem a foto, a coleta não salva no celular dele.",
  carga:
    "Liga o fluxo de CARGA no celular dele: iniciar carga, escolher caminhão, abastecimento, despesas e descarregar. Desligado, ele enxerga só a tela de coleta. Desligar depois não apaga nada que já foi lançado.",
  saldo:
    "Mostra pra ele quanto tem de dinheiro da empresa na mão, e liga a tela de aceite quando você envia adiantamento. Desligado, adiantamento pendente fica invisível pra ele.",
  protegido:
    "Trava de apagar, e ela não se desliga pelo painel: quem está com o cadeado é inapagável pelo app, inclusive no modo forçado que levaria junto coletas, cargas e dinheiro. Motorista de verdade se DESATIVA (coluna Ativo), nunca se apaga. Perfil de teste nasce sem o cadeado e continua apagável.",
} as const;

export function TabelaMotoristas({ motoristas }: { motoristas: Motorista[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [senhasVisiveis, setSenhasVisiveis] = useState<Set<string>>(new Set());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");
  const [modalSenha, setModalSenha] = useState<{ id: string; nome: string } | null>(null);
  const [modalDeletar, setModalDeletar] = useState<{ id: string; nome: string } | null>(null);
  const [modalForcar, setModalForcar] = useState<{ id: string; nome: string; mensagem: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function mostrarAviso(msg: string) {
    setAviso(msg);
    setTimeout(() => setAviso(null), 8000);
  }

  function iniciarEdicao(id: string, nomeAtual: string) {
    setEditandoId(id);
    setNomeEdit(nomeAtual);
  }

  async function salvarNome(id: string) {
    const novo = nomeEdit.trim();
    if (!novo) {
      mostrarAviso("O nome não pode ficar vazio.");
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
        mostrarAviso("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  async function executarResetSenha(id: string, senha: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/admin/motoristas/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrarAviso("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
      setModalSenha(null);
    }
  }

  /**
   * Liga/desliga uma feature do app (profiles.features).
   *
   * Endpoint diferente do `atualizar`: features moram num jsonb e o servidor
   * faz o merge — mandar o objeto inteiro daqui apagaria o que ele não
   * conhece. É o MESMO endpoint da tela "Liberar recursos no app", então os
   * dois lugares nunca divergem.
   */
  async function toggleFeature(id: string, feature: string, valor: boolean) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/admin/motoristas/${id}/feature`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, valor }),
      });
      if (!res.ok) {
        const err = await res.json();
        mostrarAviso("Erro: " + (err.error || "falha ao mudar o recurso"));
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  async function executarDeletar(id: string, nome: string, forcado: boolean) {
    setLoadingId(id);
    try {
      const res = await fetch(
        `/api/admin/motoristas/${id}${forcado ? "?forcado=1" : ""}`,
        { method: "DELETE" }
      );
      const data = await res.json();

      if (
        res.status === 409 &&
        (data.error === "tem_coletas" || data.error === "tem_movimento")
      ) {
        // Tem coisas dele no banco — segunda confirmação, com a lista do
        // que vai junto (é o fluxo do perfil de TESTE; real se desativa).
        setModalForcar({
          id,
          nome,
          mensagem:
            data.mensagem ||
            `Esse usuário tem ${data.coletas} coleta(s). Apagar tudo de vez?`,
        });
        return;
      }

      if (!res.ok) {
        mostrarAviso("Erro: " + data.error);
      } else {
        const apagadas = data.coletas_deletadas || 0;
        mostrarAviso(
          `${nome} deletado${apagadas > 0 ? ` (${apagadas} coletas apagadas)` : ""}.`
        );
        router.refresh();
      }
    } finally {
      setLoadingId(null);
      setModalDeletar(null);
      if (!forcado) {
        // modalForcar pode ter acabado de abrir — não fechar aqui
      } else {
        setModalForcar(null);
      }
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
            <th className="py-2 pr-3" title={AJUDA.ativo}>
              Ativo
            </th>
            <th className="py-2 pr-3" title={AJUDA.exige_foto}>
              Exige foto
            </th>
            <th className="py-2 pr-3" title={AJUDA.carga}>
              Cargas
            </th>
            <th className="py-2 pr-3" title={AJUDA.saldo}>
              Saldo no app
            </th>
            <th className="py-2 pr-3" title={AJUDA.protegido}>
              🔒
            </th>
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
                    <Link
                      href={`/admin/motoristas/${m.id}`}
                      className="text-verde hover:underline"
                    >
                      {m.nome}
                    </Link>
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
                  // Admin não se desativa por aqui: perderia o painel na hora
                  // e não voltaria sozinho. O servidor também recusa.
                  disabled={loadingId === m.id || m.role === "admin"}
                  title={
                    m.role === "admin"
                      ? "Admin não pode ser desativado pelo painel"
                      : AJUDA.ativo
                  }
                  onChange={(e) => atualizar(m.id, { ativo: e.target.checked })}
                  className="w-5 h-5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
              </td>
              <td className="py-3 pr-3">
                <input
                  type="checkbox"
                  checked={m.exige_foto}
                  disabled={loadingId === m.id || m.role === "admin"}
                  title={AJUDA.exige_foto}
                  onChange={(e) =>
                    atualizar(m.id, { exige_foto: e.target.checked })
                  }
                  className="w-5 h-5 cursor-pointer"
                />
              </td>
              {/* Cargas (features.carga) veio da tela "Liberar recursos no
                  app" pra cá: o gestor já está aqui olhando quem é quem, e
                  trocar de tela pra ligar um toggle era um passo a mais sem
                  motivo. A tela de lá continua existindo com a explicação
                  longa de cada recurso — e usa o MESMO endpoint. */}
              <td className="py-3 pr-3">
                <input
                  type="checkbox"
                  checked={!!m.features?.carga}
                  disabled={loadingId === m.id || m.role !== "motorista"}
                  title={AJUDA.carga}
                  onChange={(e) =>
                    toggleFeature(m.id, "carga", e.target.checked)
                  }
                  className="w-5 h-5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
              </td>
              <td className="py-3 pr-3">
                <input
                  type="checkbox"
                  checked={!!m.mostra_saldo_app}
                  disabled={loadingId === m.id || m.role !== "motorista"}
                  title={AJUDA.saldo}
                  onChange={(e) =>
                    atualizar(m.id, { mostra_saldo_app: e.target.checked })
                  }
                  className="w-5 h-5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
              </td>
              {/* Deixou de ser caixinha (0059): é um ESTADO, não um botão.
                  Enquanto dava pra desmarcar, a trava ficava a dois cliques
                  distraídos do botão que ela protege. */}
              <td className="py-3 pr-3">
                <span
                  title={AJUDA.protegido}
                  className={
                    m.protegido ? "cursor-help" : "cursor-help text-cinza-suave"
                  }
                >
                  {m.protegido ? "🔒" : "—"}
                </span>
              </td>
              <td className="py-3 pr-3">
                <div className="flex flex-col gap-1 text-sm">
                  <button
                    onClick={() => setModalSenha({ id: m.id, nome: m.nome })}
                    disabled={loadingId === m.id}
                    className="text-verde hover:underline text-left"
                  >
                    Resetar senha
                  </button>
                  {/* Admin não é deletável: o usuário sairia do Supabase Auth
                      e só voltaria por script. Perfil protegido idem (0059).
                      O servidor e o banco recusam os dois — esconder o botão
                      é só pra não oferecer o que não vai acontecer. */}
                  {m.role !== "admin" && !m.protegido && (
                    <button
                      onClick={() => setModalDeletar({ id: m.id, nome: m.nome })}
                      disabled={loadingId === m.id}
                      className="text-alerta hover:underline text-left"
                    >
                      Deletar
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aviso && (
        <div className="mt-3 bg-slate-50 border border-cinza-borda rounded-xl p-2 text-sm">
          {aviso}
        </div>
      )}

      {modalSenha && (
        <ModalInputTexto
          titulo={`Nova senha pra ${modalSenha.nome}`}
          descricao="Mínimo 6 caracteres. Fica visível na coluna Senha."
          confirmarLabel="Trocar senha"
          carregando={loadingId === modalSenha.id}
          validar={(v) =>
            v.length >= 6 ? null : "Senha precisa ter ao menos 6 caracteres"
          }
          onConfirmar={(senha) => executarResetSenha(modalSenha.id, senha)}
          onFechar={() => setModalSenha(null)}
        />
      )}

      {modalDeletar && (
        <ModalInputTexto
          titulo={`Deletar ${modalDeletar.nome}?`}
          descricao={`Pra confirmar, digite o nome exato: ${modalDeletar.nome}`}
          confirmarLabel="Deletar"
          perigo
          carregando={loadingId === modalDeletar.id}
          validar={(v) =>
            v.trim() === modalDeletar.nome ? null : "Nome não bateu"
          }
          onConfirmar={() => executarDeletar(modalDeletar.id, modalDeletar.nome, false)}
          onFechar={() => setModalDeletar(null)}
        />
      )}

      {modalForcar && (
        <ModalConfirmar
          titulo={`Apagar TUDO de ${modalForcar.nome}?`}
          descricao={`${modalForcar.mensagem} Cargas, coletas, despesas, abastecimentos, adiantamentos, acertos, contas amarradas e fotos — some tudo, permanentemente.`}
          confirmarLabel="Apagar tudo de vez"
          perigo
          carregando={loadingId === modalForcar.id}
          onConfirmar={() =>
            executarDeletar(modalForcar.id, modalForcar.nome, true)
          }
          onFechar={() => setModalForcar(null)}
        />
      )}
    </div>
  );
}
