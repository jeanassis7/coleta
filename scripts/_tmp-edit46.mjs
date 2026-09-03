import fs from "fs";
const f = "src/app/api/admin/postos/[id]/fechamento/route.ts";
let s = fs.readFileSync(f, "utf8");
const NL = s.includes("\r\n") ? "\r\n" : "\n";
const L = (...l) => l.join(NL);
function troca(velho, novo, oq) {
  if (!s.includes(velho)) throw new Error("NAO ACHOU: " + oq);
  if (s.split(velho).length > 2) throw new Error("AMBIGUO: " + oq);
  s = s.replace(velho, novo);
}

// A conta precisa vir inteira: os campos vão pra cópia da nota dividida.
troca(
  L(`    .select("id, valor, origem_id, vencimento, status")`),
  L(
    `    .select(`,
    `      "id, valor, origem_id, vencimento, status, categoria, pessoa_id, fornecedor, descricao"`,
    `    )`
  ),
  "select das contas"
);

// A doc no topo deixa de prometer o que a rota não faz mais.
troca(
  L(
    ` * SOBRE A ALOCAÇÃO: o dinheiro quita notas INTEIRAS, e o cheque quita o`,
    ` * resto. Se a divisão cair no meio de uma nota, a rota recusa e diz quanto`,
    ` * falta pra cair na fronteira. Dividir a nota em duas contas seria mais`,
    ` * "esperto" e quebraria o editor de abastecimento, que lê a conta da origem`,
    ` * com \`.maybeSingle()\` — duas linhas ali derrubam a tela com erro cru.`
  ),
  L(
    ` * SOBRE A ALOCAÇÃO: o dinheiro quita as notas mais antigas primeiro; o`,
    ` * cheque quita o resto. Quando a fronteira cai NO MEIO de uma nota, ela é`,
    ` * dividida em duas contas — uma paga em dinheiro, outra no cheque — porque`,
    ` * é isso que aconteceu de verdade: o caixa precisa saber de qual conta saiu`,
    ` * cada real, e a soma das duas continua sendo o valor da nota.`,
    ` *`,
    ` * A primeira versão RECUSAVA esse caso, e a recusa travou o Evaner no`,
    ` * primeiro acerto real (03/09/2026: sobravam R$ 181,24). Pedir pra ele`,
    ` * "ajustar o valor em dinheiro" era pedir pra mudar um pagamento que já`,
    ` * tinha acontecido — o software mandando na realidade, em vez do contrário.`,
    ` *`,
    ` * Duas contas na mesma origem exigiram blindar três \`.maybeSingle()\` do`,
    ` * editor de abastecimento (viraram \`.limit(1)\`).`
  ),
  "doc"
);

troca(
  L(
    `  if (restaDinheiro > 0) {`,
    `    const sobra = restaDinheiro / 100;`,
    `    return NextResponse.json(`,
    `      {`,
    `        error:`,
    `          \`sobram R$ \${sobra.toFixed(2)} em dinheiro que não fecham uma nota inteira. \` +`,
    `          \`Ajuste o valor em dinheiro pra fechar em cima de uma nota, ou passe tudo \` +`,
    `          \`pro cheque e registre a diferença como troco.\``,
    `      },`,
    `      { status: 400 }`,
    `    );`,
    `  }`,
    `  const setDinheiro = new Set(porDinheiro);`,
    `  const porCheque = ordenadas.filter((c) => !setDinheiro.has(c.id));`
  ),
  L(
    `  const setDinheiro = new Set(porDinheiro);`,
    ``,
    `  // Sobrou dinheiro sem fechar a próxima nota: ela é paga PELOS DOIS. Vira`,
    `  // duas contas, e a soma delas continua sendo o valor original da nota.`,
    `  const aDividir =`,
    `    restaDinheiro > 0`,
    `      ? ordenadas.find((c) => !setDinheiro.has(c.id)) ?? null`,
    `      : null;`,
    `  if (restaDinheiro > 0 && !aDividir) {`,
    `    // Só chega aqui se o dinheiro sozinho já passou do total — e nesse caso`,
    `    // o excedente é troco, que o bloco acima já exigiu.`,
    `    return NextResponse.json(`,
    `      { error: "o dinheiro informado passa do total das notas — registre a diferença como troco" },`,
    `      { status: 400 }`,
    `    );`,
    `  }`,
    ``,
    `  const porCheque = ordenadas.filter(`,
    `    (c) => !setDinheiro.has(c.id) && c.id !== aDividir?.id`,
    `  );`
  ),
  "divisao"
);

// Aplica a divisão logo depois das contas pagas em dinheiro.
troca(
  L(
    `  if (porCheque.length > 0) {`
  ),
  L(
    `  // A nota partida: a original passa a valer a parte em dinheiro, e o resto`,
    `  // nasce como conta nova já quitada pelo cheque. Mesmo desenho do pagamento`,
    `  // parcial que já existe em contas a pagar.`,
    `  if (aDividir) {`,
    `    const parteDinheiro = n2(restaDinheiro / 100);`,
    `    const resto = n2(Number(aDividir.valor) - parteDinheiro);`,
    ``,
    `    const { error: eOrig } = await client`,
    `      .from("contas_a_pagar")`,
    `      .update({`,
    `        valor: parteDinheiro,`,
    `        status: "paga",`,
    `        forma_pagamento: dinheiroForma,`,
    `        pago_em: data,`,
    `        conta_id: dinheiroContaId,`,
    `        cheque_id: null,`,
    `      })`,
    `      .eq("id", aDividir.id)`,
    `      .eq("status", "a_pagar");`,
    `    if (eOrig) return NextResponse.json({ error: eOrig.message }, { status: 400 });`,
    ``,
    `    const { error: eResto } = await client.from("contas_a_pagar").insert({`,
    `      descricao: \`\${aDividir.descricao} (parte paga em cheque)\`,`,
    `      fornecedor: aDividir.fornecedor,`,
    `      categoria: aDividir.categoria,`,
    `      pessoa_id: aDividir.pessoa_id,`,
    `      valor: resto,`,
    `      vencimento: aDividir.vencimento,`,
    `      status: "paga",`,
    `      forma_pagamento: "cheque",`,
    `      pago_em: data,`,
    `      cheque_id: chequePrincipal,`,
    `      conta_id: null,`,
    `      origem_tipo: "abastecimento",`,
    `      origem_id: aDividir.origem_id,`,
    `      registrado_por: admin.id,`,
    `    });`,
    `    if (eResto) {`,
    `      return NextResponse.json({`,
    `        ok: true,`,
    `        aviso: \`a parte em dinheiro foi quitada, mas o resto da nota (R$ \${resto.toFixed(2)}) NÃO foi: \${eResto.message}. Confira em Contas a pagar.\`,`,
    `      });`,
    `    }`,
    `  }`,
    ``,
    `  if (porCheque.length > 0) {`
  ),
  "aplica divisao"
);

troca(
  L(
    `    em_dinheiro: porDinheiro.length,`,
    `    em_cheque: porCheque.length,`
  ),
  L(
    `    em_dinheiro: porDinheiro.length,`,
    `    em_cheque: porCheque.length,`,
    `    nota_dividida: aDividir ? 1 : 0,`
  ),
  "retorno"
);

fs.writeFileSync(f, s);
console.log("ok");
