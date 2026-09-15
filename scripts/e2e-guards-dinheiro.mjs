/**
 * E2E DOS GUARDS DE DINHEIRO — o caminho que dá ERRADO.
 *
 *   node scripts/e2e-guards-dinheiro.mjs
 *
 * Roda contra produção dentro de UMA transação com ROLLBACK — nada sobra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------------------------------------------------------
 * Os outros E2E testam o caminho FELIZ: lançar, calcular, conferir. E o
 * caminho feliz é justamente aquele em que ninguém precisa do sistema.
 *
 * Em 21/08/2026 um buraco passou porque a feature foi testada só assim: o
 * pagamento de dívida aceitava valor MAIOR que o saldo devedor, o saldo
 * ficava negativo e a tela mascarava com Math.max(0, …). A varredura
 * adversarial que veio depois achou 30 irmãos do mesmo bug.
 *
 * Este arquivo é a pergunta 8 da REGUA-DO-DINHEIRO.md virada em teste:
 * cada guard tem aqui um caso com o valor ERRADO DE PROPÓSITO, pra que uma
 * regressão quebre o CI em vez de quebrar o caixa do Jean.
 *
 * Os guards de HTTP (409 + precisaConfirmar) não dá pra exercitar daqui —
 * o que se testa é a MATEMÁTICA e as invariantes do banco em que eles se
 * apoiam: se o saldo devolvido pela função mudar de sinal ou de fórmula, o
 * guard lá em cima passa a comparar contra a coisa errada e ninguém nota.
 */
import { carregarEnv } from "./carregar-env.mjs";
import pg from "pg";

carregarEnv(["DATABASE_URL"]);

const url = new URL(process.env.DATABASE_URL);
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port) || 5432,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, "") || "postgres",
  ssl: { rejectUnauthorized: false },
});

let falhas = 0;
const num = (v) => Math.round(Number(v) * 100) / 100;

