import { getSupabaseServer } from "@/lib/supabase/server";
import {
  PLANO_CONTAS,
  contaEntraNoDre,
  type GrupoDre,
  type LinhaPlano,
} from "@/lib/plano-contas";

/**
 * DRE — por COMPETÊNCIA.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS DECISÕES QUE MUDAM TODO NÚMERO
 * ---------------------------------------------------------------------------
 * 1. **Qual data.** Pra conta a pagar é `coalesce(competencia, vencimento)`.
 *    `competencia` existe pras recorrentes (a conta de luz de março que vence
 *    em abril pesa em março); pro lançamento do extrato os três são o mesmo
 *    dia. Pros lançamentos operacionais é a data do próprio fato.
 *
 * 2. **Quais status.** `a_pagar` + `paga`. Gasto que aconteceu e ainda não foi
 *    pago É gasto do período — é isso que separa competência de caixa.
 *    `prevista` fica de fora: é palpite sobre o futuro e mentiria num mês
 *    fechado. `cancelada` também.
 *
 * ---------------------------------------------------------------------------
 * A REGRA ANTI-DOBRA
 * ---------------------------------------------------------------------------
 * Cada real conta uma vez, na fonte natural dele. Conta a pagar que é espelho
 * de um lançamento operacional (abastecimento "assinei a nota", manutenção a
 * prazo, coleta paga pela sede) fica de fora — ver `contaEntraNoDre`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO É PL/pgSQL
 * ---------------------------------------------------------------------------
 * `saldos_motoristas`, `estoque_atual` e `saldo_contas` são funções no banco
 * porque o cálculo depende de ORDEM ou seria N+1. Aqui não: são 8 somas
 * independentes que rodam num `Promise.all` só. Em TypeScript a regra de
 * negócio fica legível ao lado do plano de contas — e é a regra, não a
 * velocidade, que vai mudar.
 */

export interface LinhaDre {
  chave: string;
  label: string;
  grupo: GrupoDre;
  valor: number;
  /** Só nas linhas que pedem pessoa — é o que a flecha abre. */
  porPessoa?: { id: string; nome: string; valor: number }[];
  vemDe?: string;
}

export interface Dre {
  inicio: string;
  fim: string;
  linhas: LinhaDre[];
  receita: number;
  custoOleo: number;
  margemBruta: number;
  operacional: number;
  fixa: number;
  resultadoOperacional: number;
  financeiro: number;
  impostos: number;
  resultado: number;
}

/** "2026-08-01" → o instante UTC que é 00:00 em Brasília daquele dia. */
function inicioBr(dia: string): string {
  return new Date(`${dia}T00:00:00.000-03:00`).toISOString();
}
/** "2026-08-31" → o instante UTC que é 23:59:59.999 em Brasília daquele dia. */
function fimBr(dia: string): string {
  return new Date(`${dia}T23:59:59.999-03:00`).toISOString();
}

const soma = <T,>(linhas: T[] | null, campo: (t: T) => unknown): number =>
  (linhas ?? []).reduce((s, l) => s + Number(campo(l) || 0), 0);

