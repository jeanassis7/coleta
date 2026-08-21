import { getSupabaseServer } from "@/lib/supabase/server";
import { selectTudo } from "@/lib/supabase/select-tudo";
import { PLANO_CONTAS, type GrupoDre, type LinhaPlano } from "@/lib/plano-contas";

/**
 * DRE — por REGIME DE CAIXA.
 *
 * ---------------------------------------------------------------------------
 * A REGRA, NUMA FRASE
 * ---------------------------------------------------------------------------
 * O DRE é o dinheiro que saiu, classificado. Saiu da conta (ou da mão do
 * motorista) naquele dia → pesa naquele dia.
 *
 * Decisão do Evaner em 19/08/2026, e é a certa aqui por três motivos:
 *  - é como ele já trabalha: olha o extrato e lança linha a linha;
 *  - mantém os números comparáveis com a planilha dele, que é caixa;
 *  - competência daria regime MISTO na prática — as linhas automáticas vêm
 *    da data do fato, e casá-las com contas por vencimento produziria um
 *    relatório que não é nem uma coisa nem outra.
 *
 * O custo conhecido: o mês em que se paga o IPVA fica feio. Já mitigado —
 * o parcelamento das contas a pagar cria uma linha por mês, então compra
 * em 3x se espalha em 3 meses sozinha.
 *
 * ---------------------------------------------------------------------------
 * O QUE CONTA
 * ---------------------------------------------------------------------------
 * 1. **Conta a pagar `paga`**, pela data `pago_em`. Só paga: `a_pagar` é
 *    dívida (o dinheiro não saiu) e `prevista` é palpite.
 *
 * 2. **Lançamento operacional que NÃO virou conta**, pela data dele. Coleta
 *    que o motorista pagou do bolso, abastecimento pago na hora, manutenção
 *    à vista — o dinheiro saiu ali.
 *
 * A anti-dobra cai fora desses dois: se o fato virou conta, ele é ignorado
 * aqui e contado quando a conta for paga. Um `origem_id` aponta o fato, e é
 * ele que diz "esse já tem conta". Nada de lista de origens especiais.
 *
 * ---------------------------------------------------------------------------
 * A RECEITA TAMBÉM É CAIXA
 * ---------------------------------------------------------------------------
 * A receita NÃO é a soma das vendas — é a soma do que **entrou**:
 *
 *   recebimentos que não são cheque  (o dinheiro caiu na hora)
 * + cheques COMPENSADOS              (o papel virou dinheiro)
 *
 * O recebimento em cheque fica de fora de propósito: ele e o cheque
 * compensado são **o mesmo dinheiro**, e somar os dois dobraria a receita.
 * Enquanto o cheque não compensa, a venda existe (o estoque saiu, a dívida do
 * comprador nasceu) mas o DRE ainda não a viu.
 *
 * O Evaner sabe e aceita: um mês bom pode aparecer como mês ruim se a venda
 * foi feita e o dinheiro não entrou — e mais adiante um mês ruim vira bom.
 * A ideia é manter o fluxo de caixa alinhado.
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
const inicioBr = (dia: string) =>
  new Date(`${dia}T00:00:00.000-03:00`).toISOString();
/** "2026-08-31" → o instante UTC que é 23:59:59.999 em Brasília daquele dia. */
const fimBr = (dia: string) =>
  new Date(`${dia}T23:59:59.999-03:00`).toISOString();

const soma = <T,>(linhas: T[] | null, campo: (t: T) => unknown): number =>
  (linhas ?? []).reduce((s, l) => s + Number(campo(l) || 0), 0);

export interface DreAnual {
  ano: number;
  /** Um Dre por mês, janeiro..dezembro. */
  meses: Dre[];
}

