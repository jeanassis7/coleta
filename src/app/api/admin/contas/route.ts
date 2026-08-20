import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { linhaPlano } from "@/lib/plano-contas";
const n2 = (v: number) => Math.round(v * 100) / 100;

// A lista velha de 7 valores foi substituída pelo plano de contas (importado
// acima): é o mesmo vocabulário do DRE, e sem isso as duas telas contariam
// coisas diferentes com o mesmo nome.

/**
 * POST: cria conta avulsa ou parcelada.
 *
 * Parcelamento (compra de óleo a prazo, revisão em 3x) gera N linhas, uma
 * por parcela, cada uma com seu vencimento. Assim cada parcela se paga
 * sozinha pelo mesmo fluxo das outras contas — não existe caso especial.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const descricao = String(body.descricao || "").trim();
  const categoria = String(body.categoria || "");
  const valor = Number(body.valor);
  const vencimento = String(body.vencimento || "").trim();
  const parcelas = Math.max(1, Math.min(36, Number(body.parcelas) || 1));
  const prevista = body.prevista === true;

  if (descricao.length < 2) {
    return NextResponse.json({ error: "descreva a conta" }, { status: 400 });
  }
  const linha = linhaPlano(categoria);
  if (!linha || linha.fonte !== "lancamento") {
    return NextResponse.json(
      { error: "categoria inválida pra uma conta a pagar" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
    return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
  }

  // Divide sem perder centavo: a última parcela absorve a sobra do
  // arredondamento (1000 em 3x = 333,33 + 333,33 + 333,34).
  const base = Math.floor((valor * 100) / parcelas) / 100;
  const sobra = n2(valor - base * parcelas);

  // Vencimento dia 29-31: `setMonth` estoura o mês (31/01 + 1 = 3 de março,
  // fevereiro ficava sem parcela e março com duas). Clampa pro último dia do
  // mês, igual ao gerador de recorrentes. Datas montadas por parte, sem
  // passar por Date/UTC — dia-calendário puro.
  const [anoV, mesV, diaV] = vencimento.split("-").map(Number);
  const vencimentoParcela = (i: number) => {
    const totalMeses = mesV - 1 + i;
    const ano = anoV + Math.floor(totalMeses / 12);
    const mes = (totalMeses % 12) + 1;
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const dia = Math.min(diaV, ultimoDia);
    return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  };

  const linhas = Array.from({ length: parcelas }, (_, i) => {
    return {
      descricao:
        parcelas > 1 ? `${descricao} (${i + 1}/${parcelas})` : descricao,
      fornecedor: body.fornecedor ? String(body.fornecedor).trim() : null,
      categoria,
      valor: i === parcelas - 1 ? n2(base + sobra) : base,
      vencimento: vencimentoParcela(i),
      status: prevista ? "prevista" : "a_pagar",
      origem_tipo: body.origem_tipo || null,
      origem_id: body.origem_id || null,
      parcela: parcelas > 1 ? i + 1 : null,
      parcelas_total: parcelas > 1 ? parcelas : null,
      observacao: body.observacao ? String(body.observacao).trim() : null,
      registrado_por: admin.id,
    };
  });

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("contas_a_pagar").insert(linhas);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, criadas: linhas.length });
}
