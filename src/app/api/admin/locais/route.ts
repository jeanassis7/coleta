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
 * POST /api/admin/locais — cria um local canônico a partir de coletas existentes.
 * Body: {
 *   nome_canonico: string,
 *   latitude: number,
 *   longitude: number,
 *   raio_match_m?: number,
 *   apelidos?: string[],
 *   notas_internas?: string,
 *   coleta_ids?: string[]  // se passar, vincula essas coletas ao novo local
 * }
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const nome = body.nome_canonico?.trim();
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);

  if (!nome) {
    return NextResponse.json({ error: "nome_canonico obrigatório" }, { status: 400 });
  }
  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "latitude e longitude obrigatórias" }, { status: 400 });
  }

  const raio = body.raio_match_m ? parseInt(body.raio_match_m, 10) : 50;
  if (raio < 10 || raio > 5000) {
    return NextResponse.json({ error: "raio_match_m deve estar entre 10 e 5000" }, { status: 400 });
  }

  const apelidos = Array.isArray(body.apelidos)
    ? body.apelidos.map((a: unknown) => String(a).trim()).filter(Boolean)
    : [];
  const notas = body.notas_internas?.trim() || null;

  const adminClient = getSupabaseAdmin();

  // Cria o local
  const { data: novoLocal, error: errCriar } = await adminClient
    .from("locais")
    .insert({
      nome_canonico: nome,
      latitude: lat,
      longitude: lng,
      raio_match_m: raio,
      apelidos,
      notas_internas: notas,
    })
    .select()
    .single();

  if (errCriar || !novoLocal) {
    return NextResponse.json(
      { error: errCriar?.message || "falha ao criar" },
      { status: 400 }
    );
  }

  // Se passou coleta_ids, vincula
  if (Array.isArray(body.coleta_ids) && body.coleta_ids.length > 0) {
    const ids = body.coleta_ids.map((x: unknown) => String(x));
    const { error: errVincular } = await adminClient
      .from("coletas")
      .update({ local_id: novoLocal.id })
      .in("id", ids);

    if (errVincular) {
      return NextResponse.json(
        {
          error: `local criado mas falhou ao vincular coletas: ${errVincular.message}`,
          local: novoLocal,
        },
        { status: 207 }
      );
    }
  }

  return NextResponse.json({ local: novoLocal });
}

/**
 * GET /api/admin/locais — lista todos locais com estatísticas.
 */
export async function GET() {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const adminClient = getSupabaseAdmin();
  const { data, error } = await adminClient
    .from("locais_com_stats")
    .select("*")
    .order("total_visitas", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ locais: data || [] });
}
