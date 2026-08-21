"use client";

import { useRef, useState } from "react";
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
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { compressPhoto } from "@/lib/image/compress";
import type { CompraDireta } from "@/lib/admin/queries";

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface OpcaoRotulada {
  id: string;
  rotulo: string;
}

export function CompraDiretaPainel({
  compras,
  contas,
  cargasAtivas,
  chequesCarteira,
}: {
  compras: CompraDireta[];
  contas: ContaOpcao[];
  cargasAtivas: OpcaoRotulada[];
  chequesCarteira: OpcaoRotulada[];
}) {
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<CompraDireta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <>
      <div className="mb-4">
        {!formAberto && !editando && (
          <button
            onClick={() => setFormAberto(true)}
            className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
          >
            + Nova compra direta
          </button>
        )}
      </div>

      {aviso && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm mb-4">
          {aviso}
        </div>
      )}

      {(formAberto || editando) && (
        <FormCompra
          editando={editando}
          contas={contas}
          cargasAtivas={cargasAtivas}
          chequesCarteira={chequesCarteira}
          onFim={(avisoServidor) => {
            setFormAberto(false);
            setEditando(null);
            if (avisoServidor) setAviso(avisoServidor);
          }}
        />
      )}

      <TabelaCompras compras={compras} onEditar={setEditando} />
    </>
  );
}

