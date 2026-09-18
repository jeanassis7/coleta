import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O MOTOR DO PAGAMENTO — N contas quitadas por M meios.
 *
 * Mora aqui, e não dentro de um endpoint, porque DUAS portas usam a mesma
 * regra: o pagamento em lote de Contas a pagar e o fechamento do posto. Duas
 * implementações da mesma regra de dinheiro é exatamente como o buraco do
 * cheque nasceu — a tela de Lançamentos avisava e a de Contas não, e a
 * diferença passou meses sem ninguém ver.
 *
 * ---------------------------------------------------------------------------
 * O DESENHO: O BANCO PARTE, A TELA JUNTA (0074)
 * ---------------------------------------------------------------------------
 * As contas são quitadas da mais antiga pra mais nova, consumindo os meios na
 * ordem em que vieram. Quando um meio acaba no MEIO de uma conta, ela é
 * PARTIDA: o pedaço original fica com o que aquele meio pagou e o resto vira
 * pedaço novo apontando pra ele (`conta_pai_id`).
 *
 * Cada pedaço carrega EXATAMENTE UM meio — é isso que deixa
 * `forma_pagamento`, `conta_id` e `cheque_id` continuarem valendo 1:1, e por
 * isso `movimentos_caixa`, `saldo_contas()` e o DRE não mudam uma linha.
 *
 * ⚠️ QUEM CHAMA É RESPONSÁVEL POR: ler as contas do banco (com
 * `status = 'a_pagar'`), ler os cheques (com `status = 'em_carteira'`),
 * conferir que o total pago cobre o devido e exigir o troco do excedente.
 * Este módulo não valida autorização nem lê nada da requisição.
 */

const n2 = (v: number) => Math.round(v * 100) / 100;
export const cent = (v: number) => Math.round(Number(v) * 100);
export const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export type Meio =
  | { tipo: "cheque"; id: string; centavos: number }
  // Crédito com o posto (0076): o que ELES já deviam pra gente. Se comporta
  // como um cheque sem papel — nasce inteiro, é gasto inteiro.
  | { tipo: "credito"; id: string; centavos: number }
  | { tipo: "conta"; forma: string; contaId: string; centavos: number };

/** O que o motor precisa saber de cada conta. Quem chama lê do banco. */
export interface ContaParaPagar {
  id: string;
  valor: number;
  vencimento: string;
  descricao: string;
  fornecedor: string | null;
  categoria: string;
  pessoa_id: string | null;
  origem_tipo: string | null;
  origem_id: string | null;
  local_id: string | null;
  divida_id: string | null;
}

export type Pedaco = { conta: ContaParaPagar; centavos: number; meio: Meio };

/**
 * Distribui os meios entre as contas. NÃO grava nada: o plano inteiro fecha
 * na matemática antes de o banco ser tocado.
 */
export function alocar(
  contas: ContaParaPagar[],
  meios: Meio[]
): { plano: Pedaco[]; erro?: undefined } | { plano?: undefined; erro: string } {
  if (meios.length === 0) return { erro: "nenhum meio de pagamento" };
  const plano: Pedaco[] = [];
  let m = 0;
  let sobraDoMeio = meios[0].centavos;
  for (const conta of contas) {
    let falta = cent(conta.valor);
    while (falta > 0) {
      if (m >= meios.length) {
        // Não chega aqui quando quem chama conferiu que o total pago cobre o
        // devido. Se chegasse, seria bug de aritmética — e é melhor recusar
        // tudo do que gravar meia conta paga.
        return { erro: "os meios acabaram antes das contas" };
      }
      const usa = Math.min(falta, sobraDoMeio);
      if (usa > 0) plano.push({ conta, centavos: usa, meio: meios[m] });
      falta -= usa;
      sobraDoMeio -= usa;
      if (sobraDoMeio === 0 && m < meios.length - 1) {
        m += 1;
        sobraDoMeio = meios[m].centavos;
      } else if (sobraDoMeio === 0 && falta > 0) {
        m += 1; // força o erro acima em vez de laço infinito
      }
    }
  }
  return { plano };
}

/**
 * O servidor se confere ANTES de gravar.
 *
 * ⚠️ Depois de partir, o valor ORIGINAL da conta some do banco (a mãe passa a
 * valer só o primeiro pedaço). Ou seja: um erro de distribuição seria
 * INVISÍVEL depois — não dá pra auditar o que não ficou registrado. Recusar é
 * sempre melhor do que gravar um número que ninguém vai conseguir conferir.
 */
