import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * POST: abastecimento ou despesa lançado PELO PAINEL, preso ao veículo.
 *
 * É o caso do Jean levando o óleo pra fundição com caminhão próprio, e do
 * carro do Valdecir — não existe carga nem motorista, mas o custo é da
 * operação do mesmo jeito.
 *
 * Sem motorista_id, o lançamento some da conta dele naturalmente (a
 * saldos_motoristas filtra por motorista_id) e não desconta de ninguém por
 * engano.
 *
 * `venda_id` amarra o gasto à entrega, que é o que permite calcular o custo
 * total da viagem por kg — o segundo número que o Evaner pediu, ao lado do
 * custo do óleo.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const tipo = String(body.tipo || "");
  const caminhao_id = String(body.caminhao_id || "");
  const valor = Number(body.valor);
  const criado_em = String(body.criado_em || "").trim();

  if (!["abastecimento", "despesa"].includes(tipo)) {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (!caminhao_id) {
    return NextResponse.json({ error: "escolha o veículo" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(criado_em)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  // Meio-dia pra a data não escorregar pro dia anterior no fuso BR.
  const quando = new Date(`${criado_em}T12:00:00-03:00`).toISOString();

  const client = getSupabaseAdmin(admin.id);
  const comum = {
    carga_id: null,
    motorista_id: null,
    caminhao_id,
    venda_id: body.venda_id || null,
    lancado_por: admin.id,
    valor: n2(valor),
    foto_path: body.foto_path || null,
    criado_em: quando,
  };

  if (tipo === "despesa") {
    const descricao = String(body.descricao || "").trim();
    if (descricao.length < 2) {
      return NextResponse.json({ error: "descreva a despesa" }, { status: 400 });
    }
    const { error } = await client.from("despesas").insert({ ...comum, descricao });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const posto_nome = String(body.posto_nome || "").trim();
  const litros = Number(body.litros);
  const km_atual = Number(body.km_atual);
  if (posto_nome.length < 2) {
    return NextResponse.json({ error: "diga o nome do posto" }, { status: 400 });
  }
  if (!Number.isFinite(litros) || litros <= 0) {
    return NextResponse.json({ error: "litros inválidos" }, { status: 400 });
  }
  if (!Number.isFinite(km_atual) || km_atual <= 0) {
    return NextResponse.json({ error: "km inválido" }, { status: 400 });
  }

  const { data: abast, error } = await client
    .from("abastecimentos")
    .insert({
      ...comum,
      posto_nome,
      litros: n2(litros),
      km_atual: Math.round(km_atual),
      pago_na_hora: body.pago_na_hora !== false,
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Nota assinada = dívida com o posto. Nasce junto pra não depender de
  // alguém lembrar de criar a conta depois.
  if (body.pago_na_hora === false && abast) {
    const venc = String(body.vencimento || "").trim();
    const { error: eConta } = await client.from("contas_a_pagar").insert({
      descricao: `Combustível — ${posto_nome}`,
      fornecedor: posto_nome,
      categoria: "combustivel",
      valor: n2(valor),
      vencimento: /^\d{4}-\d{2}-\d{2}$/.test(venc) ? venc : criado_em,
      status: "a_pagar",
      origem_tipo: "abastecimento",
      origem_id: abast.id,
      registrado_por: admin.id,
    });
    if (eConta) {
      return NextResponse.json({
        ok: true,
        aviso: `abastecimento salvo, mas a conta a pagar não nasceu: ${eConta.message}`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
