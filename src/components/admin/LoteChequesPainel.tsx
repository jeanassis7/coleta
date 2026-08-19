"use client";

import { useState } from "react";
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
  conferido: boolean;
  /** null quando foi digitada na mão */
  imagemIndex: number | null;
  deuPraLer: boolean;
  banco: string;
  emitente: string;
  numero: string;
  valorCentavos: number | null;
  bomPara: string;
  observacao: string;
}

let seq = 0;
const novaLinha = (parcial: Partial<Linha> = {}): Linha => ({
  id: `l${seq++}`,
  conferido: false,
  imagemIndex: null,
  deuPraLer: true,
  banco: "",
  emitente: "",
  numero: "",
  valorCentavos: null,
  bomPara: "",
  observacao: "",
  ...parcial,
});

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
  const [fotos, setFotos] = useState<{ url: string; base64: string; tipo: string }[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);

  const conferidas = linhas.filter((l) => l.conferido);
  const total = conferidas.reduce(
    (s, l) => s + (l.valorCentavos ? centavosParaReais(l.valorCentavos) : 0),
    0
  );

  function atualizar(id: string, campo: Partial<Linha>) {
    setLinhas((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...campo } : l))
    );
  }

  async function escolherFotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErro(null);
    setLendo(true);
    try {
      const novas: { url: string; base64: string; tipo: string }[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
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
          url: URL.createObjectURL(comprimida),
          base64,
          tipo: comprimida.type || "image/jpeg",
        });
      }
      setFotos(novas);
      await ler(novas);
    } catch (e) {
      setErro("Não consegui preparar as fotos: " + String(e));
    } finally {
      setLendo(false);
    }
  }

  async function ler(imgs: { base64: string; tipo: string }[]) {
    const res = await fetch("/api/admin/cheques/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imagens: imgs.map((i) => ({ media_type: i.tipo, data: i.base64 })),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErro(json.error || "A leitura falhou. Lance na mão.");
      return;
    }
    type LidoApi = {
      imagem_index?: number;
      deu_pra_ler?: boolean;
      banco?: string;
      emitente?: string;
      numero?: string;
      valor?: number;
      bom_para?: string;
      observacao?: string;
    };
    const lidas: Linha[] = (json.cheques as LidoApi[]).map((c) =>
      novaLinha({
        imagemIndex:
          typeof c.imagem_index === "number" ? c.imagem_index : null,
        deuPraLer: c.deu_pra_ler !== false,
        banco: c.banco || "",
        emitente: c.emitente || "",
        numero: c.numero || "",
        valorCentavos: c.valor && c.valor > 0 ? reaisParaCentavos(c.valor) : null,
        bomPara: c.bom_para || "",
        observacao: c.observacao || "",
      })
    );
    setLinhas((atual) => [...atual, ...lidas]);
    if (lidas.length === 0) {
      setErro("Não achei cheque nenhum nessas fotos. Confira ou lance na mão.");
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
            banco: l.banco,
            emitente: l.emitente,
            numero: l.numero,
            valor: l.valorCentavos ? centavosParaReais(l.valorCentavos) : 0,
            bom_para: l.bomPara,
            observacao: l.observacao,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao lançar.");
        return;
      }
      setLinhas([]);
      setFotos([]);
      setAberto(false);
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

      <div className="grid sm:grid-cols-2 gap-3">
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
      </div>

      <div className="flex items-center gap-4 flex-wrap border-t border-cinza-borda pt-4">
        {ocrDisponivel ? (
          <label className="text-sm">
            <span className="text-verde hover:underline cursor-pointer font-medium">
              📷 Ler por foto
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={lendo}
              onChange={(e) => escolherFotos(e.target.files)}
            />
            <span className="text-cinza-suave block text-xs mt-0.5">
              Até 10 fotos. Pode fotografar o maço junto.
            </span>
          </label>
        ) : (
          <p className="text-xs text-cinza-suave">
            A leitura por foto não está configurada neste servidor — lance na
            mão, funciona igual.
          </p>
        )}
        <button
          onClick={() => setLinhas((a) => [...a, novaLinha({ conferido: true })])}
          className="text-sm text-verde hover:underline font-medium"
        >
          + Adicionar na mão
        </button>
      </div>

      {lendo && (
        <p className="text-sm text-cinza-suave">
          Lendo as fotos… isso leva alguns segundos.
        </p>
      )}

      {fotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((f, i) => (
            <button
              key={i}
              onClick={() => setAmpliada(f.url)}
              className="shrink-0 border border-cinza-borda rounded-lg overflow-hidden"
              title={`Foto ${i + 1} — clique pra ampliar`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={`Foto ${i + 1}`} className="h-20 w-auto" />
            </button>
          ))}
        </div>
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
              l.imagemIndex != null ? fotos[l.imagemIndex] : undefined;
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

          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-cinza-borda pt-4">
            <p className="text-sm">
              <strong>{conferidas.length}</strong> de {linhas.length} conferido
              {conferidas.length === 1 ? "" : "s"} ·{" "}
              <strong>{formatBRL(total)}</strong>
            </p>
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
