import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * O cheque tem DOIS RELÓGIOS:
 *   • a dívida do comprador quita quando ele entrega o papel
 *   • o dinheiro entra quando o cheque compensa
 * Por isso "em carteira" não é caixa, e devolver ressuscita a dívida sozinho
 * (a saldo_compradores() ignora recebimento de cheque devolvido).
 *
 * Cada ação declara DE QUAIS estados ela pode sair. O update carrega esses
 * estados no WHERE — se voltar 0 linhas, alguém já mexeu no cheque em outra
 * aba e a resposta é 409 em vez de sobrescrever em silêncio. Mesmo padrão
 * do aceite de adiantamento.
 */
const TRANSICOES: Record<
  string,
  { de: string[]; para: string; carimbo: string }
> = {
  depositar: {
    de: ["em_carteira", "devolvido"], // devolvido → reapresentado no banco
    para: "depositado",
    carimbo: "depositado_em",
  },
  compensar: { de: ["depositado"], para: "compensado", carimbo: "compensado_em" },
  devolver: {
    // 'compensado' entrou pela devolução TARDIA (alínea 22/48, estorno):
    // o banco tira o dinheiro de volta dias depois de compensar. O braço do
    // caixa só soma status='compensado', então o valor sai da conta sozinho;
    // a dívida do comprador renasce como em qualquer devolução.
    de: ["em_carteira", "depositado", "repassado", "compensado"],
    para: "devolvido",
    carimbo: "devolvido_em",
  },
  // ⚠️ `repassar` NÃO existe mais como ação solta.
  //
  // Repassar um cheque é pagar alguma coisa com ele — e todo pagamento tem
  // um motivo, que é um lançamento. Antes existia um botão que só gravava
  // "pra quem foi" em texto livre: o dinheiro saía do patrimônio e o gasto
  // não aparecia no DRE em lugar nenhum.
  //
  // Agora o repasse é CONSEQUÊNCIA de pagar algo. Dois caminhos, os dois
  // criando a despesa:
  //   • conta que já existe  → /admin/contas, pagar com forma = cheque
  //   • gasto na hora        → /admin/lancamentos, "paguei com cheque"
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  // ------------------------------------------------------------------
  // EDITAR os dados do cheque (o OCR erra, o dedo erra)
  // ------------------------------------------------------------------
  // Enquanto o cheque é SÓ PAPEL (carteira/depositado), tudo é corrigível —
  // valor, banco, emitente, número, bom para. O recebimento par acompanha o
  // valor (1:1): cheque e crédito do comprador nunca podem divergir.
  // Compensado, o único conserto é a CONTA em que caiu (errou o banco no
  // modal). Repassado/devolvido não se edita: o papel já pagou uma conta ou
  // já virou dívida de novo — mexer no valor reescreveria fato encerrado.
  if (String(body.acao || "") === "editar") {
    const client = getSupabaseAdmin(admin.id);
    const { data: atual, error: eAtual } = await client
      .from("cheques")
      .select("id, status, recebimento_id, valor")
      .eq("id", id)
      .maybeSingle();
    if (eAtual) return NextResponse.json({ error: eAtual.message }, { status: 400 });
    if (!atual) return NextResponse.json({ error: "cheque não encontrado" }, { status: 404 });

    if (atual.status === "compensado") {
      const contaId = body.conta_id ? String(body.conta_id) : null;
      if (!contaId) {
        return NextResponse.json(
          { error: "diga em qual conta o cheque caiu" },
          { status: 400 }
        );
      }
      const { data: mexeu, error } = await client
        .from("cheques")
        .update({ conta_id: contaId })
        .eq("id", id)
        .eq("status", "compensado")
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!mexeu || mexeu.length === 0) {
        return NextResponse.json(
          { error: "esse cheque já mudou de situação — recarregue a tela" },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (!["em_carteira", "depositado"].includes(atual.status)) {
      return NextResponse.json(
        {
          error:
            atual.status === "repassado"
              ? "cheque repassado não se edita — ele já pagou uma conta; desfaça o pagamento primeiro"
              : "cheque devolvido não se edita — a dívida do comprador já voltou por ele",
        },
        { status: 409 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (body.banco !== undefined) {
      const v = String(body.banco).trim();
      if (!v) return NextResponse.json({ error: "banco não pode ficar vazio" }, { status: 400 });
      updates.banco = v;
    }
    if (body.emitente !== undefined) {
      const v = String(body.emitente).trim();
      if (!v) return NextResponse.json({ error: "emitente não pode ficar vazio" }, { status: 400 });
      updates.emitente = v;
    }
    if (body.numero !== undefined) {
      updates.numero = body.numero ? String(body.numero).trim() : null;
    }
    if (body.bom_para !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.bom_para))) {
        return NextResponse.json({ error: "data do 'bom para' inválida" }, { status: 400 });
      }
      updates.bom_para = body.bom_para;
    }
    let novoValor: number | null = null;
    if (body.valor !== undefined) {
      const v = Number(body.valor);
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json({ error: "valor inválido" }, { status: 400 });
      }
      novoValor = Math.round(v * 100) / 100;
      updates.valor = novoValor;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
    }

    const { data: mexeu, error } = await client
      .from("cheques")
      .update(updates)
      .eq("id", id)
      .in("status", ["em_carteira", "depositado"])
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!mexeu || mexeu.length === 0) {
      return NextResponse.json(
        { error: "esse cheque já mudou de situação — recarregue a tela" },
        { status: 409 }
      );
    }

    if (novoValor !== null && atual.recebimento_id) {
      const { error: eRec } = await client
        .from("recebimentos")
        .update({ valor: novoValor })
        .eq("id", atual.recebimento_id);
      // TUDO OU NADA: cheque de um valor e recebimento de outro é o pior
      // estado possível (o saldo do comprador e o patrimônio divergem).
      if (eRec) {
        await client
          .from("cheques")
          .update({ valor: atual.valor })
          .eq("id", id);
        return NextResponse.json(
          {
            error: `não consegui atualizar o pagamento par do cheque (${eRec.message}) — nada foi alterado, tenta de novo`,
          },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ ok: true });
  }

  const t = TRANSICOES[String(body.acao || "")];
  if (!t) return NextResponse.json({ error: "ação inválida" }, { status: 400 });

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const updates: Record<string, unknown> = {
    status: t.para,
    [t.carimbo]: body.data && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : hoje,
  };

  // COMPENSAR é o único momento em que o cheque vira dinheiro na conta.
  // Em carteira ou depositado o valor ainda não é seu; repassado nem passa
  // pela sua conta (o papel foi embora). Sem a conta aqui, todo cheque que
  // compensasse sumiria do caixa e o saldo ficaria menor que a realidade.
  if (t.para === "compensado") {
    const contaId = body.conta_id ? String(body.conta_id) : null;
    if (!contaId) {
      return NextResponse.json(
        { error: "diga em qual conta o cheque caiu" },
        { status: 400 }
      );
    }
    updates.conta_id = contaId;
  }

  const client = getSupabaseAdmin(admin.id);

  // Guarda o status ATUAL antes de devolver — se a reversão da conta falhar
  // logo abaixo, é pra cá que o cheque volta (tudo-ou-nada).
  let statusAnterior: string | null = null;
  if (t.para === "devolvido") {
    const { data: atual } = await client
      .from("cheques")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    statusAnterior = atual?.status ?? null;
  }

  const { data, error } = await client
    .from("cheques")
    .update(updates)
    .eq("id", id)
    .in("status", t.de)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // -------------------------------------------------------------------
  // Cheque devolvido: TUDO volta
  // -------------------------------------------------------------------
  // A dívida do comprador volta sozinha (a saldo_compradores() já exclui
  // recebimento de cheque devolvido). Mas a conta a pagar que ESTE cheque
  // quitou continuava marcada como paga — no papel você deixava de dever
  // pro posto, e na vida voltava a dever.
  //
  // Sob regime de caixa a despesa tinha contado no dia do repasse; ao
  // reverter ela sai do DRE daquele dia e volta a contar quando for paga de
  // verdade. Um mês fechado pode mudar por causa disso, e é o preço de ser
  // fiel ao caixa — melhor que registrar um pagamento que não aconteceu.
  let contaRevertida: string | null = null;
  let avisoVales: string | null = null;
  if (t.para === "devolvido" && data && data.length > 0) {
    const { data: contas, error: eReversao } = await client
      .from("contas_a_pagar")
      .update({
        status: "a_pagar",
        pago_em: null,
        forma_pagamento: null,
        conta_id: null,
        cheque_id: null,
      })
      .eq("cheque_id", id)
      .eq("status", "paga")
      .select("id, descricao");
    // TUDO OU NADA: se a reversão da conta falhar, o cheque VOLTA pro
    // status anterior e o erro aparece — senão o estado ficava rachado
    // (cheque devolvido + conta paga) com resposta "ok", sem retry possível
    // (devolver de novo daria 409). Erro engolido aqui seria indiagnosticável.
    if (eReversao) {
      if (statusAnterior) {
        await client
          .from("cheques")
          .update({ status: statusAnterior, [t.carimbo]: null })
          .eq("id", id)
          .eq("status", "devolvido");
      }
      return NextResponse.json(
        {
          error: `não consegui reverter a conta que esse cheque pagou (${eReversao.message}) — nada foi alterado, tenta de novo`,
        },
        { status: 500 }
      );
    }
    if (contas && contas.length > 0) {
      contaRevertida = contas[0].descricao as string;
      // Se era um pagamento de salário, os vales que ele tinha quitado
      // voltam a pendentes — o desconto não aconteceu de verdade (o cheque
      // voltou). Quando a conta for paga de novo, o gestor marca de novo.
      const { error: eVales } = await client
        .from("acertos")
        .update({ vale_quitado_em: null, vale_quitado_por: null })
        .in(
          "vale_quitado_por",
          contas.map((c) => c.id as string)
        );
      // A conta já foi revertida — reverter tudo de novo por causa do vale
      // seria pior. Mas falhar CALADO deixava vale quitado por um pagamento
      // que voltou; a tela manda conferir.
      if (eVales) {
        avisoVales = `Não consegui devolver os vales desse pagamento pra lista de pendentes (${eVales.message}) — confira em Adiantamentos.`;
      }
    }
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "esse cheque já mudou de situação — recarregue a tela" },
      { status: 409 }
    );
  }
  return NextResponse.json({
    ok: true,
    cheque: data[0],
    // A tela avisa o que foi desfeito — desfazer calado é pior que não
    // desfazer.
    contaRevertida,
    avisoVales,
  });
}
