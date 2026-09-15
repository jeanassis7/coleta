import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/admin/cheques/ocr — lê um maço de cheques por foto.
 *
 * NÃO lança nada. Devolve uma LISTA DE CONFERÊNCIA que a tela mostra ao lado
 * da foto pro gestor ticar um a um. Quem lança é o endpoint /lote, e só o
 * que foi ticado.
 *
 * Usa Claude (Anthropic). Em 19/08/2026 a escolha foi OpenAI "porque é o
 * provedor que o Evaner já paga"; em 14/09/2026 descobriu-se que ele não
 * tem conta na OpenAI e TEM conta Anthropic com crédito — o mesmo critério
 * apontando pro outro lado. Um provedor só continua sendo a regra.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PROMPT INSISTE EM DEIXAR VAZIO
 * ---------------------------------------------------------------------------
 * Modelo de visão inventa valor plausível quando não enxerga direito, e
 * cheque tem valor MANUSCRITO. Um campo meio preenchido parece lido e passa
 * na conferência; um campo vazio grita. Por isso a regra é: na dúvida, vazio.
 *
 * O mesmo vale pra foto ilegível, verso de cheque ou papel que não é cheque —
 * a linha volta com `deu_pra_ler: false` e tudo em branco, pra digitar na
 * mão. Nunca meio preenchida.
 */

export const maxDuration = 60;

/**
 * Configurável por ambiente de propósito: o catálogo de modelos da Anthropic
 * muda, e trocar não deve exigir deploy. Precisa ser um modelo com visão.
 */
const MODELO = process.env.ANTHROPIC_MODEL || "claude-opus-5";

/**
 * Preço por 1 milhão de tokens, em dólar. Conferido em 14/09/2026 pro
 * claude-opus-5.
 *
 * ⚠️ Se o ANTHROPIC_MODEL mudar, ESTE NÚMERO FICA ERRADO e a tela continua
 * mostrando um valor bonitinho. Por isso a tela mostra o modelo ao lado do
 * custo — é o que denuncia a divergência. Revisar junto com o modelo.
 */
const PRECO_POR_MILHAO = { entrada: 5.0, saida: 25.0 } as const;

/**
 * Chave "aaaa-mm" do mês corrente em horário de Brasília (UTC-3 fixo).
 *
 * Não dá pra reusar `nowBrParts` de src/lib/admin/queries.ts aqui: a função
 * não é exportada, e este é um route handler solto, não um consumidor do
 * módulo de queries do dashboard. Mesma técnica usada no resto do projeto
 * pra data BR fora de Server Component (ver `hoje` em LoteChequesPainel.tsx):
 * subtrai 3h fixas e lê os campos em UTC, que passam a representar o
 * relógio de Brasília.
 */
