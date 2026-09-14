import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST /api/admin/cheques/ocr — lê um maço de cheques por foto.
 *
 * NÃO lança nada. Devolve uma LISTA DE CONFERÊNCIA que a tela mostra ao lado
 * da foto pro gestor ticar um a um. Quem lança é o endpoint /lote, e só o
 * que foi ticado.
 *
 * Usa OpenAI porque é o provedor que o Evaner já paga — decisão dele em
 * 19/08/2026, pra não ter dois provedores por causa de uma tela.
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
 * Configurável por ambiente de propósito: o catálogo de modelos da OpenAI
 * muda, e trocar não deve exigir deploy. Precisa ser um modelo com visão.
 */
const MODELO = process.env.OPENAI_MODEL || "gpt-4o";

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

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "A leitura por foto não está configurada (falta OPENAI_API_KEY). Lance os cheques na mão — funciona igual.",
      },
      { status: 501 }
    );
  }

  const body = await req.json();
  const imagens = Array.isArray(body.imagens) ? body.imagens : [];
  if (imagens.length === 0) {
    return NextResponse.json({ error: "mande ao menos uma foto" }, { status: 400 });
  }
  if (imagens.length > 10) {
    return NextResponse.json(
      { error: "no máximo 10 fotos por vez" },
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

  const partesImagem: { type: "image_url"; image_url: { url: string } }[] = [];
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
      type: "image_url",
      image_url: { url: `data:${media_type};base64,${data}` },
    });
  }

  try {
    const client = new OpenAI();
    const resposta = await client.chat.completions.create({
      model: MODELO,
      messages: [
        { role: "system", content: montarInstrucoes(recebidoEm) },
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
      response_format: {
        type: "json_schema",
        json_schema: { name: "cheques_lidos", strict: true, schema: SCHEMA },
      },
    });

    const bruto = resposta.choices[0]?.message?.content;
    if (!bruto) {
      return NextResponse.json(
        { error: "A leitura voltou vazia. Lance os cheques na mão." },
        { status: 502 }
      );
    }

    let lido: { cheques?: unknown[] };
    try {
      lido = JSON.parse(bruto);
    } catch {
      return NextResponse.json(
        { error: "Não consegui entender a resposta da leitura. Lance na mão." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, cheques: lido.cheques ?? [] });
  } catch (erro) {
    if (erro instanceof OpenAI.APIError) {
      // 401 = chave errada; 429 = limite; o resto é falha do provedor. Em
      // qualquer caso a saída é a mesma: lançar na mão, que sempre funciona.
      const msg =
        erro.status === 401
          ? "A chave da leitura por foto está inválida."
          : erro.status === 429
            ? "Muita leitura ao mesmo tempo. Espere um minuto."
            : `A leitura falhou (${erro.status}).`;
      return NextResponse.json(
        { error: `${msg} Lance os cheques na mão.` },
        { status: erro.status === 429 ? 429 : 502 }
      );
    }
    throw erro;
  }
}