function FormCompra({
  editando,
  contas,
  cargasAtivas,
  chequesCarteira,
  onFim,
}: {
  editando: CompraDireta | null;
  contas: ContaOpcao[];
  cargasAtivas: OpcaoRotulada[];
  chequesCarteira: OpcaoRotulada[];
  onFim: (aviso?: string | null) => void;
}) {
  const router = useRouter();
  const inputFoto = useRef<HTMLInputElement>(null);
  const [data, setData] = useState(editando?.data || hojeBr());
  const [fornecedor, setFornecedor] = useState(editando?.fornecedor || "");
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    editando ? reaisParaCentavos(editando.valor) : null
  );
  const [quantidade, setQuantidade] = useState(
    editando ? String(editando.quantidade).replace(".", ",") : ""
  );
  const [unidade, setUnidade] = useState<"kg" | "litros">(
    editando?.unidade || "kg"
  );
  const [tipoOleo, setTipoOleo] = useState<"fino" | "grosso">(
    editando?.tipo_oleo || "fino"
  );
  const [caminhaoVazio, setCaminhaoVazio] = useState(
    editando ? editando.entra_no_estoque : true
  );
  const [certTipo, setCertTipo] = useState<"integral" | "parcial" | "nao">(
    editando?.certificado_tipo || "nao"
  );
  const [litrosCert, setLitrosCert] = useState(
    editando?.litros_certificado !== null && editando?.litros_certificado !== undefined
      ? String(editando.litros_certificado).replace(".", ",")
      : ""
  );
  const [observacao, setObservacao] = useState(editando?.observacao || "");
  const [contaId, setContaId] = useState(editando?.conta_id || "");
  // Pagou de conta (o comum), com CHEQUE da carteira (repasse — R66/R67),
  // ou ficou DEVENDO (a prazo → conta a pagar em aberto). Edição não mexe
  // na forma de pagamento.
  const [formaCompra, setFormaCompra] = useState<"conta" | "cheque" | "prazo">(
    "conta"
  );
  const [chequeId, setChequeId] = useState("");
  const [vencimentoPrazo, setVencimentoPrazo] = useState("");
  // Caminhão NÃO estava vazio → em qual carga aberta o óleo foi junto
  const [cargaId, setCargaId] = useState(editando?.carga_id || "");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [nomeFoto, setNomeFoto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    const qtd = Number(quantidade.trim().replace(",", "."));
    if (fornecedor.trim().length < 2) return setErro("Diga de quem comprou");
    if (valorCentavos === null || valorCentavos <= 0) return setErro("Valor inválido");
    if (!Number.isFinite(qtd) || qtd <= 0) return setErro("Quantidade inválida");
    const litrosCertNum = Number(litrosCert.trim().replace(",", "."));
    if (certTipo === "parcial" && (!Number.isFinite(litrosCertNum) || litrosCertNum <= 0)) {
      return setErro("Quantos litros foram no certificado parcial?");
    }
    if (!editando && formaCompra === "conta" && !contaId) {
      return setErro("Diga de qual conta o dinheiro saiu — sem isso o caixa não fecha");
    }
    if (!editando && formaCompra === "cheque" && !chequeId) {
      return setErro("Escolha qual cheque da carteira pagou essa compra");
    }
    if (!editando && formaCompra === "prazo" && !vencimentoPrazo) {
      return setErro("Quando ficou combinado de pagar? Informe o vencimento");
    }
    if (!caminhaoVazio && !cargaId) {
      return setErro("O óleo foi junto em qual carga aberta? Escolha a carga");
    }
    setErro(null);
    setSalvando(true);
    try {
      let foto_path: string | null = null;
      if (foto) {
        const supabase = getSupabaseBrowser();
        const path = `compras/compra-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("fotos-coletas")
          .upload(path, foto, {
            cacheControl: "31536000",
            upsert: true,
            contentType: "image/jpeg",
          });
        if (!upErr) foto_path = path;
      }

      const corpo = {
        data,
        fornecedor: fornecedor.trim(),
        valor: centavosParaReais(valorCentavos),
        quantidade: qtd,
        unidade,
        tipo_oleo: tipoOleo,
        entra_no_estoque: caminhaoVazio,
        carga_id: caminhaoVazio ? null : cargaId || null,
        certificado_tipo: certTipo,
        litros_certificado: certTipo === "parcial" ? litrosCertNum : null,
        conta_id: formaCompra === "conta" ? contaId : null,
        cheque_id: formaCompra === "cheque" ? chequeId : null,
        a_prazo: formaCompra === "prazo",
        ...(formaCompra === "prazo" ? { vencimento: vencimentoPrazo } : {}),
        observacao: observacao.trim() || null,
        ...(foto_path ? { foto_path } : {}),
      };

      const res = await fetch(
        editando ? `/api/admin/compras/${editando.id}` : "/api/admin/compras",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        }
      );
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      router.refresh();
      onFim(resposta.aviso || null);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card mb-6 space-y-4">
      <h2 className="text-lg font-semibold">
        {editando ? "Editar compra direta" : "Nova compra direta de óleo"}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Data <span className="text-cinza-suave">(dia que o óleo entrou)</span>
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">De quem comprou</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
            placeholder=""
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quanto pagou</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>
      </div>

      {/* Dinheiro não aparece nem some (R83): a compra saiu de uma conta OU
          do papel de um cheque da carteira (repasse). Edição não mexe na
          forma — corrija apagando e relançando se pagou diferente. */}
      {!editando && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Como pagou?</label>
            <div className="flex rounded-xl overflow-hidden border border-cinza-borda max-w-lg">
              {(
                [
                  ["conta", "De uma conta"],
                  ["cheque", "Com cheque da carteira"],
                  ["prazo", "Fica pra depois"],
                ] as const
              ).map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormaCompra(v)}
                  className={`flex-1 px-3 py-2 text-sm ${
                    formaCompra === v ? "bg-verde text-white" : "bg-white"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {formaCompra === "prazo" ? (
            <div>
              <label className="block text-sm font-medium mb-1">
                Quando ficou de pagar
              </label>
              <input
                type="date"
                value={vencimentoPrazo}
                onChange={(e) => setVencimentoPrazo(e.target.value)}
                className="w-full max-w-xs px-3 py-2 border border-cinza-borda rounded-xl"
              />
              <p className="text-xs text-cinza-suave mt-1">
                A dívida com o fornecedor nasce em Contas a pagar — o óleo
                entra no estoque agora, o dinheiro sai quando você pagar a
                conta (dá pra pagar com cheque também, por lá).
              </p>
            </div>
          ) : formaCompra === "conta" ? (
            <SelectConta
              contas={contas}
              valor={contaId}
              onChange={setContaId}
              label="De qual conta saiu o dinheiro"
            />
          ) : chequesCarteira.length === 0 ? (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
              Nenhum cheque na carteira agora.
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">
                Qual cheque da carteira
              </label>
              <select
                value={chequeId}
                onChange={(e) => setChequeId(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              >
                <option value="">Escolha da carteira…</option>
                {chequesCarteira.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.rotulo}
                  </option>
                ))}
              </select>
              <p className="text-xs text-cinza-suave mt-1">
                O cheque sai da carteira amarrado a esta compra (repasse) —
                não sai dinheiro de conta nenhuma.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Quantidade</label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              className="flex-1 px-3 py-2 border border-cinza-borda rounded-xl"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
            <div className="flex rounded-xl overflow-hidden border border-cinza-borda">
              {(["kg", "litros"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnidade(u)}
                  className={`px-3 py-2 text-sm ${
                    unidade === u ? "bg-verde text-white" : "bg-white"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-cinza-suave mt-1">
            {unidade === "kg"
              ? "Peso da balança — número exato"
              : "Estimativa — converte pra kg por 0,9"}
          </p>
        </div>

        {/* Fino é 95% da operação e é tudo que vem de motorista. Grosso (óleo
            de navio e afins) só entra por aqui, e vira estoque separado com
            custo médio próprio. */}
        <div>
          <label className="block text-sm font-medium mb-1">Tipo de óleo</label>
          <div className="flex gap-2">
            {(
              [
                ["fino", "Fino"],
                ["grosso", "Grosso"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setTipoOleo(valor)}
                className={`flex-1 px-4 py-2 rounded-xl border-2 text-sm ${
                  tipoOleo === valor
                    ? "bg-verde text-white border-verde"
                    : "bg-white border-cinza-borda"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-cinza-suave mt-1">
            {tipoOleo === "fino"
              ? "O de sempre — mesmo estoque do óleo dos motoristas"
              : "Estoque separado, misturado na hora da venda"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Comprovante <span className="text-cinza-suave">(opcional)</span>
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
      </div>

      {/* A pergunta que impede o óleo de ser contado duas vezes —
          escrita de forma física ("o caminhão estava vazio?") pra ainda
          fazer sentido daqui a dois anos. */}
      <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 space-y-2">
        <p className="text-sm font-medium">
          O caminhão estava vazio quando buscou esse óleo?
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            checked={caminhaoVazio}
            onChange={() => setCaminhaoVazio(true)}
            className="mt-1"
          />
          <span className="text-sm">
            <strong>Sim, estava vazio</strong>{" "}
            <span className="text-cinza-suave">(é o normal)</span>
            <span className="block text-xs text-cinza-suave">
              O óleo entra no estoque por aqui.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            checked={!caminhaoVazio}
            onChange={() => setCaminhaoVazio(false)}
            className="mt-1"
          />
          <span className="text-sm">
            <strong>Não, tinha óleo de motorista dentro</strong>
            <span className="block text-xs text-cinza-suave">
              O peso vai ser contado na descarga dele. Aqui fica registrado só
              quanto você pagou — senão o mesmo óleo entraria duas vezes.
            </span>
          </span>
        </label>
        {!caminhaoVazio && (
          <div className="pl-6">
            <label className="block text-sm font-medium mb-1">
              Em qual carga aberta o óleo foi junto
            </label>
            {cargasAtivas.length === 0 ? (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-sm">
                Nenhuma carga aberta agora — confira se o motorista já iniciou
                a carga no app.
              </div>
            ) : (
              <select
                value={cargaId}
                onChange={(e) => setCargaId(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              >
                <option value="">Escolha a carga…</option>
                {cargasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-cinza-suave mt-1">
              É o rastro da auditoria: a descarga DESSA carga vai conter este
              óleo.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Emitiu certificado?
          </label>
          <div className="flex gap-2">
            {(
              [
                ["nao", "Não"],
                ["integral", "Total"],
                ["parcial", "Parcial"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setCertTipo(valor)}
                className={`px-4 py-2 rounded-xl border-2 text-sm ${
                  certTipo === valor
                    ? "bg-verde text-white border-verde"
                    : "bg-white border-cinza-borda"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>
        {certTipo === "parcial" && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Quantos litros no certificado
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={litrosCert}
              onChange={(e) => setLitrosCert(e.target.value)}
            />
          </div>
        )}
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

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => onFim()}
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
          {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Registrar compra"}
        </button>
      </div>
    </div>
  );
}

function TabelaCompras({
  compras,
  onEditar,
}: {
  compras: CompraDireta[];
  onEditar: (c: CompraDireta) => void;
}) {
  const router = useRouter();
  const [apagando, setApagando] = useState<CompraDireta | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function apagar(c: CompraDireta) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/compras/${c.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        // O servidor desfaz o pagamento com cheque junto — e conta o que
        // desfez. Desfazer calado é pior que não desfazer.
        if (Array.isArray(json.desfeito) && json.desfeito.length > 0) {
          setAviso(`Apagada. Junto: ${json.desfeito.join("; ")}.`);
        }
        router.refresh();
      } else {
        setAviso(json.error || "Falha ao apagar.");
      }
    } finally {
      setLoading(false);
      setApagando(null);
    }
  }

  if (compras.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma compra direta no período.
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
            <th className="py-2 pr-3">De quem</th>
            <th className="py-2 pr-3 text-right">Quantidade</th>
            <th className="py-2 pr-3 text-right">Peso (kg)</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            <th className="py-2 pr-3 text-right">R$/kg</th>
            <th className="py-2 pr-3">Certificado</th>
            <th className="py-2 pr-3">Estoque</th>
            <th className="py-2 pr-3 text-center">Foto</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {compras.map((c) => (
            <tr key={c.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">{formatData(c.data)}</td>
              <td className="py-2 pr-3">
                {c.fornecedor}
                {/* Fino é o padrão em 95% das compras — só marca o que foge */}
                {c.tipo_oleo === "grosso" && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300">
                    grosso
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {c.quantidade.toLocaleString("pt-BR")} {c.unidade}
                {c.unidade === "litros" && (
                  <span className="text-cinza-suave" title="Estimativa (não pesou)">
                    {" "}~
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {c.peso_kg.toLocaleString("pt-BR")} kg
              </td>
              <td className="py-2 pr-3 text-right font-mono">{formatBRL(c.valor)}</td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {c.peso_kg > 0
                  ? `R$ ${(c.valor / c.peso_kg).toFixed(2).replace(".", ",")}`
                  : "—"}
              </td>
              <td className="py-2 pr-3 text-xs">
                {c.certificado_tipo === "integral"
                  ? "total"
                  : c.certificado_tipo === "parcial"
                    ? `parcial (${Number(c.litros_certificado || 0).toLocaleString("pt-BR")} L)`
                    : "—"}
              </td>
              <td className="py-2 pr-3 text-xs">
                {c.entra_no_estoque ? (
                  <span className="text-green-700">entra</span>
                ) : (
                  <span className="text-cinza-suave" title="Foi junto com a carga de um motorista — o peso conta na descarga dele">
                    conta na descarga
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-center">
                <VisualizadorFoto
                  path={c.foto_path}
                  legenda={`Compra de ${c.fornecedor} · ${formatData(c.data)}`}
                />
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => onEditar(c)}
                    className="text-verde hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setApagando(c)}
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

      {apagando && (
        <ModalConfirmar
          titulo="Apagar essa compra?"
          descricao={`${apagando.fornecedor} · ${formatBRL(apagando.valor)} · ${apagando.peso_kg.toLocaleString("pt-BR")} kg. O óleo sai do estoque e o comprovante é apagado. Se foi paga com cheque, o cheque volta pra carteira e o pagamento é desfeito junto.`}
          confirmarLabel="Apagar"
          perigo
          carregando={loading}
          onConfirmar={() => apagar(apagando)}
          onFechar={() => setApagando(null)}
        />
      )}
    </div>
  );
}
