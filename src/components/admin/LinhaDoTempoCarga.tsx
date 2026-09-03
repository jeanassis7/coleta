"use client";

import { useState } from "react";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { DrawerDetalhe } from "@/components/admin/DrawerDetalhe";
import type { CargaCompleta } from "@/lib/admin/queries";

type Evento =
  | { tipo: "coleta"; quando: string; dados: CargaCompleta["coletas"][number] }
  | { tipo: "despesa"; quando: string; dados: CargaCompleta["despesas"][number] }
  | {
      tipo: "abastecimento";
      quando: string;
      dados: CargaCompleta["abastecimentos"][number];
    }
  | {
      tipo: "descarga";
      quando: string;
      dados: NonNullable<CargaCompleta["descarga"]>;
    };

const ESTILO: Record<Evento["tipo"], { icone: string; cor: string; rotulo: string }> = {
  coleta: { icone: "🛢", cor: "border-verde", rotulo: "Coleta" },
  abastecimento: { icone: "⛽", cor: "border-slate-700", rotulo: "Abastecimento" },
  despesa: { icone: "💵", cor: "border-yellow-500", rotulo: "Despesa" },
  descarga: { icone: "🏁", cor: "border-red-500", rotulo: "Descarga" },
};

/**
 * Tudo que aconteceu na carga em ordem cronológica, com a foto de cada
 * lançamento ao lado. É aqui que as fotos obrigatórias (despesa,
 * abastecimento, balança) finalmente podem ser auditadas.
 */
export function LinhaDoTempoCarga({ carga }: { carga: CargaCompleta }) {
  // Clicar na coleta abre o MESMO drawer da aba Lista — editar e apagar
  // com a corrente inteira (conta a pagar amarrada, foto, log, saldo do
  // motorista de volta). Reimplementar isso aqui criaria uma segunda dona
  // da mesma regra de dinheiro; a duplicata que o Evaner achou em campo
  // (01/09) precisava ser apagada DESTA tela e não tinha por onde.
  const [coletaAberta, setColetaAberta] = useState<
    CargaCompleta["coletas"][number] | null
  >(null);
  const eventos: Evento[] = [
    ...carga.coletas.map((c) => ({
      tipo: "coleta" as const,
      quando: c.criado_em,
      dados: c,
    })),
    ...carga.despesas.map((d) => ({
      tipo: "despesa" as const,
      quando: d.criado_em,
      dados: d,
    })),
    ...carga.abastecimentos.map((a) => ({
      tipo: "abastecimento" as const,
      quando: a.criado_em,
      dados: a,
    })),
    ...(carga.descarga
      ? [
          {
            tipo: "descarga" as const,
            quando: carga.descarga.criado_em,
            dados: carga.descarga,
          },
        ]
      : []),
  ].sort((a, b) => a.quando.localeCompare(b.quando));

  if (eventos.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Essa carga ainda não tem nenhum lançamento.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {eventos.map((e, i) => {
        const est = ESTILO[e.tipo];
        return (
          <div
            key={`${e.tipo}-${e.dados.id}`}
            onClick={
              e.tipo === "coleta"
                ? () => setColetaAberta(e.dados)
                : undefined
            }
            className={`card border-l-4 ${est.cor} flex items-start gap-3${
              e.tipo === "coleta"
                ? " cursor-pointer hover:border-verde hover:bg-slate-50 transition-colors"
                : ""
            }`}
          >
            <div className="text-xl shrink-0" title={est.rotulo}>
              {est.icone}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-bold text-cinza-suave">
                  {i + 1}. {est.rotulo.toUpperCase()}
                </span>
                <span className="text-xs text-cinza-suave">
                  {formatDataHora(e.quando)}
                </span>
              </div>
              <ConteudoEvento evento={e} />
            </div>
            {/* A lupa da foto não abre o drawer junto. */}
            <div className="shrink-0 pt-1" onClick={(ev) => ev.stopPropagation()}>
              <VisualizadorFoto
                path={
                  e.tipo === "descarga"
                    ? e.dados.foto_papel_path
                    : e.dados.foto_path
                }
                legenda={`${est.rotulo} · ${formatDataHora(e.quando)}`}
              />
            </div>
          </div>
        );
      })}

      {coletaAberta && (
        <DrawerDetalhe
          key={coletaAberta.id}
          coleta={{
            ...coletaAberta,
            // O drawer mostra de quem é a coleta; aqui é sempre o motorista
            // da carga, então não vale uma consulta a mais.
            profiles: { nome: carga.motorista_nome },
          }}
          onClose={() => setColetaAberta(null)}
        />
      )}
    </div>
  );
}

function ConteudoEvento({ evento }: { evento: Evento }) {
  if (evento.tipo === "coleta") {
    const c = evento.dados;
    const rl = c.litros > 0 ? c.valor_pago / c.litros : 0;
    return (
      <>
        <p className="font-medium">
          {c.local_nome}
          {c.lancado_por_admin && (
            <span
              className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300"
              title="Digitada no painel pelo gestor — não veio do celular em campo"
            >
              lançada no painel
            </span>
          )}
        </p>
        <p className="text-sm text-cinza-suave">
          {formatLitros(c.litros)} · {formatBRL(c.valor_pago)} ·{" "}
          {formatBRL(rl)}/L
        </p>
        {c.observacao && (
          <p className="text-sm mt-1 bg-slate-50 border-l-2 border-verde pl-2 py-1">
            {c.observacao}
          </p>
        )}
      </>
    );
  }
  if (evento.tipo === "despesa") {
    const d = evento.dados;
    return (
      <>
        <p className="font-medium">{d.descricao}</p>
        <p className="text-sm text-cinza-suave">{formatBRL(d.valor)}</p>
      </>
    );
  }
  if (evento.tipo === "abastecimento") {
    const a = evento.dados;
    return (
      <>
        <p className="font-medium">{a.posto_nome}</p>
        <p className="text-sm text-cinza-suave">
          {a.litros.toLocaleString("pt-BR")} L · {formatBRL(a.valor)} ·{" "}
          {a.litros > 0 ? `${formatBRL(a.valor / a.litros)}/L` : "—"} · km{" "}
          {a.km_atual.toLocaleString("pt-BR")}
        </p>
      </>
    );
  }
  const d = evento.dados;
  return (
    <>
      <p className="font-medium">
        Líquido {d.peso_liquido_kg.toLocaleString("pt-BR")} kg
      </p>
      <p className="text-sm text-cinza-suave">
        bruto {d.peso_bruto_kg.toLocaleString("pt-BR")} kg − tara{" "}
        {d.peso_tara_kg.toLocaleString("pt-BR")} kg
        {d.litros_estimados
          ? ` · ≈ ${d.litros_estimados.toLocaleString("pt-BR")} L`
          : ""}
        {d.umidade_pct !== null
          ? ` · umidade ${d.umidade_pct}%`
          : d.umidade_nao_analisada
            ? " · análise de umidade não feita"
            : " · umidade pendente"}
      </p>
    </>
  );
}