export function conferirPlano(
  contas: ContaParaPagar[],
  plano: Pedaco[],
  totalDevido: number
): string | null {
  for (const conta of contas) {
    const soma = plano
      .filter((p) => p.conta.id === conta.id)
      .reduce((s, p) => s + p.centavos, 0);
    if (soma !== cent(conta.valor)) {
      return `erro interno na distribuição do pagamento (a conta "${conta.descricao}" recebeu R$ ${brl(soma)} de R$ ${brl(cent(conta.valor))}). NADA foi pago — avise o Evaner.`;
    }
  }
  const somaPlano = plano.reduce((s, p) => s + p.centavos, 0);
  if (somaPlano !== totalDevido) {
    return `erro interno na distribuição do pagamento (distribuí R$ ${brl(somaPlano)} de R$ ${brl(totalDevido)}). NADA foi pago — avise o Evaner.`;
  }
  return null;
}

const campoDoMeio = (meio: Meio) => {
  if (meio.tipo === "cheque") {
    return { forma_pagamento: "cheque", cheque_id: meio.id, conta_id: null };
  }
  if (meio.tipo === "credito") {
    // Sem `conta_id` de propósito: o dinheiro não saiu de conta nenhuma, saiu
    // de um saldo que o posto já devia. A `movimentos_caixa` ignora linha sem
    // conta, então o caixa continua certo sozinho — igual ao cheque (0070).
    return { forma_pagamento: "credito", cheque_id: null, conta_id: null };
  }
  return { forma_pagamento: meio.forma, cheque_id: null, conta_id: meio.contaId };
};

export interface ResultadoPagamento {
  erro?: { mensagem: string; status: number };
  partidas: number;
  avisos: string[];
}

/**
 * Grava o acerto.
 *
 * Ordem escolhida pra que uma falha interrompa o menos pior:
 *   1. cheques saem da carteira (se um já foi usado, nada mais aconteceu)
 *   2. contas são quitadas/partidas
 *   3. o troco entra no caixa
 */
