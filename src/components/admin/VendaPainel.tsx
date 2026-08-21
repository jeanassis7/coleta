"use client";

import { useMemo, useRef, useState } from "react";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { formatBRL, formatData } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
  reaisParaCentavos,
} from "@/components/InputDinheiro";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { ModalConfirmar } from "@/components/admin/Modais";
import { compressPhoto } from "@/lib/image/compress";
import { LancamentoAvulso } from "@/components/admin/LancamentoAvulso";
import type { Venda, Comprador, EstoqueTipo } from "@/lib/admin/queries";

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const kg = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
const porKg = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

interface ChequeForm {
  banco: string;
  emitente: string;
  numero: string;
  valorCentavos: number | null;
  bomPara: string;
}

export function VendaPainel({
  vendas,
  compradores,
  estoque,
  veiculos,
  contasFinanceiras,
}: {
  vendas: Venda[];
  compradores: Comprador[];
  estoque: EstoqueTipo[];
  veiculos: Array<{ id: string; placa: string; marca: string; tipo: string }>;
  /** Pra dizer em qual conta a entrada à vista caiu. */
  contasFinanceiras: ContaOpcao[];
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      {!aberto && (
        <div className="mb-4">
          <button
            onClick={() => setAberto(true)}
            disabled={compradores.length === 0}
            className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90 disabled:opacity-50"
          >
            + Nova venda
          </button>
          {compradores.length === 0 && (
            <p className="text-sm text-cinza-suave mt-2">
              Cadastre um comprador antes de lançar a primeira venda.
            </p>
          )}
        </div>
      )}

      {aberto && (
        <FormVenda
          compradores={compradores}
          estoque={estoque}
          veiculos={veiculos}
          contasFinanceiras={contasFinanceiras}
          onFim={() => setAberto(false)}
        />
      )}

      <TabelaVendas vendas={vendas} veiculos={veiculos} compradores={compradores} />
    </>
  );
}

