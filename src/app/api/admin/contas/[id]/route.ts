import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { linhaPlano, pedePessoa, pessoaOpcional } from "@/lib/plano-contas";
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * PATCH — quatro ações:
 *
 *  pagar     → marca como paga. Escolhendo cheque, o papel sai da carteira
 *              e vira 'repassado' com esta conta como destino. É o elo entre
 *              o cheque que entrou numa venda e a conta que ele quita.
 *  confirmar → previsão vira conta real (o boleto chegou e o valor é outro).
 *  cancelar  → some das contas sem apagar o histórico.
 *  editar_pagamento → corrige um pagamento JÁ FEITO: data, conta, categoria,
 *              pessoa e observação. O VALOR fica de fora de propósito —
 *              valor errado se conserta apagando e relançando, porque mexe
 *              no caixa e merece o rito completo.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const acao = String(body.acao || "");
  const client = getSupabaseAdmin(admin.id);
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (acao === "cancelar") {
    const { data, error } = await client
      .from("contas_a_pagar")
      .update({ status: "cancelada" })
      .eq("id", id)
      .in("status", ["prevista", "a_pagar"])
      .select("id, origem_tipo, origem_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json(
        { error: "essa conta já mudou de situação — recarregue a tela" },
        { status: 409 }
      );
    }
    // Conta de coleta paga pela sede cancelada = "essa dívida não existe".
    // Então quem pagou foi o motorista: a coleta volta a descontar do saldo
    // dele. Sem isso o flag ficava de pé sem conta nenhuma — o valor não
    // descontava de ninguém, não devia a ninguém e sumia do DRE.
    let aviso: string | null = null;
    const cancelada = data[0];
    if (cancelada.origem_tipo === "coleta" && cancelada.origem_id) {
      const { error: eFlag } = await client
        .from("coletas")
        .update({ pago_pela_sede: false })
        .eq("id", cancelada.origem_id);
      aviso = eFlag
        ? `a coleta de origem não foi desmarcada (${eFlag.message}) — confira no detalhe dela`
        : "a coleta voltou a descontar do saldo do motorista (a sede não deve mais esse óleo)";
    } else if (
      cancelada.origem_tipo === "abastecimento" ||
      cancelada.origem_tipo === "despesa"
    ) {
      aviso =
        "atenção: o lançamento de origem continua como 'assinou a nota' e agora está sem dívida — se quem pagou foi o motorista, edite o lançamento pra 'pagou na hora'";
    }
    return NextResponse.json({ ok: true, ...(aviso ? { aviso } : {}) });
  }

  // Corrigir valor/vencimento de uma conta AINDA NÃO PAGA é seguro por
  // definição: o que gira pro DRE e pro caixa é o PAGAMENTO — enquanto a
  // conta deve, ela é só uma promessa, e promessa se corrige. O caso real
  // do Evaner: o óleo pago pela sede tem valor certo mas o vencimento é
  // combinado depois (3, 15 ou 30 dias).
  if (acao === "editar") {
    const updates: Record<string, unknown> = {};
    if (body.valor !== undefined) {
      const valor = Number(body.valor);
      if (!Number.isFinite(valor) || valor <= 0) {
        return NextResponse.json({ error: "valor inválido" }, { status: 400 });
      }
      updates.valor = n2(valor);
    }
    if (body.vencimento !== undefined) {
      const vencimento = String(body.vencimento || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
        return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
      }
      updates.vencimento = vencimento;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
    }
    const { data, error } = await client
      .from("contas_a_pagar")
      .update(updates)
      .eq("id", id)
      .in("status", ["prevista", "a_pagar"])
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json(
        { error: "essa conta já foi paga ou cancelada — recarregue a tela" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Corrigir um pagamento já feito. Categoria errada no DRE é o tipo de
  // erro que só aparece olhando o relatório no fim do mês — obrigar a
  // apagar e relançar por causa disso é convite pra deixar errado.
  if (acao === "editar_pagamento") {
    const { data: conta, error: eConta } = await client
      .from("contas_a_pagar")
      .select("id, status, origem_tipo, cheque_id, categoria, pessoa_id")
      .eq("id", id)
      .maybeSingle();
    if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });
    if (!conta) return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });
    if (conta.status !== "paga") {
      return NextResponse.json(
        { error: "essa conta ainda não foi paga — use 'editar' (valor/vencimento) enquanto está em aberto" },
        { status: 409 }
      );
    }

    const updates: Record<string, unknown> = {};

    if (body.pago_em !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.pago_em))) {
        return NextResponse.json({ error: "data de pagamento inválida" }, { status: 400 });
      }
      updates.pago_em = body.pago_em;
    }

    if (body.conta_id !== undefined) {
      if (conta.cheque_id) {
        return NextResponse.json(
          { error: "esse pagamento foi com CHEQUE — o dinheiro saiu do papel, não de conta; não há conta pra trocar" },
          { status: 400 }
        );
      }
      if (!body.conta_id) {
        return NextResponse.json({ error: "diga de qual conta saiu o dinheiro" }, { status: 400 });
      }
      updates.conta_id = String(body.conta_id);
    }

    // Categoria/pessoa/observação: só em lançamento manual. Conta que veio
    // de um fato (abastecimento, manutenção, coleta, documento, compra)
    // tem categoria derivada da origem — mexer aqui dessincronizaria.
    if (
      (body.categoria !== undefined ||
        body.pessoa_id !== undefined ||
        body.descricao !== undefined) &&
      conta.origem_tipo
    ) {
      return NextResponse.json(
        { error: "essa conta veio de um lançamento operacional — categoria e descrição são da origem; aqui só a data e a conta do pagamento podem mudar" },
        { status: 400 }
      );
    }

    if (body.categoria !== undefined) {
      const linha = linhaPlano(String(body.categoria));
      if (!linha || linha.fonte !== "lancamento") {
        return NextResponse.json({ error: "categoria inválida" }, { status: 400 });
      }
      // Se esse pagamento descontou vales, ele precisa CONTINUAR sendo
      // Salário — vale só desconta em salário. Trocar a categoria deixaria
      // vale quitado por um pagamento de outra coisa.
      if (String(body.categoria) !== conta.categoria) {
        const { count } = await client
          .from("acertos")
          .select("id", { count: "exact", head: true })
          .eq("vale_quitado_por", id);
        if ((count ?? 0) > 0 && String(body.categoria) !== "salario") {
          return NextResponse.json(
            { error: "esse pagamento descontou vale(s) de acerto — pra trocar a categoria, apague o pagamento (os vales voltam a pendentes) e relance" },
            { status: 409 }
          );
        }
      }
      updates.categoria = String(body.categoria);
    }

    const categoriaFinal = (updates.categoria as string) ?? conta.categoria;
    if (body.pessoa_id !== undefined) {
      updates.pessoa_id = body.pessoa_id ? String(body.pessoa_id) : null;
    }
    const pessoaFinal =
      body.pessoa_id !== undefined
        ? body.pessoa_id
          ? String(body.pessoa_id)
          : null
        : conta.pessoa_id;
    if (pedePessoa(categoriaFinal) && !pessoaOpcional(categoriaFinal) && !pessoaFinal) {
      return NextResponse.json(
        { error: "essa categoria pede a pessoa (o QUEM) — escolha de quem é" },
        { status: 400 }
      );
    }
    if (!pedePessoa(categoriaFinal)) updates.pessoa_id = null;

    if (body.descricao !== undefined) {
      // descricao é NOT NULL — vazio cai no rótulo da categoria, igual ao
      // POST de lançamentos.
      updates.descricao =
        (body.descricao ? String(body.descricao).trim() : "") ||
        (linhaPlano(categoriaFinal)?.label ?? categoriaFinal);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
    }

    const { data: mexeu, error } = await client
      .from("contas_a_pagar")
      .update(updates)
      .eq("id", id)
      .eq("status", "paga")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!mexeu?.length) {
      return NextResponse.json(
        { error: "essa conta já mudou de situação — recarregue a tela" },
        { status: 409 }
      );
    }

    // Pagamento com cheque tem DOIS relógios amarrados: a despesa conta
    // pelo pago_em da conta e a receita do cheque pelo repassado_em. Mudou
    // a data, os dois andam juntos — senão o DRE racharia no meio.
    if (updates.pago_em !== undefined && conta.cheque_id) {
      const { error: eCh } = await client
        .from("cheques")
        .update({ repassado_em: updates.pago_em })
        .eq("id", conta.cheque_id)
        .eq("status", "repassado");
      if (eCh) {
        return NextResponse.json({
          ok: true,
          aviso: `a data do repasse do cheque não acompanhou (${eCh.message}) — confira na tela de Cheques`,
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (acao === "confirmar") {
    const valor = Number(body.valor);
    const vencimento = String(body.vencimento || "").trim();
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
    }
    const { data, error } = await client
      .from("contas_a_pagar")
      .update({ status: "a_pagar", valor: n2(valor), vencimento })
      .eq("id", id)
      .eq("status", "prevista")
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json({ error: "essa conta não é uma previsão" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (acao !== "pagar") {
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  }

  const forma = String(body.forma_pagamento || "");
  if (!["dinheiro", "pix", "deposito", "boleto", "cheque"].includes(forma)) {
    return NextResponse.json({ error: "forma de pagamento inválida" }, { status: 400 });
  }

  // A conta inteira, ANTES: o pagamento parcial e o vale precisam saber
  // valor, categoria e dono.
  const { data: contaAlvo, error: eAlvo } = await client
    .from("contas_a_pagar")
    .select(
      "id, valor, categoria, pessoa_id, fornecedor, descricao, vencimento, origem_tipo, origem_id, status"
    )
    .eq("id", id)
    .maybeSingle();
  if (eAlvo) return NextResponse.json({ error: eAlvo.message }, { status: 400 });
  if (!contaAlvo) return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });

  // -------------------------------------------------- pagamento PARCIAL
  // "Paguei metade hoje, metade mês que vem." A conta original vira PAGA
  // pelo valor pago (caixa e DRE exatos) e o RESTO nasce como conta nova,
  // em aberto, com o mesmo vencimento/categoria/dono — a dívida não perde
  // o fio. Cheque fica de fora: o papel quita inteiro.
  const valorConta = Number(contaAlvo.valor);
  let valorParcial: number | null = null;
  if (body.valor_pago !== undefined && body.valor_pago !== null) {
    const vp = Number(body.valor_pago);
    if (!Number.isFinite(vp) || vp <= 0) {
      return NextResponse.json({ error: "valor pago inválido" }, { status: 400 });
    }
    if (forma === "cheque") {
      return NextResponse.json(
        { error: "pagamento parcial não funciona com cheque — o papel quita o valor inteiro" },
        { status: 400 }
      );
    }
    if (Math.round(vp * 100) < Math.round(valorConta * 100)) {
      valorParcial = n2(vp);
    } else if (Math.round(vp * 100) > Math.round(valorConta * 100)) {
      return NextResponse.json(
        { error: "valor pago maior que a conta — se pagou juros/multa, use o campo próprio" },
        { status: 400 }
      );
    }
  }

  // ------------------------------------------------------- juros e multa
  // A diferença de um boleto atrasado tem categoria própria (juros_multas)
  // — entrar disfarçada na categoria original poluía a linha do DRE.
  let juros = 0;
  if (body.juros !== undefined && body.juros !== null) {
    const j = Number(body.juros);
    if (!Number.isFinite(j) || j < 0) {
      return NextResponse.json({ error: "juros inválidos" }, { status: 400 });
    }
    if (j > 0 && forma === "cheque") {
      return NextResponse.json(
        { error: "juros junto de cheque não — lance os juros como um lançamento próprio" },
        { status: 400 }
      );
    }
    juros = n2(j);
  }

  // Pagar COM cheque não tira dinheiro de conta nenhuma: quitou com o papel,
  // que sai da carteira e vira 'repassado'. Nas outras formas o dinheiro saiu
  // de algum lugar agora, e sem dizer de onde o caixa não fecha.
  const contaId = body.conta_id ? String(body.conta_id) : null;
  if (forma !== "cheque" && !contaId) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro" },
      { status: 400 }
    );
  }
  const pagoEm =
    body.pago_em && /^\d{4}-\d{2}-\d{2}$/.test(body.pago_em) ? body.pago_em : hoje;

  let chequeId: string | null = null;
  if (forma === "cheque") {
    chequeId = String(body.cheque_id || "") || null;
    if (!chequeId) {
      return NextResponse.json(
        { error: "escolha qual cheque da carteira vai pagar" },
        { status: 400 }
      );
    }
    // Tira da carteira ANTES de quitar a conta: se o cheque já tiver sido
    // usado em outra aba, a conta não pode ficar marcada como paga por um
    // papel que não está mais lá.
    const { data: ch, error: eCh } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: pagoEm,
        repassado_para: String(body.repassado_para || "").trim() || null,
      })
      .eq("id", chequeId)
      .eq("status", "em_carteira")
      .select();
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (!ch?.length) {
      return NextResponse.json(
        { error: "esse cheque não está mais na carteira — recarregue a tela" },
        { status: 409 }
      );
    }
  }

  const { data, error } = await client
    .from("contas_a_pagar")
    .update({
      status: "paga",
      forma_pagamento: forma,
      pago_em: pagoEm,
      cheque_id: chequeId,
      conta_id: forma === "cheque" ? null : contaId,
      // Parcial: a conta original passa a valer o que foi pago DE VERDADE.
      ...(valorParcial !== null ? { valor: valorParcial } : {}),
    })
    .eq("id", id)
    .in("status", ["prevista", "a_pagar"])
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) {
    // Devolve o cheque pra carteira: a conta não foi paga por ele.
    if (chequeId) {
      await client
        .from("cheques")
        .update({ status: "em_carteira", repassado_em: null, repassado_para: null })
        .eq("id", chequeId);
    }
    return NextResponse.json(
      { error: "essa conta já mudou de situação — recarregue a tela" },
      { status: 409 }
    );
  }

  const avisos: string[] = [];

  // O resto da dívida continua em aberto, como conta nova.
  if (valorParcial !== null) {
    const resto = n2(valorConta - valorParcial);
    const { error: eResto } = await client.from("contas_a_pagar").insert({
      descricao: `${contaAlvo.descricao} (restante)`,
      fornecedor: contaAlvo.fornecedor,
      categoria: contaAlvo.categoria,
      valor: resto,
      vencimento: contaAlvo.vencimento,
      status: "a_pagar",
      pessoa_id: contaAlvo.pessoa_id,
      origem_tipo: contaAlvo.origem_tipo,
      origem_id: contaAlvo.origem_id,
      registrado_por: admin.id,
    });
    if (eResto) {
      avisos.push(
        `ATENÇÃO: paguei os R$ ${valorParcial.toFixed(2).replace(".", ",")} mas o RESTANTE de R$ ${resto.toFixed(2).replace(".", ",")} não virou conta (${eResto.message}) — crie a conta do resto na mão`
      );
    } else {
      avisos.push(
        `o restante de R$ ${resto.toFixed(2).replace(".", ",")} continua em aberto como conta nova`
      );
    }
  }

  // Juros/multa entram como pagamento próprio, na categoria certa.
  if (juros > 0) {
    const { error: eJuros } = await client.from("contas_a_pagar").insert({
      descricao: `Juros/multa — ${contaAlvo.descricao}`,
      fornecedor: contaAlvo.fornecedor,
      categoria: "juros_multas",
      valor: juros,
      vencimento: pagoEm,
      pago_em: pagoEm,
      status: "paga",
      forma_pagamento: forma,
      conta_id: contaId,
      registrado_por: admin.id,
    });
    if (eJuros) {
      avisos.push(
        `os juros de R$ ${juros.toFixed(2).replace(".", ",")} não foram lançados (${eJuros.message}) — lance na mão em Lançamentos (categoria Juros e multas)`
      );
    } else {
      avisos.push(
        `R$ ${juros.toFixed(2).replace(".", ",")} de juros/multa lançados em "Juros e multas"`
      );
    }
  }

  // Vales de acerto quitados por este pagamento (só Salário com pessoa —
  // mesma regra da tela de Lançamentos, senão as duas portas divergiam).
  let valesQuitados = 0;
  const valesMarcados: string[] = Array.isArray(body.vales_quitados)
    ? body.vales_quitados.map(String)
    : [];
  if (valesMarcados.length > 0) {
    if (contaAlvo.categoria !== "salario" || !contaAlvo.pessoa_id) {
      avisos.push(
        "os vales marcados NÃO foram quitados — vale só desconta em pagamento de Salário com a pessoa escolhida"
      );
    } else {
      const { data: mexidos } = await client
        .from("acertos")
        .update({ vale_quitado_em: pagoEm, vale_quitado_por: id })
        .in("id", valesMarcados)
        .eq("motorista_id", contaAlvo.pessoa_id)
        .is("vale_quitado_em", null)
        .select("id");
      valesQuitados = mexidos?.length ?? 0;
      const deFora = valesMarcados.length - valesQuitados;
      if (deFora > 0) {
        avisos.push(
          `${deFora} vale(s) marcado(s) ficou(aram) DE FORA — ou já quitado(s) por outro pagamento, ou não é(são) dessa pessoa; confira em Adiantamentos`
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    valesQuitados,
    ...(avisos.length > 0 ? { avisos } : {}),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  // Apagar um pagamento desfaz TUDO que ele fez — senão fica ponta solta:
  //  - o cheque que pagou a conta ficava 'repassado' pra sempre (fora da
  //    carteira, sem despesa correspondente);
  //  - o vale marcado como quitado sumia da lista de pendentes sem nunca
  //    ter sido descontado de salário nenhum (o FK só limpava o ponteiro).
  const { data: conta } = await client
    .from("contas_a_pagar")
    .select("cheque_id, status, origem_tipo, origem_id")
    .eq("id", id)
    .maybeSingle();

  const desfeito: string[] = [];

  if (conta?.cheque_id) {
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

  const { data: vales, error: eVales } = await client
    .from("acertos")
    .update({ vale_quitado_em: null, vale_quitado_por: null })
    .eq("vale_quitado_por", id)
    .select("id");
  if (eVales) return NextResponse.json({ error: eVales.message }, { status: 400 });
  if (vales?.length) {
    desfeito.push(
      `${vales.length} vale(s) voltou(aram) a ficar pendente(s) — o desconto não aconteceu`
    );
  }

  const { error } = await client.from("contas_a_pagar").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Conta de coleta da sede apagada: a coleta não pode ficar com o flag de
  // pé sem conta nenhuma (o valor evaporaria — nem motorista, nem dívida,
  // nem DRE). Ela volta a descontar do motorista, e o aviso conta.
  if (conta?.origem_tipo === "coleta" && conta.origem_id) {
    const { error: eFlag } = await client
      .from("coletas")
      .update({ pago_pela_sede: false })
      .eq("id", conta.origem_id);
    desfeito.push(
      eFlag
        ? `a coleta de origem não foi desmarcada (${eFlag.message})`
        : "a coleta de origem voltou a descontar do saldo do motorista"
    );
  }
  return NextResponse.json({ ok: true, desfeito });
}
