import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * FECHAMENTO DO POSTO — o acerto periódico das notas assinadas.
 *
 * Três caminhos existem na vida real (levantados com o Evaner, 03/09/2026):
 *   1. paga tudo em cheque;
 *   2. parte em cheque, parte em dinheiro;
 *   3. paga a MAIS em cheque e o posto DEVOLVE dinheiro.
 *
 * ⚠️ O caminho 3 é o motivo desta rota existir. A varredura de 21/08 registrou
 * o buraco: cheque repassado maior que a despesa inflava o resultado, porque
 * o excedente não tinha onde entrar. Aqui ele fica fechado POR CONSTRUÇÃO —
 * pagar a mais sem informar o troco é RECUSADO, não avisado.
 *
 * SOBRE A ALOCAÇÃO: o dinheiro quita as notas mais antigas primeiro e o
 * cheque quita o resto. Quando a fronteira cai NO MEIO de uma nota, ela é
 * dividida em duas contas — uma paga em dinheiro, outra no cheque. É o que
 * aconteceu de verdade: o caixa precisa saber de qual conta saiu cada real,
 * e a soma das duas continua sendo o valor da nota.
 *
 * A primeira versão RECUSAVA esse caso, e travou o Evaner no primeiro
 * acerto real (03/09/2026, sobravam R$ 181,24). Pedir pra ele "ajustar o
 * valor em dinheiro" era pedir pra mudar um pagamento que já aconteceu —
 * o software mandando na realidade, em vez do contrário.
 *
 * Duas contas na mesma origem obrigaram a blindar três `.maybeSingle()` do
 * editor de abastecimento (viraram `.limit(1)`).
 *
 * IDEMPOTÊNCIA: não precisa de client_id. Toda conta é quitada com
 * `.eq("status","a_pagar")`; no reenvio nada está mais em aberto e a rota
 * responde que não há o que fechar. Clique duplo não paga duas vezes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id: postoId } = await params;
  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  const n2 = (v: number) => Math.round(v * 100) / 100;
  const cent = (v: number) => Math.round(Number(v) * 100);

  const data = String(body.data || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data do acerto inválida" }, { status: 400 });
  }

  const contaIds: string[] = Array.isArray(body.contas)
    ? body.contas.map(String)
    : [];
  if (contaIds.length === 0) {
    return NextResponse.json({ error: "escolha ao menos uma nota" }, { status: 400 });
  }

  // ------------------------------------------------------------------
  // O servidor NÃO confia no total que a tela mandou: relê as notas.
  // ------------------------------------------------------------------
  const { data: contas, error: eContas } = await client
    .from("contas_a_pagar")
    .select(
      "id, valor, origem_id, origem_tipo, vencimento, status, categoria, pessoa_id, fornecedor, descricao"
    )
    .in("id", contaIds)
    // No posto se assina nota de combustível E de despesa (palheta, óleo
    // de motor) — 0065. As duas entram no mesmo acerto.
    .in("origem_tipo", ["abastecimento", "despesa"])
    .eq("status", "a_pagar")
    .order("vencimento");
  if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });
  if (!contas || contas.length === 0) {
    return NextResponse.json(
      { error: "nenhuma dessas notas está em aberto — recarregue a tela" },
      { status: 409 }
    );
  }

  // E confere que as notas são MESMO desse posto: id de conta vindo da tela
  // não é prova de nada. Confere nas DUAS origens.
  const origensAb = contas
    .filter((c) => c.origem_tipo === "abastecimento")
    .map((c) => c.origem_id);
  const origensDe = contas
    .filter((c) => c.origem_tipo === "despesa")
    .map((c) => c.origem_id);
  const [{ data: abast }, { data: desps }] = await Promise.all([
    origensAb.length
      ? client.from("abastecimentos").select("id").eq("local_id", postoId).in("id", origensAb)
      : Promise.resolve({ data: [] as { id: string }[] }),
    origensDe.length
      ? client.from("despesas").select("id").eq("local_id", postoId).in("id", origensDe)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const doPosto = new Set([
    ...(abast ?? []).map((a) => a.id),
    ...(desps ?? []).map((d) => d.id),
  ]);
  const foraDoPosto = contas.filter((c) => !doPosto.has(c.origem_id));
  if (foraDoPosto.length > 0) {
    return NextResponse.json(
      { error: "há notas selecionadas que não são desse posto" },
      { status: 400 }
    );
  }

  const totalDevido = contas.reduce((s, c) => s + Number(c.valor), 0);

  // ------------------------------------------------------------------ cheques
  const chequeIds: string[] = Array.isArray(body.cheques)
    ? body.cheques.map(String)
    : [];
  let totalCheques = 0;
  let cheques: { id: string; valor: number }[] = [];
  if (chequeIds.length > 0) {
    const { data: chs, error: eCh } = await client
      .from("cheques")
      .select("id, valor, status")
      .in("id", chequeIds)
      .eq("status", "em_carteira");
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (!chs || chs.length !== chequeIds.length) {
      return NextResponse.json(
        { error: "algum cheque não está mais na carteira — recarregue a tela" },
        { status: 409 }
      );
    }
    cheques = chs.map((c) => ({ id: c.id, valor: Number(c.valor) }));
    totalCheques = cheques.reduce((s, c) => s + c.valor, 0);
  }

  // ----------------------------------------------------------------- dinheiro
  const dinheiroValor = Number(body.dinheiro_valor ?? 0);
  const dinheiroContaId = body.dinheiro_conta_id
    ? String(body.dinheiro_conta_id)
    : null;
  const dinheiroForma = ["dinheiro", "pix", "deposito"].includes(
    String(body.dinheiro_forma)
  )
    ? String(body.dinheiro_forma)
    : "dinheiro";
  if (dinheiroValor > 0 && !dinheiroContaId) {
    return NextResponse.json(
      { error: "diga de qual conta da empresa saiu o dinheiro" },
      { status: 400 }
    );
  }

  const totalPago = n2(totalCheques + (dinheiroValor > 0 ? dinheiroValor : 0));

  if (cent(totalPago) < cent(totalDevido)) {
    return NextResponse.json(
      {
        error:
          `o pagamento (R$ ${totalPago.toFixed(2)}) não cobre as notas ` +
          `escolhidas (R$ ${totalDevido.toFixed(2)}). Faltam R$ ${(
            totalDevido - totalPago
          ).toFixed(2)} — tire uma nota da lista ou acrescente pagamento.`,
      },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------- troco
  const excedente = n2(totalPago - totalDevido);
  const trocoValor = Number(body.troco_valor ?? 0);
  const trocoContaId = body.troco_conta_id ? String(body.troco_conta_id) : null;
  if (excedente > 0) {
    if (cent(trocoValor) !== cent(excedente) || !trocoContaId) {
      return NextResponse.json(
        {
          error:
            `você está pagando R$ ${excedente.toFixed(2)} a mais do que as notas. ` +
            `Informe o troco de R$ ${excedente.toFixed(2)} e em qual conta ele entrou — ` +
            `sem isso esse dinheiro sumiria do caixa e o resultado ficaria inflado.`,
          precisaTroco: true,
          excedente,
        },
        { status: 400 }
      );
    }
  } else if (trocoValor > 0) {
    return NextResponse.json(
      { error: "não há troco: o pagamento é igual ao total das notas" },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------------
  // Alocação: o dinheiro quita notas inteiras; o cheque quita o resto.
  // ------------------------------------------------------------------
  const ordenadas = [...contas].sort((a, b) =>
    String(a.vencimento).localeCompare(String(b.vencimento))
  );
  const porDinheiro: string[] = [];
  let restaDinheiro = cent(dinheiroValor > 0 ? dinheiroValor : 0);
  for (const c of ordenadas) {
    const v = cent(Number(c.valor));
    if (restaDinheiro >= v) {
      porDinheiro.push(c.id);
      restaDinheiro -= v;
    } else {
      break;
    }
  }
  const setDinheiro = new Set(porDinheiro);

  // Sobrou dinheiro sem fechar a próxima nota: ela é paga PELOS DOIS. Vira
  // duas contas, e a soma delas continua sendo o valor original da nota.
  const aDividir =
    restaDinheiro > 0
      ? ordenadas.find((c) => !setDinheiro.has(c.id)) ?? null
      : null;
  if (restaDinheiro > 0 && !aDividir) {
    // Só chega aqui se o dinheiro sozinho passou do total — e aí o excedente
    // é troco, que o bloco acima já exigiu.
    return NextResponse.json(
      {
        error:
          "o dinheiro informado passa do total das notas — registre a diferença como troco",
      },
      { status: 400 }
    );
  }

  const porCheque = ordenadas.filter(
    (c) => !setDinheiro.has(c.id) && c.id !== aDividir?.id
  );

  // ------------------------------------------------------------------
  // Aplica. Os cheques saem da carteira ANTES de quitar qualquer conta:
  // se um deles já tiver sido usado em outra aba, nada é marcado como pago
  // por um papel que não está mais lá (mesma ordem do pagamento avulso).
  // ------------------------------------------------------------------
  for (const ch of cheques) {
    const { data: ok, error } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: data,
        repassado_para: String(body.posto_nome || "").trim() || null,
      })
      .eq("id", ch.id)
      .eq("status", "em_carteira")
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!ok?.length) {
      return NextResponse.json(
        { error: "um cheque saiu da carteira no meio do caminho — recarregue a tela" },
        { status: 409 }
      );
    }
  }

  // Cada nota do cheque leva o id de UM cheque (a coluna é uma só). Quando
  // um maço paga várias notas, todas apontam pro primeiro — é referência,
  // não rateio: o valor de cada nota continua sendo o dela.
  const chequePrincipal = cheques[0]?.id ?? null;

  if (porDinheiro.length > 0) {
    const { error } = await client
      .from("contas_a_pagar")
      .update({
        status: "paga",
        forma_pagamento: dinheiroForma,
        pago_em: data,
        conta_id: dinheiroContaId,
        cheque_id: null,
      })
      .in("id", porDinheiro)
      .eq("status", "a_pagar");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // A NOTA PARTIDA: a original passa a valer a parte paga em dinheiro, e o
  // resto nasce como conta nova já quitada pelo cheque. Mesmo desenho do
  // pagamento parcial que já existe em contas a pagar.
  if (aDividir) {
    const parteDinheiro = n2(restaDinheiro / 100);
    const resto = n2(Number(aDividir.valor) - parteDinheiro);

    const { error: eOrig } = await client
      .from("contas_a_pagar")
      .update({
        valor: parteDinheiro,
        status: "paga",
        forma_pagamento: dinheiroForma,
        pago_em: data,
        conta_id: dinheiroContaId,
        cheque_id: null,
      })
      .eq("id", aDividir.id)
      .eq("status", "a_pagar");
    if (eOrig) {
      return NextResponse.json({ error: eOrig.message }, { status: 400 });
    }

    const { error: eResto } = await client.from("contas_a_pagar").insert({
      descricao: `${aDividir.descricao} (parte em cheque)`,
      fornecedor: aDividir.fornecedor,
      categoria: aDividir.categoria,
      pessoa_id: aDividir.pessoa_id,
      valor: resto,
      vencimento: aDividir.vencimento,
      status: "paga",
      forma_pagamento: "cheque",
      pago_em: data,
      cheque_id: chequePrincipal,
      conta_id: null,
      origem_tipo: aDividir.origem_tipo,
      origem_id: aDividir.origem_id,
      registrado_por: admin.id,
    });
    if (eResto) {
      return NextResponse.json({
        ok: true,
        aviso:
          `a parte em dinheiro foi quitada, mas o resto da nota ` +
          `(R$ ${resto.toFixed(2)}) NÃO foi: ${eResto.message}. ` +
          `Confira em Contas a pagar antes de seguir.`,
      });
    }
  }

  if (porCheque.length > 0) {
    // Pagar com cheque NÃO tira dinheiro de conta nenhuma: quitou com o papel.
    const { error } = await client
      .from("contas_a_pagar")
      .update({
        status: "paga",
        forma_pagamento: "cheque",
        pago_em: data,
        conta_id: null,
        cheque_id: chequePrincipal,
      })
      .in("id", porCheque.map((c) => c.id))
      .eq("status", "a_pagar");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // O troco é dinheiro que ENTRA e não é venda de óleo: entrada avulsa
  // (0047) — soma no caixa e fica FORA do DRE, porque não é resultado.
  if (excedente > 0 && trocoContaId) {
    const { error } = await client.from("entradas_avulsas").insert({
      tipo: "reembolso",
      valor: n2(trocoValor),
      data,
      conta_id: trocoContaId,
      descricao: `Troco do acerto com ${String(body.posto_nome || "o posto").trim()}`,
      registrado_por: admin.id,
    });
    if (error) {
      return NextResponse.json({
        ok: true,
        aviso: `notas quitadas, mas o troco NÃO foi registrado: ${error.message}. Lance a entrada avulsa na mão, senão o caixa fica menor que o extrato.`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    notas: contas.length,
    total: n2(totalDevido),
    em_dinheiro: porDinheiro.length,
    em_cheque: porCheque.length,
    nota_dividida: aDividir ? 1 : 0,
    troco: excedente > 0 ? n2(trocoValor) : 0,
  });
}
