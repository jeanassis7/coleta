"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/format";
import type { GrupoLog, LinhaLog } from "@/lib/admin/queries";

/**
 * Tradução do registro cru pra português.
 *
 * O gatilho do banco grava o que mudou sem saber o que aquilo significa —
 * é o preço de ele funcionar sozinho em qualquer tabela, inclusive nas que
 * ainda não existem. A leitura humana é montada aqui.
 *
 * Se um dia eu criar uma tabela e esquecer de traduzir, a linha aparece com
 * o nome cru da tabela e do campo. Fica feia, nunca invisível.
 */
const TABELAS: Record<string, string> = {
  coletas: "coleta",
  cargas: "carga",
  descargas: "descarga",
  despesas: "despesa",
  abastecimentos: "abastecimento",
  compras_diretas: "compra direta",
  vendas: "venda",
  recebimentos: "pagamento recebido",
  cheques: "cheque",
  compradores: "comprador",
  contas_a_pagar: "conta a pagar",
  despesas_recorrentes: "despesa recorrente",
  ajustes_estoque: "inventário de estoque",
  adiantamentos: "adiantamento",
  acertos: "acerto",
  caminhoes: "veículo",
  locais: "local",
  profiles: "cadastro de pessoa",
};

const CAMPOS: Record<string, string> = {
  litros: "litros",
  valor_pago: "valor pago",
  valor: "valor",
  valor_total: "valor total",
  preco_kg: "preço por kg",
  local_nome: "local",
  nome: "nome",
  nome_canonico: "nome do local",
  ativo: "ativo",
  status: "situação",
  senha_visivel: "senha",
  tara_kg: "tara",
  capacidade_l: "capacidade",
  placa: "placa",
  pago_pela_sede: "pago pela sede",
  valor_sede: "parte paga pela sede",
  pago_na_hora: "pago na hora",
  vencimento: "vencimento",
  pago_em: "pago em",
  forma_pagamento: "forma de pagamento",
  bom_para: "bom para",
  umidade_pct: "umidade",
  peso_bruto_kg: "peso bruto",
  observacao: "observação",
  exige_foto: "exige foto",
  features: "recursos liberados",
  mostra_saldo_app: "mostra saldo no app",
  ve_log: "vê o log",
  km_final: "km final",
  km_inicial: "km inicial",
  saldo_novo_kg: "saldo contado",
  custo_medio_kg: "custo médio",
};

const CAMPOS_DINHEIRO = new Set([
  "valor",
  "valor_pago",
  "valor_total",
  "valor_saldo",
  "valor_devolvido",
  "valor_vale",
  "perda_valor",
]);

// Campos que só fazem barulho: mudam sozinhos e não dizem nada.
const CAMPOS_ESCONDIDOS = new Set([
  "atualizado_em",
  "criado_em",
  "sincronizado_em",
  "foto_url_cached",
]);

function rotuloCampo(k: string): string {
  return CAMPOS[k] || k.replace(/_/g, " ");
}

function valorLegivel(campo: string, v: unknown): string {
  if (v === null || v === undefined) return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (CAMPOS_DINHEIRO.has(campo) && typeof v === "number") return formatBRL(v);
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function descreverLinha(l: LinhaLog): string {
  const alvo = TABELAS[l.tabela] || l.tabela;
  if (l.acao === "criou") {
    const nome =
      (l.depois?.nome as string) ||
      (l.depois?.local_nome as string) ||
      (l.depois?.descricao as string) ||
      (l.depois?.placa as string) ||
      "";
    return `criou ${alvo}${nome ? ` "${nome}"` : ""}`;
  }
  if (l.acao === "apagou") {
    const nome =
      (l.antes?.nome as string) ||
      (l.antes?.local_nome as string) ||
      (l.antes?.descricao as string) ||
      (l.antes?.placa as string) ||
      "";
    return `apagou ${alvo}${nome ? ` "${nome}"` : ""}`;
  }
  const campos = Object.keys(l.depois || {}).filter(
    (k) => !CAMPOS_ESCONDIDOS.has(k)
  );
  if (campos.length === 0) return `mexeu em ${alvo}`;
  const partes = campos.map(
    (k) =>
      `${rotuloCampo(k)} de ${valorLegivel(k, l.antes?.[k])} para ${valorLegivel(k, l.depois?.[k])}`
  );
  return `mudou ${partes.join(" · ")} em ${alvo}`;
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LogPainel({
  grupos,
  atores,
  tabelas,
  filtroAtor,
  filtroTabela,
}: {
  grupos: GrupoLog[];
  atores: Array<{ id: string; nome: string }>;
  tabelas: string[];
  filtroAtor?: string;
  filtroTabela?: string;
}) {
  return (
    <>
      <form method="get" className="card mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-cinza-suave mb-1">Quem</label>
          <select
            name="ator"
            defaultValue={filtroAtor || ""}
            className="px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">Todos</option>
            {atores.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-cinza-suave mb-1">O quê</label>
          <select
            name="tabela"
            defaultValue={filtroTabela || ""}
            className="px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">Tudo</option>
            {tabelas.map((t) => (
              <option key={t} value={t}>
                {TABELAS[t] || t}
              </option>
            ))}
          </select>
        </div>
        <button className="px-4 py-2 bg-verde text-white rounded-xl font-medium">
          Filtrar
        </button>
      </form>

      {grupos.length === 0 ? (
        <div className="card">
          <p className="text-cinza-suave text-center py-6">
            Nada registrado ainda. O log começa a encher assim que alguém
            alterar algo pelo painel.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {grupos.map((g) => (
            <Grupo key={g.chave} grupo={g} />
          ))}
        </div>
      )}
    </>
  );
}

function Grupo({ grupo }: { grupo: GrupoLog }) {
  const [aberto, setAberto] = useState(false);
  const varias = grupo.linhas.length > 1;
  const primeira = grupo.linhas[0];

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <span className="text-sm text-cinza-suave whitespace-nowrap font-mono pt-0.5">
          {dataHora(grupo.criado_em)}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-semibold">{grupo.ator_nome}</span>{" "}
          <span>{descreverLinha(primeira)}</span>
          {varias && (
            <button
              onClick={() => setAberto((a) => !a)}
              className="ml-2 text-sm text-verde hover:underline"
            >
              {aberto
                ? "esconder"
                : `+ ${grupo.linhas.length - 1} alteração${grupo.linhas.length - 1 > 1 ? "ões" : ""}`}
            </button>
          )}
          {grupo.ator_nome === "não identificado" && (
            <div className="text-xs text-cinza-suave mt-0.5">
              sem nome — alteração feita fora do painel, ou endpoint sem o ator
            </div>
          )}
        </div>
      </div>

      {aberto && (
        <div className="mt-3 pl-4 border-l-2 border-cinza-borda space-y-1">
          {grupo.linhas.slice(1).map((l) => (
            <p key={l.id} className="text-sm text-cinza-suave">
              {descreverLinha(l)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
