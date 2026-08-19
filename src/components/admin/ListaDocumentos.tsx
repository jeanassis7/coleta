"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import { ModalConfirmar } from "./Modais";
import {
  TIPOS_DOC_CAMINHAO,
  TIPOS_DOC_MOTORISTA,
  labelDocumento,
  situacaoDocumento,
} from "@/lib/documentos";
import type { Documento } from "@/lib/admin/frota";
import { formatData } from "@/lib/format";

/**
 * Documentos com vencimento — serve caminhão e motorista.
 *
 * O arquivo (foto da CNH, PDF do CIPP) vai pro bucket `documentos`, que é
 * privado e só admin acessa. O link de visualização é assinado na hora.
 */
export function ListaDocumentos({
  documentos,
  dono,
}: {
  documentos: Documento[];
  dono: { tipo: "caminhao" | "motorista"; id: string };
}) {
  const router = useRouter();
  const tipos =
    dono.tipo === "caminhao" ? TIPOS_DOC_CAMINHAO : TIPOS_DOC_MOTORISTA;

  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState(tipos[0].valor);
  const [descricao, setDescricao] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [alertaDias, setAlertaDias] = useState("30");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modalApagar, setModalApagar] = useState<Documento | null>(null);

  function limpar() {
    setTipo(tipos[0].valor);
    setDescricao("");
    setVencimento("");
    setValorCentavos(null);
    setAlertaDias("30");
    setArquivo(null);
    setObservacao("");
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!vencimento) return setErro("Quando vence?");
    if (tipo === "outro" && descricao.trim().length < 2) {
      return setErro('Escolheu "Outro" — escreva qual é o documento.');
    }
    setErro(null);
    setSalvando(true);
    try {
      let arquivo_path: string | null = null;
      if (arquivo) {
        const supabase = getSupabaseBrowser();
        const ext = arquivo.name.split(".").pop()?.toLowerCase() || "bin";
        const path = `${dono.tipo}/${dono.id}/${tipo}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("documentos")
          .upload(path, arquivo, { upsert: true, contentType: arquivo.type });
        if (upErr) {
          setErro("Falha ao enviar o arquivo: " + upErr.message);
          return;
        }
        arquivo_path = path;
      }

      const res = await fetch("/api/admin/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [dono.tipo === "caminhao" ? "caminhao_id" : "motorista_id"]: dono.id,
          tipo,
          descricao: descricao.trim() || null,
          vencimento,
          valor: valorCentavos == null ? null : centavosParaReais(valorCentavos),
          arquivo_path,
          alerta_dias: Number(alertaDias) || 30,
          observacao: observacao.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "Falha ao salvar.");
        return;
      }
      limpar();
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(doc: Documento) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/documentos/${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setErro(data.error || "Falha ao apagar.");
      } else {
        router.refresh();
      }
    } finally {
      setSalvando(false);
      setModalApagar(null);
    }
  }

  async function abrirArquivo(path: string) {
    // Bucket privado: o link tem que ser assinado, e vale 60s.
    const supabase = getSupabaseBrowser();
    const { data } = await supabase.storage
      .from("documentos")
      .createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else setErro("Não consegui abrir o arquivo.");
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold">Documentos</h2>
        <button
          onClick={() => setAberto((v) => !v)}
          className="text-sm text-verde hover:underline"
        >
          {aberto ? "Cancelar" : "+ Cadastrar documento"}
        </button>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm mb-3">
          {erro}
        </div>
      )}

      {aberto && (
        <form onSubmit={salvar} className="space-y-3 mb-5 border-b border-cinza-borda pb-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Documento</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {tipos.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Vence em</label>
              <input
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>

          {tipo === "outro" && (
            <div>
              <label className="block text-sm font-medium mb-1">Qual documento?</label>
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="ex: Alvará da prefeitura"
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Custou quanto <span className="text-cinza-suave">(opcional)</span>
              </label>
              <InputDinheiro
                centavos={valorCentavos}
                onChange={setValorCentavos}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Avisar quantos dias antes
              </label>
              <input
                type="number"
                min={0}
                max={365}
                value={alertaDias}
                onChange={(e) => setAlertaDias(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Arquivo <span className="text-cinza-suave">(foto ou PDF, opcional)</span>
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              className="text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Observação <span className="text-cinza-suave">(opcional)</span>
            </label>
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>

          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvando…" : "Salvar documento"}
          </button>
        </form>
      )}

      {documentos.length === 0 ? (
        <p className="text-cinza-suave text-sm">
          Nenhum documento cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {documentos.map((d) => {
            const { situacao, dias } = situacaoDocumento(
              d.vencimento,
              d.alerta_dias
            );
            const cor =
              situacao === "vencido"
                ? "bg-alerta/10 border-alerta"
                : situacao === "vencendo"
                  ? "bg-amber-50 border-amber-300"
                  : "border-cinza-borda";
            const aviso =
              situacao === "vencido"
                ? `venceu há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`
                : situacao === "vencendo"
                  ? dias === 0
                    ? "vence hoje"
                    : `vence em ${dias} dia${dias === 1 ? "" : "s"}`
                  : null;
            return (
              <div
                key={d.id}
                className={`border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap ${cor}`}
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {labelDocumento(d.tipo, d.descricao)}
                    {aviso && (
                      <span
                        className={`ml-2 text-xs font-bold ${
                          situacao === "vencido" ? "text-alerta" : "text-amber-700"
                        }`}
                      >
                        {aviso}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-cinza-suave">
                    Vence em {formatData(d.vencimento)}
                    {d.valor != null &&
                      ` · custou R$ ${d.valor.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}`}
                    {d.observacao && ` · ${d.observacao}`}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {d.arquivo_path && (
                    <button
                      onClick={() => abrirArquivo(d.arquivo_path!)}
                      className="text-verde hover:underline"
                    >
                      Ver arquivo
                    </button>
                  )}
                  <button
                    onClick={() => setModalApagar(d)}
                    className="text-alerta hover:underline"
                  >
                    Apagar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalApagar && (
        <ModalConfirmar
          titulo="Apagar documento"
          descricao={`Apagar "${labelDocumento(modalApagar.tipo, modalApagar.descricao)}"? O arquivo anexado vai junto.`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={() => apagar(modalApagar)}
          onFechar={() => setModalApagar(null)}
        />
      )}
    </div>
  );
}