export async function gravarPagamento(
  client: SupabaseClient,
  adminId: string,
  opts: {
    pagamentoId: string;
    data: string;
    contas: ContaParaPagar[];
    meios: Meio[];
    plano: Pedaco[];
    /** Nome de quem recebeu — vai no `repassado_para` dos cheques. */
    repassadoPara: string;
    /** Posto que recebeu, quando é um (0073) — o nome não basta pra dívida. */
    repassadoLocalId?: string | null;
    excedente: number;
    /** A sobra voltou em dinheiro pra esta conta da empresa. */
    trocoContaId: string | null;
    /** OU a sobra ficou de crédito com este posto (0076). Um dos dois. */
    trocoLocalId?: string | null;
  }
): Promise<ResultadoPagamento> {
  const avisos: string[] = [];
  let partidas = 0;

  // Os créditos usados saem de cena ANTES de qualquer conta ser quitada —
  // mesma ordem do cheque. Se um já tiver sido gasto em outra aba, nada foi
  // marcado como pago por um saldo que não existe mais.
  const creditosUsados = opts.meios.filter(
    (x): x is Extract<Meio, { tipo: "credito" }> => x.tipo === "credito"
  );
  for (const cr of creditosUsados) {
    const { data: ok, error } = await client
      .from("creditos_fornecedor")
      .update({ consumido_em: opts.data, consumido_por: opts.pagamentoId })
      .eq("id", cr.id)
      .is("consumido_em", null)
      .select("id");
    if (error) {
      return { erro: { mensagem: error.message, status: 400 }, partidas, avisos };
    }
    if (!ok?.length) {
      return {
        erro: {
          mensagem:
            "um crédito do posto já tinha sido usado em outro acerto — recarregue a tela",
          status: 409,
        },
        partidas,
        avisos,
      };
    }
  }

  const chequesUsados = opts.meios.filter(
    (x): x is Extract<Meio, { tipo: "cheque" }> => x.tipo === "cheque"
  );

  for (const ch of chequesUsados) {
    const { data: ok, error } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: opts.data,
        repassado_para: opts.repassadoPara.slice(0, 120),
        repassado_local_id: opts.repassadoLocalId ?? null,
        pagamento_id: opts.pagamentoId,
      })
      .eq("id", ch.id)
      .eq("status", "em_carteira")
      .select("id");
    if (error) {
      return { erro: { mensagem: error.message, status: 400 }, partidas, avisos };
    }
    if (!ok?.length) {
      return {
        erro: {
          mensagem: "um cheque saiu da carteira no meio do caminho — recarregue a tela",
          status: 409,
        },
        partidas,
        avisos,
      };
    }
  }

  for (const conta of opts.contas) {
    const pedacos = opts.plano.filter((p) => p.conta.id === conta.id);

    // O PRIMEIRO pedaço reaproveita a conta original — ela guarda a
    // identidade (é ela que a origem aponta e que o histórico conhece).
    const primeiro = pedacos[0];
    const { data: mexeu, error } = await client
      .from("contas_a_pagar")
      .update({
        status: "paga",
        pago_em: opts.data,
        pagamento_id: opts.pagamentoId,
        valor: n2(primeiro.centavos / 100),
        ...campoDoMeio(primeiro.meio),
      })
      .eq("id", conta.id)
      .eq("status", "a_pagar")
      .select("id");
    if (error) {
      return { erro: { mensagem: error.message, status: 400 }, partidas, avisos };
    }
    if (!mexeu?.length) {
      return {
        erro: {
          mensagem: `a conta "${conta.descricao}" mudou de situação no meio do caminho — parte do lote pode ter sido paga. Recarregue a tela e confira antes de repetir.`,
          status: 409,
        },
        partidas,
        avisos,
      };
    }

    for (const p of pedacos.slice(1)) {
      partidas += 1;
      const { error: ePedaco } = await client.from("contas_a_pagar").insert({
        descricao: conta.descricao,
        fornecedor: conta.fornecedor,
        categoria: conta.categoria,
        pessoa_id: conta.pessoa_id,
        valor: n2(p.centavos / 100),
        vencimento: conta.vencimento,
        status: "paga",
        pago_em: opts.data,
        pagamento_id: opts.pagamentoId,
        conta_pai_id: conta.id,
        origem_tipo: conta.origem_tipo,
        origem_id: conta.origem_id,
        local_id: conta.local_id,
        divida_id: conta.divida_id,
        registrado_por: adminId,
        ...campoDoMeio(p.meio),
      });
      if (ePedaco) {
        // O pedaço que faltou é dívida que sumiu: ninguém deve e ninguém
        // pagou. Avisa com o valor exato pra dar pra consertar na mão.
        avisos.push(
          `ATENÇÃO: R$ ${brl(p.centavos)} da conta "${conta.descricao}" NÃO foram registrados (${ePedaco.message}) — essa parte sumiu da dívida; confira em Contas a pagar antes de seguir`
        );
      }
    }
  }

  // O troco é dinheiro que ENTRA e não é venda: entrada avulsa (0047) — soma
  // no caixa e fica FORA do DRE. Carimbada com o cheque de origem (0072)
  // quando o excedente veio de um papel.
  // A sobra ficou COM O POSTO: vira crédito (0076), não entrada de caixa.
  // É o caso real do CENTRO OESTE — o posto abateu todas as notas e ficou
  // devendo R$ 172,77. Sem isto, esse valor sumia e a única lembrança era a
  // cabeça do gestor.
  if (opts.excedente > 0 && opts.trocoLocalId) {
    const ultimo = opts.meios[opts.meios.length - 1];
    const { error: eCredito } = await client.from("creditos_fornecedor").insert({
      local_id: opts.trocoLocalId,
      valor: n2(opts.excedente / 100),
      data: opts.data,
      pagamento_id: opts.pagamentoId,
      cheque_id: ultimo.tipo === "cheque" ? ultimo.id : null,
      observacao: `Sobra do acerto com ${opts.repassadoPara}`,
      registrado_por: adminId,
    });
    if (eCredito) {
      avisos.push(
        `ATENÇÃO: as contas foram pagas, mas o crédito de R$ ${brl(opts.excedente)} com o posto NÃO foi registrado (${eCredito.message}) — esse valor sumiu da lembrança; confira na tela do posto antes de seguir`
      );
    }
  }

  if (opts.excedente > 0 && opts.trocoContaId) {
    const ultimo = opts.meios[opts.meios.length - 1];
    const { error: eTroco } = await client.from("entradas_avulsas").insert({
      tipo: "reembolso",
      valor: n2(opts.excedente / 100),
      data: opts.data,
      conta_id: opts.trocoContaId,
      descricao: `Troco do pagamento de ${opts.repassadoPara}`,
      origem_tipo: ultimo.tipo === "cheque" ? "cheque" : null,
      origem_id: ultimo.tipo === "cheque" ? ultimo.id : null,
      registrado_por: adminId,
    });
    if (eTroco) {
      avisos.push(
        `ATENÇÃO: as contas foram pagas, mas o TROCO de R$ ${brl(opts.excedente)} NÃO entrou no caixa (${eTroco.message}) — lance a entrada avulsa na mão, senão o saldo do app fica menor que o do banco`
      );
    }
  }

  return { partidas, avisos };
}

