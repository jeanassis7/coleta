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
  if (typeof body.placa === "string" && body.placa.trim()) {
    const placa = body.placa.trim().toUpperCase();
    if (!/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(placa)) {
      return NextResponse.json({ error: "placa em formato inválido" }, { status: 400 });
    }
    updates.placa = placa;
  }
  if (typeof body.marca === "string" && body.marca.trim()) updates.marca = body.marca.trim();
  if (body.modelo !== undefined) updates.modelo = body.modelo?.trim() || null;
  if (typeof body.cor === "string" && body.cor.trim()) updates.cor = body.cor.trim();
  if (body.tipo === "carro" || body.tipo === "caminhao") updates.tipo = body.tipo;
  if (body.de_quem !== undefined) {
    updates.de_quem = body.de_quem ? String(body.de_quem).trim() : null;
  }
  // Carro zera tanque e tara; caminhão exige os dois. Sem isto, virar um
  // caminhão em carro (ou o contrário) estouraria o CHECK da 0018 com erro
  // cru do Postgres na cara do gestor.
  const viraCarro = updates.tipo === "carro";
  if (viraCarro) {
    updates.capacidade_l = null;
    updates.tara_kg = null;
  } else {
    if (body.capacidade_l !== undefined) {
      const n = Number(body.capacidade_l);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "capacidade inválida" }, { status: 400 });
      }
      updates.capacidade_l = Math.round(n);
    }
    if (body.tara_kg !== undefined) {
      const n = Number(body.tara_kg);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "tara inválida" }, { status: 400 });
      }
      updates.tara_kg = Math.round(n);
    }
    if (updates.tipo === "caminhao" && (!updates.capacidade_l || !updates.tara_kg)) {
      return NextResponse.json(
        { error: "caminhão precisa de capacidade do tanque de óleo e tara — informe os dois" },
        { status: 400 }
      );
    }
  }
  if (typeof body.ativo === "boolean") {
    updates.ativo = body.ativo;
    if (!body.ativo) {
      updates.motivo_inativo = body.motivo_inativo?.trim() || null;
    } else {
      updates.motivo_inativo = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("caminhoes").update(updates).eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "placa já cadastrada" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  // Bloqueia delete se caminhão tem cargas — precisa inativar em vez disso
  const { count } = await client
    .from("cargas")
    .select("id", { count: "exact", head: true })
    .eq("caminhao_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `esse caminhão tem ${count} carga(s). Desative em vez de deletar.` },
      { status: 409 }
    );
  }
  // Manutenção sem carga também segura (FK sem cascade) — melhor um aviso
  // em português que o 23503 cru do Postgres na cara do usuário.
  const { count: nManut } = await client
    .from("manutencoes")
    .select("id", { count: "exact", head: true })
    .eq("caminhao_id", id);
  if ((nManut ?? 0) > 0) {
    return NextResponse.json(
      { error: `esse caminhão tem ${nManut} manutenção(ões) lançada(s). Desative em vez de deletar.` },
      { status: 409 }
    );
  }

  // Os documentos morrem por cascade — mas a conta PREVISTA que cada um
  // gerou e o arquivo no bucket não morrem sozinhos: sem esta limpeza, o
  // IPVA de um caminhão apagado ficava pendurado no fluxo de caixa futuro
  // pra sempre, apontando pra um documento que não existe.
  const { data: docs } = await client
    .from("documentos")
    .select("id, arquivo_path")
    .eq("caminhao_id", id);
  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length > 0) {
    const { error: ePrev } = await client
      .from("contas_a_pagar")
      .delete()
      .eq("origem_tipo", "documento")
      .in("origem_id", docIds)
      .in("status", ["prevista", "a_pagar"]);
    if (ePrev) return NextResponse.json({ error: ePrev.message }, { status: 400 });
    const paths = (docs ?? [])
      .map((d) => d.arquivo_path)
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await client.storage.from("documentos").remove(paths);
    }
  }

  const { error } = await client.from("caminhoes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