/**
 * O ano inteiro, mês a mês — a grade estilo planilha que o Evaner pediu
 * (21/08/2026). Roda o MESMO calcularDre 12 vezes de propósito: qualquer
 * regra nova (anti-dobra, repasse, não-classificado) vale automaticamente
 * na visão anual, sem segunda implementação pra divergir.
 * Em blocos de 3 pra não estourar o pool do Supabase (cada mês são ~11
 * consultas paralelas).
 */
export async function calcularDreAnual(ano: number): Promise<DreAnual> {
  const p = (d: Date) => d.toISOString().slice(0, 10);
  const janelas = Array.from({ length: 12 }, (_, m) => ({
    inicio: p(new Date(Date.UTC(ano, m, 1))),
    fim: p(new Date(Date.UTC(ano, m + 1, 0))),
  }));
  const meses: Dre[] = [];
  for (let i = 0; i < janelas.length; i += 3) {
    const bloco = await Promise.all(
      janelas.slice(i, i + 3).map((j) => calcularDre(j.inicio, j.fim))
    );
    meses.push(...bloco);
  }
  return { ano, meses };
}

export async function calcularDre(inicio: string, fim: string): Promise<Dre> {
  const supabase = await getSupabaseServer();
  const de = inicioBr(inicio);
  const ate = fimBr(fim);

  const [
    { data: recebimentos },
    { data: chequesCompensados },
    { data: chequesRepassados },
    { data: coletas },
    { data: compras },
    { data: abast },
    { data: manut },
    { data: despesas },
    { data: contasPagas },
    { data: origens },
    { data: perfis },
  ] = await Promise.all([
    // Receita = o que ENTROU. Cheque fica de fora aqui e entra pela
    // compensação, na consulta seguinte — senão o mesmo dinheiro dobra.
    // ABATIMENTO também fica de fora: baixa a dívida do comprador sem
    // dinheiro entrar (perdão/desconto combinado, 0047) — receita que
    // nunca virou caixa não é receita sob regime de caixa.
    supabase
      .from("recebimentos")
      .select("valor, forma")
      .not("forma", "in", '("cheque","abatimento")')
      .gte("data", inicio)
      .lte("data", fim),
    supabase
      .from("cheques")
      .select("valor")
      .eq("status", "compensado")
      .gte("compensado_em", inicio)
      .lte("compensado_em", fim),
    // Cheque REPASSADO também é receita — no dia do repasse. É o espelho da
    // regra do gasto (Parte XIII): a conta paga com o cheque conta no dia do
    // repasse; se a despesa conta, a receita que a pagou conta junto, senão
    // todo repasse derrubava o resultado pelo valor do cheque. Decisão do
    // Evaner em 20/08/2026: "usou o cheque pra pagar fornecedor = entrada do
    // cheque e saída pro fornecedor". Se o cheque voltar, o status vira
    // 'devolvido' e ele sai daqui sozinho — igual à conta, que volta a dever.
    supabase
      .from("cheques")
      .select("valor")
      .eq("status", "repassado")
      .gte("repassado_em", inicio)
      .lte("repassado_em", fim),
    supabase
      .from("coletas")
      .select("id, valor_pago, pago_pela_sede, motorista_id")
      .gte("criado_em", de)
      .lte("criado_em", ate),
    supabase.from("compras_diretas").select("id, valor").gte("data", inicio).lte("data", fim),
    supabase
      .from("abastecimentos")
      .select("id, valor, pago_na_hora")
      .gte("criado_em", de)
      .lte("criado_em", ate),
    supabase.from("manutencoes").select("id, valor, tipo").gte("data", inicio).lte("data", fim),
    supabase
      .from("despesas")
      .select("id, valor, pago_na_hora")
      .gte("criado_em", de)
      .lte("criado_em", ate),
    // Só PAGA, e pela data em que foi paga. É o extrato.
    supabase
      .from("contas_a_pagar")
      .select("valor, categoria, pessoa_id")
      .eq("status", "paga")
      .gte("pago_em", inicio)
      .lte("pago_em", fim),
    // Todo fato que já virou conta — em qualquer época. Não pode ser
    // limitado ao período: uma manutenção de março paga em maio tem conta
    // fora da janela, e o fato continuaria contando duas vezes.
    // PAGINADO (selectTudo): esta lista cresce PRA SEMPRE — truncar em 1000
    // faria a anti-dobra falhar aleatoriamente daqui a uns anos.
    selectTudo<{ origem_id: string }>((de, ate) =>
      supabase
        .from("contas_a_pagar")
        .select("origem_id")
        .not("origem_id", "is", null)
        .order("id")
        .range(de, ate)
    ).then((rows) => ({ data: rows, error: null })),
    supabase.from("profiles").select("id, nome"),
  ]);

  const nomePessoa = new Map(
    ((perfis as { id: string; nome: string }[]) ?? []).map((p) => [p.id, p.nome])
  );
  /** Fatos que já têm conta: contam quando a conta for paga, não aqui. */
  const jaTemConta = new Set(
    ((origens as { origem_id: string }[]) ?? []).map((o) => o.origem_id)
  );

  // --------------------------------------------------------- contas pagas
  type ContaPaga = { valor: number; categoria: string; pessoa_id: string | null };
  const porCategoria = new Map<string, ContaPaga[]>();
  for (const c of (contasPagas as ContaPaga[]) ?? []) {
    const lista = porCategoria.get(c.categoria) ?? [];
    lista.push(c);
    porCategoria.set(c.categoria, lista);
  }

  // ------------------------------------------------- lançamentos à vista
  type Coleta = {
    id: string;
    valor_pago: number;
    pago_pela_sede: boolean;
    motorista_id: string;
  };
  const todasColetas = (coletas as Coleta[]) ?? [];
  // Coleta paga pela sede vira conta a pagar (0021) — sai do caixa quando a
  // conta for paga, não quando o óleo foi coletado.
  const doMotorista = todasColetas.filter(
    (c) => !c.pago_pela_sede && !jaTemConta.has(c.id)
  );

  const oleoPorMotorista = new Map<string, number>();
  for (const c of doMotorista) {
    oleoPorMotorista.set(
      c.motorista_id,
      (oleoPorMotorista.get(c.motorista_id) ?? 0) + Number(c.valor_pago || 0)
    );
  }

  type Manut = { id: string; valor: number; tipo: string };
  const manutAVista = ((manut as Manut[]) ?? []).filter(
    (m) => !jaTemConta.has(m.id)
  );
  const manutPorTipo = (tipos: string[]) =>
    soma(manutAVista.filter((m) => tipos.includes(m.tipo)), (m) => m.valor);

  type Abast = { id: string; valor: number; pago_na_hora: boolean };
  const abastAVista = ((abast as Abast[]) ?? []).filter(
    (a) => a.pago_na_hora !== false && !jaTemConta.has(a.id)
  );

  // As três bocas por onde a receita entra — separadas porque o Evaner quer
  // ver DE ONDE o dinheiro está vindo (à vista × papel que compensou × papel
  // que virou pagamento). A linha do DRE mostra o total e abre nas três.
  const receitaAVista = soma(recebimentos as { valor: number }[], (r) => r.valor);
  const receitaChequesCompensados = soma(
    chequesCompensados as { valor: number }[],
    (c) => c.valor
  );
  const receitaChequesRepassados = soma(
    chequesRepassados as { valor: number }[],
    (c) => c.valor
  );

  const automatico: Record<string, number> = {
    venda_oleo:
      receitaAVista + receitaChequesCompensados + receitaChequesRepassados,
    oleo_motorista: soma(doMotorista, (c) => c.valor_pago),
    oleo_sede: soma(
      ((compras as { id: string; valor: number }[]) ?? []).filter(
        (c) => !jaTemConta.has(c.id)
      ),
      (c) => c.valor
    ),
    combustivel: soma(abastAVista, (a) => a.valor),
    troca_oleo: manutPorTipo(["troca_oleo"]),
    pneus: manutPorTipo(["pneu"]),
    manutencao: manutPorTipo(["revisao", "corretiva", "outro"]),
  };

  // Despesa que o motorista lançou em campo é custo de viagem — é o que ela
  // é na prática (pedágio, refeição, pequeno reparo na estrada), e o
  // dinheiro saiu da mão dele naquele dia.
  //
  // ANTI-DOBRA (0047): despesa de NOTA ASSINADA virou conta a pagar — conta
  // quando a conta for paga, não aqui. Sem o filtro, a linha custos_viagem
  // somava a despesa E a conta paga da mesma despesa.
  type Despesa = { id: string; valor: number; pago_na_hora: boolean };
  const despesaMotorista = soma(
    ((despesas as Despesa[]) ?? []).filter(
      (d) => d.pago_na_hora !== false && !jaTemConta.has(d.id)
    ),
    (d) => d.valor
  );

  // ------------------------------------------------------------- montagem
  // Toda categoria de conta paga que entrou em alguma linha é riscada daqui;
  // o que sobrar no final vira a linha "Não classificado" — dinheiro que saiu
  // NUNCA pode simplesmente desaparecer do relatório.
  const categoriasConsumidas = new Set<string>();

  const linhas: LinhaDre[] = PLANO_CONTAS.map((p: LinhaPlano) => {
    let valor = 0;
    let porPessoa: LinhaDre["porPessoa"];

    if (p.fonte === "automatico") {
      // O fato à vista conta pela data dele; o fato que virou conta conta
      // quando a conta é PAGA — e a conta paga entra AQUI, na mesma linha.
      // Sem esta soma, nota assinada, manutenção a prazo e coleta paga pela
      // sede sumiam do DRE ao serem pagas (contavam 0 vezes).
      valor =
        (automatico[p.chave] ?? 0) +
        soma(porCategoria.get(p.chave) ?? [], (c) => c.valor);
      categoriasConsumidas.add(p.chave);
      if (p.chave === "oleo_motorista") {
        porPessoa = [...oleoPorMotorista.entries()]
          .map(([id, v]) => ({ id, nome: nomePessoa.get(id) ?? "—", valor: v }))
          .sort((a, b) => b.valor - a.valor);
      }
      if (p.chave === "venda_oleo") {
        porPessoa = [
          {
            id: "avista",
            nome: "À vista (pix, dinheiro, transferência)",
            valor: receitaAVista,
          },
          {
            id: "cheques_compensados",
            nome: "Cheques compensados",
            valor: receitaChequesCompensados,
          },
          {
            id: "cheques_repassados",
            nome: "Cheques repassados (pagaram contas)",
            valor: receitaChequesRepassados,
          },
        ].filter((l) => l.valor > 0);
      }
    } else {
      const daCategoria = porCategoria.get(p.chave) ?? [];
      valor = soma(daCategoria, (c) => c.valor);
      categoriasConsumidas.add(p.chave);
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

  // Rede de segurança: conta paga com categoria que não é linha de ninguém
  // (dado antigo, categoria que saiu do plano). Em vez de sumir do resultado
  // — o que faria o mês parecer melhor do que foi — vira uma linha visível,
  // pra alguém ver e reclassificar o lançamento.
  const orfas: ContaPaga[] = [];
  for (const [cat, lista] of porCategoria) {
    if (!categoriasConsumidas.has(cat)) orfas.push(...lista);
  }
  if (orfas.length > 0) {
    linhas.push({
      chave: "nao_classificado",
      label: "Não classificado (categoria fora do plano)",
      grupo: "fixa",
      valor: soma(orfas, (c) => c.valor),
      vemDe:
        "contas pagas cuja categoria não existe no plano de contas — reclassifique o lançamento pra sumir daqui",
    });
  }

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
