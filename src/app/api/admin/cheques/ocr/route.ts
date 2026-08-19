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
          "bom_para",
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
            description: "Quem assinou. Vazio se não tiver certeza.",
          },
          numero: { type: "string", description: "Vazio se não tiver certeza." },
          valor: {
            type: "number",
            description:
              "Valor em reais. 0 se não tiver certeza absoluta — é manuscrito e é o campo mais perigoso de chutar.",
          },
          bom_para: {
            type: "string",
            description: "aaaa-mm-dd. Vazio se não tiver certeza.",
          },
          observacao: {
            type: "string",
            description:
              "Só quando algo atrapalhou a leitura (borrão, corte, sombra). Vazio caso contrário.",
          },
        },
      },
    },
  },
} as const;

const INSTRUCOES = `Você está lendo fotos de cheques bancários brasileiros para uma empresa de coleta de óleo.

Devolva UMA LINHA POR CHEQUE que aparecer nas imagens. Uma foto pode ter vários cheques (maço fotografado junto) ou nenhum.

REGRA MAIS IMPORTANTE — na dúvida, deixe vazio:
- O valor de um cheque é MANUSCRITO. Se você não consegue ler com certeza absoluta, mande 0. Nunca deduza a partir do valor por extenso se os dois discordam, e nunca "arredonde" para um número plausível.
- Vale o mesmo para banco, emitente, número e data: campo que você não tem certeza vai VAZIO.
- É muito melhor devolver um campo vazio pra pessoa digitar do que um campo errado que ela vai aprovar sem perceber.

Quando a imagem estiver ilegível, for o verso do cheque, ou não for um cheque:
- devolva a linha com deu_pra_ler = false e TODOS os campos vazios (valor = 0).
- não preencha nada "parcialmente" nesse caso.

Datas: cheque brasileiro escreve dd/mm/aaaa. Converta para aaaa-mm-dd. Se o ano vier com 2 dígitos, não invente o século — deixe vazio.

As imagens vão numeradas a partir de 0, na ordem em que aparecem. Cada linha precisa dizer de qual imagem ela veio (imagem_index) — é isso que põe a foto ao lado da linha na tela de conferência.`;

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
        { role: "system", content: INSTRUCOES },
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
