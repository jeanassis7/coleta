import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import {
  alocar,
  brl,
  cent,
  conferirPlano,
  gravarPagamento,
  meiosDeDinheiro,
  type ContaParaPagar,
  type Meio,
} from "@/lib/admin/pagar-contas";

/**
 * PAGAMENTO EM LOTE — N contas quitadas por M meios.
 *
 * "Às vezes 3 contas dão R$ 1.000 e um cheque de R$ 1.000 paga. Às vezes 1
 * conta dá R$ 1.000 e cheque de 600 + outro de 400 paga." (Evaner, 15/09)
 *
 * A distribuição e a gravação moram em `@/lib/admin/pagar-contas` — o mesmo
 * motor que o fechamento do posto usa. Aqui fica só o que é desta porta: ler
 * as contas escolhidas, montar os meios e conferir a soma.
 *
 * O SERVIDOR NÃO CONFIA EM NADA QUE VEIO DA TELA: relê as contas e os cheques
 * do banco e refaz a conta. Total mandado pela tela é informação, não
 * autoridade.
 *
 * IDEMPOTÊNCIA: `pagamento_id` vem do navegador. Se a resposta se perder e o
 * gestor clicar de novo, o servidor vê que aquele acerto já existe e recusa.
 */

const n2 = (v: number) => Math.round(v * 100) / 100;

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

  const { data: lidas, error: eContas } = await client
    .from("contas_a_pagar")
    .select(
      "id, valor, vencimento, descricao, fornecedor, categoria, pessoa_id, origem_tipo, origem_id, local_id, divida_id"
    )
    .in("id", contaIds)
    // `prevista` fica DE FORA: o valor dela é chute, e pagar um chute grava no
    // caixa um número que o banco não tem. Ela é confirmada uma a uma antes.
    .eq("status", "a_pagar")
    .order("vencimento")
    .order("id");
  if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });
  const contas = (lidas ?? []) as ContaParaPagar[];
  if (contas.length !== contaIds.length) {
    return NextResponse.json(
      {
        error:
          `só ${contas.length} das ${contaIds.length} contas escolhidas ainda estão em aberto ` +
          `(previsões não entram no lote — confirme o valor delas antes). Nada foi pago; recarregue a tela.`,
      },
      { status: 409 }
    );
  }

  const totalDevido = contas.reduce((s, c) => s + cent(c.valor), 0);

  // -------------------------------------------------------------- os meios
  const dinheiro = meiosDeDinheiro(body);
  if (dinheiro.erro || !dinheiro.meios) {
    return NextResponse.json({ error: dinheiro.erro }, { status: 400 });
  }
  const meios: Meio[] = [...dinheiro.meios];

  const chequeIds: string[] = Array.isArray(body.cheques) ? body.cheques.map(String) : [];
  if (new Set(chequeIds).size !== chequeIds.length) {
    return NextResponse.json({ error: "há cheque repetido na lista" }, { status: 400 });
  }
  if (chequeIds.length > 0) {
    const { data: chs, error: eCh } = await client
      .from("cheques")
      .select("id, valor")
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

  // ---------------------------------------------------- distribui e confere
  const { plano, erro: eAloc } = alocar(contas, meios);
  if (eAloc || !plano) {
    return NextResponse.json(
      { error: `não consegui distribuir os pagamentos (${eAloc}) — nada foi pago` },
      { status: 500 }
    );
  }
  const eConfere = conferirPlano(contas, plano, totalDevido);
  if (eConfere) return NextResponse.json({ error: eConfere }, { status: 500 });

  const r = await gravarPagamento(client, admin.id, {
    pagamentoId,
    data,
    contas,
    meios,
    plano,
    repassadoPara:
      contas.length === 1
        ? String(contas[0].fornecedor || contas[0].descricao)
        : `${contas.length} contas`,
    excedente,
    trocoContaId,
  });
  if (r.erro) {
    return NextResponse.json({ error: r.erro.mensagem }, { status: r.erro.status });
  }

  return NextResponse.json({
    ok: true,
    pagamento_id: pagamentoId,
    contas: contas.length,
    meios: meios.length,
    partidas: r.partidas,
    total: n2(totalDevido / 100),
    troco: excedente > 0 ? n2(excedente / 100) : 0,
    ...(r.avisos.length > 0 ? { avisos: r.avisos } : {}),
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

  // 2) Os PEDAÇOS filhos somem e a mãe volta a valer a conta inteira. A ordem
  //    importa: a FK sem cascade recusaria apagar a mãe antes.
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

  // 3) As mães (e as contas não partidas) voltam a ser devidas, inteiras.
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
      desfeito.push(`${voltaram.length} cheque(s) voltou(aram) pra carteira`);
    }
  }

  desfeito.push(`${maes.length} conta(s) voltou(aram) a ser devida(s)`);
  return NextResponse.json({ ok: true, desfeito });
}
