import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { randomUUID } from "node:crypto";
import {
  alocar,
  brl,
  cent,
  conferirPlano,
  gravarPagamento,
  lerCreditos,
  meiosDeDinheiro,
  type ContaParaPagar,
  type Meio,
} from "@/lib/admin/pagar-contas";

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
 * ---------------------------------------------------------------------------
 * ATUALIZADO EM 15/09/2026 — VÁRIOS MEIOS, E UM MOTOR SÓ
 * ---------------------------------------------------------------------------
 * Antes cabia UM pagamento não-cheque por acerto. O caso real do Evaner é
 * "4 notas pagas com 3 cheques + R$ 200 de PIX + R$ 50 em espécie" — agora
 * cabem quantas linhas ele quiser.
 *
 * E a distribuição saiu daqui: mora em `@/lib/admin/pagar-contas`, o mesmo
 * motor do pagamento em lote de Contas a pagar. Duas implementações da mesma
 * regra de dinheiro é exatamente como o buraco do cheque nasceu.
 *
 * A ORDEM DOS MEIOS É O QUE PRESERVA O COMPORTAMENTO ANTIGO: o dinheiro entra
 * antes dos cheques, então ele quita as notas mais antigas e o cheque quita o
 * resto — igual a 03/09. Quando a fronteira cai no meio de uma nota, ela é
 * partida (agora com `conta_pai_id`, então a tela mostra uma linha só).
 *
 * IDEMPOTÊNCIA: toda conta é quitada com `.eq("status","a_pagar")`; no
 * reenvio nada está mais em aberto e a rota responde que não há o que fechar.
 */

