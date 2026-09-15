"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { InputDinheiro, centavosParaReais, reaisParaCentavos } from "@/components/InputDinheiro";
import { formatBRL } from "@/lib/format";

/**
 * Lançar um maço de cheques.
 *
 * A foto é ATALHO, nunca dependência: o botão "+ Adicionar na mão" está
 * sempre lá e faz tudo que a foto faz. Se a leitura por foto não estiver
 * configurada no servidor, o resto da tela funciona igual.
 *
 * A leitura NÃO preenche um formulário — ela monta uma lista de conferência
 * com a foto do lado. A diferença importa: conferir é comparar, não confiar.
 * Num formulário já preenchido o erro passa; com a foto ao lado ele salta.
 *
 * Nada é lançado sem o tique. Linha não conferida não entra, ponto.
 */

interface Linha {
  id: string;
  /** Idempotência (0041): se a internet piscar depois do servidor gravar e
   *  o gestor clicar de novo, o reenvio com o MESMO client_id não duplica. */
  clientId: string;
  conferido: boolean;
  /** null quando foi digitada na mão. Aponta pro `id` estável da foto (nunca
   *  pro índice do array — remover uma foto do meio deslocaria os índices e
   *  faria a linha errada apontar pra foto errada). */
  imagemId: string | null;
  deuPraLer: boolean;
  banco: string;
  emitente: string;
  numero: string;
  valorCentavos: number | null;
  /** Só conferência na tela (número × extenso) — NUNCA vai pro /lote. */
  valorExtensoCentavos: number | null;
  bomPara: string;
  /** Só conferência na tela — NUNCA vai pro /lote. */
  bomParaOrigem: "" | "bom_para" | "data_assinatura";
  /** Só conferência na tela — NUNCA vai pro /lote. */
  anoAssumido: boolean;
  observacao: string;
}

interface Foto {
  /** Estável pra sempre (não é o índice do array) — é o que a linha guarda
   *  pra achar a foto certa mesmo depois de outras serem removidas. */
  id: string;
  url: string;
  base64: string;
  tipo: string;
  /** true só quando a LEVA dela terminou de ler com sucesso. Se a leva
   *  falhar, a foto continua false — dá pra tentar de novo sem perder as
   *  fotos de outras levas nem duplicar linha das que já leram. */
  lida: boolean;
}

/** Dólar no padrão brasileiro: 0,04 e não 0.04. */
const formatUSD = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let seq = 0;
const novaLinha = (parcial: Partial<Linha> = {}): Linha => ({
  id: `l${seq++}`,
  clientId: crypto.randomUUID(),
  conferido: false,
  imagemId: null,
  deuPraLer: true,
  banco: "",
  emitente: "",
  numero: "",
  valorCentavos: null,
  valorExtensoCentavos: null,
  bomPara: "",
  bomParaOrigem: "",
  anoAssumido: false,
  observacao: "",
  ...parcial,
});

/**
 * Diferença em meses de calendário entre duas datas "aaaa-mm-dd" (positivo
 * = a depois de b). Só olha ano/mês — é o suficiente pra marcar "essa data
 * está longe do recebimento", não precisa de precisão de dia. Data pura,
 * nunca passa por Date/fuso (regra do projeto).
 */
function diferencaEmMeses(aIso: string, bIso: string): number {
  const [anoA, mesA] = aIso.split("-").map(Number);
  const [anoB, mesB] = bIso.split("-").map(Number);
  if (!anoA || !mesA || !anoB || !mesB) return 0;
  return anoA * 12 + mesA - (anoB * 12 + mesB);
}