/**
 * Lê os créditos escolhidos e os devolve como meios.
 *
 * Mora aqui pelo mesmo motivo que o resto do motor: as duas portas (pagamento
 * em lote e fechamento do posto) precisam da mesma leitura, e duas cópias
 * divergem. Só devolve crédito AINDA ABERTO e DO POSTO certo — id vindo da
 * tela não é prova de nada.
 */
export async function lerCreditos(
  client: SupabaseClient,
  ids: string[],
  localId: string | null
): Promise<{ meios: Meio[]; erro?: undefined } | { meios?: undefined; erro: string }> {
  if (ids.length === 0) return { meios: [] };
  if (new Set(ids).size !== ids.length) {
    return { erro: "há crédito repetido na lista" };
  }
  let q = client
    .from("creditos_fornecedor")
    .select("id, valor, local_id")
    .in("id", ids)
    .is("consumido_em", null);
  if (localId) q = q.eq("local_id", localId);
  const { data, error } = await q;
  if (error) return { erro: error.message };
  if (!data || data.length !== ids.length) {
    return {
      erro: "algum crédito já foi usado ou não é desse posto — recarregue a tela",
    };
  }
  return {
    meios: ids.map((id) => {
      const c = data.find((x) => x.id === id)!;
      return { tipo: "credito" as const, id: c.id, centavos: cent(c.valor) };
    }),
  };
}

/**
 * Monta os meios não-cheque a partir do que a tela mandou.
 *
 * Aceita a forma NOVA (lista de linhas) e a ANTIGA do fechamento do posto
 * (um valor só). A antiga continua valendo porque uma aba aberta antes do
 * deploy manda o formato velho — e recusar isso seria transformar um deploy
 * num erro incompreensível no meio de um acerto.
 */
export function meiosDeDinheiro(
  body: Record<string, unknown>
): { meios: Meio[]; erro?: undefined } | { meios?: undefined; erro: string } {
  const meios: Meio[] = [];
  const FORMAS = ["dinheiro", "pix", "deposito", "boleto"];

  const linhas: unknown[] = Array.isArray(body.dinheiro) ? body.dinheiro : [];
  for (const raw of linhas) {
    const l = raw as { forma?: unknown; conta_id?: unknown; valor?: unknown };
    const valor = Number(l.valor);
    if (!Number.isFinite(valor) || cent(valor) <= 0) {
      return { erro: "toda linha de dinheiro precisa de um valor maior que zero" };
    }
    const forma = String(l.forma ?? "dinheiro");
    if (!FORMAS.includes(forma)) return { erro: "forma de pagamento inválida" };
    if (!l.conta_id) {
      return { erro: "diga de qual conta da empresa saiu cada valor" };
    }
    meios.push({
      tipo: "conta",
      forma,
      contaId: String(l.conta_id),
      centavos: cent(valor),
    });
  }

  // Formato antigo do fechamento do posto: um valor só.
  const antigo = Number(body.dinheiro_valor ?? 0);
  if (linhas.length === 0 && cent(antigo) > 0) {
    if (!body.dinheiro_conta_id) {
      return { erro: "diga de qual conta da empresa saiu o dinheiro" };
    }
    const forma = FORMAS.includes(String(body.dinheiro_forma))
      ? String(body.dinheiro_forma)
      : "dinheiro";
    meios.push({
      tipo: "conta",
      forma,
      contaId: String(body.dinheiro_conta_id),
      centavos: cent(antigo),
    });
  }

  return { meios };
}
