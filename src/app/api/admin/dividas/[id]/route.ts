import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH — edita a dívida ou marca como quitada.
 *
 * Editar o valor é o caminho legítimo quando a negociação muda (juro que
 * entrou, acordo refeito): o log (0022) guarda o antes e o depois, então a
 * mudança fica auditável em vez de virar mistério.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  // Nome vazio não é "não mudou": é apagar sem querer. Antes voltava
  // ok:true com o nome antigo e nenhuma palavra (régua do dinheiro #6).
  if (body.credor !== undefined) {
    const c = String(body.credor).trim();
    if (!c) {
      return NextResponse.json({ error: "diga a quem a empresa deve" }, { status: 400 });
    }
    updates.credor = c;
  }
  if (body.valor_total != null) {
    const v = Number(body.valor_total);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: "valor total inválido" }, { status: 400 });
    }
    updates.valor_total = Math.round(v * 100) / 100;
  }
  if (body.parcelas_total !== undefined) {
    if (body.parcelas_total == null) {
      updates.parcelas_total = null;
    } else {
      const n = Number(body.parcelas_total);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "número de parcelas inválido (tem que ser inteiro positivo)" },
          { status: 400 }
        );
      }
      updates.parcelas_total = n;
    }
  }
  if (body.valor_parcela !== undefined) {
    updates.valor_parcela = body.valor_parcela
      ? Math.round(Number(body.valor_parcela) * 100) / 100
      : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao ? String(body.observacao).trim() : null;
  }
  if (body.primeira_em !== undefined) {
    updates.primeira_em =
      typeof body.primeira_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.primeira_em)
        ? body.primeira_em
        : null;
  }

  // Quitar / reabrir. A data é obrigatória no banco quando quitada (CHECK).
  if (body.status === "quitada") {
    updates.status = "quitada";
    updates.quitada_em =
      typeof body.quitada_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.quitada_em)
        ? body.quitada_em
        : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  } else if (body.status === "aberta") {
    updates.status = "aberta";
    updates.quitada_em = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);

  // ---------------------------------------------------------------------
  // A MESMA conferência do POST — que faltava aqui (achado da auditoria de
  // 21/08). Guard que existe na criação e falta na edição é o padrão que
  // deixou passar o buraco do pagamento acima do saldo: sem isto, trocar a
  // parcela pra 1.200 e esquecer o total deixava "8 de 8 parcelas" com
  // R$ 86.400 ainda em aberto, sem nada dizer que a conta não fecha.
  // ---------------------------------------------------------------------
  const { data: atual } = await client
    .from("dividas")
    .select("tipo, valor_total, parcelas_total, valor_parcela")
    .eq("id", id)
    .maybeSingle();
  if (!atual) return NextResponse.json({ error: "dívida não encontrada" }, { status: 404 });

  const tipo = atual.tipo as string;
  const vTotal = Number(updates.valor_total ?? atual.valor_total);
  const nParc = Number(updates.parcelas_total ?? atual.parcelas_total ?? 0);
  const vParc = Number(updates.valor_parcela ?? atual.valor_parcela ?? 0);
  if (tipo === "parcelada" && nParc > 0 && vParc > 0 && !body.confirmado) {
    const soma = Math.round(nParc * vParc * 100) / 100;
    const dif = Math.abs(soma - Math.round(vTotal * 100) / 100);
    if (dif > Math.max(1, vTotal * 0.02)) {
      return NextResponse.json(
        {
          error: `${nParc}× ${vParc.toFixed(2)} dá ${soma.toFixed(
            2
          )}, e o total é ${vTotal.toFixed(
            2
          )}. Confira — se estiver certo mesmo (entrada, juro na última), confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  const { error } = await client.from("dividas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — só dívida que nunca recebeu pagamento.
 *
 * Com pagamento vinculado, apagar deixaria aquele dinheiro pagando o nada:
 * o lançamento continua no DRE (é real) mas perde a que dívida se referia.
 * Quem terminou de pagar QUITA; quem cadastrou errado apaga.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { count } = await client
    .from("contas_a_pagar")
    .select("id", { count: "exact", head: true })
    .eq("divida_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Essa dívida já tem ${count} pagamento(s) vinculado(s) e não pode ser apagada — o histórico do dinheiro ficaria sem dono. Se ela acabou, marque como quitada.`,
      },
      { status: 409 }
    );
  }

  const { error } = await client.from("dividas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