function chaveMesBr(): string {
  const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const ano = brNow.getUTCFullYear();
  const mes = String(brNow.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

/**
 * Soma o custo desta leitura ao acumulado do mês em `configuracoes`
 * (chave `ocr_custo_<aaaa-mm>`, valor em dólar como texto).
 *
 * ⚠️ READ-MODIFY-WRITE com corrida teórica: duas leituras simultâneas podem
 * ler o mesmo valor antigo e uma sobra por cima da outra, perdendo uma soma.
 * Com um usuário só (o Jean, lançando cheques) é desprezível. Se um dia isso
 * virar problema de verdade, o conserto é uma RPC que soma no banco (tipo
 * `update ... set valor = valor + x`), não reescrever isto na mão.
 *
 * Nunca deixa a leitura cair por causa disso: qualquer falha aqui (leitura
 * ou gravação) é engolida, e o retorno cai pro fallback de "pelo menos esta
 * leitura" — o mês fica subcontado, nunca a tela quebra.
 */
async function acumularCustoDoMes(
  atorId: string,
  custoDestaLeitura: number
): Promise<number> {
  const chave = `ocr_custo_${chaveMesBr()}`;
  try {
    const admin = getSupabaseAdmin(atorId);
    const { data } = await admin
      .from("configuracoes")
      .select("valor")
      .eq("chave", chave)
      .maybeSingle();
    const atual = Number(data?.valor);
    const novoTotal = (Number.isFinite(atual) ? atual : 0) + custoDestaLeitura;
    const { error } = await admin.from("configuracoes").upsert({
      chave,
      valor: String(novoTotal),
      atualizado_em: new Date().toISOString(),
      atualizado_por: atorId,
    });
    if (error) throw error;
    return novoTotal;
  } catch (e) {
    console.error(
      "Falha ao acumular o custo mensal da leitura de cheques (não impede a leitura em si):",
      e
    );
    // Fallback honesto: não sabemos o acumulado real, então devolvemos só o
    // desta leitura em vez de inventar um total. O mês fica subcontado.
    return custoDestaLeitura;
  }
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cheques"],
  properties: {
    cheques: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "imagem_index",
          "deu_pra_ler",
          "banco",
          "emitente",
          "numero",
          "valor",
          "valor_extenso",
          "bom_para",
          "bom_para_origem",
          "ano_assumido",
          "observacao",
        ],
        properties: {
          imagem_index: {
            type: "integer",
            description:
              "Índice da imagem (começando em 0) de onde este cheque foi lido.",
          },
          deu_pra_ler: {
            type: "boolean",
            description:
              "false quando a foto está ilegível, é o verso do cheque, ou não é um cheque. Nesse caso todos os outros campos vêm vazios.",
          },
          banco: { type: "string", description: "Vazio se não tiver certeza." },
          emitente: {
            type: "string",
            description:
              "Nome/razão social IMPRESSO perto da assinatura (nunca a assinatura em si, que é rabisco manuscrito ilegível). Vazio se não tiver certeza.",
          },
          numero: {
            type: "string",
            description:
              "O número do cheque, tirado do bloco do meio da linha CMC7 (rodapé, fonte magnética) e conferido contra a tabelinha impressa no topo. Vazio se os dois divergirem ou não tiver certeza.",
          },
          valor: {
            type: "number",
            description:
              "Valor em reais lido da CAIXA NUMÉRICA (manuscrito). Leia de forma independente do valor por extenso — nunca use um pra corrigir o outro. 0 se não tiver certeza absoluta.",
          },
          valor_extenso: {
            type: "number",
            description:
              "Valor em reais lido do valor POR EXTENSO (manuscrito, em palavras). Leia de forma independente do valor numérico — nunca use um pra corrigir o outro. 0 se não tiver certeza absoluta.",
          },
          bom_para: {
            type: "string",
            description:
              "aaaa-mm-dd. Resultado das regras de BOM PARA descritas nas instruções. Vazio se não tiver certeza.",
          },
          bom_para_origem: {
            type: "string",
            description:
              "'bom_para' quando a data veio de um bom para explícito escrito no cheque (ou papel junto); 'data_assinatura' quando veio da data de emissão/assinatura por falta de bom para; '' quando bom_para ficou vazio.",
          },
          ano_assumido: {
            type: "boolean",
            description:
              "true só quando o ano da data escolhida para bom_para não estava escrito e foi inferido pela regra da janela. false em qualquer outro caso, inclusive quando bom_para ficou vazio.",
          },
          observacao: {
            type: "string",
            description:
              "Só quando algo atrapalhou a leitura (borrão, corte, sombra) ou quando número/valor divergiram entre fontes. Vazio caso contrário.",
          },
        },
      },
    },
  },
} as const;

