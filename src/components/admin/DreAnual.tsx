import { GRUPOS, type GrupoDre } from "@/lib/plano-contas";
import type { Dre, DreAnual } from "@/lib/admin/dre";

/**
 * A grade ANUAL do DRE — o modelo que o Evaner usa desde a planilha:
 * uma coluna por mês, o ano inteiro num olhar. Só leitura, sem flechas —
 * o detalhe (por pessoa, por origem) fica na visão por período, embaixo.
 *
 * Números sem "R$" nas células (o título já diz que é tudo em reais) e
 * SEMPRE com 2 casas — mês zerado vira traço pra não virar poluição.
 */

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const n2 = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Celula({ valor, forte }: { valor: number; forte?: boolean }) {
  if (valor === 0)
    return <td className="py-1.5 px-2 text-right font-mono text-cinza-suave/50">—</td>;
  return (
    <td
      className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${
        valor < 0 ? "text-alerta" : ""
      } ${forte ? "font-bold" : ""}`}
    >
      {n2(valor)}
    </td>
  );
}

function LinhaMeses({
  label,
  valores,
  tipo,
}: {
  label: string;
  valores: number[];
  tipo: "grupo" | "linha" | "subtotal" | "resultado";
}) {
  const total = valores.reduce((s, v) => s + v, 0);
  const estilos = {
    grupo: {
      tr: "border-t border-cinza-borda",
      td: "py-2 px-2 text-xs font-bold text-cinza-suave tracking-wide uppercase whitespace-nowrap",
    },
    linha: { tr: "border-b border-cinza-borda/40", td: "py-1.5 px-2 pl-5 whitespace-nowrap" },
    subtotal: { tr: "border-t border-cinza-borda bg-slate-50", td: "py-2 px-2 font-bold whitespace-nowrap" },
    resultado: { tr: "border-t-2 border-preto bg-slate-50", td: "py-2.5 px-2 font-bold whitespace-nowrap" },
  }[tipo];
  return (
    <tr className={estilos.tr}>
      <td
        className={`sticky left-0 ${
          tipo === "subtotal" || tipo === "resultado" ? "bg-slate-50" : "bg-white"
        } ${estilos.td}`}
      >
        {label}
      </td>
      {valores.map((v, i) => (
        <Celula key={i} valor={v} forte={tipo !== "linha"} />
      ))}
      <Celula valor={total} forte />
    </tr>
  );
}

export function DreAnualGrade({ anual }: { anual: DreAnual }) {
  const { meses } = anual;

  // União das linhas que apareceram em qualquer mês, na ordem do plano
  // (calcularDre já devolve na ordem do plano; "não classificado" cai no fim
  // do grupo dela). Linha 100% zerada no ano fica de fora.
  const porGrupo = new Map<GrupoDre, { chave: string; label: string }[]>();
  for (const d of meses) {
    for (const l of d.linhas) {
      const lista = porGrupo.get(l.grupo) ?? [];
      if (!lista.some((x) => x.chave === l.chave)) lista.push({ chave: l.chave, label: l.label });
      porGrupo.set(l.grupo, lista);
    }
  }
  const valoresDe = (chave: string) =>
    meses.map((d) => d.linhas.find((l) => l.chave === chave)?.valor ?? 0);
  const grupoTotais: Record<GrupoDre, (d: Dre) => number> = {
    receita: (d) => d.receita,
    custo_oleo: (d) => d.custoOleo,
    operacional: (d) => d.operacional,
    fixa: (d) => d.fixa,
    financeiro: (d) => d.financeiro,
    impostos: (d) => d.impostos,
  };

  return (
    <div className="card overflow-x-auto">
      <table className="text-sm min-w-max w-full">
        <thead>
          <tr className="border-b-2 border-preto">
            <th className="sticky left-0 bg-white py-2 px-2 text-left">
              {anual.ano} <span className="text-xs font-normal text-cinza-suave">(valores em R$)</span>
            </th>
            {MESES.map((m) => (
              <th key={m} className="py-2 px-2 text-right font-semibold">
                {m}
              </th>
            ))}
            <th className="py-2 px-2 text-right font-semibold">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {GRUPOS.map((g) => {
            const linhas = (porGrupo.get(g.chave) ?? []).filter((l) =>
              valoresDe(l.chave).some((v) => v !== 0)
            );
            if (linhas.length === 0) return null;
            return (
              <FragmentoGrupo
                key={g.chave}
                grupo={g}
                linhas={linhas}
                meses={meses}
                valoresDe={valoresDe}
                totalDoGrupo={grupoTotais[g.chave]}
              />
            );
          })}
          <LinhaMeses
            label="= RESULTADO"
            valores={meses.map((d) => d.resultado)}
            tipo="resultado"
          />
        </tbody>
      </table>
    </div>
  );
}

function FragmentoGrupo({
  grupo,
  linhas,
  meses,
  valoresDe,
  totalDoGrupo,
}: {
  grupo: { chave: GrupoDre; label: string };
  linhas: { chave: string; label: string }[];
  meses: Dre[];
  valoresDe: (chave: string) => number[];
  totalDoGrupo: (d: Dre) => number;
}) {
  const receita = grupo.chave === "receita";
  return (
    <>
      <LinhaMeses
        label={receita ? grupo.label : `(−) ${grupo.label}`}
        valores={meses.map(totalDoGrupo)}
        tipo="grupo"
      />
      {linhas.map((l) => (
        <LinhaMeses key={l.chave} label={l.label} valores={valoresDe(l.chave)} tipo="linha" />
      ))}
      {grupo.chave === "custo_oleo" && (
        <LinhaMeses
          label="= Margem bruta"
          valores={meses.map((d) => d.margemBruta)}
          tipo="subtotal"
        />
      )}
      {grupo.chave === "fixa" && (
        <LinhaMeses
          label="= Resultado operacional"
          valores={meses.map((d) => d.resultadoOperacional)}
          tipo="subtotal"
        />
      )}
    </>
  );
}
