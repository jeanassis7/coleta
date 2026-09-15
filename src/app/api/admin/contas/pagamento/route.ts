import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PAGAMENTO EM LOTE — N contas quitadas por M meios.
 *
 * "Às vezes 3 contas dão R$ 1.000 e um cheque de R$ 1.000 paga. Às vezes 1
 * conta dá R$ 1.000 e cheque de 600 + outro de 400 paga." (Evaner, 15/09)
 *
 * MEIO = um cheque da carteira, ou um valor saindo de uma conta financeira
 * (dinheiro, PIX, depósito, boleto). O lote aceita quantos quiser de cada.
 *
 * ---------------------------------------------------------------------------
 * COMO A ALOCAÇÃO FUNCIONA
 * ---------------------------------------------------------------------------
 * As contas são quitadas da mais antiga pra mais nova, consumindo os meios na
 * ordem em que vieram (dinheiro antes de cheque, como o fechamento do posto
 * já fazia). Quando um meio acaba no MEIO de uma conta, ela é PARTIDA: o
 * pedaço original fica com o que aquele meio pagou, e o resto vira pedaço
 * novo apontando pra ele (`conta_pai_id`, 0074).
 *
 * Cada pedaço carrega EXATAMENTE UM meio — é isso que deixa `conta_id` e
 * `cheque_id` continuarem valendo 1:1, e por isso `movimentos_caixa`,
 * `saldo_contas()` e o DRE não mudam uma linha. A tela junta os pedaços.
 *
 * ---------------------------------------------------------------------------
 * O SERVIDOR NÃO CONFIA EM NADA QUE VEIO DA TELA
 * ---------------------------------------------------------------------------
 * Relê as contas e os cheques do banco e refaz a soma. Total mandado pela
 * tela é informação, não autoridade — mesma postura do fechamento do posto.
 *
 * IDEMPOTÊNCIA: `pagamento_id` vem do navegador. Se a resposta se perder e o
 * gestor clicar de novo, o servidor vê que aquele acerto já existe e recusa.
 * Clique duplo não paga duas vezes.
 */

const n2 = (v: number) => Math.round(v * 100) / 100;
const cent = (v: number) => Math.round(Number(v) * 100);
const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