/** dd/mm/aaaa a partir de aaaa-mm-dd. Data pura — split de string, nunca passa por Date/fuso. */
function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function montarInstrucoes(recebidoEm: string | null): string {
  const recebidoEmBr = recebidoEm ? formatarDataBr(recebidoEm) : null;

  return `Você está lendo fotos de cheques bancários brasileiros para uma empresa de coleta de óleo.

Devolva UMA LINHA POR CHEQUE que aparecer nas imagens. Uma foto pode ter vários cheques (maço fotografado junto) ou nenhum. A foto pode estar em QUALQUER ORIENTAÇÃO (de lado, de cabeça para baixo) — oriente-se pelo conteúdo do cheque, não assuma que já veio "em pé".

REGRA MAIS IMPORTANTE — na dúvida, deixe vazio:
- Todo campo manuscrito (valor, valor por extenso, data) é o mais perigoso de chutar. Se você não consegue ler com certeza absoluta, devolva vazio (texto) ou 0 (número).
- É muito melhor devolver um campo vazio pra pessoa digitar do que um campo errado que ela vai aprovar sem perceber.

Quando a imagem estiver ilegível, for o verso do cheque, ou não for um cheque:
- devolva a linha com deu_pra_ler = false e TODOS os campos vazios (valor e valor_extenso = 0, ano_assumido = false, bom_para_origem = "").
- não preencha nada "parcialmente" nesse caso.

NÚMERO DO CHEQUE — vem do CMC7, não de qualquer lugar da imagem:
O cheque tem uma linha em fonte magnética no rodapé (CMC7), com três blocos de números. O número do cheque está no bloco do MEIO (10 dígitos): os 3 primeiros são o código de compensação, os 6 seguintes são o número do cheque, e o último é dígito verificador. Leia o número do cheque desse bloco do meio e confira com a tabelinha impressa no topo do cheque (que também traz "Cheque Nº"). Se os dois baterem, devolva o número. Se divergirem, deixe numero vazio e explique em observacao.

VALOR — leia os dois de forma independente, e nunca conserte um com o outro:
Todo cheque brasileiro traz o valor duas vezes: em número (caixa no canto superior direito) e por extenso (na linha "Pague por este cheque a quantia de..."). Os dois são manuscritos.
- valor = o que está na caixa numérica.
- valor_extenso = o que está escrito por extenso, convertido para número.
- Leia cada um olhando só para ele, como se o outro não existisse. NUNCA "conserte" um usando o outro, mesmo que pareçam quase iguais — a divergência entre os dois é informação importante pra quem vai conferir, e escondê-la seria pior do que deixar os dois vazios.
- Qualquer um dos dois que você não conseguir ler com certeza absoluta vai 0.

EMITENTE — do texto impresso, não da assinatura:
O nome de quem emitiu o cheque (razão social, em cheque empresarial) fica IMPRESSO perto da linha de assinatura — não é a assinatura em si, que é rabisco manuscrito e não serve pra nada. Leia o nome impresso. Se houver um CNPJ impresso do lado, use-o só como confirmação de que você achou o texto certo — mas NÃO devolva o CNPJ, não existe campo pra ele.
O emitente de cada cheque é uma empresa qualquer, diferente do comprador que entregou o maço — cada cheque pode vir de uma empresa diferente. Não tente adivinhar, padronizar ou "reconhecer" nomes parecidos entre cheques.

BOM PARA — a parte mais importante deste prompt, siga nesta ordem:
${
  recebidoEmBr
    ? `O maço foi recebido em ${recebidoEmBr}. Use essa data nas regras (c) abaixo.`
    : `A data de recebimento do maço não foi informada — aplique só as letras (a) e (b) abaixo. Sem ela você NÃO pode aplicar a regra (c): se o ano não estiver escrito, deixe bom_para vazio e ano_assumido = false.`
}

a) Se existir um "bom para" escrito em QUALQUER canto do cheque, ou em um papel grampeado/junto que apareça na foto, ELE GANHA — use essa data. bom_para_origem = "bom_para".
b) Se NÃO existir nenhum "bom para", use a data de assinatura/emissão do cheque (a da linha "[cidade], [dia] de [mês] de [ano]"). bom_para_origem = "data_assinatura".
c) Se a data escolhida em (a) ou (b) tiver dia e mês mas o ANO não estiver escrito (ex: só "13/10", isso é muito comum e NÃO é motivo pra deixar vazio) — assuma o ano que deixa essa data mais próxima da data de recebimento do maço${recebidoEmBr ? ` (${recebidoEmBr})` : ""}, dentro de uma janela de 3 meses PARA TRÁS até 12 meses PARA FRENTE a partir do recebimento. Marque ano_assumido = true nesse caso.
   Exemplo (recebido em 14/09/2026): "13/10" → 13/10/2026 (29 dias à frente, dentro da janela); "20/12" → 20/12/2026; "05/09" → 05/09/2026 (9 dias atrás — cheque à vista, normal); "15/01" → 15/01/2027 (se fosse 2026 estaria 8 meses no passado, fora da janela de 3 meses para trás).
d) Se não der pra ler com certeza nem o "bom para" nem a data de assinatura, deixe bom_para vazio, bom_para_origem = "" e ano_assumido = false.

Datas: cheque brasileiro escreve dd/mm/aaaa. Converta bom_para para aaaa-mm-dd.

As imagens vão numeradas a partir de 0, na ordem em que aparecem. Cada linha precisa dizer de qual imagem ela veio (imagem_index) — é isso que põe a foto ao lado da linha na tela de conferência.`;
}

