import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * Cadastrar posto pelo NOME, do escritório.
 *
 * É assim que ele aparece na vida real: o extrato chega com o nome de um
 * posto que ainda não existe no sistema. A coordenada quem tem é o motorista,
 * na bomba — e o posto aprende sozinho no primeiro abastecimento com GPS
 * (trigger da 0063).
 *
 * Posto é `locais` com `tipo='posto'`, não tabela nova: assim a sugestão por
 * proximidade e a curadoria valem de graça.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const nome = String(body.nome || "").trim();
  if (nome.length < 2) {
    return NextResponse.json({ error: "diga o nome do posto" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);

  // Nome repetido não é bloqueado (pode haver duas unidades da mesma rede em
  // cidades diferentes), mas AVISA: quase sempre é o mesmo posto sendo
  // cadastrado duas vezes, e aí a dívida nasce partida em dois lugares.
  const { data: iguais } = await client
    .from("locais")
    .select("id, nome_canonico")
    .eq("tipo", "posto")
    .ilike("nome_canonico", nome);

  if (iguais && iguais.length > 0 && !body.confirmado) {
    return NextResponse.json(
      {
        error: `já existe um posto chamado "${iguais[0].nome_canonico}". Se for outra unidade, confirme — mas se for o mesmo, use o que já existe: cadastrar de novo parte a dívida em dois lugares.`,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { data, error } = await client
    .from("locais")
    .insert({
      nome_canonico: nome,
      tipo: "posto",
      // Sem GPS: o posto aprende onde fica no primeiro abastecimento (0063).
      latitude: null,
      longitude: null,
      raio_match_m: 100,
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: data?.id });
}
