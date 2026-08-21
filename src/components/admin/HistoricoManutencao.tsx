"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import { ModalConfirmar } from "./Modais";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { TIPOS_MANUTENCAO, labelManutencao } from "@/lib/documentos";
import type { Manutencao } from "@/lib/admin/frota";
import { formatData } from "@/lib/format";

const real = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

export function HistoricoManutencao({
  manutencoes,
  caminhaoId,
  kmAtual,
  contas,
}: {
  manutencoes: Manutencao[];
  caminhaoId: string;
  kmAtual: number | null;
  contas: ContaOpcao[];
}) {
  const router = useRouter();

  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState(TIPOS_MANUTENCAO[0].valor);
  const [descricao, setDescricao] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [km, setKm] = useState("");
  const [proximaKm, setProximaKm] = useState("");
  const [proximaData, setProximaData] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [aPrazo, setAPrazo] = useState(false);
  const [vencimento, setVencimento] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("boleto");
  // À vista: o dinheiro saiu AGORA de alguma conta — sem dizer de qual, o
  // caixa fica maior que a gaveta em silêncio.
  const [contaId, setContaId] = useState("");
  const [formaVista, setFormaVista] = useState<"pix" | "dinheiro" | "deposito">("pix");
  const [foto, setFoto] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modalApagar, setModalApagar] = useState<Manutencao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Editar um lançamento: valor/descrição/fornecedor arrastam a conta a
  // pagar amarrada (enquanto não paga) no servidor.
  const [editando, setEditando] = useState<Manutencao | null>(null);
  const [edData, setEdData] = useState("");
  const [edDescricao, setEdDescricao] = useState("");
  const [edValorCentavos, setEdValorCentavos] = useState<number | null>(null);
  const [edKm, setEdKm] = useState("");
  const [edProximaKm, setEdProximaKm] = useState("");
  const [edProximaData, setEdProximaData] = useState("");
  const [edFornecedor, setEdFornecedor] = useState("");

  function abrirEdicao(m: Manutencao) {
    setErro(null);
    setAviso(null);
    setEditando(m);
    setEdData(m.data);
    setEdDescricao(m.descricao);
    setEdValorCentavos(Math.round(m.valor * 100));
    setEdKm(m.km != null ? String(m.km) : "");
    setEdProximaKm(m.proxima_km != null ? String(m.proxima_km) : "");
    setEdProximaData(m.proxima_data || "");
    setEdFornecedor(m.fornecedor || "");
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (!edData) return setErro("Quando foi?");
    if (edDescricao.trim().length < 2) return setErro("Descreva o que foi feito.");
    if (!edValorCentavos) return setErro("Quanto custou?");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/manutencoes/${editando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: edData,
          descricao: edDescricao.trim(),
          valor: centavosParaReais(edValorCentavos),
          km: edKm.trim() === "" ? null : Number(edKm),
          proxima_km: edProximaKm.trim() === "" ? null : Number(edProximaKm),
          proxima_data: edProximaData || null,
          fornecedor: edFornecedor.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao salvar.");
        return;
      }
      if (json.aviso) setAviso(json.aviso);
      setEditando(null);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return setErro("Quando foi?");
    if (descricao.trim().length < 2) return setErro("Descreva o que foi feito.");
    if (!valorCentavos) return setErro("Quanto custou?");
    if (aPrazo && !vencimento) return setErro("Quando vence o pagamento?");
    if (!aPrazo && !contaId) {
      return setErro("Pagou na hora? Diga de qual conta o dinheiro saiu.");
    }
    setErro(null);
    setSalvando(true);
    try {
      let foto_path: string | null = null;
      if (foto) {
        const supabase = getSupabaseBrowser();
        const ext = foto.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `manutencao/${caminhaoId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("documentos")
          .upload(path, foto, { upsert: true, contentType: foto.type });
        if (upErr) {
          setErro("Falha ao enviar a foto: " + upErr.message);
          return;
        }
        foto_path = path;
      }

      const res = await fetch("/api/admin/manutencoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caminhao_id: caminhaoId,
          data,
          tipo,
          descricao: descricao.trim(),
          valor: centavosParaReais(valorCentavos),
          km: km.trim() === "" ? null : Number(km),
          proxima_km: proximaKm.trim() === "" ? null : Number(proximaKm),
          proxima_data: proximaData || null,
          fornecedor: fornecedor.trim() || null,
          foto_path,
          vencimento: aPrazo ? vencimento : null,
          forma_pagamento: aPrazo ? formaPagamento : formaVista,
          conta_id: aPrazo ? null : contaId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao salvar.");
        return;
      }
      setData("");
      setDescricao("");
      setValorCentavos(null);
      setKm("");
      setProximaKm("");
      setProximaData("");
      setFornecedor("");
      setAPrazo(false);
      setVencimento("");
      setFoto(null);
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(m: Manutencao) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/manutencoes/${m.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) setErro(json.error || "Falha ao apagar.");
      else {
        if (json.aviso) setAviso(json.aviso);
        router.refresh();
      }
    } finally {
      setSalvando(false);
      setModalApagar(null);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold">Manutenção</h2>
        <button
          onClick={() => setAberto((v) => !v)}
          className="text-sm text-verde hover:underline"
        >
          {aberto ? "Cancelar" : "+ Lançar manutenção"}
        </button>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm mb-3">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-sm mb-3">
          {aviso}
        </div>
      )}

      {aberto && (
        <form
          onSubmit={salvar}
          className="space-y-3 mb-5 border-b border-cinza-borda pb-5"
        >
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Quando</label>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">O que foi</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {TIPOS_MANUTENCAO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Custou</label>
              <InputDinheiro
                centavos={valorCentavos}
                onChange={setValorCentavos}
                grande={false}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descrição</label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={
                tipo === "pneu" ? "ex: 4 pneus dianteiros" : "ex: troca de correia"
              }
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Km de hoje{" "}
                {kmAtual != null && (
                  <span className="text-cinza-suave">(último: {kmAtual.toLocaleString("pt-BR")})</span>
                )}
              </label>
              <input
                type="number"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
            {tipo === "troca_oleo" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Próxima troca em (km)
                  </label>
                  <input
                    type="number"
                    value={proximaKm}
                    onChange={(e) => setProximaKm(e.target.value)}
                    className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    ou até a data{" "}
                    <span className="text-cinza-suave">(opcional)</span>
                  </label>
                  <input
                    type="date"
                    value={proximaData}
                    onChange={(e) => setProximaData(e.target.value)}
                    className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                  />
                  <p className="text-xs text-cinza-suave mt-1">
                    O alerta acende pelo que vencer PRIMEIRO — km ou data.
                  </p>
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                Onde fez <span className="text-cinza-suave">(opcional)</span>
              </label>
              <input
                value={fornecedor}
                onChange={(e) => setFornecedor(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={aPrazo}
              onChange={(e) => setAPrazo(e.target.checked)}
              className="w-5 h-5 cursor-pointer"
            />
            <span className="text-sm">
              Ficou pra pagar depois
              <span className="text-cinza-suave block text-xs">
                Marca isso e nasce uma conta a pagar ligada a esta manutenção.
              </span>
            </span>
          </label>

          {aPrazo ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Vence em</label>
                <input
                  type="date"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Como vai pagar</label>
                <select
                  value={formaPagamento}
                  onChange={(e) => setFormaPagamento(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                >
                  <option value="boleto">Boleto</option>
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <SelectConta
                contas={contas}
                valor={contaId}
                onChange={setContaId}
                label="De qual conta saiu o dinheiro"
              />
              <div>
                <label className="block text-sm font-medium mb-1">Como pagou</label>
                <select
                  value={formaVista}
                  onChange={(e) =>
                    setFormaVista(e.target.value as "pix" | "dinheiro" | "deposito")
                  }
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                >
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="deposito">Depósito</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              Nota / foto <span className="text-cinza-suave">(opcional)</span>
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFoto(e.target.files?.[0] || null)}
              className="text-sm"
            />
          </div>

          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvando…" : "Salvar manutenção"}
          </button>
        </form>
      )}

      {manutencoes.length === 0 ? (
        <p className="text-cinza-suave text-sm">
          Nenhuma manutenção lançada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3">O que foi</th>
                <th className="py-2 pr-3">Descrição</th>
                <th className="py-2 pr-3">Km</th>
                <th className="py-2 pr-3">Onde</th>
                <th className="py-2 pr-3 text-right">Valor</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {manutencoes.map((m) => (
                <tr key={m.id} className="border-b border-cinza-borda">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatData(m.data)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {labelManutencao(m.tipo)}
                  </td>
                  <td className="py-2 pr-3">{m.descricao}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {m.km?.toLocaleString("pt-BR") ?? "—"}
                    {m.proxima_km && (
                      <span className="text-cinza-suave">
                        {" "}
                        → {m.proxima_km.toLocaleString("pt-BR")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{m.fornecedor || "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">
                    R$ {real(m.valor)}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => abrirEdicao(m)}
                        className="text-verde hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setModalApagar(m)}
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
        </div>
      )}

      {modalApagar && (
        <ModalConfirmar
          titulo="Apagar manutenção"
          descricao={`Apagar "${modalApagar.descricao}" de ${formatData(modalApagar.data)}? Se tiver conta a pagar em aberto amarrada, ela é removida junto; conta já paga fica (o dinheiro saiu de verdade).`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={() => apagar(modalApagar)}
          onFechar={() => setModalApagar(null)}
        />
      )}

      {editando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-bold">
                Editar — {labelManutencao(editando.tipo)}
              </h2>
              <p className="text-sm text-cinza-suave mt-1">
                Valor, descrição e oficina corrigem a conta a pagar amarrada
                junto (enquanto ela não foi paga). Como foi pago não se troca —
                errou isso, apague e relance.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Quando</label>
                <input
                  type="date"
                  value={edData}
                  onChange={(e) => setEdData(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Custou</label>
                <InputDinheiro
                  centavos={edValorCentavos}
                  onChange={setEdValorCentavos}
                  grande={false}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Descrição</label>
              <input
                value={edDescricao}
                onChange={(e) => setEdDescricao(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Km</label>
                <input
                  type="number"
                  value={edKm}
                  onChange={(e) => setEdKm(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Onde fez <span className="text-cinza-suave">(opcional)</span>
                </label>
                <input
                  value={edFornecedor}
                  onChange={(e) => setEdFornecedor(e.target.value)}
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                />
              </div>
              {editando.tipo === "troca_oleo" && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Próxima troca (km)
                    </label>
                    <input
                      type="number"
                      value={edProximaKm}
                      onChange={(e) => setEdProximaKm(e.target.value)}
                      className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      ou até a data
                    </label>
                    <input
                      type="date"
                      value={edProximaData}
                      onChange={(e) => setEdProximaData(e.target.value)}
                      className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                    />
                  </div>
                </>
              )}
            </div>

            {erro && (
              <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
                {erro}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditando(null)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl border border-cinza-borda"
              >
                Cancelar
              </button>
              <button
                onClick={salvarEdicao}
                disabled={salvando}
                className="btn-primario disabled:opacity-40"
              >
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
