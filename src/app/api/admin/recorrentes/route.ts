import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { linhaPlano } from "@/lib/plano-contas";
const n2 = (v: number) => Math.round(v * 100) / 100;

/** POST: cadastra uma despesa recorrente (aluguel, energia, contador, IPVA). */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const descricao = String(body.descricao || "").trim();
  const valor = Number(body.valor);
  const dia = Number(body.dia_vencimento);
  const periodicidade = body.periodicidade === "anual" ? "anual" : "mensal";
  const mes = Number(body.mes_vencimento);

  if (descricao.length < 2) {
    return NextResponse.json({ error: "descreva a despesa" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return NextResponse.json({ error: "dia do vencimento inválido" }, { status: 400 });
  }
  if (periodicidade === "anual" && (!Number.isInteger(mes) || mes < 1 || mes > 12)) {
    return NextResponse.json(
      { error: "despesa anual precisa do mês de vencimento" },
      { status: 400 }
    );
  }
  // Mesma validação das contas: categoria tem que ser lançável do plano.
  // Sem isso as contas geradas herdavam categoria órfã ("fixa") e, quando
  // pagas, caíam no "Não classificado" do DRE.
  const categoria = String(body.categoria || "");
  const linha = linhaPlano(categoria);
  if (!linha || linha.fonte !== "lancamento") {
    return NextResponse.json(
      { error: "categoria inválida pra uma despesa recorrente" },
      { status: 400 }
    );
  }
  // ⚠️ A recorrente é a TERCEIRA porta da contas_a_pagar, e a única sem
  // coluna `pessoa_id` (varredura 21/08). "Salário Valdecir todo dia 5"
  // gerava conta sem dono TODO MÊS: no DRE a linha Salário abria em "sem
  // pessoa" e o vale de acerto nunca casava (a quitação exige pessoa).
  // Enquanto a tabela não tiver o dono, categoria que pede pessoa não
  // pode virar recorrente.
  if (linha.pedePessoa && !linha.pessoaOpcional) {
    return NextResponse.json(
      {
        error: `"${linha.label}" precisa dizer de quem é, e despesa recorrente não guarda a pessoa. Lance mês a mês em Lançamentos (é lá que o vale desconta do salário).`,
      },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("despesas_recorrentes").insert({
    descricao,
    categoria,
    fornecedor: body.fornecedor ? String(body.fornecedor).trim() : null,
    valor: n2(valor),
    dia_vencimento: dia,
    periodicidade,
    mes_vencimento: periodicidade === "anual" ? mes : null,
    aproximada: body.aproximada === true,
    observacao: body.observacao ? String(body.observacao).trim() : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
