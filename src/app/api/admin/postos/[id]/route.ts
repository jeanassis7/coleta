import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * CURADORIA DE POSTO — renomear e juntar grafias.
 *
 * "Texas" e "Posto texas" a 20 m um do outro apareceram nos TRÊS primeiros
 * abastecimentos da operação. O picker (0061) faz isso virar exceção, mas
 * posto novo na estrada continua sendo digitado à mão, e um dia sai
 * "Texas BR".
 *
 * ⚠️ ORDEM IMPORTA. `coletas.local_id` e `abastecimentos.local_id` apagam com
 * SET NULL: apagar o posto perdedor ANTES de mover as notas as desligaria em
 * silêncio — a dívida continuaria existindo, mas sem posto, e sumiria do
 * saldo sem ninguém perceber. Move primeiro, apaga depois. Sempre.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();
  const acao = String(body.acao || "");

  const { data: posto } = await client
    .from("locais")
    .select("id, nome_canonico, apelidos, tipo")
    .eq("id", id)
    .maybeSingle();
  if (!posto || (posto as { tipo: string }).tipo !== "posto") {
    return NextResponse.json({ error: "posto não encontrado" }, { status: 404 });
  }
  const atual = posto as unknown as {
    id: string;
    nome_canonico: string;
    apelidos: string[] | null;
  };

  // Junta listas de apelidos sem repetir e sem guardar o próprio nome.
  const apelidar = (nomeFinal: string, extras: (string | null)[]) => {
    const set = new Set(
      [...(atual.apelidos ?? []), ...extras]
        .map((x) => (x ?? "").trim())
        .filter((x) => x.length > 0 && x !== nomeFinal)
    );
    return [...set];
  };

  // ------------------------------------------------------------------ renomear
  if (acao === "renomear") {
    const nome = String(body.nome || "").trim();
    if (nome.length < 2) {
      return NextResponse.json({ error: "nome muito curto" }, { status: 400 });
    }
    // O nome antigo vira apelido: o motorista que digitar "Texas" daqui a um
    // mês ainda tem que casar com este posto.
    const { error } = await client
      .from("locais")
      .update({
        nome_canonico: nome,
        apelidos: apelidar(nome, [atual.nome_canonico]),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------- juntar
  if (acao === "juntar") {
    const outroId = String(body.outro_id || "");
    if (!outroId) {
      return NextResponse.json({ error: "escolha o posto a juntar" }, { status: 400 });
    }
    if (outroId === id) {
      return NextResponse.json(
        { error: "não dá pra juntar um posto nele mesmo" },
        { status: 400 }
      );
    }
    const { data: outro } = await client
      .from("locais")
      .select("id, nome_canonico, apelidos, tipo")
      .eq("id", outroId)
      .maybeSingle();
    if (!outro || (outro as { tipo: string }).tipo !== "posto") {
      return NextResponse.json(
        { error: "o outro posto não existe (ou não é um posto)" },
        { status: 404 }
      );
    }
    const perdedor = outro as unknown as {
      id: string;
      nome_canonico: string;
      apelidos: string[] | null;
    };

    // 1) MOVE as notas. Se isto falhar, nada foi apagado.
    const { data: movAb, error: eAb } = await client
      .from("abastecimentos")
      .update({ local_id: id })
      .eq("local_id", outroId)
      .select("id");
    if (eAb) return NextResponse.json({ error: eAb.message }, { status: 400 });

    // Coleta apontando pra um posto é anomalia (posto não é ponto de coleta),
    // mas se existir vai junto: deixar pra trás significaria perder o vínculo
    // quando o posto perdedor for apagado.
    const { data: movCol, error: eCol } = await client
      .from("coletas")
      .update({ local_id: id })
      .eq("local_id", outroId)
      .select("id");
    if (eCol) return NextResponse.json({ error: eCol.message }, { status: 400 });

    // 2) O nome do perdedor e os apelidos dele viram apelidos daqui.
    const { error: eNome } = await client
      .from("locais")
      .update({
        apelidos: apelidar(atual.nome_canonico, [
          perdedor.nome_canonico,
          ...(perdedor.apelidos ?? []),
        ]),
      })
      .eq("id", id);
    if (eNome) return NextResponse.json({ error: eNome.message }, { status: 400 });

    // 3) Só agora o perdedor some.
    const { error: eDel } = await client.from("locais").delete().eq("id", outroId);
    if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      notas_movidas: movAb?.length ?? 0,
      coletas_movidas: movCol?.length ?? 0,
      virou_apelido: perdedor.nome_canonico,
    });
  }

  return NextResponse.json({ error: "ação inválida" }, { status: 400 });
}
