import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

const TIPOS = ["troca_oleo", "pneu", "revisao", "corretiva", "outro"];

/**
 * POST: lança uma manutenção de veículo.
 *
 * Se vier `vencimento`, a manutenção não foi paga à vista e nasce junto uma
 * conta a pagar apontando pra ela (`origem_tipo = 'manutencao'`, aceito pela
 * tabela desde a 0019). É o mesmo desenho do abastecimento "assinei a nota".
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const caminhao_id = String(body.caminhao_id || "");
  const data = String(body.data || "").trim();
  const tipo = String(body.tipo || "");
  const descricao = String(body.descricao || "").trim();
  const valor = Number(body.valor);
  const km = body.km == null || body.km === "" ? null : Number(body.km);
  const proxima_km =
    body.proxima_km == null || body.proxima_km === ""
      ? null
      : Number(body.proxima_km);
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;
  const foto_path = body.foto_path ? String(body.foto_path) : null;
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  // Só existe quando a manutenção não foi paga na hora.
  const vencimento = body.vencimento ? String(body.vencimento).trim() : null;
  const forma_pagamento = body.forma_pagamento
    ? String(body.forma_pagamento)
    : null;

  if (!caminhao_id) {
    return NextResponse.json({ error: "escolha o caminhão" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (descricao.length < 2) {
    return NextResponse.json(
      { error: "descreva o que foi feito" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (km != null && (!Number.isFinite(km) || km < 0)) {
    return NextResponse.json({ error: "km inválido" }, { status: 400 });
  }
  if (proxima_km != null && (!Number.isFinite(proxima_km) || proxima_km <= 0)) {
    return NextResponse.json(
      { error: "km da próxima troca inválido" },
      { status: 400 }
    );
  }
  // Antiburro: próxima troca antes do km atual é digitação trocada.
  if (proxima_km != null && km != null && proxima_km <= km) {
    return NextResponse.json(
      { error: "o km da próxima troca tem que ser maior que o km de hoje" },
      { status: 400 }
    );
  }
  if (vencimento && !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
    return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
  }

  // UM cliente por handler: é o que faz as duas gravações deste clique
  // (manutenção + conta a pagar) saírem agrupadas no /admin/log.
  const client = getSupabaseAdmin(admin.id);

  const { data: criada, error } = await client
    .from("manutencoes")
    .insert({
      caminhao_id,
      data,
      km,
      tipo,
      descricao,
      valor: Math.round(valor * 100) / 100,
      fornecedor,
      // proxima_km só faz sentido em troca de óleo
      proxima_km: tipo === "troca_oleo" ? proxima_km : null,
      foto_path,
      observacao,
      registrado_por: admin.id,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (vencimento) {
    // A categoria da conta segue o TIPO da manutenção — assim, quando a
    // conta for paga, o valor cai na mesma linha do DRE em que a manutenção
    // à vista cairia (troca de óleo / pneus / manutenção).
    const categoriaConta =
      tipo === "troca_oleo" ? "troca_oleo" : tipo === "pneu" ? "pneus" : "manutencao";
    const { error: errConta } = await client.from("contas_a_pagar").insert({
      descricao: `Manutenção — ${descricao}`,
      fornecedor,
      categoria: categoriaConta,
      valor: Math.round(valor * 100) / 100,
      vencimento,
      status: "a_pagar",
      forma_pagamento,
      origem_tipo: "manutencao",
      origem_id: criada.id,
      registrado_por: admin.id,
    });
    if (errConta) {
      return NextResponse.json(
        {
          error: `Manutenção salva, mas a conta a pagar falhou: ${errConta.message}`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, id: criada.id });
}