export function LoteChequesPainel({
  compradores,
  ocrDisponivel,
}: {
  compradores: { id: string; nome: string }[];
  /** ANTHROPIC_API_KEY existe no servidor? Sem ela, só o modo manual. */
  ocrDisponivel: boolean;
}) {
  const router = useRouter();
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [aberto, setAberto] = useState(false);
  const [compradorId, setCompradorId] = useState("");
  const [data, setData] = useState(hoje);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  // Duas fases distintas, de propósito: preparar (comprimir/acumular fotos,
  // não chama API) e ler (chama a API de OCR). O botão "Ler" só existe pra
  // separar as duas — chamar a API a cada foto tirada custava dinheiro a
  // cada toque no celular.
  const [adicionandoFotos, setAdicionandoFotos] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [progressoLeitura, setProgressoLeitura] = useState<{
    atual: number;
    total: number;
  } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [totalRelatorioCentavos, setTotalRelatorioCentavos] = useState<number | null>(null);
  // Último custo devolvido pela leitura por foto (dólar por token REAL da
  // resposta). Só aparece depois da primeira leitura da sessão — antes
  // disso não há o que mostrar. É estimativa, e a tela precisa dizer isso:
  // o preço por token pode mudar sem aviso, e a régua do dinheiro
  // (pergunta 6) proíbe número de dinheiro escondendo que pode estar errado.
  const [custoOcr, setCustoOcr] = useState<{
    destaLeitura: number;
    doMes: number;
    modelo: string;
    cotacao: number | null;
  } | null>(null);
  // Guarda A SOMA que foi confirmada, não um "sim" solto. Assim qualquer
  // mudança — ticar, desticar, corrigir um valor, apagar linha — invalida a
  // confirmação sozinha: a soma muda e a igualdade abaixo deixa de valer.
  // Com um booleano, cada gatilho novo precisaria lembrar de resetar, e o
  // esquecido deixaria passar uma divergência MAIOR do que a confirmada.
  const [somaConfirmadaCentavos, setSomaConfirmadaCentavos] = useState<number | null>(null);

  // Rolar até a linha recém-criada: com 8 cheques na tela, a linha nova
  // nascia fora da vista e o botão ficava lá em cima.
  const fimDaListaRef = useRef<HTMLDivElement | null>(null);
  const [rolarParaFim, setRolarParaFim] = useState(false);

  useEffect(() => {
    if (!rolarParaFim) return;
    fimDaListaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setRolarParaFim(false);
  }, [rolarParaFim]);

  const conferidas = linhas.filter((l) => l.conferido);
  const total = conferidas.reduce(
    (s, l) => s + (l.valorCentavos ? centavosParaReais(l.valorCentavos) : 0),
    0
  );
  // Em centavos inteiros: comparar dinheiro em float erra por arredondamento.
  const somaCentavos = conferidas.reduce((s, l) => s + (l.valorCentavos ?? 0), 0);
  const diferencaCentavos =
    totalRelatorioCentavos === null ? null : totalRelatorioCentavos - somaCentavos;
  const bate = diferencaCentavos === null || diferencaCentavos === 0;
  const confirmarDivergencia =
    somaConfirmadaCentavos !== null && somaConfirmadaCentavos === somaCentavos;

  function atualizar(id: string, campo: Partial<Linha>) {
    setLinhas((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...campo } : l))
    );
  }

  /** O botão de foto só ACUMULA — nunca chama a API. O gestor tira uma
   *  foto por vez no celular (a câmera fecha e volta pra tela a cada
   *  toque), e chamar a leitura a cada uma custaria dinheiro a cada toque. */
  async function escolherFotos(files: FileList | null, inputEl: HTMLInputElement) {
    if (!files || files.length === 0) return;
    setErro(null);
    setAdicionandoFotos(true);
    try {
      const novas: Foto[] = [];
      for (const file of Array.from(files)) {
        // Comprime antes de subir: cheque não precisa de resolução de
        // impressão, e payload grande estoura o limite da função serverless.
        const comprimida = await imageCompression(file, {
          maxWidthOrHeight: 1600,
          maxSizeMB: 1.5,
          useWebWorker: true,
        });
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.onerror = reject;
          r.readAsDataURL(comprimida);
        });
        novas.push({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(comprimida),
          base64,
          tipo: comprimida.type || "image/jpeg",
          lida: false,
        });
      }
      // Acumula — nunca substitui. Escolher fotos de novo não pode apagar
      // as anteriores nem desalinhar as linhas já lidas.
      setFotos((atual) => [...atual, ...novas]);
    } catch (e) {
      setErro("Não consegui preparar as fotos: " + String(e));
    } finally {
      setAdicionandoFotos(false);
      // Sem isso, escolher a MESMA foto de novo não dispara o onChange (o
      // navegador só avisa quando o valor muda) e a tela parece travada.
      inputEl.value = "";
    }
  }

  function removerFoto(id: string) {
    setFotos((atual) => {
      const alvo = atual.find((f) => f.id === id);
      if (alvo) URL.revokeObjectURL(alvo.url);
      return atual.filter((f) => f.id !== id);
    });
  }

  type LidoApi = {
    imagem_index?: number;
    deu_pra_ler?: boolean;
    banco?: string;
    emitente?: string;
    numero?: string;
    valor?: number;
    valor_extenso?: number;
    bom_para?: string;
    bom_para_origem?: string;
    ano_assumido?: boolean;
    observacao?: string;
  };

  /** Lê UMA leva (até 3 fotos, o limite de payload da função). Devolve
   *  true/false pra quem chama saber se pode marcar a leva como lida —
   *  em caso de falha as fotos continuam disponíveis pra tentar de novo. */
  async function lerLeva(leva: Foto[]): Promise<boolean> {
    const res = await fetch("/api/admin/cheques/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imagens: leva.map((f) => ({ media_type: f.tipo, data: f.base64 })),
        // Data que a tela já tem (campo "Recebido em") — o prompt usa ela
        // pra assumir o ano do "bom para" quando ele vem sem ano (comum).
        recebido_em: data,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErro(json.error || "A leitura falhou. Lance na mão.");
      return false;
    }
    const lidas: Linha[] = (json.cheques as LidoApi[]).map((c) =>
      novaLinha({
        // imagem_index vem RELATIVO a esta leva — converte pro id estável
        // da foto na hora, e a linha nunca mais depende de posição.
        imagemId:
          typeof c.imagem_index === "number" && leva[c.imagem_index]
            ? leva[c.imagem_index].id
            : null,
        deuPraLer: c.deu_pra_ler !== false,
        banco: c.banco || "",
        emitente: c.emitente || "",
        numero: c.numero || "",
        valorCentavos: c.valor && c.valor > 0 ? reaisParaCentavos(c.valor) : null,
        valorExtensoCentavos:
          c.valor_extenso && c.valor_extenso > 0
            ? reaisParaCentavos(c.valor_extenso)
            : null,
        bomPara: c.bom_para || "",
        bomParaOrigem:
          c.bom_para_origem === "bom_para" || c.bom_para_origem === "data_assinatura"
            ? c.bom_para_origem
            : "",
        anoAssumido: c.ano_assumido === true,
        observacao: c.observacao || "",
      })
    );
    setLinhas((atual) => [...atual, ...lidas]);
    if (lidas.length === 0) {
      setErro("Não achei cheque nenhum nessas fotos. Confira ou lance na mão.");
    }
    if (json.custo) {
      setCustoOcr({
        destaLeitura: Number(json.custo.desta_leitura) || 0,
        doMes: Number(json.custo.do_mes) || 0,
        modelo: String(json.custo.modelo || ""),
        cotacao:
          typeof json.custo.cotacao === "number" && Number.isFinite(json.custo.cotacao)
            ? json.custo.cotacao
            : null,
      });
    }
    return true;
  }

  /** O botão "Ler" dispara isto: lê SÓ as fotos ainda não lidas, em levas
   *  de 3 (limite de payload de 4,5MB da função da Vercel). Ler de novo
   *  não relê o que já leu — não cobra de novo nem duplica linha. */
  async function lerPendentes() {
    const pendentes = fotos.filter((f) => !f.lida);
    if (pendentes.length === 0) return;
    setErro(null);
    setLendo(true);
    setProgressoLeitura({ atual: 0, total: pendentes.length });
    try {
      for (let i = 0; i < pendentes.length; i += 3) {
        const leva = pendentes.slice(i, i + 3);
        const ok = await lerLeva(leva);
        if (ok) {
          const idsDaLeva = new Set(leva.map((f) => f.id));
          setFotos((atual) =>
            atual.map((f) => (idsDaLeva.has(f.id) ? { ...f, lida: true } : f))
          );
        }
        setProgressoLeitura((p) =>
          p ? { ...p, atual: Math.min(p.atual + leva.length, p.total) } : p
        );
      }
    } finally {
      setLendo(false);
      setProgressoLeitura(null);
    }
  }

  async function lancar() {
    if (!compradorId) return setErro("De qual comprador é o maço?");
    if (conferidas.length === 0) {
      return setErro("Tique os cheques que você conferiu — nada é lançado sem o tique.");
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/cheques/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprador_id: compradorId,
          data,
          cheques: conferidas.map((l) => ({
            client_id: l.clientId,
            banco: l.banco,
            emitente: l.emitente,
            numero: l.numero,
            valor: l.valorCentavos ? centavosParaReais(l.valorCentavos) : 0,
            bom_para: l.bomPara,
            observacao: l.observacao,
          })),
          total_conferencia:
            totalRelatorioCentavos === null
              ? null
              : centavosParaReais(totalRelatorioCentavos),
          confirmado: confirmarDivergencia,
        }),
      });
      const json = await res.json();
      // 409 = a soma não bateu e o segundo clique não veio. A tela já mostra
      // o bloco amarelo; isto é a rede de segurança pra quem chamar a API na
      // mão ou pra estado dessincronizado.
      if (res.status === 409 && json.erro_conferencia) {
        setSomaConfirmadaCentavos(null);
        setErro(
          `A soma não bate: ticado ${formatBRL(json.soma)}, relatório ${formatBRL(
            json.total_informado
          )} (${json.diferenca > 0 ? "faltam" : "sobram"} ${formatBRL(
            Math.abs(json.diferenca)
          )}). Confira e clique de novo pra lançar assim mesmo.`
        );
        return;
      }
      if (!res.ok) {
        setErro(json.error || "Falha ao lançar.");
        return;
      }
      // O servidor pode ter concluído "esse maço já entrou antes". Antes a
      // tela ignorava o aviso, limpava tudo e o gestor achava que os
      // cheques novos/corrigidos tinham entrado. Agora ele fica na tela.
      if (json.aviso) {
        setErro(`⚠️ ${json.aviso}`);
        router.refresh();
        return;
      }
      setLinhas([]);
      setFotos([]);
      setAberto(false);
      setTotalRelatorioCentavos(null);
      setSomaConfirmadaCentavos(null);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="mb-4">
        <button onClick={() => setAberto(true)} className="btn-primario">
          + Lançar maço de cheques
        </button>
      </div>
    );
  }

  return (
    <div className="card mb-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Lançar maço de cheques</h2>
        <button
          onClick={() => setAberto(false)}
          className="text-sm text-cinza-suave hover:underline"
        >
          Fechar
        </button>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">De quem é o maço</label>
          <select
            value={compradorId}
            onChange={(e) => setCompradorId(e.target.value)}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
          >
            <option value="">Escolha o comprador…</option>
            {compradores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Recebido em</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Total do relatório{" "}
            <span className="text-cinza-suave font-normal">(opcional)</span>
          </label>
          {/* Zero e vazio são o mesmo estado aqui (o InputDinheiro mapeia 0
              para null), e tudo bem: um maço de cheques nunca soma zero, então
              zero só pode ser engano de digitação ou campo não preenchido — os
              dois querem dizer "não confira pela soma". O que NÃO pode é isso
              ficar invisível: o rodapé diz "sem conferência pela soma" quando
              há cheque ticado e nenhum total, pra ninguém achar que conferiu. */}
          <InputDinheiro
            centavos={totalRelatorioCentavos}
            onChange={(v) => {
              setTotalRelatorioCentavos(v);
              setSomaConfirmadaCentavos(null);
            }}
            grande={false}
          />
          <p className="text-xs text-cinza-suave mt-0.5">
            A soma que vem no papel. Se bater, os valores estão certos.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap border-t border-cinza-borda pt-4">
        {ocrDisponivel ? (
          <label className="text-sm">
            <span className="text-verde hover:underline cursor-pointer font-medium">
              📷 Adicionar fotos
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={adicionandoFotos}
              onChange={(e) => {
                const el = e.currentTarget;
                escolherFotos(el.files, el);
              }}
            />
            <span className="text-cinza-suave block text-xs mt-0.5">
              Tire quantas fotos precisar, uma de cada vez ou o maço junto.
              Depois toque em &quot;Ler&quot;.
            </span>
          </label>
        ) : (
          <p className="text-xs text-cinza-suave">
            A leitura por foto não está configurada neste servidor — lance na
            mão, funciona igual.
          </p>
        )}
      </div>

      {adicionandoFotos && (
        <p className="text-sm text-cinza-suave">Preparando fotos…</p>
      )}

      {fotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((f, i) => (
            <div key={f.id} className="relative shrink-0">
              <button
                onClick={() => setAmpliada(f.url)}
                className={`border rounded-lg overflow-hidden block ${
                  f.lida ? "border-cinza-borda" : "border-amber-300"
                }`}
                title={`Foto ${i + 1} — clique pra ampliar`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={`Foto ${i + 1}`} className="h-20 w-auto" />
              </button>
              {!f.lida && (
                <span className="absolute bottom-0 left-0 right-0 bg-amber-600/80 text-white text-[10px] text-center leading-tight">
                  não lida
                </span>
              )}
              <button
                onClick={() => removerFoto(f.id)}
                disabled={lendo}
                title="Remover foto"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-alerta text-white text-xs leading-none flex items-center justify-center disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {fotos.some((f) => !f.lida) && (
        <button
          onClick={lerPendentes}
          disabled={lendo}
          className="btn-primario disabled:opacity-40"
        >
          {lendo
            ? `Lendo ${progressoLeitura?.atual ?? 0} de ${progressoLeitura?.total ?? 0}…`
            : `🔍 Ler ${fotos.filter((f) => !f.lida).length} foto${
                fotos.filter((f) => !f.lida).length === 1 ? "" : "s"
              }`}
        </button>
      )}

      {/* Dólar com VÍRGULA: o app inteiro é pt-BR, e "US$ 0.04" no meio de
          uma tela onde todo o resto usa vírgula lê como erro de digitação. */}
      {custoOcr && (
        <p className="text-xs text-cinza-suave">
          ≈ US$ {formatUSD(custoOcr.destaLeitura)} nesta leitura · US${" "}
          {formatUSD(custoOcr.doMes)} no mês
          {custoOcr.cotacao !== null &&
            ` (≈ ${formatBRL(custoOcr.doMes * custoOcr.cotacao)})`}{" "}
          · estimativa pelo {custoOcr.modelo} · o valor real está no painel da
          Anthropic
        </p>
      )}

      {linhas.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-cinza-suave">
            Confira cada cheque com a foto do lado e{" "}
            <strong>tique o que estiver certo</strong>. Só o que for ticado é
            lançado. Campo em branco é a leitura dizendo que não teve certeza —
            preencha na mão.
          </p>

          {linhas.map((l) => {
            const foto =
              l.imagemId != null ? fotos.find((f) => f.id === l.imagemId) : undefined;
            // Divergência número × extenso: só conta quando os DOIS foram
            // lidos e discordam. Um dos dois em branco não é divergência,
            // é só falta de conferência — merece um aviso mais leve.
            const divergeValor =
              l.valorCentavos !== null &&
              l.valorExtensoCentavos !== null &&
              l.valorCentavos !== l.valorExtensoCentavos;
            const faltaConferirValor =
              !divergeValor &&
              (l.valorCentavos !== null || l.valorExtensoCentavos !== null) &&
              (l.valorCentavos === null || l.valorExtensoCentavos === null);
            // Antiburro de janela: só marca (amarelo), nunca bloqueia. Fora
            // de mais de 12 meses à frente ou 6 meses atrás do recebimento.
            const foraDaJanela =
              l.bomPara && data
                ? (() => {
                    const diff = diferencaEmMeses(l.bomPara, data);
                    return diff > 12 || diff < -6;
                  })()
                : false;
            return (
              <div
                key={l.id}
                className={`border rounded-xl p-3 ${
                  l.conferido
                    ? "border-verde bg-verde/5"
                    : l.deuPraLer
                      ? "border-cinza-borda"
                      : "border-amber-300 bg-amber-50"
                }`}
              >
                {!l.deuPraLer && (
                  <p className="text-sm text-amber-800 mb-2">
                    <strong>Não deu pra ler.</strong> Pode ser o verso, foto
                    tremida ou papel que não é cheque. Digite na mão ou apague a
                    linha.
                  </p>
                )}
                {l.observacao && l.deuPraLer && (
                  <p className="text-xs text-cinza-suave mb-2">⚠️ {l.observacao}</p>
                )}
                {l.deuPraLer && divergeValor && (
                  <p className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-2 py-1.5 mb-2">
                    ⚠️ O número diz{" "}
                    {formatBRL(centavosParaReais(l.valorCentavos!))} e o extenso diz{" "}
                    {formatBRL(centavosParaReais(l.valorExtensoCentavos!))} — confira
                    na foto.
                  </p>
                )}
                {l.deuPraLer && !divergeValor && faltaConferirValor && (
                  <p className="text-xs text-cinza-suave mb-2">
                    Só {l.valorCentavos !== null ? "o número" : "o extenso"} foi
                    lido com certeza — confira o outro na foto.
                  </p>
                )}

                <div className="flex gap-3">
                  {foto && (
                    <button
                      onClick={() => setAmpliada(foto.url)}
                      className="shrink-0 border border-cinza-borda rounded-lg overflow-hidden self-start"
                      title="Ampliar"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={foto.url} alt="Cheque" className="h-24 w-auto" />
                    </button>
                  )}

                  <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-cinza-suave">Banco</label>
                      <input
                        value={l.banco}
                        onChange={(e) => atualizar(l.id, { banco: e.target.value })}
                        className="w-full border border-cinza-borda rounded-lg px-2 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-cinza-suave">Emitente</label>
                      <input
                        value={l.emitente}
                        onChange={(e) => atualizar(l.id, { emitente: e.target.value })}
                        className="w-full border border-cinza-borda rounded-lg px-2 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-cinza-suave">Valor</label>
                      <InputDinheiro
                        centavos={l.valorCentavos}
                        onChange={(v) => atualizar(l.id, { valorCentavos: v })}
                        grande={false}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-cinza-suave">Bom para</label>
                      <input
                        type="date"
                        value={l.bomPara}
                        onChange={(e) => atualizar(l.id, { bomPara: e.target.value })}
                        className="w-full border border-cinza-borda rounded-lg px-2 py-1.5"
                      />
                      {l.anoAssumido && (
                        <p className="text-xs text-amber-700 mt-0.5">
                          ano assumido pelo sistema
                        </p>
                      )}
                      {l.bomParaOrigem === "data_assinatura" && (
                        <p className="text-xs text-cinza-suave mt-0.5">
                          sem &quot;bom para&quot; escrito — veio da data de assinatura
                        </p>
                      )}
                      {foraDaJanela && (
                        <p className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded px-1.5 py-0.5 mt-0.5">
                          ⚠️ data distante do recebimento — confira
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-cinza-suave">
                        Número <span className="text-cinza-suave">(opcional)</span>
                      </label>
                      <input
                        value={l.numero}
                        onChange={(e) => atualizar(l.id, { numero: e.target.value })}
                        className="w-full border border-cinza-borda rounded-lg px-2 py-1.5"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 mt-3 pt-2 border-t border-cinza-borda/60">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={l.conferido}
                      onChange={(e) =>
                        atualizar(l.id, { conferido: e.target.checked })
                      }
                      className="w-5 h-5 cursor-pointer"
                    />
                    <span className="text-sm font-medium">Conferi, pode lançar</span>
                  </label>
                  <button
                    onClick={() =>
                      setLinhas((a) => a.filter((x) => x.id !== l.id))
                    }
                    className="text-sm text-alerta hover:underline"
                  >
                    Apagar linha
                  </button>
                </div>
              </div>
            );
          })}

          <div ref={fimDaListaRef} />
          <button
            onClick={() => {
              setLinhas((a) => [...a, novaLinha({ conferido: true })]);
              setRolarParaFim(true);
            }}
            className="w-full border border-dashed border-cinza-borda rounded-xl py-2 text-sm text-verde hover:bg-slate-50 font-medium"
          >
            + Adicionar cheque na mão
          </button>

          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-cinza-borda pt-4">
            <p className="text-sm">
              <strong>{conferidas.length}</strong> de {linhas.length} conferido
              {conferidas.length === 1 ? "" : "s"} ·{" "}
              <strong>{formatBRL(total)}</strong>
              {diferencaCentavos !== null && diferencaCentavos !== 0 && (
                <>
                  {" · "}
                  <strong className="text-alerta">
                    {diferencaCentavos > 0 ? "faltam " : "sobram "}
                    {formatBRL(Math.abs(diferencaCentavos) / 100)}
                  </strong>
                </>
              )}
              {bate && totalRelatorioCentavos !== null && (
                <span className="text-verde font-semibold"> · ✅ bate</span>
              )}
              {totalRelatorioCentavos === null && conferidas.length > 0 && (
                <span className="text-cinza-suave">
                  {" "}
                  · sem conferência pela soma
                </span>
              )}
            </p>

            {diferencaCentavos !== null &&
              diferencaCentavos !== 0 &&
              !confirmarDivergencia && (
                <div className="w-full bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    A soma não bate com o relatório.
                  </p>
                  <p className="mt-1">
                    Ticado: {formatBRL(total)} · Relatório:{" "}
                    {formatBRL(totalRelatorioCentavos! / 100)} ·{" "}
                    <strong>
                      {diferencaCentavos > 0 ? "faltam " : "sobram "}
                      {formatBRL(Math.abs(diferencaCentavos) / 100)}
                    </strong>
                  </p>
                  <p className="mt-1">Pode ser uma destas três:</p>
                  <ul className="list-disc ml-5">
                    <li>um cheque do maço não foi ticado</li>
                    <li>um valor foi lido errado (confira com a foto)</li>
                    <li>um cheque do relatório não veio no maço</li>
                  </ul>
                  <button
                    onClick={() => setSomaConfirmadaCentavos(somaCentavos)}
                    className="mt-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold"
                  >
                    LANÇAR MESMO ASSIM
                  </button>
                </div>
              )}

            <button
              onClick={lancar}
              disabled={salvando || conferidas.length === 0}
              className="btn-primario disabled:opacity-40"
            >
              {salvando
                ? "Lançando…"
                : `Lançar ${conferidas.length} cheque${conferidas.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {linhas.length === 0 && (
        <button
          onClick={() => setLinhas([novaLinha({ conferido: true })])}
          className="w-full border border-dashed border-cinza-borda rounded-xl py-3 text-sm text-verde hover:bg-slate-50 font-medium"
        >
          + Adicionar cheque na mão
        </button>
      )}

      {ampliada && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
          onClick={() => setAmpliada(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ampliada}
            alt="Cheque ampliado"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
