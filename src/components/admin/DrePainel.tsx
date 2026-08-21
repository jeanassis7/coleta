"use client";

import { useState } from "react";
import { formatBRLExato as formatBRL } from "@/lib/format";
import { GRUPOS, type GrupoDre } from "@/lib/plano-contas";
import type { Dre, LinhaDre } from "@/lib/admin/dre";

/**
 * O DRE Ã© PAINEL: sÃ³ leitura, calculado na hora.
 *
 * O que muda Ã© o lanÃ§amento; aqui nada se edita. Foi assim que o Evaner
 * descreveu e Ã© o desenho certo â€” relatÃ³rio que se edita deixa de ser
 * relatÃ³rio.
 *
 * A flecha abre a linha por pessoa (SalÃ¡rios â†’ cada funcionÃ¡rio; Ã“leo
 * comprado â†’ cada motorista).
 */
export function DrePainel({ dre }: { dre: Dre }) {
  const [aberta, setAberta] = useState<string | null>(null);

  const linhasDe = (g: GrupoDre) =>
    dre.linhas.filter((l) => l.grupo === g && (l.valor !== 0 || l.porPessoa));

  return (
    <div className="card">
      <table className="w-full text-sm">
        <tbody>
          {GRUPOS.map((g) => {
            const linhas = linhasDe(g.chave);
            if (linhas.length === 0) return null;
            return (
              <GrupoBloco
                key={g.chave}
                titulo={g.label}
                linhas={linhas}
                aberta={aberta}
                setAberta={setAberta}
                subtotais={subtotaisDepois(g.chave, dre)}
              />
            );
          })}
        </tbody>
      </table>

      <div className="mt-6 pt-4 border-t-2 border-preto flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-lg font-bold">Resultado do perÃ­odo</span>
        <span
          className={`text-3xl font-bold ${
            dre.resultado < 0 ? "text-alerta" : "text-verde"
          }`}
        >
          {formatBRL(dre.resultado)}
        </span>
      </div>
    </div>
  );
}

/** Os cortes que entram DEPOIS de cada grupo. */
function subtotaisDepois(
  grupo: GrupoDre,
  dre: Dre
): { label: string; valor: number; forte?: boolean }[] {
  if (grupo === "custo_oleo") {
    return [
      {
        label: "Margem bruta",
        valor: dre.margemBruta,
        forte: true,
      },
    ];
  }
  if (grupo === "fixa") {
    return [
      {
        label: "Resultado operacional",
        valor: dre.resultadoOperacional,
        forte: true,
      },
    ];
  }
  return [];
}

function GrupoBloco({
  titulo,
  linhas,
  aberta,
  setAberta,
  subtotais,
}: {
  titulo: string;
  linhas: LinhaDre[];
  aberta: string | null;
  setAberta: (c: string | null) => void;
  subtotais: { label: string; valor: number; forte?: boolean }[];
}) {
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const receita = linhas[0]?.grupo === "receita";

  return (
    <>
      <tr>
        <td colSpan={2} className="pt-5 pb-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-bold text-cinza-suave tracking-wide uppercase">
              {receita ? titulo : `(âˆ’) ${titulo}`}
            </span>
            <span className="font-semibold">{formatBRL(total)}</span>
          </div>
        </td>
      </tr>

      {linhas.map((l) => {
        const abre = !!l.porPessoa;
        const aberto = aberta === l.chave;
        return (
          <>
            <tr key={l.chave} className="border-b border-cinza-borda/60">
              <td className="py-2 pl-3">
                {abre ? (
                  <button
                    onClick={() => setAberta(aberto ? null : l.chave)}
                    className="flex items-center gap-1.5 hover:text-verde text-left"
                  >
                    <span
                      className={`transition-transform text-cinza-suave ${
                        aberto ? "rotate-90" : ""
                      }`}
                    >
                      â–¸
                    </span>
                    {l.label}
                  </button>
                ) : (
                  <span className="pl-4">{l.label}</span>
                )}
                {l.vemDe && (
                  <span
                    className="ml-2 text-xs text-cinza-suave"
                    title={`Calculado automaticamente: ${l.vemDe}`}
                  >
                    auto
                  </span>
                )}
              </td>
              <td className="py-2 pr-1 text-right font-mono whitespace-nowrap">
                {formatBRL(l.valor)}
              </td>
            </tr>

            {aberto &&
              l.porPessoa?.map((p) => (
                <tr key={`${l.chave}:${p.id}`} className="bg-slate-50">
                  <td className="py-1.5 pl-12 text-cinza-suave">{p.nome}</td>
                  <td className="py-1.5 pr-1 text-right font-mono text-cinza-suave whitespace-nowrap">
                    {formatBRL(p.valor)}
                  </td>
                </tr>
              ))}
          </>
        );
      })}

      {subtotais.map((s) => (
        <tr key={s.label}>
          <td colSpan={2} className="pt-3">
            <div
              className={`flex items-baseline justify-between gap-3 border-t border-cinza-borda pt-2 ${
                s.forte ? "font-bold" : ""
              }`}
            >
              <span>= {s.label}</span>
              <span
                className={`font-mono ${s.valor < 0 ? "text-alerta" : ""}`}
              >
                {formatBRL(s.valor)}
              </span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
