import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;

/**
 * POST: gera as contas do mês a partir das despesas recorrentes ativas.
 *
 * Idempotente pelo índice único (recorrente_id, competencia): clicar duas
 * vezes não duplica o aluguel. Sem magia de fundo — ele clica, vê o que
 * nasceu e edita o que mudou.
 *
 * Recorrente marcada como `aproximada` nasce **prevista**: o valor é chute
 * (energia, IPVA) e não pode contar como dívida real até o boleto chegar.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const competencia =
    typeof body.competencia === "string" && /^\d{4}-\d{2}$/.test(body.competencia)
      ? body.competencia
      : hojeBr.toISOString().slice(0, 7);

  const [ano, mes] = competencia.split("-").map(Number);
  const client = getSupabaseAdmin(admin.id);

  const { data: recorrentes, error } = await client
    .from("despesas_recorrentes")
    .select("*")
    .eq("ativa", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const linhas = (recorrentes || [])
    // Anual só entra no mês dela.
    .filter((r) => r.periodicidade !== "anual" || r.mes_vencimento === mes)
    .map((r) => {
      // Dia 31 num mês de 30 vira o último dia, não escorrega pro mês seguinte.
      const dia = Math.min(r.dia_vencimento, ultimoDia);
      return {
        descricao: r.descricao,
        fornecedor: r.fornecedor,
        categoria: r.categoria,
        valor: r.valor,
        vencimento: `${competencia}-${String(dia).padStart(2, "0")}`,
        status: r.aproximada ? "prevista" : "a_pagar",
        recorrente_id: r.id,
        competencia,
        registrado_por: admin.id,
      };
    });

  if (linhas.length === 0) {
    return NextResponse.json({ ok: true, criadas: 0, competencia });
  }

  // onConflict + ignoreDuplicates: as que já existem são puladas sem erro.
  const { data: criadas, error: eIns } = await client
    .from("contas_a_pagar")
    .upsert(linhas, {
      onConflict: "recorrente_id,competencia",
      ignoreDuplicates: true,
    })
    .select("id");

  if (eIns) return NextResponse.json({ error: eIns.message }, { status: 400 });
  return NextResponse.json({
    ok: true,
    criadas: criadas?.length ?? 0,
    competencia,
  });
}
