import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.ativo) return null;
  return user;
}

/**
 * POST /api/admin/coletas/bulk-delete
 * Body: { ids: string[] }
 * Apaga coletas em lote + remove fotos do Storage.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json(
      { error: "máximo 200 por vez" },
      { status: 400 }
    );
  }

  const adminClient = getSupabaseAdmin();

  // 1. Busca fotos pra apagar do Storage
  const { data: coletasComFoto } = await adminClient
    .from("coletas")
    .select("foto_path")
    .in("id", ids)
    .not("foto_path", "is", null);

  const paths = (coletasComFoto || [])
    .map((c) => c.foto_path)
    .filter((p): p is string => !!p);

  if (paths.length > 0) {
    await adminClient.storage.from("fotos-coletas").remove(paths);
  }

  // 2. Apaga as coletas
  const { error } = await adminClient.from("coletas").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    apagadas: ids.length,
    fotos_apagadas: paths.length,
  });
}