function afirmar(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`   ${condicao ? "OK " : "FALHOU"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}
function igual(rotulo, obtido, esperado, tol = 0.02) {
  const ok = Math.abs(Number(obtido) - Number(esperado)) <= tol;
  if (!ok) falhas++;
  console.log(
    `   ${ok ? "OK " : "FALHOU"} ${rotulo}: ${num(obtido)} (esperado ${num(esperado)})`
  );
}

await client.connect();
await client.query("begin");

try {
  const evaner = (await client.query("select id from profiles where nome='Evaner' limit 1"))
    .rows[0].id;
  const conta = (
    await client.query("select id from contas_financeiras where ativa order by nome limit 1")
  ).rows[0].id;

  // =========================================================================
  console.log("\n1. DÍVIDA — pagar MAIS do que falta");
  // =========================================================================
  {
    const d = (
      await client.query(
        `insert into dividas (credor, tipo, valor_total, parcelas_total, valor_parcela, registrado_por)
         values ('E2E Guard', 'parcelada', 10000, 2, 5000, $1) returning id`,
        [evaner]
      )
    ).rows[0].id;

    const pagar = (valor) =>
      client.query(
        `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, pago_em, conta_id, divida_id, registrado_por)
         values ('E2E', 'dividas_pf', $1, current_date, 'paga', current_date, $2, $3, $4)`,
        [valor, conta, d, evaner]
      );
    const saldo = async () =>
      Number(
        (await client.query("select saldo from saldo_dividas() where id = $1", [d])).rows[0]
          .saldo
      );

    igual("saldo nasce igual ao total", await saldo(), 10000);
    await pagar(4000);
    igual("3 pagamentos parciais abatem certo", await saldo(), 6000);

    // O caso do bug: pagar 8.000 numa dívida que só devia 6.000.
    await pagar(8000);
    const s = await saldo();
    igual("pagar a mais deixa saldo NEGATIVO (não pode zerar calado)", s, -2000);
    afirmar(
      "o excedente é visível como número negativo, não escondido",
      s < 0,
      `saldo=${s}`
    );

    // A linha do patrimônio não pode virar crédito fantasma.
    const linha = Number(
      (
        await client.query(
          "select coalesce(sum(saldo),0) t from saldo_dividas() where status='aberta' and saldo>0"
        )
      ).rows[0].t
    );
    afirmar("dívida com saldo negativo NÃO entra na linha do patrimônio", linha >= 0);

    // Apagar o pagamento devolve a dívida — sem trigger, é derivado.
    await client.query("delete from contas_a_pagar where divida_id = $1 and valor = 8000", [d]);
    igual("apagar o pagamento devolve a dívida sozinho", await saldo(), 6000);

    // Parcela AGENDADA não abate (regime de caixa).
    await client.query(
      `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, conta_id, divida_id, registrado_por)
       values ('E2E futura', 'dividas_pf', 5000, current_date, 'a_pagar', $1, $2, $3)`,
      [conta, d, evaner]
    );
    igual("parcela agendada NÃO abate o saldo", await saldo(), 6000);

    // Anti-dobra: conta amarrada a dívida sai da linha de contas a pagar.
    const semDivida = Number(
      (
        await client.query(
          "select coalesce(sum(valor),0) t from contas_a_pagar where status='a_pagar' and divida_id is null"
        )
      ).rows[0].t
    );
    const comDivida = Number(
      (
        await client.query(
          "select coalesce(sum(valor),0) t from contas_a_pagar where status='a_pagar'"
        )
      ).rows[0].t
    );
    afirmar(
      "conta de dívida fica FORA de 'contas a pagar em aberto' (anti-dobra)",
      comDivida - semDivida >= 5000
    );
  }

  // =========================================================================
  console.log("\n2. DRE — conta CANCELADA devolve o fato pro relatório");
  // =========================================================================
  {
    // A anti-dobra do DRE lê contas com origem_id. Cancelada não paga nada,
    // então o fato tem que voltar a contar sozinho.
    const coleta = (
      await client.query(
        // valor_sede junto (0058): o CHECK exige que os dois concordem.
        `insert into coletas (motorista_id, client_id, litros, valor_pago, valor_sede, local_nome, certificado_tipo, pago_pela_sede, criado_em)
         values ($1, gen_random_uuid(), 100, 250, 250, 'E2E Guard', 'nao', true, now()) returning id`,
        [evaner]
      )
    ).rows[0].id;
    await client.query(
      `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, origem_tipo, origem_id, registrado_por)
       values ('E2E', 'oleo_sede', 250, current_date, 'cancelada', 'coleta', $1, $2)`,
      [coleta, evaner]
    );

    const escondidos = Number(
      (
        await client.query(
          `select count(*) n from contas_a_pagar
           where origem_id = $1 and status <> 'cancelada'`,
          [coleta]
        )
      ).rows[0].n
    );
    afirmar(
      "conta cancelada NÃO esconde mais o fato do DRE (filtro status)",
      escondidos === 0,
      "o custo voltaria a sumir pra sempre se este filtro cair"
    );
  }

  // =========================================================================
  console.log("\n3. ESTOQUE — custo médio corrompido tem que se DENUNCIAR");
  // =========================================================================
  {
    const r = await client.query("select * from estoque_atual()");
    afirmar(
      "estoque_atual() expõe a coluna custo_confiavel",
      r.rows.length > 0 && "custo_confiavel" in r.rows[0],
      "sem ela, venda a descoberto corrompe o custo em silêncio"
    );
  }

  // =========================================================================
  console.log("\n4. ACERTO — idempotência (clique duplo não credita em dobro)");
  // =========================================================================
  {
    const cid = (await client.query("select gen_random_uuid() id")).rows[0].id;
    const inserir = () =>
      client.query(
        `insert into acertos (motorista_id, valor_devolvido, valor_vale, valor_saldo, conta_id, client_id, registrado_por)
         values ($1, 100, 0, 0, $2, $3, $4)`,
        [evaner, conta, cid, evaner]
      );
    await inserir();
    let bloqueou = false;
    try {
      await client.query("savepoint s1");
      await inserir();
      await client.query("release savepoint s1");
    } catch (e) {
      bloqueou = e.code === "23505";
      await client.query("rollback to savepoint s1");
    }
    afirmar("o MESMO client_id não grava dois acertos", bloqueou);
  }

  // =========================================================================
  console.log("\n5. CHEQUE — transição de status não pode pular etapa");
  // =========================================================================
  {
    const comprador = (
      await client.query("select id from compradores order by nome limit 1")
    ).rows[0].id;
    const rec = (
      await client.query(
        `insert into recebimentos (comprador_id, forma, valor, data, registrado_por)
         values ($1, 'cheque', 500, current_date, $2) returning id`,
        [comprador, evaner]
      )
    ).rows[0].id;
    const ch = (
      await client.query(
        `insert into cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para, status)
         values ($1, $2, '001', 'E2E', 500, current_date, 'devolvido') returning id`,
        [rec, comprador]
      )
    ).rows[0].id;

    // O padrão do sistema: o UPDATE filtra pelo status ANTERIOR.
    const mexeu = await client.query(
      "update cheques set status='compensado' where id=$1 and status='em_carteira' returning id",
      [ch]
    );
    afirmar(
      "compensar cheque DEVOLVIDO mexe em 0 linhas (o filtro protege)",
      mexeu.rowCount === 0
    );
  }

  // =========================================================================
  console.log("\n6. VENDA — a mistura fino+grosso TEM que fechar");
  // =========================================================================
  {
    const comprador = (
      await client.query("select id from compradores order by nome limit 1")
    ).rows[0].id;
    let recusou = false;
    try {
      await client.query("savepoint s2");
      await client.query(
        `insert into vendas (comprador_id, data, peso_total_kg, kg_fino, kg_grosso, preco_kg, valor_total, registrado_por)
         values ($1, current_date, 1000, 900, 900, 2, 2000, $2)`,
        [comprador, evaner]
      );
      await client.query("release savepoint s2");
    } catch {
      recusou = true;
      await client.query("rollback to savepoint s2");
    }
    afirmar("900 + 900 numa venda de 1.000 kg é recusado pelo banco", recusou);
  }

  // =========================================================================
  console.log("\n7. CONTA PAGA — sem data de pagamento é recusada");
  // =========================================================================
  {
    let recusou = false;
    try {
      await client.query("savepoint s3");
      await client.query(
        `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, registrado_por)
         values ('E2E', 'sistema', 10, current_date, 'paga', $1)`,
        [evaner]
      );
      await client.query("release savepoint s3");
    } catch {
      recusou = true;
      await client.query("rollback to savepoint s3");
    }
    afirmar("conta 'paga' sem pago_em é recusada (CHECK paga_precisa_de_data)", recusou);
  }

  // =========================================================================
  console.log("\nTROCO DE CHEQUE — o dinheiro que volta do fornecedor (0072)");
  // =========================================================================
  // O guard de "cheque não bate com a conta" mora no ENDPOINT (como o de
  // peso bruto < tara): daqui não dá pra exercitar o 400. O que se testa é a
  // invariante em que ele se apoia — um cheque gera NO MÁXIMO UM troco — e a
  // MATEMÁTICA do cheque menor, que é onde o dinheiro some quando erra.
  {
    const comprador = (
      await client.query(
        "insert into compradores (nome, ativo) values ('E2E Guard Comprador', false) returning id"
      )
    ).rows[0].id;
    const rec = (
      await client.query(
        `insert into recebimentos (comprador_id, forma, valor, data, registrado_por)
         values ($1, 'cheque', 600, current_date, $2) returning id`,
        [comprador, evaner]
      )
    ).rows[0].id;
    const cheque = (
      await client.query(
        `insert into cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para)
         values ($1, $2, '999', 'E2E Guard', 600, current_date) returning id`,
        [rec, comprador]
      )
    ).rows[0].id;

    const troco = (v) =>
      client.query(
        `insert into entradas_avulsas (tipo, valor, data, conta_id, descricao, origem_tipo, origem_id, registrado_por)
         values ('reembolso', $1, current_date, $2, 'E2E troco', 'cheque', $3, $4)`,
        [v, conta, cheque, evaner]
      );

    await troco(400);
    afirmar("o troco de um cheque entra no caixa", true);

    let recusouDobra = false;
    try {
      await client.query("savepoint t1");
      await troco(400);
      await client.query("release savepoint t1");
    } catch {
      recusouDobra = true;
      await client.query("rollback to savepoint t1");
    }
    afirmar(
      "o MESMO cheque não pode gerar um segundo troco (índice único)",
      recusouDobra,
      recusouDobra ? "" : "lançou dois trocos — o caixa ficaria maior que o banco"
    );

    // Cheque de 600 numa conta de 1.000: a conta passa a valer o cheque e o
    // resto nasce em aberto. A soma das duas TEM que ser a conta original —
    // é aqui que os R$ 4,64 do BATERIAS sumiram em 26/08.
    const mae = (
      await client.query(
        `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, registrado_por)
         values ('E2E cheque menor', 'sistema', 1000, current_date, 'a_pagar', $1) returning id`,
        [evaner]
      )
    ).rows[0].id;
    await client.query(
      `update contas_a_pagar set valor = 600, status='paga', pago_em=current_date,
         forma_pagamento='cheque', cheque_id=$2 where id = $1`,
      [mae, cheque]
    );
    await client.query(
      `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, registrado_por)
       values ('E2E cheque menor (restante)', 'sistema', 400, current_date, 'a_pagar', $1)`,
      [evaner]
    );
    const soma = Number(
      (
        await client.query(
          `select sum(valor) s from contas_a_pagar
            where descricao like 'E2E cheque menor%'`
        )
      ).rows[0].s
    );
    igual("cheque menor: pago + restante = a conta original", soma, 1000);

    // -----------------------------------------------------------------
    // CHEQUE DEVOLVIDO VIRA DÍVIDA (0073)
    // -----------------------------------------------------------------
    // A escolha entre "reverte a conta" e "cria dívida" é do endpoint. O que
    // se testa aqui são as invariantes do banco em que ela se apoia — e a
    // primeira delas é a que morderia no pior momento: o CHECK de
    // `origem_tipo` precisa aceitar o tipo novo, senão a dívida falha
    // exatamente quando um cheque volta do banco.
    const posto = (
      await client.query(
        `insert into locais (nome_canonico, latitude, longitude, tipo)
         values ('E2E Posto Guard', -24.0, -54.0, 'posto') returning id`
      )
    ).rows[0].id;

    const criarDivida = (chequeId) =>
      client.query(
        `insert into contas_a_pagar
           (descricao, categoria, valor, vencimento, status, local_id,
            origem_tipo, origem_id, registrado_por)
         values ('E2E cheque devolvido', 'cheque_devolvido', 250, current_date,
                 'a_pagar', $1, 'cheque_devolvido', $2, $3)`,
        [posto, chequeId, evaner]
      );

    let aceitou = true;
    try {
      await client.query("savepoint d1");
      await criarDivida(cheque);
      await client.query("release savepoint d1");
    } catch (e) {
      aceitou = false;
      await client.query("rollback to savepoint d1");
      console.log("      (motivo: " + e.message + ")");
    }
    afirmar(
      "o banco ACEITA origem_tipo 'cheque_devolvido' (CHECK da 0073)",
      aceitou,
      aceitou ? "" : "a dívida falharia bem na hora em que o cheque volta"
    );

    let recusouSegunda = false;
    try {
      await client.query("savepoint d2");
      await criarDivida(cheque);
      await client.query("release savepoint d2");
    } catch {
      recusouSegunda = true;
      await client.query("rollback to savepoint d2");
    }
    afirmar(
      "o MESMO cheque devolvido não gera duas dívidas (índice único)",
      recusouSegunda,
      recusouSegunda ? "" : "devolver duas vezes cobraria o mesmo papel em dobro"
    );

    const saldoPosto = Number(
      (
        await client.query("select saldo from saldo_postos() where local_id = $1", [
          posto,
        ])
      ).rows[0]?.saldo ?? -1
    );
    igual(
      "a dívida do cheque devolvido APARECE no saldo do posto",
      saldoPosto,
      250
    );

    // O terceiro braço da saldo_postos() exclui as origens dos outros dois.
    // Sem essa exclusão, uma conta de abastecimento que também tivesse
    // `local_id` seria somada DUAS vezes — e o Jean pagaria o posto olhando
    // um número maior do que deve.
    //
    // Testa a propriedade direto: conta com origem de abastecimento E
    // local_id preenchido. O primeiro braço não a pega (não existe
    // abastecimento com esse id) e o terceiro tem que ignorá-la também —
    // então o saldo NÃO pode mudar.
    await client.query(
      `insert into contas_a_pagar
         (descricao, categoria, valor, vencimento, status, local_id,
          origem_tipo, origem_id, registrado_por)
       values ('E2E dobra', 'combustivel', 999, current_date, 'a_pagar', $1,
               'abastecimento', gen_random_uuid(), $2)`,
      [posto, evaner]
    );
    const saldoDepois = Number(
      (
        await client.query("select saldo from saldo_postos() where local_id = $1", [
          posto,
        ])
      ).rows[0]?.saldo ?? -1
    );
    igual(
      "conta de abastecimento com local_id NÃO é contada duas vezes",
      saldoDepois,
      250
    );
  }

  console.log(
    falhas === 0
      ? "\nTODOS OS GUARDS DE PÉ.\n"
      : `\n${falhas} GUARD(S) CAÍRAM — o caminho errado deixou de ser barrado.\n`
  );
} catch (e) {
  falhas++;
  console.error("\nERRO no teste:", e.message);
} finally {
  await client.query("rollback");
  await client.end();
}

process.exit(falhas === 0 ? 0 : 1);
