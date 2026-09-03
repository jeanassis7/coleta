import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { normalizarCombustivel } from "@/lib/combustivel";
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
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (criado_em > hojeBr) {
    return NextResponse.json({ error: "a data está no futuro" }, { status: 400 });
  }
  // Meio-dia pra a data não escorregar pro dia anterior no fuso BR.
  const quando = new Date(`${criado_em}T12:00:00-03:00`).toISOString();

  // Sem motorista, o dinheiro só pode ter saído de dois lugares: de uma
  // CONTA da empresa (pagou na hora — pix/cartão da sede) ou de lugar
  // nenhum ainda (assinou a nota → conta a pagar). O buraco antigo era
  // aceitar "pagou na hora" sem conta: o gasto entrava no DRE e não saía
  // de caixa nenhum — o saldo do sistema inflava pra sempre.
  const pagoNaHora = body.pago_na_hora !== false;
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  if (pagoNaHora && !conta_id) {
    return NextResponse.json(
      { error: "diga de qual conta da empresa o dinheiro saiu (ou marque 'assinou a nota')" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  // QUEM ASSINOU. Nota assinada NÃO desconta do saldo do motorista (a
  // fórmula exige `pago_na_hora`), então guardar o nome dele aqui é só
  // registro — e é o que faz a ficha do posto dizer quem foi. Marcar
  // "pagou na hora" com motorista junto é recusado pelo banco (0047), então
  // não existe o caminho em que isso vira desconto por engano.
  const motoristaAssinou =
    typeof body.motorista_id === "string" && body.motorista_id
      ? body.motorista_id
      : null;

  // Particular de sócio e posto valem pros DOIS tipos: no posto se assina
  // nota de combustível e de despesa, e as duas entram no mesmo acerto.
  const socio_id =
    typeof body.socio_id === "string" && body.socio_id ? body.socio_id : null;
  const local_id =
    typeof body.local_id === "string" && body.local_id ? body.local_id : null;

  const comum = {
    carga_id: null,
    motorista_id: motoristaAssinou,
    socio_id,
    local_id,
    caminhao_id,
    venda_id: body.venda_id || null,
    lancado_por: admin.id,
    valor: n2(valor),
    foto_path: body.foto_path || null,
    criado_em: quando,
    pago_na_hora: pagoNaHora,
    conta_id: pagoNaHora ? conta_id : null,
  };

  if (tipo === "despesa") {
    const descricao = String(body.descricao || "").trim();
    if (descricao.length < 2) {
      return NextResponse.json({ error: "descreva a despesa" }, { status: 400 });
    }
    const { data: desp, error } = await client
      .from("despesas")
      .insert({ ...comum, descricao })
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Nota assinada de despesa: a conta nasce pelo trigger da 0047. Aqui só
    // se ajusta o vencimento, se o Jean informou um.
    if (!pagoNaHora && desp) {
      const venc = String(body.vencimento || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(venc)) {
        const { error: eConta } = await client
          .from("contas_a_pagar")
          .update({ vencimento: venc })
          .eq("origem_tipo", "despesa")
          .eq("origem_id", desp.id)
          .eq("status", "a_pagar");
        if (eConta) {
          return NextResponse.json({
            ok: true,
            aviso: `despesa salva, mas não consegui ajustar o vencimento da conta: ${eConta.message}`,
          });
        }
      }
    }
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
  // Km OPCIONAL aqui (0062): a nota transcrita do extrato do posto, trinta
  // dias depois, não tem odômetro — e km inventado envenena o km/L e o
  // alerta de salto. Informado, continua valendo a regra: tem que ser
  // número positivo.
  const temKm = body.km_atual !== undefined && body.km_atual !== null && body.km_atual !== "";
  if (temKm && (!Number.isFinite(km_atual) || km_atual <= 0)) {
    return NextResponse.json({ error: "km inválido" }, { status: 400 });
  }


  const { data: abast, error } = await client
    .from("abastecimentos")
    .insert({
      ...comum,
      posto_nome,
      // ARLA fica fora do km/L do veículo (0044) — o gasto conta igual.
      tipo: normalizarCombustivel(body.tipo_abastecimento),
      litros: n2(litros),
      km_atual: temKm ? Math.round(km_atual) : null,
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Nota assinada = dívida com o posto. Quem CRIA a conta é o trigger do
  // banco (0034) — vale pra qualquer caminho de inserção, inclusive o sync
  // do celular. Aqui só se ajusta o vencimento, se o Jean informou um.
  if (body.pago_na_hora === false && abast) {
    const venc = String(body.vencimento || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(venc)) {
      const { error: eConta } = await client
        .from("contas_a_pagar")
        .update({ vencimento: venc })
        .eq("origem_tipo", "abastecimento")
        .eq("origem_id", abast.id)
        .eq("status", "a_pagar");
      if (eConta) {
        return NextResponse.json({
          ok: true,
          aviso: `abastecimento salvo, mas não consegui ajustar o vencimento da conta: ${eConta.message}`,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
