import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST /api/admin/cheques/lote — lança os cheques que foram TICADOS.
 *
 * ---------------------------------------------------------------------------
 * UM RECEBIMENTO POR CHEQUE, não um por maço
 * ---------------------------------------------------------------------------
 * `cheques.recebimento_id` é UNIQUE (migration 0017) — de propósito: cheque é
 * "objeto com vida própria", cada um tem seu `bom_para` e seu ciclo, então
 * cada um É um evento de pagamento. Tentar pendurar o maço inteiro num
 * recebimento só bate na constraint.
 *
 * Então o maço vira N recebimentos avulsos (`venda_id` nulo — não é
 * pagamento de uma venda específica), um por cheque, cada um com o cheque
 * dele. A dívida do comprador abate pela soma, igual a qualquer pagamento.
 *
 * Este endpoint não sabe se as linhas vieram de foto ou foram digitadas — e
 * não deve saber. A foto é atalho; a fonte da verdade é o que a pessoa
 * conferiu e ticou.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const comprador_id = String(body.comprador_id || "");
  const data = String(body.data || "").trim();
  const linhas = Array.isArray(body.cheques) ? body.cheques : [];

  if (!comprador_id) {
    return NextResponse.json(
      { error: "diga de qual comprador é o maço" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  if (linhas.length === 0) {
    return NextResponse.json(
      { error: "nenhum cheque conferido — tique os que quer lançar" },
      { status: 400 }
    );
  }

  // Valida TODAS antes de gravar qualquer uma: meio maço lançado é pior que
  // nenhum, porque ninguém sabe onde parou.
  const prontos: {
    client_id: string | null;
    banco: string;
    emitente: string;
    numero: string | null;
    valor: number;
    bom_para: string;
    observacao: string | null;
  }[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const banco = String(l.banco || "").trim();
    const emitente = String(l.emitente || "").trim();
    const bom_para = String(l.bom_para || "").trim();
    const valor = Number(l.valor);
    const ondeEsta = `cheque ${i + 1}`;

    if (!banco) {
      return NextResponse.json(
        { error: `${ondeEsta}: falta o banco` },
        { status: 400 }
      );
    }
    if (!emitente) {
      return NextResponse.json(
        { error: `${ondeEsta}: falta quem emitiu` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: `${ondeEsta}: valor inválido` },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bom_para)) {
      return NextResponse.json(
        { error: `${ondeEsta}: falta a data do "bom para"` },
        { status: 400 }
      );
    }

    prontos.push({
      client_id: l.client_id ? String(l.client_id) : null,
      banco,
      emitente,
      numero: l.numero ? String(l.numero).trim() : null,
      valor: Math.round(valor * 100) / 100,
      bom_para,
      observacao: l.observacao ? String(l.observacao).trim() : null,
    });
  }

  const total = prontos.reduce((s, c) => s + c.valor, 0);
  const rotulo = `Maço de ${prontos.length} cheque${prontos.length === 1 ? "" : "s"}`;

  // UM cliente por handler: os N recebimentos e os N cheques saem agrupados
  // como UMA operação só no /admin/log — é o clique que agrupa, não a linha.
  const client = getSupabaseAdmin(admin.id);

  // Os recebimentos primeiro, de uma vez, pra pegar os ids na mesma ordem.
  const { data: recebs, error: errReceb } = await client
    .from("recebimentos")
    .insert(
      prontos.map((c) => ({
        client_id: c.client_id,
        comprador_id,
        venda_id: null,
        forma: "cheque",
        valor: c.valor,
        data,
        observacao: rotulo,
        registrado_por: admin.id,
      }))
    )
    .select("id");

  // 23505 no client_id = REENVIO: o maço já entrou numa tentativa anterior
  // (internet piscou depois do servidor gravar, o gestor clicou de novo).
  // O insert em lote é tudo-ou-nada, então a tentativa anterior gravou os N
  // recebimentos. Só confere se os cheques também entraram — se o rollback
  // compensatório da vez anterior tiver deixado recebimento sem cheque, os
  // que faltam entram agora. Nada duplica.
  if (errReceb?.code === "23505") {
    const ids = prontos.map((c) => c.client_id).filter((x): x is string => !!x);
    const { data: jaEntraram } = await client
      .from("recebimentos")
      .select("id, client_id")
      .in("client_id", ids);
    const recebPorClientId = new Map(
      (jaEntraram ?? []).map((r) => [r.client_id as string, r.id as string])
    );
    const { data: chequesExistentes } = await client
      .from("cheques")
      .select("recebimento_id")
      .in("recebimento_id", [...recebPorClientId.values()]);
    const temCheque = new Set(
      (chequesExistentes ?? []).map((c) => c.recebimento_id as string)
    );
    const faltantes = prontos.filter(
      (c) =>
        c.client_id &&
        recebPorClientId.has(c.client_id) &&
        !temCheque.has(recebPorClientId.get(c.client_id)!)
    );
    if (faltantes.length > 0) {
      const { error: errCompleta } = await client.from("cheques").insert(
        faltantes.map((c) => ({
          recebimento_id: recebPorClientId.get(c.client_id!)!,
          comprador_id,
          banco: c.banco,
          emitente: c.emitente,
          numero: c.numero,
          valor: c.valor,
          bom_para: c.bom_para,
          status: "em_carteira",
          observacao: c.observacao,
        }))
      );
      if (errCompleta) {
        return NextResponse.json({ error: errCompleta.message }, { status: 400 });
      }
    }
    return NextResponse.json({
      ok: true,
      quantidade: prontos.length,
      total,
      aviso: "esse maço já tinha sido lançado — nada foi duplicado",
    });
  }

  if (errReceb || !recebs || recebs.length !== prontos.length) {
    return NextResponse.json(
      { error: errReceb?.message || "falha ao registrar os recebimentos" },
      { status: 400 }
    );
  }

  const { error: errCheques } = await client.from("cheques").insert(
    prontos.map((c, i) => ({
      recebimento_id: recebs[i].id,
      comprador_id,
      banco: c.banco,
      emitente: c.emitente,
      numero: c.numero,
      valor: c.valor,
      bom_para: c.bom_para,
      status: "em_carteira",
      observacao: c.observacao,
    }))
  );

  if (errCheques) {
    // Recebimento sem cheque abateria a dívida sem o papel existir — pior
    // que falhar. Desfaz todos.
    await client
      .from("recebimentos")
      .delete()
      .in(
        "id",
        recebs.map((r) => r.id)
      );
    return NextResponse.json({ error: errCheques.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, quantidade: prontos.length, total });
}