type Meio =
  | { tipo: "cheque"; id: string; centavos: number }
  | { tipo: "conta"; forma: string; contaId: string; centavos: number };

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  // ------------------------------------------------------------ o carimbo
  const pagamentoId = String(body.pagamento_id || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      pagamentoId
    )
  ) {
    return NextResponse.json(
      { error: "identificador do pagamento inválido — recarregue a tela" },
      { status: 400 }
    );
  }
  const { count: jaExiste } = await client
    .from("contas_a_pagar")
    .select("id", { count: "exact", head: true })
    .eq("pagamento_id", pagamentoId);
  if ((jaExiste ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "esse pagamento já foi registrado — se a tela travou, recarregue antes de tentar de novo",
      },
      { status: 409 }
    );
  }

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data = String(body.data || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data do pagamento inválida" }, { status: 400 });
  }
  if (data > hoje) {
    return NextResponse.json(
      { error: "a data do pagamento está no futuro" },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------- as contas
  const contaIds: string[] = Array.isArray(body.contas) ? body.contas.map(String) : [];
  if (contaIds.length === 0) {
    return NextResponse.json({ error: "escolha ao menos uma conta" }, { status: 400 });
  }

  const { data: contas, error: eContas } = await client
    .from("contas_a_pagar")
    .select(
      "id, valor, vencimento, descricao, fornecedor, categoria, pessoa_id, origem_tipo, origem_id, local_id, divida_id"
    )
    .in("id", contaIds)
    // `prevista` fica DE FORA: o valor dela é chute, e pagar um chute grava
    // no caixa um número que o banco não tem. Ela tem que ser confirmada
    // uma a uma antes — a regra já existe no pagamento avulso.
    .eq("status", "a_pagar")
    .order("vencimento")
    .order("id");
  if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });
  if (!contas || contas.length !== contaIds.length) {
    return NextResponse.json(
      {
        error:
          `só ${contas?.length ?? 0} das ${contaIds.length} contas escolhidas ainda estão em aberto ` +
          `(previsões não entram no lote — confirme o valor delas antes). Nada foi pago; recarregue a tela.`,
      },
      { status: 409 }
    );
  }

  const totalDevido = contas.reduce((s, c) => s + cent(c.valor), 0);

  // -------------------------------------------------------------- os meios
  const meios: Meio[] = [];

  // Dinheiro/PIX/depósito/boleto: uma linha por origem do dinheiro.
  const linhas: unknown[] = Array.isArray(body.dinheiro) ? body.dinheiro : [];
  for (const raw of linhas) {
    const l = raw as { forma?: unknown; conta_id?: unknown; valor?: unknown };
    const valor = Number(l.valor);
    if (!Number.isFinite(valor) || cent(valor) <= 0) {
      return NextResponse.json(
        { error: "toda linha de dinheiro precisa de um valor maior que zero" },
        { status: 400 }
      );
    }
    const forma = String(l.forma ?? "dinheiro");
    if (!["dinheiro", "pix", "deposito", "boleto"].includes(forma)) {
      return NextResponse.json({ error: "forma de pagamento inválida" }, { status: 400 });
    }
    if (!l.conta_id) {
      return NextResponse.json(
        { error: "diga de qual conta da empresa saiu cada valor" },
        { status: 400 }
      );
    }
    meios.push({
      tipo: "conta",
      forma,
      contaId: String(l.conta_id),
      centavos: cent(valor),
    });
  }

  // Cheques: o valor é o do PAPEL, lido do banco. A tela não opina.
  const chequeIds: string[] = Array.isArray(body.cheques) ? body.cheques.map(String) : [];
  if (new Set(chequeIds).size !== chequeIds.length) {
    return NextResponse.json({ error: "há cheque repetido na lista" }, { status: 400 });
  }
  if (chequeIds.length > 0) {
    const { data: chs, error: eCh } = await client
      .from("cheques")
      .select("id, valor, banco, numero")
      .in("id", chequeIds)
      .eq("status", "em_carteira");
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (!chs || chs.length !== chequeIds.length) {
      return NextResponse.json(
        { error: "algum cheque não está mais na carteira — recarregue a tela" },
        { status: 409 }
      );
    }
    for (const id of chequeIds) {
      const ch = chs.find((c) => c.id === id)!;
      meios.push({ tipo: "cheque", id: ch.id, centavos: cent(ch.valor) });
    }
  }

  if (meios.length === 0) {
    return NextResponse.json(
      { error: "diga com o que essas contas foram pagas" },
      { status: 400 }
    );
  }

  const totalPago = meios.reduce((s, m) => s + m.centavos, 0);

  if (totalPago < totalDevido) {
    return NextResponse.json(
      {
        error:
          `o pagamento (R$ ${brl(totalPago)}) não cobre as contas escolhidas ` +
          `(R$ ${brl(totalDevido)}). Faltam R$ ${brl(totalDevido - totalPago)} — ` +
          `tire uma conta da lista ou acrescente pagamento.`,
        falta: n2((totalDevido - totalPago) / 100),
      },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------------- troco
  const excedente = totalPago - totalDevido;
  const trocoValor = Number(body.troco_valor ?? 0);
  const trocoContaId = body.troco_conta_id ? String(body.troco_conta_id) : null;
  if (excedente > 0) {
    if (cent(trocoValor) !== excedente || !trocoContaId) {
      return NextResponse.json(
        {
          error:
            `você está pagando R$ ${brl(excedente)} a mais do que as contas. ` +
            `Informe o troco de R$ ${brl(excedente)} e em qual conta ele entrou — ` +
            `sem isso esse dinheiro sumiria do caixa e o resultado ficaria inflado.`,
          precisaTroco: true,
          excedente: n2(excedente / 100),
        },
        { status: 400 }
      );
    }
  } else if (cent(trocoValor) > 0) {
    return NextResponse.json(
      { error: "não há troco: o pagamento é igual ao total das contas" },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------- alocação
  // Conta mais antiga primeiro, consumindo os meios na ordem em que vieram.
  // Nada é gravado aqui: primeiro o plano inteiro fecha na matemática, e só
  // depois o banco é tocado.
  type Pedaco = { conta: (typeof contas)[number]; centavos: number; meio: Meio };
  const plano: Pedaco[] = [];
  let m = 0;
  let sobraDoMeio = meios[0].centavos;
  for (const conta of contas) {
    let falta = cent(conta.valor);
    while (falta > 0) {
      if (m >= meios.length) {
        // Não chega aqui: totalPago >= totalDevido já foi conferido. Se
        // chegasse, seria bug de aritmética — e é melhor recusar tudo do que
        // gravar meia conta paga.
        return NextResponse.json(
          { error: "não consegui distribuir os pagamentos — nada foi pago, avise o Evaner" },
          { status: 500 }
        );
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

  // ------------------------------------------------- o servidor se confere
  // ⚠️ Depois de partir, o valor ORIGINAL da conta some do banco (a mãe passa
  // a valer só o primeiro pedaço). Ou seja: um erro de distribuição aqui
  // seria INVISÍVEL depois — não dá pra auditar o que não ficou registrado.
  //
  // Então a conferência é ANTES de gravar: a soma dos pedaços de cada conta
  // tem que ser exatamente o valor dela, e a soma de tudo tem que ser o
  // total devido. Se não bater, nada é pago. Recusar é sempre melhor do que
  // gravar um número que ninguém vai conseguir conferir.
  for (const conta of contas) {
    const soma = plano
      .filter((p) => p.conta.id === conta.id)
      .reduce((s, p) => s + p.centavos, 0);
    if (soma !== cent(conta.valor)) {
      return NextResponse.json(
        {
          error: `erro interno na distribuição do pagamento (a conta "${conta.descricao}" recebeu R$ ${brl(soma)} de R$ ${brl(cent(conta.valor))}). NADA foi pago — avise o Evaner.`,
        },
        { status: 500 }
      );
    }
  }
  const somaPlano = plano.reduce((s, p) => s + p.centavos, 0);
  if (somaPlano !== totalDevido) {
    return NextResponse.json(
      {
        error: `erro interno na distribuição do pagamento (distribuí R$ ${brl(somaPlano)} de R$ ${brl(totalDevido)}). NADA foi pago — avise o Evaner.`,
      },
      { status: 500 }
    );
  }

  // ------------------------------------------------------------- gravação
  // Ordem escolhida pra que uma falha interrompa o menos pior:
  //   1. cheques saem da carteira (se um já foi usado, nada mais aconteceu)
  //   2. contas são quitadas/partidas
  //   3. troco entra no caixa
  const chequesUsados = meios.filter((x) => x.tipo === "cheque") as Extract<
    Meio,
    { tipo: "cheque" }
  >[];
  const paraQuem =
    contas.length === 1
      ? contas[0].fornecedor || contas[0].descricao
      : `${contas.length} contas`;

  for (const ch of chequesUsados) {
    const { data: ok, error } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: data,
        repassado_para: String(paraQuem).slice(0, 120),
        pagamento_id: pagamentoId,
      })
      .eq("id", ch.id)
      .eq("status", "em_carteira")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!ok?.length) {
      return NextResponse.json(
        { error: "um cheque saiu da carteira no meio do caminho — recarregue a tela" },
        { status: 409 }
      );
    }
  }

  const campoDoMeio = (meio: Meio) =>
    meio.tipo === "cheque"
      ? { forma_pagamento: "cheque", cheque_id: meio.id, conta_id: null }
      : { forma_pagamento: meio.forma, cheque_id: null, conta_id: meio.contaId };

  const avisos: string[] = [];
  let partidas = 0;

  for (const conta of contas) {
    const pedacos = plano.filter((p) => p.conta.id === conta.id);

    // O PRIMEIRO pedaço reaproveita a conta original — ela guarda a
    // identidade (é ela que a origem aponta, é ela que o histórico conhece).
    const primeiro = pedacos[0];
    const { data: mexeu, error } = await client
      .from("contas_a_pagar")
      .update({
        status: "paga",
        pago_em: data,
        pagamento_id: pagamentoId,
        valor: n2(primeiro.centavos / 100),
        ...campoDoMeio(primeiro.meio),
      })
      .eq("id", conta.id)
      .eq("status", "a_pagar")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!mexeu?.length) {
      return NextResponse.json(
        {
          error: `a conta "${conta.descricao}" mudou de situação no meio do caminho — parte do lote pode ter sido paga. Recarregue a tela e confira antes de repetir.`,
        },
        { status: 409 }
      );
    }

    // Os demais viram pedaços novos, apontando pro original.
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
        pago_em: data,
        pagamento_id: pagamentoId,
        conta_pai_id: conta.id,
        origem_tipo: conta.origem_tipo,
        origem_id: conta.origem_id,
        local_id: conta.local_id,
        divida_id: conta.divida_id,
        registrado_por: admin.id,
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
  if (excedente > 0 && trocoContaId) {
    const ultimo = meios[meios.length - 1];
    const { error: eTroco } = await client.from("entradas_avulsas").insert({
      tipo: "reembolso",
      valor: n2(trocoValor),
      data,
      conta_id: trocoContaId,
      descricao: `Troco do pagamento de ${paraQuem}`,
      origem_tipo: ultimo.tipo === "cheque" ? "cheque" : null,
      origem_id: ultimo.tipo === "cheque" ? ultimo.id : null,
      registrado_por: admin.id,
    });
    if (eTroco) {
      avisos.push(
        `ATENÇÃO: as contas foram pagas, mas o TROCO de R$ ${brl(excedente)} NÃO entrou no caixa (${eTroco.message}) — lance a entrada avulsa na mão, senão o saldo do app fica menor que o do banco`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    pagamento_id: pagamentoId,
    contas: contas.length,
    meios: meios.length,
    partidas,
    total: n2(totalDevido / 100),
    troco: excedente > 0 ? n2(excedente / 100) : 0,
    ...(avisos.length > 0 ? { avisos } : {}),
  });
}

/**
 * DELETE — desfazer o acerto inteiro.
 *
 * ⚠️ É tudo ou nada de propósito: desfazer meio acerto deixaria contas pagas
 * por cheques que voltaram pra carteira. O `pagamento_id` é o que torna isso
 * possível — sem ele, "quais contas foram pagas junto?" não teria resposta.
 */
export async function DELETE(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const pagamentoId = String(new URL(req.url).searchParams.get("pagamento_id") || "");
  if (!pagamentoId) {
    return NextResponse.json({ error: "qual pagamento?" }, { status: 400 });
  }

  const { data: contas, error: eLer } = await client
    .from("contas_a_pagar")
    .select("id, valor, descricao, conta_pai_id, origem_tipo, cheque_id")
    .eq("pagamento_id", pagamentoId);
  if (eLer) return NextResponse.json({ error: eLer.message }, { status: 400 });
  if (!contas?.length) {
    return NextResponse.json(
      { error: "esse pagamento não existe mais — recarregue a tela" },
      { status: 409 }
    );
  }

  const desfeito: string[] = [];

  // 1) O troco sai primeiro (mesma ordem inversa do pagamento avulso): se o
  //    cheque voltasse antes e isto falhasse, o caixa ficaria com dinheiro
  //    que entrou por um pagamento que não existe mais.
  const chequesDoAcerto = [...new Set(contas.map((c) => c.cheque_id).filter(Boolean))];
  if (chequesDoAcerto.length > 0) {
    const { data: trocos, error: eTroco } = await client
      .from("entradas_avulsas")
      .delete()
      .eq("origem_tipo", "cheque")
      .in("origem_id", chequesDoAcerto as string[])
      .select("valor");
    if (eTroco) return NextResponse.json({ error: eTroco.message }, { status: 400 });
    if (trocos?.length) {
      const soma = trocos.reduce((s, t) => s + Number(t.valor), 0);
      desfeito.push(`o troco de R$ ${soma.toFixed(2).replace(".", ",")} saiu do caixa junto`);
    }
  }

  // 2) Os PEDAÇOS filhos somem e a mãe volta a valer a conta inteira. A
  //    ordem importa: a FK sem cascade recusaria apagar a mãe antes.
  const filhos = contas.filter((c) => c.conta_pai_id);
  const somaPorMae = new Map<string, number>();
  for (const f of filhos) {
    const k = f.conta_pai_id as string;
    somaPorMae.set(k, (somaPorMae.get(k) ?? 0) + Number(f.valor));
  }
  if (filhos.length > 0) {
    const { error: eFilhos } = await client
      .from("contas_a_pagar")
      .delete()
      .in(
        "id",
        filhos.map((f) => f.id)
      );
    if (eFilhos) return NextResponse.json({ error: eFilhos.message }, { status: 400 });
  }

  // 3) As mães (e as contas não partidas) voltam a ser devidas, pelo valor
  //    inteiro.
  const maes = contas.filter((c) => !c.conta_pai_id);
  for (const mae of maes) {
    const valorInteiro = Number(mae.valor) + (somaPorMae.get(mae.id) ?? 0);
    const { error } = await client
      .from("contas_a_pagar")
      .update({
        status: "a_pagar",
        valor: n2(valorInteiro),
        pago_em: null,
        forma_pagamento: null,
        conta_id: null,
        cheque_id: null,
        pagamento_id: null,
      })
      .eq("id", mae.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // 4) Os cheques voltam pra carteira.
  if (chequesDoAcerto.length > 0) {
    const { data: voltaram, error: eCh } = await client
      .from("cheques")
      .update({
        status: "em_carteira",
        repassado_em: null,
        repassado_para: null,
        repassado_local_id: null,
        pagamento_id: null,
      })
      .in("id", chequesDoAcerto as string[])
      .eq("status", "repassado")
      .select("id");
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (voltaram?.length) {
      desfeito.push(
        `${voltaram.length} cheque(s) voltou(aram) pra carteira`
      );
    }
  }

  desfeito.push(`${maes.length} conta(s) voltou(aram) a ser devida(s)`);
  return NextResponse.json({ ok: true, desfeito });
}
