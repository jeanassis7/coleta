import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/** PATCH: corrige uma compra direta lançada errado. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const client = getSupabaseAdmin(admin.id);

  const { data: atual, error: eAtual } = await client
    .from("compras_diretas")
    .select("id, entra_no_estoque, carga_id, conta_id")
    .eq("id", id)
    .maybeSingle();
  if (eAtual) return NextResponse.json({ error: eAtual.message }, { status: 400 });
  if (!atual) return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });

  // Compra paga com CHEQUE tem uma conta a pagar espelho (paga, com o
  // cheque). É ela que o DRE lê — e é por ela que a edição precisa passar.
  const { data: contaEspelho } = await client
    .from("contas_a_pagar")
    .select("id, status, cheque_id")
    .eq("origem_tipo", "compra_direta")
    .eq("origem_id", id)
    .maybeSingle();

  const updates: Record<string, unknown> = {};
  if (typeof body.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data)) {
    updates.data = body.data;
  }
  if (typeof body.fornecedor === "string" && body.fornecedor.trim().length >= 2) {
    updates.fornecedor = body.fornecedor.trim();
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.quantidade !== undefined) {
    const n = Number(body.quantidade);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
    }
    updates.quantidade = Math.round(n * 100) / 100;
  }
  if (body.unidade !== undefined) {
    if (!["kg", "litros"].includes(body.unidade)) {
      return NextResponse.json({ error: "unidade inválida" }, { status: 400 });
    }
    updates.unidade = body.unidade;
  }
  if (body.tipo_oleo !== undefined) {
    if (!["fino", "grosso"].includes(body.tipo_oleo)) {
      return NextResponse.json({ error: "tipo de óleo inválido" }, { status: 400 });
    }
    updates.tipo_oleo = body.tipo_oleo;
  }
  if (typeof body.entra_no_estoque === "boolean") {
    updates.entra_no_estoque = body.entra_no_estoque;
  }
  // O certificado É editável — o caso real: acertou os litros do óleo, errou
  // o certificado, volta e corrige. O PATCH descartava esses campos em
  // silêncio (a tela dizia salvo, o banco não mudava).
  if (body.certificado_tipo !== undefined) {
    if (!["integral", "parcial", "nao"].includes(body.certificado_tipo)) {
      return NextResponse.json({ error: "certificado inválido" }, { status: 400 });
    }
    updates.certificado_tipo = body.certificado_tipo;
    if (body.certificado_tipo === "parcial") {
      const lc = Number(body.litros_certificado);
      if (!Number.isFinite(lc) || lc <= 0) {
        return NextResponse.json(
          { error: "quantos litros no certificado parcial?" },
          { status: 400 }
        );
      }
      updates.litros_certificado = Math.round(lc * 100) / 100;
    }
    if (body.certificado_tipo === "nao") updates.litros_certificado = null;
  }
  if (body.conta_id !== undefined) {
    // Paga com cheque, a compra NÃO tem conta — o dinheiro saiu do papel.
    // Aceitar conta aqui faria a mesma compra sair do caixa duas vezes
    // (pela conta E pelo cheque repassado).
    if (contaEspelho && body.conta_id) {
      return NextResponse.json(
        { error: "essa compra foi paga com CHEQUE — não tem conta pra trocar; pra mudar a forma de pagamento, apague e relance" },
        { status: 400 }
      );
    }
    updates.conta_id = body.conta_id ? String(body.conta_id) : null;
  }
  if (body.carga_id !== undefined) {
    updates.carga_id = body.carga_id ? String(body.carga_id) : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  // Mesma regra do POST: fora do estoque só faz sentido com a carga que vai
  // pesar esse óleo — senão o custo some sem os kg entrarem por lugar nenhum.
  const entraFinal =
    updates.entra_no_estoque !== undefined
      ? (updates.entra_no_estoque as boolean)
      : atual.entra_no_estoque;
  const cargaFinal =
    updates.carga_id !== undefined ? updates.carga_id : atual.carga_id;
  if (entraFinal === false && !cargaFinal) {
    return NextResponse.json(
      { error: "óleo fora do estoque precisa dizer em qual carga ele está — escolha a carga que vai pesar esse óleo" },
      { status: 400 }
    );
  }

  const { data: depois, error } = await client
    .from("compras_diretas")
    .update(updates)
    .eq("id", id)
    .select("quantidade, unidade, certificado_tipo, data, fornecedor, valor")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // A conta espelho (compra com cheque) acompanha: valor, data e fornecedor
  // editados sem ela seriam dois números pro mesmo óleo — a ficha com o
  // novo, o DRE com o velho.
  let aviso: string | null = null;
  if (
    contaEspelho &&
    (updates.valor !== undefined ||
      updates.data !== undefined ||
      updates.fornecedor !== undefined)
  ) {
    const ajuste: Record<string, unknown> = {};
    if (updates.valor !== undefined) ajuste.valor = updates.valor;
    if (updates.data !== undefined) {
      ajuste.pago_em = updates.data;
      ajuste.vencimento = updates.data;
    }
    if (updates.fornecedor !== undefined) {
      ajuste.fornecedor = updates.fornecedor;
      ajuste.descricao = `Óleo (compra direta) — ${updates.fornecedor}`;
    }
    const { error: eConta } = await client
      .from("contas_a_pagar")
      .update(ajuste)
      .eq("id", contaEspelho.id);
    if (eConta) {
      aviso = `a conta do pagamento com cheque não acompanhou: ${eConta.message}`;
    } else if (updates.data !== undefined && contaEspelho.cheque_id) {
      // O relógio do repasse anda junto (é ele que põe a receita do cheque
      // no DRE do dia certo).
      const { error: eCh } = await client
        .from("cheques")
        .update({ repassado_em: updates.data })
        .eq("id", contaEspelho.cheque_id)
        .eq("status", "repassado");
      if (eCh) {
        aviso = `a data do repasse do cheque não acompanhou: ${eCh.message}`;
      }
    }
  }

  // Certificado INTEGRAL cobre a compra inteira: se quantidade, unidade ou o
  // próprio tipo mudaram, os litros do certificado se recalculam — senão
  // editar a compra deixava o certificado com os litros antigos.
  if (depois?.certificado_tipo === "integral") {
    const qtd = Number(depois.quantidade);
    const litros =
      depois.unidade === "litros"
        ? Math.round(qtd * 100) / 100
        : Math.round((qtd / 0.9) * 100) / 100;
    const { error: eCert } = await client
      .from("compras_diretas")
      .update({ litros_certificado: litros })
      .eq("id", id);
    if (eCert) return NextResponse.json({ error: eCert.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ...(aviso ? { aviso } : {}) });
}

/**
 * DELETE: apaga a compra, a foto — e DESFAZ o pagamento com cheque.
 *
 * Sem isso, apagar uma compra paga com cheque deixava o pior estado
 * possível: o cheque preso em "repassado" pra sempre (fora do patrimônio,
 * ainda contando como receita no DRE) e uma conta paga órfã contando como
 * despesa — óleo que sumiu do estoque com despesa e receita fantasmas.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: compra } = await client
    .from("compras_diretas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const desfeito: string[] = [];

  // A conta espelho do pagamento com cheque morre junto, e o cheque volta
  // pra carteira — o mesmo desfazer do DELETE de conta a pagar.
  const { data: contas, error: eContas } = await client
    .from("contas_a_pagar")
    .select("id, cheque_id")
    .eq("origem_tipo", "compra_direta")
    .eq("origem_id", id);
  if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });

  for (const conta of contas ?? []) {
    if (conta.cheque_id) {
      const { data: ch, error: eCh } = await client
        .from("cheques")
        .update({ status: "em_carteira", repassado_em: null, repassado_para: null })
        .eq("id", conta.cheque_id)
        .eq("status", "repassado")
        .select("banco, valor");
      if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
      if (ch?.length) {
        desfeito.push(
          `o cheque ${ch[0].banco} de R$ ${Number(ch[0].valor).toFixed(2).replace(".", ",")} voltou pra carteira`
        );
      }
    }
    const { error: eDel } = await client
      .from("contas_a_pagar")
      .delete()
      .eq("id", conta.id);
    if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });
  }

  const { error } = await client.from("compras_diretas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (compra?.foto_path) {
    await client.storage.from("fotos-coletas").remove([compra.foto_path]);
  }
  return NextResponse.json({ ok: true, desfeito });
}
