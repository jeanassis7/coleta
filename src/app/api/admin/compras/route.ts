import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/** POST: registra uma compra direta de óleo feita pelo gestor. */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const data = String(body.data || "").trim();
  const fornecedor = String(body.fornecedor || "").trim();
  const valor = Number(body.valor);
  const quantidade = Number(body.quantidade);
  const unidade = String(body.unidade || "");
  const tipo_oleo = body.tipo_oleo === "grosso" ? "grosso" : "fino";
  const entra_no_estoque = body.entra_no_estoque !== false;
  const foto_path = body.foto_path ? String(body.foto_path) : null;
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const certificado_tipo = ["integral", "parcial", "nao"].includes(
    body.certificado_tipo
  )
    ? body.certificado_tipo
    : "nao";
  // Integral = tudo que entrou; parcial = o que o gestor informar
  let litros_certificado: number | null = null;
  if (certificado_tipo === "parcial") {
    const n = Number(body.litros_certificado);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "certificado parcial precisa dos litros" },
        { status: 400 }
      );
    }
    litros_certificado = Math.round(n * 100) / 100;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  if (fornecedor.length < 2) {
    return NextResponse.json({ error: "diga de quem comprou" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
  }
  if (!["kg", "litros"].includes(unidade)) {
    return NextResponse.json({ error: "unidade deve ser kg ou litros" }, { status: 400 });
  }
  // Dinheiro não aparece nem some (R83): a compra sai de uma CONTA ou do
  // papel de um CHEQUE da carteira (repasse, R66/R67). Um dos dois, sempre.
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  const cheque_id = body.cheque_id ? String(body.cheque_id) : null;
  if (!conta_id && !cheque_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro (ou qual cheque pagou)" },
      { status: 400 }
    );
  }
  // Caminhão não-vazio: em qual carga aberta o óleo foi junto (0045).
  const carga_id = body.carga_id ? String(body.carga_id) : null;
  if (!entra_no_estoque && !carga_id) {
    return NextResponse.json(
      { error: "o óleo foi junto em qual carga aberta? escolha a carga" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);

  if (carga_id) {
    const { data: carga } = await client
      .from("cargas")
      .select("id, status")
      .eq("id", carga_id)
      .maybeSingle();
    if (!carga || carga.status !== "ativa") {
      return NextResponse.json(
        { error: "essa carga não está mais aberta — recarregue a tela" },
        { status: 409 }
      );
    }
  }
  const { data: criada, error } = await client
    .from("compras_diretas")
    .insert({
      data,
      fornecedor,
      valor: Math.round(valor * 100) / 100,
      quantidade: Math.round(quantidade * 100) / 100,
      unidade,
      tipo_oleo,
      entra_no_estoque,
      certificado_tipo,
      litros_certificado:
        certificado_tipo === "integral"
          ? unidade === "litros"
            ? Math.round(quantidade * 100) / 100
            : Math.round((quantidade / 0.9) * 100) / 100
          : litros_certificado,
      // Com cheque, conta_id fica NULO: nada saiu de conta — saiu do papel.
      conta_id: cheque_id ? null : conta_id,
      carga_id,
      foto_path,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Pagou com CHEQUE: o papel sai da carteira amarrado a uma conta a pagar
  // JÁ PAGA de origem compra_direta — é o que faz o repasse auditável, o
  // DRE contar pela linha oleo_sede no dia do repasse (o fato fica excluído
  // do automático via origem_id) e a devolução do cheque reverter a conta.
  if (cheque_id && criada) {
    const { data: ch, error: eCh } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: data,
        repassado_para: fornecedor,
      })
      .eq("id", cheque_id)
      .eq("status", "em_carteira")
      .select("id");
    if (eCh || !ch?.length) {
      // Sem o cheque saindo da carteira, a compra ficaria paga por um papel
      // que não está mais lá. Desfaz a compra.
      await client.from("compras_diretas").delete().eq("id", criada.id);
      return NextResponse.json(
        {
          error:
            eCh?.message ||
            "esse cheque não está mais na carteira — recarregue a tela",
        },
        { status: 409 }
      );
    }
    const { error: eConta } = await client.from("contas_a_pagar").insert({
      descricao: `Óleo (compra direta) — ${fornecedor}`,
      fornecedor,
      categoria: "oleo_sede",
      valor: Math.round(valor * 100) / 100,
      vencimento: data,
      pago_em: data,
      status: "paga",
      forma_pagamento: "cheque",
      cheque_id,
      conta_id: null,
      origem_tipo: "compra_direta",
      origem_id: criada.id,
      registrado_por: admin.id,
    });
    if (eConta) {
      // Volta tudo: cheque pra carteira, compra apagada.
      await client
        .from("cheques")
        .update({ status: "em_carteira", repassado_em: null, repassado_para: null })
        .eq("id", cheque_id)
        .eq("status", "repassado");
      await client.from("compras_diretas").delete().eq("id", criada.id);
      return NextResponse.json({ error: eConta.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, compra: criada });
}
