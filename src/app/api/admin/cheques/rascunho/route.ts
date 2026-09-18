import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * O MAÇO DE CHEQUES EM ANDAMENTO — fotografa no celular, confere no notebook.
 *
 * Guarda só os DADOS que a leitura extraiu. A foto morre na hora, como
 * sempre: quem confere está com os cheques de papel na mesa (0078).
 *
 * ⚠️ ISTO NÃO É DINHEIRO. Nada aqui entra em caixa, estoque ou DRE — é um
 * bloco de rascunho. O maço só vira cheque de verdade quando passa pelo
 * `/api/admin/cheques/lote`, que continua validando tudo. Por isso aqui não
 * há guarda de valor: guardar um rascunho errado não quebra nada, e recusar
 * um rascunho no meio da digitação seria atrapalhar sem proteger.
 *
 * UM MAÇO POR PESSOA: a chave primária da tabela é o dono. O Jean e o Evaner
 * têm cada um o seu e não esbarram.
 */

export async function GET() {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("rascunho_lote_cheques")
    .select("comprador_id, data, rotulo, linhas, criado_em, atualizado_em")
    .eq("dono_id", admin.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ rascunho: data ?? null });
}

export async function PUT(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  const linhas = Array.isArray(body.linhas) ? body.linhas : [];
  // Maço vazio não é rascunho, é rascunho apagado. Assim "tirei a última
  // linha" limpa o aviso de maço em andamento em vez de deixar um fantasma
  // de zero cheques na tela do outro aparelho.
  if (linhas.length === 0) {
    const { error } = await client
      .from("rascunho_lote_cheques")
      .delete()
      .eq("dono_id", admin.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, rascunho: null });
  }

  const { data, error } = await client
    .from("rascunho_lote_cheques")
    .upsert(
      {
        dono_id: admin.id,
        comprador_id: body.comprador_id ? String(body.comprador_id) : null,
        data:
          body.data && /^\d{4}-\d{2}-\d{2}$/.test(String(body.data))
            ? String(body.data)
            : null,
        rotulo: body.rotulo ? String(body.rotulo).slice(0, 200) : null,
        linhas,
      },
      { onConflict: "dono_id" }
    )
    .select("atualizado_em")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, atualizado_em: data.atualizado_em });
}

export async function DELETE() {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client
    .from("rascunho_lote_cheques")
    .delete()
    .eq("dono_id", admin.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
