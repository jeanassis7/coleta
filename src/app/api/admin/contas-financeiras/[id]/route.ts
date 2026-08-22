import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.nome === "string" && body.nome.trim()) {
    updates.nome = body.nome.trim();
  }
  if (body.saldo_inicial != null) {
    const v = Number(body.saldo_inicial);
    if (!Number.isFinite(v)) {
      return NextResponse.json({ error: "saldo inicial inválido" }, { status: 400 });
    }
    updates.saldo_inicial = Math.round(v * 100) / 100;
  }
  if (body.saldo_inicial_em != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.saldo_inicial_em))) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    updates.saldo_inicial_em = body.saldo_inicial_em;
  }
  for (const campo of ["banco", "agencia", "numero", "observacao"]) {
    if (body[campo] !== undefined) {
      updates[campo] = body[campo] ? String(body[campo]).trim() : null;
    }
  }
  if (typeof body.ativa === "boolean") updates.ativa = body.ativa;
  if (body.ordem != null) updates.ordem = Number(body.ordem) || 0;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #1/#6 — mexer no PONTO DE PARTIDA de uma conta que
  // já tem movimento (varredura 21/08)
  // ---------------------------------------------------------------------
  // `saldo_contas()` só soma movimentos com data >= `saldo_inicial_em`.
  // Adiantar a data de corte EXCLUI silenciosamente tudo que é anterior, e
  // mudar o saldo inicial reescreve o saldo de hoje — nos dois casos o
  // número muda sem que nada tenha acontecido de verdade. O DELETE desta
  // rota checa 8 tabelas de uso; o PATCH não checava nenhuma.
  if (updates.saldo_inicial !== undefined || updates.saldo_inicial_em !== undefined) {
    const { data: atual } = await client
      .from("contas_financeiras")
      .select("saldo_inicial, saldo_inicial_em, nome")
      .eq("id", id)
      .maybeSingle();
    const mudouSaldo =
      updates.saldo_inicial !== undefined &&
      Math.round(Number(updates.saldo_inicial) * 100) !==
        Math.round(Number(atual?.saldo_inicial ?? 0) * 100);
    const mudouData =
      updates.saldo_inicial_em !== undefined &&
      String(updates.saldo_inicial_em) !== String(atual?.saldo_inicial_em ?? "").slice(0, 10);

    if ((mudouSaldo || mudouData) && !body.confirmado) {
      const usos = await Promise.all([
        client.from("recebimentos").select("id", { count: "exact", head: true }).eq("conta_id", id),
        client.from("contas_a_pagar").select("id", { count: "exact", head: true }).eq("conta_id", id),
        client.from("adiantamentos").select("id", { count: "exact", head: true }).eq("conta_id", id),
        client.from("acertos").select("id", { count: "exact", head: true }).eq("conta_id", id),
        client.from("transferencias").select("id", { count: "exact", head: true }).eq("conta_origem_id", id),
        client.from("transferencias").select("id", { count: "exact", head: true }).eq("conta_destino_id", id),
        client.from("cheques").select("id", { count: "exact", head: true }).eq("conta_id", id),
        client.from("compras_diretas").select("id", { count: "exact", head: true }).eq("conta_id", id),
      ]);
      const total = usos.reduce((s, u) => s + (u.count ?? 0), 0);
      if (total > 0) {
        return NextResponse.json(
          {
            error:
              `Essa conta já tem ${total} movimento(s). ` +
              (mudouData
                ? "Mudar a data de corte faz o sistema IGNORAR tudo que aconteceu antes dela — o saldo muda sem nada ter acontecido. "
                : "") +
              (mudouSaldo
                ? "Mudar o saldo inicial reescreve o saldo de hoje inteiro. "
                : "") +
              "Se foi erro no cadastro e você quer corrigir mesmo, confirme.",
            precisaConfirmar: true,
          },
          { status: 409 }
        );
      }
    }
  }

  const { error } = await client
    .from("contas_financeiras")
    .update(updates)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — só quando a conta nunca foi usada.
 *
 * Apagar conta com movimento apagaria o lastro de dinheiro que aconteceu de
 * verdade, e o caixa deixaria de fechar sem ninguém entender por quê. Quem
 * parou de usar uma conta DESATIVA (`ativa = false`): ela some das telas de
 * lançamento e o histórico continua de pé.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);

  const usos = await Promise.all([
    client.from("recebimentos").select("id", { count: "exact", head: true }).eq("conta_id", id),
    client.from("contas_a_pagar").select("id", { count: "exact", head: true }).eq("conta_id", id),
    client.from("adiantamentos").select("id", { count: "exact", head: true }).eq("conta_id", id),
    client.from("acertos").select("id", { count: "exact", head: true }).eq("conta_id", id),
    client.from("transferencias").select("id", { count: "exact", head: true }).eq("conta_origem_id", id),
    client.from("transferencias").select("id", { count: "exact", head: true }).eq("conta_destino_id", id),
    // Estes dois entraram depois das outras seis e ficaram fora do guarda:
    // conta usada só por cheque compensado ou compra direta passava daqui e
    // morria no erro cru de FK do Postgres.
    client.from("cheques").select("id", { count: "exact", head: true }).eq("conta_id", id),
    client.from("compras_diretas").select("id", { count: "exact", head: true }).eq("conta_id", id),
  ]);
  const total = usos.reduce((s, u) => s + (u.count ?? 0), 0);

  if (total > 0) {
    return NextResponse.json(
      {
        error: `Essa conta tem ${total} movimento(s) e não pode ser apagada — o caixa deixaria de fechar. Desative em vez de apagar.`,
      },
      { status: 409 }
    );
  }

  const { error } = await client.from("contas_financeiras").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