const n2 = (v: number) => Math.round(v * 100) / 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id: postoId } = await params;
  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  const data = String(body.data || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data do acerto inválida" }, { status: 400 });
  }

  const contaIds: string[] = Array.isArray(body.contas) ? body.contas.map(String) : [];
  if (contaIds.length === 0) {
    return NextResponse.json({ error: "escolha ao menos uma nota" }, { status: 400 });
  }

  // ------------------------------------------------------------------
  // O servidor NÃO confia no total que a tela mandou: relê as notas.
  // ------------------------------------------------------------------
  const { data: lidas, error: eContas } = await client
    .from("contas_a_pagar")
    .select(
      "id, valor, vencimento, descricao, fornecedor, categoria, pessoa_id, origem_tipo, origem_id, local_id, divida_id"
    )
    .in("id", contaIds)
    // No posto se assina nota de combustível E de despesa (palheta, óleo de
    // motor) — 0065. As duas entram no mesmo acerto.
    .in("origem_tipo", ["abastecimento", "despesa"])
    .eq("status", "a_pagar")
    .order("vencimento")
    .order("id");
  if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });
  const contas = (lidas ?? []) as ContaParaPagar[];
  if (contas.length === 0) {
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
      ? client
          .from("abastecimentos")
          .select("id")
          .eq("local_id", postoId)
          .in("id", origensAb as string[])
      : Promise.resolve({ data: [] as { id: string }[] }),
    origensDe.length
      ? client
          .from("despesas")
          .select("id")
          .eq("local_id", postoId)
          .in("id", origensDe as string[])
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const doPosto = new Set([
    ...(abast ?? []).map((a) => a.id),
    ...(desps ?? []).map((d) => d.id),
  ]);
  if (contas.some((c) => !doPosto.has(c.origem_id as string))) {
    return NextResponse.json(
      { error: "há notas selecionadas que não são desse posto" },
      { status: 400 }
    );
  }

  const totalDevido = contas.reduce((s, c) => s + cent(c.valor), 0);

  // ------------------------------------------------------------- os meios
  // Dinheiro ANTES dos cheques: é o que faz o dinheiro quitar as notas mais
  // antigas e o cheque quitar o resto, como em 03/09.
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

  // Crédito que o posto já devia (0076) entra como meio, do lado do cheque.
  const creditoIds: string[] = Array.isArray(body.creditos)
    ? body.creditos.map(String)
    : [];
  const cr = await lerCreditos(client, creditoIds, postoId);
  if (cr.erro || !cr.meios) {
    return NextResponse.json({ error: cr.erro }, { status: 409 });
  }
  meios.push(...cr.meios);

  if (meios.length === 0) {
    return NextResponse.json(
      { error: "diga com o que essas notas foram pagas" },
      { status: 400 }
    );
  }

  const totalPago = meios.reduce((s, m) => s + m.centavos, 0);
  if (totalPago < totalDevido) {
    return NextResponse.json(
      {
        error:
          `o pagamento (R$ ${brl(totalPago)}) não cobre as notas escolhidas ` +
          `(R$ ${brl(totalDevido)}). Faltam R$ ${brl(totalDevido - totalPago)} — ` +
          `tire uma nota da lista ou acrescente pagamento.`,
      },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------- troco
  const excedente = totalPago - totalDevido;
  const trocoValor = Number(body.troco_valor ?? 0);
  const trocoContaId = body.troco_conta_id ? String(body.troco_conta_id) : null;
  // A sobra tem DOIS destinos possíveis, e um deles é obrigatório: ou o posto
  // devolveu em dinheiro (conta), ou ficou devendo (crédito — 0076). O caso
  // real do CENTRO OESTE é o segundo, e era ele que não tinha onde morar.
  const trocoFicaComOPosto = body.troco_fica_com_o_posto === true;
  if (excedente > 0) {
    if (cent(trocoValor) !== excedente || (!trocoContaId && !trocoFicaComOPosto)) {
      return NextResponse.json(
        {
          error:
            `você está pagando R$ ${brl(excedente)} a mais do que as notas. ` +
            `Diga o que aconteceu com esses R$ ${brl(excedente)}: o posto devolveu ` +
            `em dinheiro (e em qual conta entrou), ou ficou devendo pra você? ` +
            `Sem isso esse valor sumiria.`,
          precisaTroco: true,
          excedente: n2(excedente / 100),
        },
        { status: 400 }
      );
    }
    if (trocoContaId && trocoFicaComOPosto) {
      return NextResponse.json(
        { error: "a sobra ou volta em dinheiro ou fica de crédito — não os dois" },
        { status: 400 }
      );
    }
  } else if (cent(trocoValor) > 0) {
    return NextResponse.json(
      { error: "não há troco: o pagamento é igual ao total das notas" },
      { status: 400 }
    );
  }

  // ---------------------------------------------------- distribui e confere
  const { plano, erro: eAloc } = alocar(contas, meios);
  if (eAloc || !plano) {
    return NextResponse.json(
      { error: `não consegui distribuir o acerto (${eAloc}) — nada foi pago` },
      { status: 500 }
    );
  }
  const eConfere = conferirPlano(contas, plano, totalDevido);
  if (eConfere) return NextResponse.json({ error: eConfere }, { status: 500 });

  const r = await gravarPagamento(client, admin.id, {
    pagamentoId: randomUUID(),
    data,
    contas,
    meios,
    plano,
    repassadoPara: String(body.posto_nome || "").trim() || "posto",
    // O POSTO, não o nome dele (0073). Se um desses cheques voltar, a dívida
    // vai pro saldo do posto certo — em produção existem "Texas", "TEXAS
    // RODOVIA" e "Posto texas" pro mesmo lugar.
    repassadoLocalId: postoId,
    excedente,
    trocoContaId: trocoFicaComOPosto ? null : trocoContaId,
    trocoLocalId: trocoFicaComOPosto ? postoId : null,
  });
  if (r.erro) {
    return NextResponse.json({ error: r.erro.mensagem }, { status: r.erro.status });
  }

  return NextResponse.json({
    ok: true,
    notas: contas.length,
    meios: meios.length,
    total: n2(totalDevido / 100),
    partidas: r.partidas,
    troco: excedente > 0 ? n2(excedente / 100) : 0,
    ...(r.avisos.length > 0 ? { avisos: r.avisos } : {}),
  });
}
