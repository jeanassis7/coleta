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
    de: ["em_carteira", "depositado", "repassado"],
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
      .select("descricao");
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
  });
}
