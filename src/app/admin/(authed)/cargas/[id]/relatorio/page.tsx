import { notFound } from "next/navigation";
import Link from "next/link";
import { Fragment } from "react";
import type { Metadata } from "next";
import {
  buscarIdentidadeDaCarga,
  buscarRelatorioCarga,
} from "@/lib/admin/queries";
import { formatBRLExato, formatHora } from "@/lib/format";
import { BotaoImprimir } from "@/components/admin/BotaoImprimir";

export const dynamic = "force-dynamic";

/**
 * O título da página É o nome que o Chrome sugere no "Salvar como PDF".
 * "Relatório da carga - Lucimar - 24-08-2026" sai pronto pro WhatsApp;
 * antes todo relatório de toda carga era salvo como "Coleta".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const info = await buscarIdentidadeDaCarga(id);
  if (!info) return { title: "Relatório da carga" };
  return {
    title: `Relatório da carga - ${info.motorista_nome} - ${info.data}${
      info.encerrada ? "" : " (em andamento)"
    }`,
  };
}

// ---------------------------------------------------------------------------
// Datas em dia BR. O agrupamento por dia é o que tira a data repetida de 90
// linhas — sem ele, uma carga de 5 dias vira 6 páginas.
// ---------------------------------------------------------------------------
const DIA_CHAVE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DIA_ROTULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
});

function litrosBR(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Litros em tambores de 200 L, no meio tambor mais próximo.
 *
 * Vem sempre com "≈" na frente, e não é frescura: 24,5 tambores × 200 dá
 * 4.900 L, mas o líquido da balança foi 4.856 L. São 44 litros que um
 * motorista com calculadora acha em meio minuto — e papel que não fecha
 * perde a credibilidade inteira, não só aquela linha. O sinal avisa que
 * ali é aproximação, de propósito.
 *
 * Inteiro sai sem casa decimal ("32 tambores"), meio sai com uma
 * ("31,5 tambores") — decisão do Evaner.
 */
function tambores(litros: number): string {
  const t = Math.round((litros / 200) * 2) / 2;
  return `≈ ${t.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${
    t === 1 ? "tambor" : "tambores"
  }`;
}

/**
 * Uma linha do papel.
 *
 * `pagou` é SEMPRE o que saiu do bolso do motorista — nunca o valor cheio.
 * Numa coleta que a sede bancou em parte (0058), o valor cheio vai pro
 * `detalhe` e a coluna fica com a diferença. É isso que faz a coluna somar
 * exatamente o TOTAL do rodapé: papel cuja coluna não fecha destrói a
 * confiança que o relatório existe pra construir.
 */
/**
 * Cor de fundo por natureza do lançamento.
 *
 * A COLETA FICA BRANCA de propósito: ela é 90% das linhas (o Luiz fez 19
 * num dia). Se tudo tem cor, nada tem — pintar a rotina viraria listra de
 * arco-íris e o olho pararia de ver. Branco é o normal; cor é a exceção,
 * e é justamente a exceção que ele precisa achar rápido.
 *
 * A cor nunca é o ÚNICO sinal: toda linha já diz em palavras o que é
 * ("Diesel — Posto X", "Despesa — almoço"). Quem imprimir em preto e
 * branco não perde informação nenhuma.
 */
const FUNDO = {
  /** começo e fim da carga — as capas do relatório */
  marco: "bg-slate-100",
  /** dinheiro ENTRANDO na mão dele */
  entrada: "bg-emerald-50",
  /** dinheiro saindo que não é coleta (diesel, arla, despesa) */
  saida: "bg-amber-50",
  /** a rotina */
  coleta: "",
} as const;

interface Linha {
  quando: string;
  titulo: string;
  detalhe: string | null;
  quantidade: string | null;
  pagou: number | null;
  fundo: string;
}