export async function POST(req: NextRequest) {
  const user = await exigirAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "A leitura por foto não está configurada (falta ANTHROPIC_API_KEY). Lance os cheques na mão — funciona igual.",
      },
      { status: 501 }
    );
  }

  const body = await req.json();
  const imagens = Array.isArray(body.imagens) ? body.imagens : [];
  if (imagens.length === 0) {
    return NextResponse.json({ error: "mande ao menos uma foto" }, { status: 400 });
  }
  // Teto por CHAMADA, não pelo total de fotos da tela: é o limite de
  // payload da função (4,5MB) que manda aqui, não uma regra de negócio. A
  // tela nunca manda mais de 3 por vez (o batching fica bem abaixo disso).
  if (imagens.length > 5) {
    return NextResponse.json(
      {
        error:
          "no máximo 5 fotos por chamada — é o limite de payload da função",
      },
      { status: 400 }
    );
  }

  // Data pura (aaaa-mm-dd), usada só como referência pra regra do "bom para"
  // sem ano escrito — nunca passa por Date/fuso. Formato inválido é tratado
  // como "não informado": a regra (c) do prompt fica de fora, e o resto
  // (bom para explícito, ou data de assinatura com ano escrito) continua
  // funcionando normal.
  const recebidoEm =
    typeof body.recebido_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.recebido_em)
      ? body.recebido_em
      : null;

  const partesImagem: Anthropic.ImageBlockParam[] = [];
  for (const img of imagens) {
    const media_type = String(img.media_type || "");
    const data = String(img.data || "");
    if (!["image/jpeg", "image/png", "image/webp"].includes(media_type)) {
      return NextResponse.json(
        { error: "formato de imagem não suportado" },
        { status: 400 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "imagem vazia" }, { status: 400 });
    }
    partesImagem.push({
      type: "image",
      source: {
        type: "base64",
        media_type: media_type as "image/jpeg" | "image/png" | "image/webp",
        data,
      },
    });
  }

  try {
    const client = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente sozinho
    const resposta = await client.messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: montarInstrucoes(recebidoEm),
      // effort "low" é deliberado: esta função tem maxDuration = 60 na Vercel,
      // e ler texto de uma imagem é percepção, não raciocínio longo. Dá pra
      // subir se a leitura vier ruim na prática.
      output_config: {
        format: { type: "json_schema", schema: SCHEMA },
        effort: "low",
      },
      messages: [
        {
          role: "user",
          content: [
            ...partesImagem,
            {
              type: "text",
              text: "Leia os cheques destas imagens e devolva uma linha por cheque.",
            },
          ],
        },
      ],
    });

    const blocoTexto = resposta.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    if (!blocoTexto) {
      return NextResponse.json(
        { error: "A leitura voltou vazia. Lance os cheques na mão." },
        { status: 502 }
      );
    }

    let lido: { cheques?: unknown[] };
    try {
      lido = JSON.parse(blocoTexto.text);
    } catch {
      return NextResponse.json(
        { error: "Não consegui entender a resposta da leitura. Lance na mão." },
        { status: 502 }
      );
    }

    // Custo em dólar a partir dos tokens REAIS devolvidos pela Anthropic —
    // nunca estimativa de tokens.
    const tokensEntrada = resposta.usage.input_tokens ?? 0;
    const tokensSaida = resposta.usage.output_tokens ?? 0;
    const custoDestaLeitura =
      (tokensEntrada / 1_000_000) * PRECO_POR_MILHAO.entrada +
      (tokensSaida / 1_000_000) * PRECO_POR_MILHAO.saida;

    const custoDoMes = await acumularCustoDoMes(user.id, custoDestaLeitura);

    // COTACAO_DOLAR é opcional (cadastrada na Vercel junto com a
    // ANTHROPIC_API_KEY). Sem ela, ou com valor inválido, a tela mostra só
    // dólar — nunca inventamos cotação.
    const cotacaoBruta = Number(process.env.COTACAO_DOLAR);
    const cotacao = Number.isFinite(cotacaoBruta) && cotacaoBruta > 0 ? cotacaoBruta : null;

    return NextResponse.json({
      ok: true,
      cheques: lido.cheques ?? [],
      custo: {
        desta_leitura: custoDestaLeitura,
        do_mes: custoDoMes,
        modelo: MODELO,
        cotacao,
      },
    });
  } catch (erro) {
    if (erro instanceof Anthropic.AuthenticationError) {
      // ⚠️ A explicação da Anthropic vai JUNTO, e não no lugar da nossa
      // frase. Em 14/09/2026 um 401 custou uma rodada de adivinhação porque
      // a mensagem dizia só "chave inválida" — e o provedor tinha mandado o
      // motivo exato (chave incompleta? revogada? sem acesso?), que o código
      // descartava. A mensagem do erro mascara a própria chave, então
      // mostrar é seguro e ainda deixa conferir começo e fim contra o que
      // foi colado na Vercel.
      const detalhe = erro.message ? ` Motivo: ${erro.message}` : "";
      return NextResponse.json(
        {
          error: `A chave da leitura por foto foi recusada pela Anthropic.${detalhe} Lance os cheques na mão.`,
        },
        { status: 502 }
      );
    }
    if (erro instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        {
          error:
            "Limite atingido, ou a conta da Anthropic está sem saldo. Lance os cheques na mão.",
        },
        { status: 429 }
      );
    }
    if (erro instanceof Anthropic.APIError) {
      // 401/429 já foram tratados acima com mensagem específica; o resto é
      // falha do provedor. Em qualquer caso a saída é a mesma: lançar na
      // mão, que sempre funciona.
      //
      // ⚠️ A explicação da Anthropic vai JUNTO. Isto já tinha sido consertado
      // em 14/09/2026 e se perdeu na troca de provedor no mesmo dia — e
      // custou de novo: um 400 chegou como "A leitura falhou (400)." e a
      // mensagem que dizia QUAL campo do pedido estava errado foi descartada
      // pelo próprio código. Erro sem motivo é adivinhação.
      const detalhe = erro.message ? ` Motivo: ${erro.message}` : "";
      return NextResponse.json(
        {
          error: `A leitura falhou (${erro.status}).${detalhe} Lance os cheques na mão.`,
        },
        { status: 502 }
      );
    }
    throw erro;
  }
}
