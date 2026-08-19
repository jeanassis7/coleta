import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;

interface ChequeEntrada {
  banco?: string;
  emitente?: string;
  numero?: string;
  valor?: number;
  bom_para?: string;
  observacao?: string;
}

const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * POST: lança a venda com o pagamento junto.
 *
 * O pagamento é opcional e parcial de propósito — o que não entrar agora
 * fica em aberto na conta corrente do comprador, que é como o Evaner
 * descreveu o caso real (venda de 50k, 20k de pix hoje, cheque depois,
 * sobra 320).
 *
 * Sem transação: o Supabase JS não expõe uma. Se um recebimento falhar
 * depois da venda gravada, a venda fica lá e o pagamento se lança na ficha
 * do comprador — a resposta diz exatamente o que não entrou, em vez de
 * fingir que deu tudo certo.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const comprador_id = String(body.comprador_id || "");
  const data = String(body.data || "").trim();
  const peso_total_kg = Number(body.peso_total_kg);
  const kg_grosso = Number(body.kg_grosso || 0);
  const preco_kg = Number(body.preco_kg);
  const valor_total = Number(body.valor_total);

  if (!comprador_id) {
    return NextResponse.json({ error: "escolha o comprador" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  if (!Number.isFinite(peso_total_kg) || peso_total_kg <= 0) {
    return NextResponse.json({ error: "peso da balança inválido" }, { status: 400 });
  }
  if (!Number.isFinite(kg_grosso) || kg_grosso < 0 || kg_grosso > peso_total_kg) {
    return NextResponse.json(
      { error: "o grosso não pode passar do peso total" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(preco_kg) || preco_kg <= 0) {
    return NextResponse.json({ error: "preço por kg inválido" }, { status: 400 });
  }
  if (!Number.isFinite(valor_total) || valor_total <= 0) {
    return NextResponse.json({ error: "valor total inválido" }, { status: 400 });
  }

  const grosso = n2(kg_grosso);
  const total = n2(peso_total_kg);
  const fino = n2(total - grosso);

  const client = getSupabaseAdmin(admin.id);
  const { data: venda, error } = await client
    .from("vendas")
    .insert({
      comprador_id,
      data,
      peso_total_kg: total,
      kg_fino: fino,
      kg_grosso: grosso,
      preco_kg: Math.round(preco_kg * 10000) / 10000,
      valor_total: n2(valor_total),
      caminhao_id: body.caminhao_id || null,
      nota_numero: body.nota_numero ? String(body.nota_numero).trim() : null,
      foto_ticket_path: body.foto_ticket_path || null,
      observacao: body.observacao ? String(body.observacao).trim() : null,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const avisos: string[] = [];

  // Entrada à vista (pix/dinheiro/transferência)
  const aVista = Number(body.recebido_agora);
  if (Number.isFinite(aVista) && aVista > 0) {
    const forma = ["pix", "dinheiro", "transferencia"].includes(body.forma_a_vista)
      ? body.forma_a_vista
      : "pix";
    const { error: eRec } = await client.from("recebimentos").insert({
      comprador_id,
      venda_id: venda.id,
      forma,
      valor: n2(aVista),
      data,
      registrado_por: admin.id,
    });
    if (eRec) avisos.push(`entrada à vista não registrada: ${eRec.message}`);
  }

  // Cheques — cada um vira SEU PRÓPRIO recebimento (1:1). Assim, se um
  // voltar, some só o valor dele e nada mais.
  const cheques: ChequeEntrada[] = Array.isArray(body.cheques) ? body.cheques : [];
  for (const [i, ch] of cheques.entries()) {
    const valor = Number(ch.valor);
    const banco = String(ch.banco || "").trim();
    const emitente = String(ch.emitente || "").trim();
    const bomPara = String(ch.bom_para || "").trim();
    const rotulo = `cheque ${i + 1}`;

    if (!Number.isFinite(valor) || valor <= 0) {
      avisos.push(`${rotulo}: valor inválido, não registrado`);
      continue;
    }
    if (!banco || !emitente || !/^\d{4}-\d{2}-\d{2}$/.test(bomPara)) {
      avisos.push(`${rotulo}: falta banco, emitente ou "bom para" — não registrado`);
      continue;
    }

    const { data: rec, error: eRec } = await client
      .from("recebimentos")
      .insert({
        comprador_id,
        venda_id: venda.id,
        forma: "cheque",
        valor: n2(valor),
        data,
        registrado_por: admin.id,
      })
      .select("id")
      .maybeSingle();

    if (eRec || !rec) {
      avisos.push(`${rotulo}: ${eRec?.message || "não registrado"}`);
      continue;
    }

    const { error: eCh } = await client.from("cheques").insert({
      recebimento_id: rec.id,
      comprador_id,
      banco,
      emitente,
      numero: ch.numero ? String(ch.numero).trim() : null,
      valor: n2(valor),
      bom_para: bomPara,
      observacao: ch.observacao ? String(ch.observacao).trim() : null,
    });
    if (eCh) {
      // Sem o cheque, o recebimento viraria um crédito fantasma que nenhum
      // papel sustenta — melhor desfazer do que deixar a conta mentir.
      await client.from("recebimentos").delete().eq("id", rec.id);
      avisos.push(`${rotulo}: ${eCh.message}`);
    }
  }

  return NextResponse.json({ ok: true, venda, avisos });
}
