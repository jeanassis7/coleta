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
  const proxima_data =
    body.proxima_data && /^\d{4}-\d{2}-\d{2}$/.test(String(body.proxima_data))
      ? String(body.proxima_data)
      : null;
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;
  const foto_path = body.foto_path ? String(body.foto_path) : null;
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  // Só existe quando a manutenção não foi paga na hora.
  const vencimento = body.vencimento ? String(body.vencimento).trim() : null;
  const forma_pagamento = body.forma_pagamento
    ? String(body.forma_pagamento)
    : null;
  // À VISTA o dinheiro saiu de uma conta AGORA — sem ela o DRE via o gasto
  // mas o caixa não via a saída (o mesmo furo da compra direta).
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  if (!vencimento && !conta_id) {
    return NextResponse.json(
      { error: "pagou na hora? diga de qual conta o dinheiro saiu" },
      { status: 400 }
    );
  }

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
      // proxima_km/proxima_data só fazem sentido em troca de óleo
      proxima_km: tipo === "troca_oleo" ? proxima_km : null,
      proxima_data: tipo === "troca_oleo" ? proxima_data : null,
      foto_path,
      observacao,
      registrado_por: admin.id,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // A categoria da conta segue o TIPO da manutenção — o valor cai na mesma
  // linha do DRE em que a manutenção cairia (troca de óleo / pneus /
  // manutenção).
  const categoriaConta =
    tipo === "troca_oleo" ? "troca_oleo" : tipo === "pneu" ? "pneus" : "manutencao";

  if (vencimento) {
    // A PRAZO: nasce a dívida.
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
  } else {
    // À VISTA: nasce a conta JÁ PAGA, com a conta de onde o dinheiro saiu.
    // É o que faz o caixa descontar E o DRE contar pela linha certa (o fato
    // fica excluído do automático via origem_id — anti-dobra da R92).
    const { error: errConta } = await client.from("contas_a_pagar").insert({
      descricao: `Manutenção — ${descricao}`,
      fornecedor,
      categoria: categoriaConta,
      valor: Math.round(valor * 100) / 100,
      vencimento: data,
      pago_em: data,
      status: "paga",
      forma_pagamento: forma_pagamento || "pix",
      conta_id,
      origem_tipo: "manutencao",
      origem_id: criada.id,
      registrado_por: admin.id,
    });
    if (errConta) {
      return NextResponse.json(
        {
          error: `Manutenção salva, mas o registro do pagamento falhou: ${errConta.message}`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, id: criada.id });
}
