import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH: renovar é o caso comum — muda o vencimento (e às vezes o arquivo).
 * Dono e tipo NÃO são editáveis: documento que mudou de dono é outro
 * documento, e trocar isso por engano some com o histórico do anterior.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.vencimento != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.vencimento))) {
      return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
    }
    updates.vencimento = body.vencimento;
  }
  if (body.valor !== undefined) {
    if (body.valor === "" || body.valor == null) {
      updates.valor = null;
    } else {
      const v = Number(body.valor);
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: "valor inválido" }, { status: 400 });
      }
      updates.valor = Math.round(v * 100) / 100;
    }
  }
  if (body.alerta_dias != null) {
    const d = Number(body.alerta_dias);
    if (!Number.isFinite(d) || d < 0 || d > 365) {
      return NextResponse.json(
        { error: "aviso tem que ser entre 0 e 365 dias" },
        { status: 400 }
      );
    }
    updates.alerta_dias = d;
  }
  if (body.arquivo_path !== undefined) {
    updates.arquivo_path = body.arquivo_path
      ? String(body.arquivo_path)
      : null;
  }
  if (body.descricao !== undefined) {
    updates.descricao = body.descricao ? String(body.descricao).trim() : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao
      ? String(body.observacao).trim()
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("documentos").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE: apaga o cadastro. O arquivo no Storage vai junto, se houver. */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { data: doc } = await client
    .from("documentos")
    .select("arquivo_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("documentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Arquivo órfão no bucket é lixo que ninguém vê e ninguém limpa. Falha
  // aqui não desfaz o delete — o cadastro já foi, e é ele que a tela mostra.
  if (doc?.arquivo_path) {
    await client.storage.from("documentos").remove([doc.arquivo_path]);
  }

  return NextResponse.json({ ok: true });
}
