import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST /api/admin/cheques/ocr — lê um maço de cheques por foto.
 *
 * NÃO lança nada. Devolve uma LISTA DE CONFERÊNCIA que a tela mostra ao lado
 * da foto pra o gestor ticar um a um. Quem lança é o endpoint /lote, e só o
 * que foi ticado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PROMPT INSISTE EM DEIXAR VAZIO
 * ---------------------------------------------------------------------------
 * Modelo de visão inventa valor plausível quando não enxerga direito, e
 * cheque tem valor MANUSCRITO. Um campo meio preenchido parece lido e passa
 * na conferência; um campo vazio grita. Por isso a regra é: na dúvida, vazio.
 *
 * O mesmo vale pra foto ilegível, verso de cheque ou papel que não é cheque —
 * a linha volta com `deu_pra_ler: false` e tudo em branco, pra digitar na mão.
 * Nunca meio preenchida.
 */

export const maxDuration = 60;

const LinhaCheque = z.object({
  imagem_index: z
    .number()
    .describe(
      "Índice da imagem (começando em 0) de onde este cheque foi lido. É o que põe a foto ao lado da linha na tela de conferência."
    ),
  deu_pra_ler: z
    .boolean()
    .describe(
      "false quando a foto está ilegível, é o verso do cheque, ou não é um cheque. Nesse caso todos os outros campos vêm vazios."
    ),
  banco: z.string().describe("Nome do banco. Vazio se não tiver certeza."),
  emitente: z
    .string()
    .describe("Nome de quem assinou o cheque. Vazio se não tiver certeza."),
  numero: z.string().describe("Número do cheque. Vazio se não tiver certeza."),
  valor: z
    .number()
    .describe(
      "Valor em reais. 0 se não tiver certeza absoluta — o valor é manuscrito e é o campo mais perigoso de chutar."
    ),
  bom_para: z
    .string()
    .describe(
      "Data no formato aaaa-mm-dd. Vazio se não tiver certeza ou se o cheque não tiver data."
    ),
  observacao: z
    .string()
    .describe(
      "Só quando algo atrapalhou a leitura (borrão, corte, sombra). Vazio caso contrário."
    ),
});

const Resultado = z.object({
  cheques: z.array(LinhaCheque),
});

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
  if (imagens.length > 10) {
    return NextResponse.json(
      { error: "no máximo 10 fotos por vez" },
      { status: 400 }
    );
  }

  const blocos: Anthropic.ImageBlockParam[] = [];
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
    blocos.push({ type: "image", source: { type: "base64", media_type: media_type as "image/jpeg" | "image/png" | "image/webp", data } });
  }

  try {
    const client = new Anthropic();
    const resposta = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: INSTRUCOES,
      messages: [
        {
          role: "user",
          content: [
            ...blocos,
            {
              type: "text",
              text: "Leia os cheques destas imagens e devolva uma linha por cheque.",
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(Resultado) },
    });

    // Uma recusa por política volta com HTTP 200 — checar antes de ler o
    // resultado, senão o erro aparece como "não achou cheque nenhum".
    if (resposta.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "A leitura foi recusada. Lance os cheques na mão." },
        { status: 502 }
      );
    }

    const lido = resposta.parsed_output;
    if (!lido) {
      return NextResponse.json(
        { error: "Não consegui entender a resposta da leitura. Lance na mão." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, cheques: lido.cheques });
  } catch (erro) {
    if (erro instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "A chave da leitura por foto está inválida. Lance na mão." },
        { status: 502 }
      );
    }
    if (erro instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Muita leitura ao mesmo tempo. Espere um minuto e tente de novo." },
        { status: 429 }
      );
    }
    if (erro instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `A leitura falhou (${erro.status}). Lance os cheques na mão.` },
        { status: 502 }
      );
    }
    throw erro;
  }
}