export async function calcularDre(inicio: string, fim: string): Promise<Dre> {
  const supabase = await getSupabaseServer();
  const de = inicioBr(inicio);
  const ate = fimBr(fim);

  const [
    { data: vendas },
    { data: coletas },
    { data: compras },
    { data: abast },
    { data: manut },
    { data: despesas },
    { data: contas },
    { data: perfis },
  ] = await Promise.all([
    supabase.from("vendas").select("valor_total").gte("data", inicio).lte("data", fim),
    supabase
      .from("coletas")
      .select("valor_pago, pago_pela_sede, motorista_id")
      .gte("criado_em", de)
      .lte("criado_em", ate),
    supabase.from("compras_diretas").select("valor").gte("data", inicio).lte("data", fim),
    supabase.from("abastecimentos").select("valor").gte("criado_em", de).lte("criado_em", ate),
    supabase.from("manutencoes").select("valor, tipo").gte("data", inicio).lte("data", fim),
    supabase.from("despesas").select("valor").gte("criado_em", de).lte("criado_em", ate),
    supabase
      .from("contas_a_pagar")
      .select("valor, categoria, origem_tipo, pessoa_id, vencimento, competencia")
      .in("status", ["a_pagar", "paga"]),
    supabase.from("profiles").select("id, nome"),
  ]);

  const nomePessoa = new Map(
    ((perfis as { id: string; nome: string }[]) ?? []).map((p) => [p.id, p.nome])
  );

  // ------------------------------------------------------------- contas
  // Filtra por competência AQUI e não no banco: a data que vale é
  // `coalesce(competencia, vencimento)`, e o PostgREST não expressa isso num
  // filtro. São poucas centenas de linhas por ano.
  type ContaLinha = {
    valor: number;
    categoria: string;
    origem_tipo: string | null;
    pessoa_id: string | null;
    vencimento: string;
    competencia: string | null;
  };
  const contasNoPeriodo = ((contas as ContaLinha[]) ?? []).filter((c) => {
    if (!contaEntraNoDre(c.origem_tipo)) return false;
    const dia = (c.competencia || c.vencimento).slice(0, 10);
    return dia >= inicio && dia <= fim;
  });

  const porCategoria = new Map<string, ContaLinha[]>();
  for (const c of contasNoPeriodo) {
    const lista = porCategoria.get(c.categoria) ?? [];
    lista.push(c);
    porCategoria.set(c.categoria, lista);
  }

  // ------------------------------------------------------- automáticas
  type Coleta = { valor_pago: number; pago_pela_sede: boolean; motorista_id: string };
  const todasColetas = (coletas as Coleta[]) ?? [];
  const doMotorista = todasColetas.filter((c) => !c.pago_pela_sede);

  const oleoPorMotorista = new Map<string, number>();
  for (const c of doMotorista) {
    oleoPorMotorista.set(
      c.motorista_id,
      (oleoPorMotorista.get(c.motorista_id) ?? 0) + Number(c.valor_pago || 0)
    );
  }

  const manutPorTipo = (tipos: string[]) =>
    soma(
      ((manut as { valor: number; tipo: string }[]) ?? []).filter((m) =>
        tipos.includes(m.tipo)
      ),
      (m) => m.valor
    );

  const automatico: Record<string, number> = {
    venda_oleo: soma(vendas as { valor_total: number }[], (v) => v.valor_total),
    oleo_motorista: soma(doMotorista, (c) => c.valor_pago),
    oleo_sede:
      soma(
        todasColetas.filter((c) => c.pago_pela_sede),
        (c) => c.valor_pago
      ) + soma(compras as { valor: number }[], (c) => c.valor),
    // Fase D. Enquanto não existe vigência de comissão, é zero — e mostrar a
    // linha zerada é melhor que escondê-la: deixa claro que ainda não entra.
    comissao: 0,
    combustivel: soma(abast as { valor: number }[], (a) => a.valor),
    troca_oleo: manutPorTipo(["troca_oleo"]),
    pneus: manutPorTipo(["pneu"]),
    manutencao: manutPorTipo(["revisao", "corretiva", "outro"]),
  };

  // Despesa lançada pelo motorista em campo é custo de viagem — é o que ela
  // é na prática (pedágio, refeição, pequeno reparo na estrada).
  const despesaMotorista = soma(despesas as { valor: number }[], (d) => d.valor);

  // ----------------------------------------------------------- montagem
  const linhas: LinhaDre[] = PLANO_CONTAS.map((p: LinhaPlano) => {
    let valor = 0;
    let porPessoa: LinhaDre["porPessoa"];

    if (p.fonte === "automatico") {
      valor = automatico[p.chave] ?? 0;
      if (p.chave === "oleo_motorista") {
        porPessoa = [...oleoPorMotorista.entries()]
          .map(([id, v]) => ({ id, nome: nomePessoa.get(id) ?? "—", valor: v }))
          .sort((a, b) => b.valor - a.valor);
      }
    } else {
      const daCategoria = porCategoria.get(p.chave) ?? [];
      valor = soma(daCategoria, (c) => c.valor);
      if (p.chave === "custos_viagem") valor += despesaMotorista;
      if (p.pedePessoa) {
        const agrupado = new Map<string, number>();
        for (const c of daCategoria) {
          const k = c.pessoa_id ?? "";
          agrupado.set(k, (agrupado.get(k) ?? 0) + Number(c.valor || 0));
        }
        porPessoa = [...agrupado.entries()]
          .map(([id, v]) => ({
            id,
            nome: id ? nomePessoa.get(id) ?? "—" : "sem pessoa",
            valor: v,
          }))
          .sort((a, b) => b.valor - a.valor);
      }
    }

    return {
      chave: p.chave,
      label: p.label,
      grupo: p.grupo,
      valor,
      porPessoa: porPessoa?.length ? porPessoa : undefined,
      vemDe: p.vemDe,
    };
  });

  const doGrupo = (g: GrupoDre) =>
    linhas.filter((l) => l.grupo === g).reduce((s, l) => s + l.valor, 0);

  const receita = doGrupo("receita");
  const custoOleo = doGrupo("custo_oleo");
  const operacional = doGrupo("operacional");
  const fixa = doGrupo("fixa");
  const financeiro = doGrupo("financeiro");
  const impostos = doGrupo("impostos");

  const margemBruta = receita - custoOleo;
  const resultadoOperacional = margemBruta - operacional - fixa;

  return {
    inicio,
    fim,
    linhas,
    receita,
    custoOleo,
    margemBruta,
    operacional,
    fixa,
    resultadoOperacional,
    financeiro,
    impostos,
    resultado: resultadoOperacional - financeiro - impostos,
  };
}
