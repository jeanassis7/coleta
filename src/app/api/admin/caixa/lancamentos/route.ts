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
  // Qual dívida cadastrada este pagamento abate (0053). Só faz sentido em
  // "Pagamento de dívidas" — o saldo da dívida sai de `total − pagos`.
  const divida_id = body.divida_id ? String(body.divida_id) : null;
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
  // Amarrar dívida em categoria errada faria o saldo dela cair por um gasto
  // que não a pagou. A tela já limita; aqui é a garantia.
  if (divida_id && categoria !== "dividas_pf") {
    return NextResponse.json(
      { error: "só pagamento em “Pagamento de dívidas” pode abater uma dívida" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #1 — cheque MAIOR que a despesa que ele pagou
  // ---------------------------------------------------------------------
  // O cheque repassado conta como RECEITA no dia do repasse (R67-b). Pagar
  // R$ 500 de advogado com um cheque de R$ 3.000 lançava 3.000 de receita
  // contra 500 de despesa e inflava o resultado do mês em 2.500 — e o
  // troco ficava fora do sistema. A tela de Contas já avisava disso; esta
  // não avisava nem no cliente nem no servidor.
  if (cheque_id) {
    const { data: chq } = await client
      .from("cheques")
      .select("valor, emitente")
      .eq("id", cheque_id)
      .maybeSingle();
    const vChq = Math.round(Number(chq?.valor ?? 0) * 100) / 100;
    const troco = Math.round((vChq - valor) * 100) / 100;
    if (troco > 0.009 && !body.confirmado) {
      return NextResponse.json(
        {
          error: `O cheque é de ${vChq.toFixed(2)} e o gasto é ${valor.toFixed(
            2
          )} — sobram ${troco.toFixed(
            2
          )} de troco. O cheque inteiro vira receita no dia do repasse, então esse troco precisa existir em algum lugar: receba o troco e lance como entrada avulsa no Caixa. Se está certo assim, confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
    if (troco < -0.009 && !body.confirmado) {
      return NextResponse.json(
        {
          error: `O cheque é de ${vChq.toFixed(2)} e o gasto é ${valor.toFixed(
            2
          )} — o cheque não cobre tudo. Faltam ${Math.abs(troco).toFixed(
            2
          )}, que saíram de outro lugar e precisam de lançamento próprio. Se está certo assim, confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  // Pagamento MAIOR do que o que falta: não bloqueia (juro que entrou,
  // acordo refeito, arredondamento são reais) mas NUNCA passa calado —
  // avisa quanto passa e pede confirmação. Sem isto, o saldo ficava
  // negativo escondido e a dívida parecia quitada certinha.
  if (divida_id) {
    const { data: saldos } = await client.rpc("saldo_dividas");
    const d = ((saldos as { id: string; credor: string; saldo: number }[]) ?? []).find(
      (x) => x.id === divida_id
    );
    if (!d) {
      return NextResponse.json({ error: "dívida não encontrada" }, { status: 400 });
    }
    const falta = Math.round(Number(d.saldo) * 100) / 100;
    const passa = Math.round((valor - falta) * 100) / 100;
    if (passa > 0.009 && !body.confirmado) {
      return NextResponse.json(
        {
          error:
            falta <= 0
              ? `A dívida de ${d.credor} já está coberta pelos pagamentos lançados. Este valor passaria ${passa.toFixed(2)} do total.`
              : `Faltam ${falta.toFixed(2)} na dívida de ${d.credor} e este pagamento é de ${valor.toFixed(
                  2
                )} — passa ${passa.toFixed(2)}. Se entrou juro, o certo é atualizar o valor da dívida em /admin/dividas. Se está certo mesmo, confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #5 — a MESMA saída lançada duas vezes
  // ---------------------------------------------------------------------
  // Esta tela é o ritmo do extrato: o gestor desce linha a linha do banco e
  // lança tudo. Só que parte dessas saídas JÁ NASCEU no sistema por outro
  // caminho — a coleta paga pela sede, o abastecimento com nota assinada, a
  // manutenção. Quando ele chega na linha do extrato, ela já está lá.
  //
  // Sem aviso, o erro só aparece muito depois: o saldo da conta no app fica
  // menor que o do banco e alguém precisa caçar a diferença. Com aviso, o
  // sistema mostra a linha que já existe e ele decide em dois cliques.
  //
  // Janela de 3 dias porque data de pix e data de extrato divergem em fim de
  // semana. Não bloqueia — pagamento repetido de verdade existe (duas
  // parcelas iguais, dois fretes do mesmo valor); só nunca passa calado.
  if (!body.confirmado && conta_id) {
    const dia = (d: number) =>
      new Date(new Date(`${data}T12:00:00Z`).getTime() + d * 86400000)
        .toISOString()
        .slice(0, 10);
    const { data: parecidas } = await client
      .from("contas_a_pagar")
      .select("id, descricao, valor, pago_em, origem_tipo")
      .eq("status", "paga")
      .eq("conta_id", conta_id)
      .eq("valor", Math.round(valor * 100) / 100)
      .gte("pago_em", dia(-3))
      .lte("pago_em", dia(3))
      .limit(1);
    const igual = (parecidas ?? [])[0];
    if (igual) {
      const nasceuDe: Record<string, string> = {
        coleta: "nasceu de uma coleta paga pela sede",
        abastecimento: "nasceu de um abastecimento com nota assinada",
        manutencao: "nasceu de uma manutenção",
        compra_direta: "nasceu de uma compra direta",
        documento: "nasceu de um documento",
      };
      const origem = igual.origem_tipo
        ? nasceuDe[igual.origem_tipo] || "veio de outro lançamento"
        : "foi lançada na mão";
      return NextResponse.json(
        {
          error:
            `Já existe uma saída de R$ ${Number(igual.valor).toFixed(2).replace(".", ",")} nessa mesma conta em ` +
            `${String(igual.pago_em).slice(0, 10).split("-").reverse().join("/")}: "${igual.descricao}" — ` +
            `essa ${origem}. Se for a MESMA linha do extrato, não lance de novo: o saldo da conta no app ficaria ` +
            `abaixo do saldo do banco. Se forem dois pagamentos diferentes de mesmo valor, confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

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
      divida_id,
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
      // RÉGUA DO DINHEIRO #1 — vale MAIOR que o pagamento.
      // O vale é tudo-ou-nada: marcar um de R$ 3.000 num salário de R$
      // 2.000 tirava o vale inteiro da lista e R$ 1.000 de desconto
      // deixavam de existir, calados. Agora avisa e pede o 2º clique.
      const { data: marcados } = await client
        .from("acertos")
        .select("valor_vale")
        .in("id", vales_quitados)
        .is("vale_quitado_em", null);
      const somaVales = Math.round(
        ((marcados as { valor_vale: number }[]) ?? []).reduce(
          (s, v) => s + Number(v.valor_vale || 0),
          0
        ) * 100
      ) / 100;
      if (somaVales > valor + 0.009 && !body.confirmado) {
        await client.from("contas_a_pagar").delete().eq("id", criado.id);
        return NextResponse.json(
          {
            error: `Os vales marcados somam ${somaVales.toFixed(
              2
            )} e o pagamento é de ${valor.toFixed(
              2
            )}. O vale é tudo-ou-nada: marcando assim, o vale inteiro sai da lista e ${(
              somaVales - valor
            ).toFixed(
              2
            )} de desconto deixam de existir. Desconte o resto no próximo salário (deixe o vale pendente) ou confirme.`,
            precisaConfirmar: true,
          },
          { status: 409 }
        );
      }
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