function FormVenda({
  compradores,
  estoque,
  veiculos,
  contasFinanceiras,
  onFim,
}: {
  compradores: Comprador[];
  estoque: EstoqueTipo[];
  veiculos: Array<{ id: string; placa: string; marca: string; tipo: string }>;
  contasFinanceiras: ContaOpcao[];
  onFim: () => void;
}) {
  const router = useRouter();
  const inputFoto = useRef<HTMLInputElement>(null);

  const [compradorId, setCompradorId] = useState(compradores[0]?.id || "");
  const [data, setData] = useState(hojeBr());
  const [peso, setPeso] = useState("");
  const [grosso, setGrosso] = useState("");
  const [precoCentavos, setPrecoCentavos] = useState<number | null>(null);
  const [totalCentavos, setTotalCentavos] = useState<number | null>(null);
  const [caminhaoId, setCaminhaoId] = useState("");
  const [nota, setNota] = useState("");
  const [observacao, setObservacao] = useState("");

  const [recebidoCentavos, setRecebidoCentavos] = useState<number | null>(null);
  const [formaAVista, setFormaAVista] = useState<"pix" | "dinheiro" | "transferencia">("pix");
  // Só a entrada à vista entra em conta agora. O cheque fica no papel até
  // compensar — a conta dele é registrada na compensação.
  const [contaAVista, setContaAVista] = useState("");
  const [cheques, setCheques] = useState<ChequeForm[]>([]);

  const [foto, setFoto] = useState<Blob | null>(null);
  const [nomeFoto, setNomeFoto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoEstoque, setAvisoEstoque] = useState(false);
  const [avisoPagamento, setAvisoPagamento] = useState(false);

  const pesoNum = Number(peso.trim().replace(",", ".")) || 0;
  const grossoNum = Number(grosso.trim().replace(",", ".")) || 0;
  const finoNum = Math.max(0, pesoNum - grossoNum);

  const estFino = estoque.find((e) => e.tipo_oleo === "fino")?.saldo_kg ?? 0;
  const estGrosso = estoque.find((e) => e.tipo_oleo === "grosso")?.saldo_kg ?? 0;

  const totalPago = useMemo(() => {
    const aVista = recebidoCentavos ? centavosParaReais(recebidoCentavos) : 0;
    const soma = cheques.reduce(
      (s, c) => s + (c.valorCentavos ? centavosParaReais(c.valorCentavos) : 0),
      0
    );
    return aVista + soma;
  }, [recebidoCentavos, cheques]);

  const valorTotal = totalCentavos ? centavosParaReais(totalCentavos) : 0;
  const emAberto = valorTotal - totalPago;

  // Preço e total andam juntos: mexer num recalcula o outro. Nunca gravar
  // os dois desencontrados.
  function mudarPreco(centavos: number | null) {
    setPrecoCentavos(centavos);
    if (centavos && pesoNum > 0) {
      setTotalCentavos(Math.round(centavosParaReais(centavos) * pesoNum * 100));
    }
  }
  function mudarTotal(centavos: number | null) {
    setTotalCentavos(centavos);
    if (centavos && pesoNum > 0) {
      setPrecoCentavos(
        Math.round((centavosParaReais(centavos) / pesoNum) * 100)
      );
    }
  }
  function mudarPeso(v: string) {
    setPeso(v);
    const p = Number(v.trim().replace(",", ".")) || 0;
    if (precoCentavos && p > 0) {
      setTotalCentavos(Math.round(centavosParaReais(precoCentavos) * p * 100));
    }
  }

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      setFoto(blob);
      setNomeFoto(file.name);
    } catch {
      setErro("Não consegui processar essa imagem.");
    }
  }

  async function salvar() {
    if (!compradorId) return setErro("Escolha o comprador");
    if (pesoNum <= 0) return setErro("Informe o peso da balança");
    if (grossoNum > pesoNum) return setErro("O grosso não pode passar do peso total");
    if (!totalCentavos || totalCentavos <= 0) return setErro("Informe o preço");

    // Antiburros: avisam e deixam passar no segundo toque. O estoque é
    // estimado — bloquear travaria o Jean num sábado.
    const passaEstoque = finoNum > estFino || grossoNum > estGrosso;
    if (passaEstoque && !avisoEstoque) {
      setErro(null);
      setAvisoEstoque(true);
      return;
    }
    if (Math.abs(emAberto) > 0.009 && !avisoPagamento) {
      setErro(null);
      setAvisoPagamento(true);
      return;
    }

    setErro(null);
    setSalvando(true);
    try {
      let foto_ticket_path: string | null = null;
      if (foto) {
        const supabase = getSupabaseBrowser();
        const path = `vendas/venda-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("fotos-coletas")
          .upload(path, foto, {
            cacheControl: "31536000",
            upsert: true,
            contentType: "image/jpeg",
          });
        if (!upErr) foto_ticket_path = path;
      }

      const res = await fetch("/api/admin/vendas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprador_id: compradorId,
          data,
          peso_total_kg: pesoNum,
          kg_grosso: grossoNum,
          preco_kg: precoCentavos ? centavosParaReais(precoCentavos) : 0,
          valor_total: valorTotal,
          caminhao_id: caminhaoId || null,
          nota_numero: nota.trim() || null,
          observacao: observacao.trim() || null,
          foto_ticket_path,
          recebido_agora: recebidoCentavos ? centavosParaReais(recebidoCentavos) : 0,
          forma_a_vista: formaAVista,
          conta_id: recebidoCentavos ? contaAVista : null,
          cheques: cheques
            .filter((c) => c.valorCentavos)
            .map((c) => ({
              banco: c.banco,
              emitente: c.emitente,
              numero: c.numero,
              valor: centavosParaReais(c.valorCentavos as number),
              bom_para: c.bomPara,
            })),
        }),
      });
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      if (resposta.avisos?.length) {
        setErro(
          "Venda salva, mas parte do pagamento não entrou: " +
            resposta.avisos.join(" · ") +
            ". Lance na ficha do comprador."
        );
        return;
      }
      router.refresh();
      onFim();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card mb-6 space-y-5">
      <h2 className="text-lg font-semibold">Nova venda</h2>

      {/* 1. Quem e quando */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Comprador</label>
          <select
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={compradorId}
            onChange={(e) => setCompradorId(e.target.value)}
          >
            {compradores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.cidade ? ` — ${c.cidade}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Data</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      {/* 2. Peso e mistura */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Peso da balança (kg)
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-right font-mono"
            value={peso}
            onChange={(e) => mudarPeso(e.target.value)}
          />
          <p className="text-xs text-cinza-suave mt-1">
            O que a balança marcou — é o que o comprador paga
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Quanto era grosso (kg)
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-right font-mono"
            value={grosso}
            onChange={(e) => setGrosso(e.target.value)}
            placeholder="0"
          />
          <p className="text-xs text-cinza-suave mt-1">
            Estimativa. O resto sai do fino.
          </p>
        </div>
      </div>

      {pesoNum > 0 && (
        <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 text-sm grid grid-cols-2 gap-3">
          <div>
            <span className="text-cinza-suave">Sai do fino: </span>
            <span className="font-mono font-semibold">{kg(finoNum)}</span>
            <span className="text-cinza-suave"> (tem {kg(estFino)})</span>
          </div>
          <div>
            <span className="text-cinza-suave">Sai do grosso: </span>
            <span className="font-mono font-semibold">{kg(grossoNum)}</span>
            <span className="text-cinza-suave"> (tem {kg(estGrosso)})</span>
          </div>
        </div>
      )}

      {/* 3. Preço */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Preço por kg</label>
          <InputDinheiro
            centavos={precoCentavos}
            onChange={mudarPreco}
            grande={false}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor total</label>
          <InputDinheiro
            centavos={totalCentavos}
            onChange={mudarTotal}
            grande={false}
          />
          <p className="text-xs text-cinza-suave mt-1">
            Pode arredondar aqui — o R$/kg se ajusta sozinho
          </p>
        </div>
      </div>

      {/* 4. Entrega (opcional) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Levou com qual veículo{" "}
            <span className="text-cinza-suave">(opcional)</span>
          </label>
          <select
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={caminhaoId}
            onChange={(e) => setCaminhaoId(e.target.value)}
          >
            <option value="">O comprador veio buscar</option>
            {veiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.placa} — {v.marca}
                {v.tipo === "carro" ? " (carro)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Número da nota <span className="text-cinza-suave">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
      </div>

      {/* 5. Pagamento */}
      <div className="border-t border-cinza-borda pt-4 space-y-4">
        <h3 className="font-semibold">Pagamento</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Entrou agora <span className="text-cinza-suave">(opcional)</span>
            </label>
            <InputDinheiro
              centavos={recebidoCentavos}
              onChange={setRecebidoCentavos}
              grande={false}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Como entrou</label>
            <div className="flex gap-2">
              {(
                [
                  ["pix", "Pix"],
                  ["dinheiro", "Dinheiro"],
                  ["transferencia", "Transf."],
                ] as const
              ).map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormaAVista(v)}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm ${
                    formaAVista === v
                      ? "bg-verde text-white border-verde"
                      : "bg-white border-cinza-borda"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {!!recebidoCentavos && (
            <div className="mt-3">
              <SelectConta
                contas={contasFinanceiras}
                valor={contaAVista}
                onChange={setContaAVista}
                label="Em qual conta o dinheiro entrou"
              />
            </div>
          )}
        </div>

        {cheques.map((ch, i) => (
          <div
            key={i}
            className="border border-cinza-borda rounded-xl p-3 space-y-3 bg-slate-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Cheque {i + 1}</span>
              <button
                type="button"
                onClick={() => setCheques(cheques.filter((_, j) => j !== i))}
                className="text-sm text-alerta hover:underline"
              >
                Remover
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Banco"
                className="px-3 py-2 border border-cinza-borda rounded-xl"
                value={ch.banco}
                onChange={(e) => {
                  const c = [...cheques];
                  c[i] = { ...ch, banco: e.target.value };
                  setCheques(c);
                }}
              />
              <input
                type="text"
                placeholder="Quem emitiu"
                className="px-3 py-2 border border-cinza-borda rounded-xl"
                value={ch.emitente}
                onChange={(e) => {
                  const c = [...cheques];
                  c[i] = { ...ch, emitente: e.target.value };
                  setCheques(c);
                }}
              />
              <input
                type="text"
                placeholder="Número (opcional)"
                className="px-3 py-2 border border-cinza-borda rounded-xl"
                value={ch.numero}
                onChange={(e) => {
                  const c = [...cheques];
                  c[i] = { ...ch, numero: e.target.value };
                  setCheques(c);
                }}
              />
              <input
                type="date"
                title="Bom para"
                className="px-3 py-2 border border-cinza-borda rounded-xl"
                value={ch.bomPara}
                onChange={(e) => {
                  const c = [...cheques];
                  c[i] = { ...ch, bomPara: e.target.value };
                  setCheques(c);
                }}
              />
            </div>
            <div className="max-w-xs">
              <InputDinheiro
                centavos={ch.valorCentavos}
                onChange={(v) => {
                  const c = [...cheques];
                  c[i] = { ...ch, valorCentavos: v };
                  setCheques(c);
                }}
                grande={false}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setCheques([
              ...cheques,
              { banco: "", emitente: "", numero: "", valorCentavos: null, bomPara: "" },
            ])
          }
          className="px-4 py-2 border border-cinza-borda rounded-xl hover:bg-slate-50 text-sm"
        >
          + Adicionar cheque
        </button>

        {valorTotal > 0 && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-cinza-suave">Venda</span>
              <span className="font-mono">{formatBRL(valorTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cinza-suave">Pago agora</span>
              <span className="font-mono">{formatBRL(totalPago)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-cinza-borda pt-1">
              <span>{emAberto >= 0 ? "Fica em aberto" : "Pagou a mais"}</span>
              <span className="font-mono">{formatBRL(Math.abs(emAberto))}</span>
            </div>
          </div>
        )}
      </div>

      {/* 6. Ticket */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Ticket da balança <span className="text-cinza-suave">(opcional)</span>
        </label>
        <input
          ref={inputFoto}
          type="file"
          accept="image/*"
          onChange={escolherFoto}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputFoto.current?.click()}
          className="px-4 py-2 border border-cinza-borda rounded-xl hover:bg-slate-50 text-sm"
        >
          {nomeFoto ? `📷 ${nomeFoto}` : "📷 Escolher foto"}
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Observação <span className="text-cinza-suave">(opcional)</span>
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>

      {avisoEstoque && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
          <p className="font-semibold mb-1">Está saindo mais óleo do que o sistema tem</p>
          <p className="text-cinza-suave">
            O sistema diz {kg(estFino)} de fino e {kg(estGrosso)} de grosso.
            Isso é normal quando faz tempo que ninguém conta o tanque — o peso
            da balança é o que vale. Toque de novo pra confirmar, e depois faça
            um inventário no Estoque.
          </p>
        </div>
      )}

      {avisoPagamento && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
          <p className="font-semibold mb-1">
            O pagamento não fecha com o valor da venda
          </p>
          <p className="text-cinza-suave">
            {emAberto > 0
              ? `Faltam ${formatBRL(emAberto)}, que vão ficar em aberto na conta do comprador.`
              : `Sobram ${formatBRL(-emAberto)}, que viram crédito dele pra próxima.`}{" "}
            Se é isso mesmo, toque de novo.
          </p>
        </div>
      )}

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onFim}
          disabled={salvando}
          className="px-4 py-2 rounded-xl border border-cinza-borda"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
        >
          {salvando
            ? "Salvando..."
            : avisoEstoque || avisoPagamento
              ? "CONFIRMAR MESMO ASSIM"
              : "Registrar venda"}
        </button>
      </div>
    </div>
  );
}

function TabelaVendas({
  vendas,
  veiculos,
  compradores,
}: {
  vendas: Venda[];
  veiculos: Array<{ id: string; placa: string; marca: string; tipo: string }>;
  compradores: Comprador[];
}) {
  const router = useRouter();
  const [apagando, setApagando] = useState<Venda | null>(null);
  // A entrega é um ciclo: depois de lançar a venda, os gastos da viagem
  // (diesel, pedágio, almoço) entram aqui presos ao mesmo caminhão e à
  // venda — é o que permite o custo total da viagem por kg.
  const [gastoDe, setGastoDe] = useState<Venda | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Editar os campos SIMPLES: data, comprador, preço, nota, obs. Peso e
  // mistura ficam de fora (mexem no estoque) — o servidor também recusa.
  const [editando, setEditando] = useState<Venda | null>(null);
  const [edData, setEdData] = useState("");
  const [edCompradorId, setEdCompradorId] = useState("");
  const [edPrecoCentavos, setEdPrecoCentavos] = useState<number | null>(null);
  const [edNota, setEdNota] = useState("");
  const [edObs, setEdObs] = useState("");
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);

  async function apagar(v: Venda) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/vendas/${v.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.aviso) setAviso(json.aviso);
        router.refresh();
      } else {
        setAviso(json.error || "Falha ao apagar.");
      }
    } finally {
      setLoading(false);
      setApagando(null);
    }
  }

  function abrirEdicao(v: Venda) {
    setErroEdicao(null);
    setEditando(v);
    setEdData(v.data);
    setEdCompradorId(v.comprador_id);
    setEdPrecoCentavos(reaisParaCentavos(v.preco_kg));
    setEdNota(v.nota_numero || "");
    setEdObs(v.observacao || "");
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (!edPrecoCentavos || edPrecoCentavos <= 0) {
      return setErroEdicao("Informe o preço por kg");
    }
    setLoading(true);
    setErroEdicao(null);
    try {
      const res = await fetch(`/api/admin/vendas/${editando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: edData,
          comprador_id: edCompradorId,
          preco_kg: centavosParaReais(edPrecoCentavos),
          nota_numero: edNota.trim() || null,
          observacao: edObs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErroEdicao(json.error || "Falha ao salvar.");
        return;
      }
      setEditando(null);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (vendas.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma venda lançada ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      {aviso && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm mb-3">
          {aviso}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Data</th>
            <th className="py-2 pr-3">Comprador</th>
            <th className="py-2 pr-3 text-right">Peso</th>
            <th className="py-2 pr-3 text-right">Fino</th>
            <th className="py-2 pr-3 text-right">Grosso</th>
            <th className="py-2 pr-3 text-right">R$/kg</th>
            <th className="py-2 pr-3 text-right">Total</th>
            <th className="py-2 pr-3">Levou</th>
            <th className="py-2 pr-3 text-center">Ticket</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {vendas.map((v) => (
            <tr key={v.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">{formatData(v.data)}</td>
              <td className="py-2 pr-3">{v.comprador_nome}</td>
              <td className="py-2 pr-3 text-right font-mono">
                {v.peso_total_kg.toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {v.kg_fino.toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {v.kg_grosso > 0 ? v.kg_grosso.toLocaleString("pt-BR") : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono">{porKg(v.preco_kg)}</td>
              <td className="py-2 pr-3 text-right font-mono font-semibold">
                {formatBRL(v.valor_total)}
              </td>
              <td className="py-2 pr-3 text-xs text-cinza-suave">
                {v.caminhao_placa || "buscou"}
              </td>
              <td className="py-2 pr-3 text-center">
                <VisualizadorFoto
                  path={v.foto_ticket_path}
                  legenda={`Venda ${v.comprador_nome} · ${formatData(v.data)}`}
                />
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  {v.caminhao_id && (
                    <button
                      onClick={() => setGastoDe(v)}
                      className="text-verde hover:underline"
                    >
                      + gasto
                    </button>
                  )}
                  <button
                    onClick={() => abrirEdicao(v)}
                    className="text-verde hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setApagando(v)}
                    className="text-alerta hover:underline"
                  >
                    Apagar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {gastoDe && (
        <LancamentoAvulso
          veiculos={veiculos}
          caminhaoFixo={gastoDe.caminhao_id}
          vendaId={gastoDe.id}
          titulo={`Gasto da entrega — ${gastoDe.comprador_nome}`}
          onFechar={() => setGastoDe(null)}
        />
      )}

      {apagando && (
        <ModalConfirmar
          titulo="Apagar essa venda?"
          descricao={`${apagando.comprador_nome} · ${kg(apagando.peso_total_kg)} · ${formatBRL(apagando.valor_total)}. O óleo volta pro estoque. Os pagamentos já recebidos continuam valendo na conta do comprador — o dinheiro entrou de verdade.`}
          confirmarLabel="Apagar"
          perigo
          carregando={loading}
          onConfirmar={() => apagar(apagando)}
          onFechar={() => setApagando(null)}
        />
      )}

      {editando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-bold">Editar venda</h2>
              <p className="text-sm text-cinza-suave mt-1">
                {kg(editando.peso_total_kg)} ({editando.kg_fino.toLocaleString("pt-BR")} fino
                {editando.kg_grosso > 0
                  ? ` + ${editando.kg_grosso.toLocaleString("pt-BR")} grosso`
                  : ""}
                ). Peso e mistura não se editam — mexem no estoque; errou o
                peso, apague e relance. Mudar o preço recalcula o total, e o
                saldo do comprador acompanha sozinho.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Data</label>
                <input
                  type="date"
                  value={edData}
                  onChange={(e) => setEdData(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Comprador</label>
                <select
                  value={edCompradorId}
                  onChange={(e) => setEdCompradorId(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                >
                  {compradores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Preço por kg
                </label>
                <InputDinheiro
                  centavos={edPrecoCentavos}
                  onChange={setEdPrecoCentavos}
                  grande={false}
                />
                {edPrecoCentavos ? (
                  <p className="text-xs text-cinza-suave mt-1">
                    Total:{" "}
                    {formatBRL(
                      Math.round(
                        editando.peso_total_kg * centavosParaReais(edPrecoCentavos) * 100
                      ) / 100
                    )}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nº da nota <span className="text-cinza-suave">(opcional)</span>
                </label>
                <input
                  value={edNota}
                  onChange={(e) => setEdNota(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Observação <span className="text-cinza-suave">(opcional)</span>
              </label>
              <input
                value={edObs}
                onChange={(e) => setEdObs(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              />
            </div>

            {erroEdicao && (
              <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
                {erroEdicao}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditando(null)}
                disabled={loading}
                className="px-4 py-2 rounded-xl border border-cinza-borda"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={loading}
                className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
              >
                {loading ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
