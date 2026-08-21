import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { linhaPlano, pedePessoa, pessoaOpcional } from "@/lib/plano-contas";

/**
 * POST /api/admin/caixa/lancamentos — lançar o que JÁ SAIU.
 *
 * É o ritmo do extrato: o Jean olha o banco e lança linha a linha o que já
 * aconteceu. Diferente de "conta a pagar", que é o que ainda vai vencer.
 *
 * Grava em `contas_a_pagar` com `status = 'paga'` de propósito: uma tabela só
 * pra todo dinheiro que sai é o que torna o DRE possível sem dobrar. Conta
 * paga é conta que foi paga — o modelo não precisa de tabela nova.
 *
 * Não confundir com `/api/admin/lancamentos`, que é abastecimento e despesa
 * de veículo lançados pelo painel.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const categoria = String(body.categoria || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  // Pagar com cheque da carteira: o dinheiro não sai de conta nenhuma —
  // sai do papel. É o caminho que substitui o antigo botão "Repassar".
  const cheque_id = body.cheque_id ? String(body.cheque_id) : null;
  // Vales de acerto que este pagamento está quitando (R110-b).
  const vales_quitados: string[] = Array.isArray(body.vales_quitados)
    ? body.vales_quitados.map(String)
    : [];
  const pessoa_id = body.pessoa_id ? String(body.pessoa_id) : null;
  const descricao = String(body.descricao || "").trim();
  const forma_pagamento = body.forma_pagamento
    ? String(body.forma_pagamento)
    : null;

  const linha = linhaPlano(categoria);
  if (!linha) {
    return NextResponse.json({ error: "categoria inválida" }, { status: 400 });
  }
  // Categoria automática vem de outra tabela. Deixar lançar na mão dobraria
  // o valor no DRE sem ninguém perceber.
  if (linha.fonte !== "lancamento") {
    return NextResponse.json(
      {
        error: `"${linha.label}" o sistema já calcula sozinho (${linha.vemDe}). Lançar na mão contaria duas vezes.`,
      },
      { status: 400 }
    );
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (data > hojeBr) {
    return NextResponse.json(
      { error: "a data está no futuro — dinheiro só sai quando sai" },
      { status: 400 }
    );
  }
  if (!conta_id && !cheque_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro (ou qual cheque pagou)" },
      { status: 400 }
    );
  }
  // Guia coletiva (DAE do INSS, FGTS digital) não tem UMA pessoa — nas
  // categorias marcadas pessoaOpcional o campo pode ficar vazio.
  if (pedePessoa(categoria) && !pessoaOpcional(categoria) && !pessoa_id) {
    return NextResponse.json(
      { error: `"${linha.label}" precisa dizer de quem é` },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: criado, error } = await client
    .from("contas_a_pagar")
    .insert({
      descricao: descricao || linha.label,
      fornecedor: body.fornecedor ? String(body.fornecedor).trim() : null,
      categoria,
      valor: Math.round(valor * 100) / 100,
      // O que já saiu vence e é pago no mesmo dia: é registro, não previsão.
      vencimento: data,
      pago_em: data,
      status: "paga",
      forma_pagamento: cheque_id ? "cheque" : forma_pagamento,
      // Com cheque, conta_id fica NULO de propósito: nada saiu de conta.
      conta_id: cheque_id ? null : conta_id,
      cheque_id,
      pessoa_id: pedePessoa(categoria) ? pessoa_id : null,
      observacao: body.observacao ? String(body.observacao).trim() : null,
      registrado_por: admin.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // O repasse é CONSEQUÊNCIA de pagar algo — nunca uma ação solta.
  if (cheque_id) {
    const { data: mexeu, error: errCh } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: data,
        repassado_para: (body.fornecedor
          ? String(body.fornecedor).trim()
          : descricao) || linha.label,
      })
      .eq("id", cheque_id)
      .eq("status", "em_carteira")
      .select("id");

    if (errCh || !mexeu || mexeu.length === 0) {
      // Sem o cheque saindo da carteira, o lançamento seria uma despesa que
      // nada pagou — e o cheque continuaria contado como ativo.
      await client.from("contas_a_pagar").delete().eq("id", criado.id);
      return NextResponse.json(
        {
          error:
            errCh?.message ||
            "esse cheque não está mais na carteira — recarregue a tela",
        },
        { status: 409 }
      );
    }
  }

  // Marca os vales que este pagamento quitou. Só os que ainda estão
  // pendentes — se dois pagamentos tentarem quitar o mesmo, o segundo mexe
  // em zero linhas e ninguém desconta duas vezes.
  //
  // GUARDAS (a tela já limita, mas a tela não é garantia):
  //  - só pagamento de SALÁRIO quita vale — a categoria certa é validada
  //    aqui, senão marcar vales e depois trocar a categoria quitava igual;
  //  - só vale DO PRÓPRIO motorista — o `.eq("motorista_id")` impede quitar
  //    vale de outra pessoa por engano;
  //  - e quitação PARCIAL deixa de ser silenciosa: se algum vale marcado
  //    ficou de fora (já quitado por outro pagamento, ou de outra pessoa),
  //    a resposta avisa em vez de fingir que descontou.
  let valesQuitados = 0;
  let avisoVales: string | null = null;
  if (vales_quitados.length > 0) {
    if (categoria !== "salario" || !pessoa_id) {
      avisoVales =
        "os vales marcados NÃO foram quitados — vale só desconta em pagamento de Salário com a pessoa escolhida";
    } else {
      const { data: mexidos } = await client
        .from("acertos")
        .update({ vale_quitado_em: data, vale_quitado_por: criado.id })
        .in("id", vales_quitados)
        .eq("motorista_id", pessoa_id)
        .is("vale_quitado_em", null)
        .select("id");
      valesQuitados = mexidos?.length ?? 0;
      if (valesQuitados < vales_quitados.length) {
        const deFora = vales_quitados.length - valesQuitados;
        avisoVales = `${deFora} vale(s) marcado(s) ficou(aram) DE FORA — ou já tinha(m) sido quitado(s) por outro pagamento, ou não é(são) dessa pessoa. Confira na tela de adiantamentos.`;
      }
    }
  }

  return NextResponse.json({ ok: true, id: criado.id, valesQuitados, avisoVales });
}
