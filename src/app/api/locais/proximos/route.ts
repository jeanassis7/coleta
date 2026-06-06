import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/locais/proximos?lat=X&lng=Y&raio=200
 * Retorna locais ativos dentro do raio (em metros), ordenados por distância.
 * Qualquer usuário autenticado pode chamar (motorista usa pra sugestão).
 */
export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  const raio = parseInt(searchParams.get("raio") || "200", 10);

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: "lat e lng obrigatórios" },
      { status: 400 }
    );
  }

  if (raio < 10 || raio > 5000) {
    return NextResponse.json(
      { error: "raio deve estar entre 10 e 5000m" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("locais_proximos", {
    p_lat: lat,
    p_lng: lng,
    p_raio_m: raio,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ locais: data || [] });
}