export default async function RelatorioCargaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dados = await buscarRelatorioCarga(id);
  if (!dados) notFound();
  const { carga, adiantamentos } = dados;

  // -------------------------------------------------------------------------
  // Os números do bolso dele. Mesmos filtros de saldos_motoristas() (0058):
  // coleta desconta valor_pago - valor_sede, nota assinada não desconta, e
  // lançamento sem motorista_id foi pago por conta da empresa (0047).
  // -------------------------------------------------------------------------
  const doBolso = (m: string | null, pagoNaHora: boolean) =>
    m !== null && pagoNaHora;

  const bolsoColetas = carga.coletas.reduce(
    (s, c) => s + (Number(c.valor_pago) - Number(c.valor_sede)),
    0
  );
  const bolsoAbast = carga.abastecimentos.reduce(
    (s, a) => (doBolso(a.motorista_id, a.pago_na_hora) ? s + Number(a.valor) : s),
    0
  );
  const bolsoDespesas = carga.despesas.reduce(
    (s, d) => (doBolso(d.motorista_id, d.pago_na_hora) ? s + Number(d.valor) : s),
    0
  );
  const totalBolso = bolsoColetas + bolsoAbast + bolsoDespesas;

  const sedeColetas = carga.coletas.reduce((s, c) => s + Number(c.valor_sede), 0);
  const empresaOutros =
    carga.abastecimentos.reduce(
      (s, a) => (doBolso(a.motorista_id, a.pago_na_hora) ? s : s + Number(a.valor)),
      0
    ) +
    carga.despesas.reduce(
      (s, d) => (doBolso(d.motorista_id, d.pago_na_hora) ? s : s + Number(d.valor)),
      0
    );

  const litrosDeclarados = carga.coletas.reduce((s, c) => s + Number(c.litros), 0);
  const kmRodado =
    carga.km_final !== null && carga.km_final > carga.km_inicial
      ? carga.km_final - carga.km_inicial
      : null;
  const dias = carga.encerrada_em
    ? Math.max(
        1,
        Math.round(
          (new Date(carga.encerrada_em).getTime() -
            new Date(carga.iniciada_em).getTime()) /
            86_400_000
        )
      )
    : null;

  // -------------------------------------------------------------------------
  // A linha do tempo
  // -------------------------------------------------------------------------
  const linhas: Linha[] = [];

  // O adiantamento entra pra ele SE SITUAR ("é, aceitei nesse dia"), nunca
  // pra somar: o valor vai no texto, não na coluna. Valor de entrada na
  // mesma coluna dos gastos convidaria a subtrair e produziria um "sobrou"
  // que não é o saldo dele — e saldo, por decisão, não entra neste papel.
  for (const ad of adiantamentos) {
    linhas.push({
      quando: ad.aceito_em,
      titulo: `Recebeu ${formatBRLExato(ad.valor)} do gestor (${
        ad.forma_pagamento === "pix" ? "PIX" : "dinheiro"
      })`,
      detalhe: ad.antes_de_abrir ? "antes de abrir a carga" : null,
      quantidade: null,
      pagou: null,
      fundo: FUNDO.entrada,
    });
  }

  linhas.push({
    quando: carga.iniciada_em,
    titulo: "Abriu a carga",
    detalhe: null,
    quantidade: `${carga.km_inicial.toLocaleString("pt-BR")} km`,
    pagou: null,
    fundo: FUNDO.marco,
  });

  for (const c of carga.coletas) {
    const cheio = Number(c.valor_pago);
    const sede = Number(c.valor_sede);
    const marcas: string[] = [];
    if (sede > 0) {
      marcas.push(
        `custou ${formatBRLExato(cheio)} · a empresa pagou ${formatBRLExato(sede)} direto`
      );
    }
    if (c.lancado_por_admin) marcas.push("lançada no painel pelo gestor");
    linhas.push({
      quando: c.criado_em,
      titulo: c.local_nome,
      detalhe: marcas.length ? marcas.join(" · ") : null,
      quantidade: `${litrosBR(Number(c.litros))} L`,
      pagou: cheio - sede,
      fundo: FUNDO.coleta,
    });
  }

  for (const a of carga.abastecimentos) {
    const meu = doBolso(a.motorista_id, a.pago_na_hora);
    linhas.push({
      quando: a.criado_em,
      titulo: `${a.tipo === "arla" ? "Arla" : "Diesel"} — ${a.posto_nome}`,
      detalhe: meu
        ? null
        : a.pago_na_hora
          ? `a empresa pagou direto — ${formatBRLExato(Number(a.valor))}`
          : `assinou a nota — a empresa paga ${formatBRLExato(Number(a.valor))}`,
      quantidade: `${litrosBR(Number(a.litros))} L`,
      pagou: meu ? Number(a.valor) : null,
      fundo: FUNDO.saida,
    });
  }

  for (const d of carga.despesas) {
    const meu = doBolso(d.motorista_id, d.pago_na_hora);
    linhas.push({
      quando: d.criado_em,
      titulo: `Despesa — ${d.descricao}`,
      detalhe: meu
        ? null
        : d.pago_na_hora
          ? `a empresa pagou direto — ${formatBRLExato(Number(d.valor))}`
          : `assinou a nota — a empresa paga ${formatBRLExato(Number(d.valor))}`,
      quantidade: null,
      pagou: meu ? Number(d.valor) : null,
      fundo: FUNDO.saida,
    });
  }

  if (carga.descarga) {
    linhas.push({
      quando: carga.descarga.criado_em,
      titulo: "Descarregou na balança",
      detalhe: null,
      quantidade: `${carga.descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg`,
      pagou: null,
      fundo: FUNDO.marco,
    });
  }

  linhas.sort((a, b) => a.quando.localeCompare(b.quando));

  const grupos: { chave: string; rotulo: string; linhas: Linha[] }[] = [];
  for (const l of linhas) {
    const d = new Date(l.quando);
    const chave = DIA_CHAVE.format(d);
    let g = grupos[grupos.length - 1];
    if (!g || g.chave !== chave) {
      g = { chave, rotulo: DIA_ROTULO.format(d), linhas: [] };
      grupos.push(g);
    }
    g.linhas.push(l);
  }

  return (
    <div className="max-w-[820px] mx-auto print:max-w-none">
      <div className="flex items-center gap-3 mb-4 print:hidden">
        <Link
          href={`/admin/cargas/${carga.id}`}
          className="text-cinza-suave hover:text-verde"
        >
          ← Voltar pra carga
        </Link>
        <BotaoImprimir />
        <span className="text-sm text-cinza-suave">
          Salve como PDF e mande pro motorista.
        </span>
      </div>

      <div className="relatorio-folha bg-white p-8 rounded-xl border border-cinza-borda print:border-0 print:rounded-none">
        {/* Cabeçalho */}
        <div className="border-b-2 border-black pb-3 mb-4">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-sm font-bold tracking-widest text-cinza-suave">
              RELATÓRIO DA CARGA
            </h1>
            {!carga.encerrada_em && (
              <span className="text-xs font-semibold">
                carga ainda em andamento
              </span>
            )}
          </div>
          <p className="text-3xl font-bold leading-tight">
            {carga.motorista_nome}
          </p>
          <p className="text-sm mt-1">
            Caminhão {carga.caminhao_placa} {carga.caminhao_marca}{" "}
            {carga.caminhao_cor}
          </p>
          <p className="text-sm">
            Abriu a carga {dataHoraCurta(carga.iniciada_em)}
            {carga.encerrada_em
              ? ` · Fechou a carga ${dataHoraCurta(carga.encerrada_em)} · ${dias} ${
                  dias === 1 ? "dia" : "dias"
                }`
              : ""}
          </p>
          <p className="text-sm">
            Km {carga.km_inicial.toLocaleString("pt-BR")}
            {carga.km_final !== null
              ? ` → ${carga.km_final.toLocaleString("pt-BR")}`
              : ""}
            {kmRodado !== null
              ? ` · rodou ${kmRodado.toLocaleString("pt-BR")} km`
              : ""}
          </p>
          {/* A umidade aparece SEMPRE, mesmo sem número — inclusive quando
              nem descarga existe. É proposital: o motorista vai se
              acostumando com o campo antes de a análise virar rotina.

              Só o número lançado conta como informação; "não analisada"
              (0057) e "ninguém lançou ainda" viram o mesmo traço, porque a
              diferença entre os dois é assunto do painel, não do papel. */}
          <p className="text-sm">
            Umidade:{" "}
            {carga.descarga?.umidade_pct !== null &&
            carga.descarga?.umidade_pct !== undefined
              ? `${Number(carga.descarga.umidade_pct).toLocaleString("pt-BR", {
                  maximumFractionDigits: 2,
                })}%`
              : "—"}
          </p>
        </div>

        {/* Linha do tempo */}
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="text-[10px] tracking-widest text-cinza-suave text-left border-b border-cinza-borda">
              <th className="py-1 font-semibold w-[52px]">HORA</th>
              <th className="py-1 font-semibold">O QUE FOI</th>
              <th className="py-1 font-semibold text-right w-[92px]">
                QUANTIDADE
              </th>
              <th className="py-1 font-semibold text-right w-[104px]">
                VOCÊ PAGOU
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <Fragment key={g.chave}>
                <tr className="relatorio-dia">
                  <td
                    colSpan={4}
                    className="pt-3 pb-1 text-[11px] font-bold tracking-wider uppercase text-cinza-suave"
                  >
                    {g.rotulo}
                  </td>
                </tr>
                {g.linhas.map((l, i) => (
                  <tr
                    key={g.chave + i}
                    className={`relatorio-linha border-b border-slate-100 ${l.fundo}`}
                  >
                    <td className="py-1 align-top text-cinza-suave">
                      {formatHora(l.quando)}
                    </td>
                    <td className="py-1 align-top pr-2">
                      {l.titulo}
                      {l.detalhe && (
                        <span className="block text-[11px] text-cinza-suave">
                          {l.detalhe}
                        </span>
                      )}
                    </td>
                    <td className="py-1 align-top text-right whitespace-nowrap">
                      {l.quantidade ?? ""}
                    </td>
                    <td className="py-1 align-top text-right whitespace-nowrap font-medium">
                      {l.pagou !== null ? formatBRLExato(l.pagou) : ""}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>


        {/* Resumo — nunca quebra no meio da folha */}
        <div className="relatorio-resumo mt-6 grid grid-cols-2 gap-6 border-t-2 border-black pt-4">
          <div>
            <h2 className="text-[11px] font-bold tracking-widest text-cinza-suave mb-2">
              O ÓLEO QUE VOCÊ PEGOU
            </h2>
            <p className="text-[13px]">
              Você lançou{" "}
              <strong>{litrosBR(litrosDeclarados)} litros</strong>{" "}
              <span className="text-cinza-suave">
                · {tambores(litrosDeclarados)}
              </span>
            </p>
            {carga.descarga ? (
              <>
                <p className="text-[13px] mt-1">
                  O peso na balança deu{" "}
                  <strong>
                    {carga.descarga.peso_bruto_kg.toLocaleString("pt-BR")} kg
                  </strong>
                </p>

                {/* A conta aberta: ele vê de onde saiu o líquido. A tara é o
                    snapshot do caminhão na hora da descarga — recalibrar o
                    cadastro depois não muda papel já entregue. */}
                <div className="mt-2">
                  <Par
                    rotulo="Peso lançado"
                    valor={`${carga.descarga.peso_bruto_kg.toLocaleString(
                      "pt-BR"
                    )} kg`}
                  />
                  <Par
                    rotulo="Tara"
                    valor={`− ${carga.descarga.peso_tara_kg.toLocaleString(
                      "pt-BR"
                    )} kg`}
                  />
                  <div className="border-t border-black mt-1 pt-1">
                    <Par
                      rotulo="LÍQUIDO"
                      valor={`${carga.descarga.peso_liquido_kg.toLocaleString(
                        "pt-BR"
                      )} kg`}
                      forte
                    />
                  </div>
                </div>

                {/* A conversão fecha em LITROS, a unidade que ele declara:
                    assim os dois números do bloco são comparáveis de bater
                    o olho. SEM linha de "diferença" — número ao lado de
                    número ensina; linha chamada "faltou" acusa.

                    A conta vem ao lado do resultado: eles já sabem o 0,9, o
                    que faltava era poder conferir na calculadora. Sem sinal
                    de igual — o resultado é arredondado ("por volta de"). */}
                <p className="text-[12px] mt-2">
                  Dão por volta de{" "}
                  <strong>
                    {litrosBR(Math.round(carga.descarga.peso_liquido_kg / 0.9))}{" "}
                    litros
                  </strong>{" "}
                  <span className="text-cinza-suave">
                    {/* Tambor conta em cima do litro IMPRESSO, não do interno
                        (4.855,56): assim ele refaz a conta com os números
                        que estão na frente dele. */}
                    ·{" "}
                    {tambores(
                      Math.round(carga.descarga.peso_liquido_kg / 0.9)
                    )}{" "}
                    ({carga.descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg
                    ÷ 0,9)
                  </span>
                </p>
              </>
            ) : (
              <p className="text-[11px] text-cinza-suave mt-1">
                Ainda não descarregou.
              </p>
            )}
          </div>

          <div>
            <h2 className="text-[11px] font-bold tracking-widest text-cinza-suave mb-2">
              O DINHEIRO DO SEU BOLSO
            </h2>
            <Par rotulo="Coletas" valor={formatBRLExato(bolsoColetas)} />
            <Par rotulo="Combustível" valor={formatBRLExato(bolsoAbast)} />
            <Par rotulo="Outras despesas" valor={formatBRLExato(bolsoDespesas)} />
            <div className="border-t border-black mt-1 pt-1">
              <Par rotulo="TOTAL" valor={formatBRLExato(totalBolso)} forte />
            </div>
          </div>
        </div>

        {(sedeColetas > 0 || empresaOutros > 0) && (
          <p className="relatorio-resumo text-[11px] text-cinza-suave mt-3 border-t border-cinza-borda pt-2">
            A empresa pagou direto, não era seu dinheiro:
            {sedeColetas > 0 ? ` coletas ${formatBRLExato(sedeColetas)}` : ""}
            {sedeColetas > 0 && empresaOutros > 0 ? " ·" : ""}
            {empresaOutros > 0
              ? ` combustível e despesas ${formatBRLExato(empresaOutros)}`
              : ""}
          </p>
        )}

        <p className="text-[10px] text-cinza-suave mt-4 pt-2 border-t border-cinza-borda">
          Gerado em {dataHoraCurta(new Date().toISOString())} — retrato desta
          carga.
        </p>
      </div>
    </div>
  );
}

function dataHoraCurta(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function Par({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 text-[13px] tabular-nums ${
        forte ? "font-bold" : ""
      }`}
    >
      <span>{rotulo}</span>
      <span className="whitespace-nowrap">{valor}</span>
    </div>
  );
}
