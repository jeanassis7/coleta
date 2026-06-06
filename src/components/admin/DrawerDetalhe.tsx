"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { formatBRL, formatDataHora, formatLitros, parseLitros, parseValorInteiro } from "@/lib/format";

const MiniMapa = dynamic(() => import("@/components/admin/MiniMapa"), {
  ssr: false,
  loading: () => <div className="bg-slate-100 h-48 rounded-xl animate-pulse" />,
});

interface Coleta {
  id: string;
  client_id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  valor_pago: number;
  certificado_tipo: string;
  litros_certificado: number | null;
  observacao: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  foto_path: string | null;
  criado_em: string;
  sincronizado_em: string | null;
  profiles: { nome: string } | null;
}

export function DrawerDetalhe({
  coleta,
  onClose,
}: {
  coleta: Coleta;
  onClose: () => void;
}) {
  const router = useRouter();
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmTexto, setConfirmTexto] = useState("");
  const [editando, setEditando] = useState(false);

  // Estados de edição
  const [litrosTexto, setLitrosTexto] = useState(String(coleta.litros).replace(".", ","));
  const [localNome, setLocalNome] = useState(coleta.local_nome);
  const [valorTexto, setValorTexto] = useState(String(coleta.valor_pago));
  const [certTipo, setCertTipo] = useState(coleta.certificado_tipo);
  const [litrosCertTexto, setLitrosCertTexto] = useState(
    coleta.litros_certificado !== null
      ? String(coleta.litros_certificado).replace(".", ",")
      : ""
  );
  const [observacao, setObservacao] = useState(coleta.observacao || "");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!coleta.foto_path) return;
    const carregar = async () => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.storage
        .from("fotos-coletas")
        .createSignedUrl(coleta.foto_path!, 3600);
      if (data?.signedUrl) setFotoUrl(data.signedUrl);
    };
    carregar();
  }, [coleta.foto_path]);

  async function excluir() {
    if (confirmTexto !== coleta.local_nome) return;
    setExcluindo(true);
    const supabase = getSupabaseBrowser();
    if (coleta.foto_path) {
      await supabase.storage.from("fotos-coletas").remove([coleta.foto_path]);
    }
    const { error } = await supabase.from("coletas").delete().eq("id", coleta.id);
    if (error) {
      alert("Falha ao excluir: " + error.message);
      setExcluindo(false);
      return;
    }
    onClose();
    router.refresh();
  }

  async function salvarEdicao() {
    const litros = parseLitros(litrosTexto);
    const valor = parseValorInteiro(valorTexto);

    if (!litros || litros <= 0) {
      alert("Litros inválido");
      return;
    }
    if (!localNome.trim()) {
      alert("Nome do local não pode ficar vazio");
      return;
    }
    if (!valor || valor <= 0) {
      alert("Valor inválido");
      return;
    }
    if (!["integral", "parcial", "nao"].includes(certTipo)) {
      alert("Certificado inválido");
      return;
    }

    let litros_certificado: number | null = null;
    if (certTipo === "integral") {
      litros_certificado = litros;
    } else if (certTipo === "parcial") {
      const lc = parseLitros(litrosCertTexto);
      if (!lc || lc <= 0) {
        alert("Quantos litros foram no certificado parcial?");
        return;
      }
      litros_certificado = lc;
    }

    setSalvando(true);
    const res = await fetch(`/api/admin/coletas/${coleta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        litros,
        local_nome: localNome.trim(),
        valor_pago: valor,
        certificado_tipo: certTipo,
        litros_certificado,
        observacao: observacao.trim() || null,
      }),
    });
    const data = await res.json();
    setSalvando(false);

    if (!res.ok) {
      alert("Erro ao salvar: " + data.error);
      return;
    }

    setEditando(false);
    onClose();
    router.refresh();
  }

  const custoLitro = coleta.litros > 0 ? coleta.valor_pago / coleta.litros : 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full md:w-[500px] bg-white z-50 overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-cinza-borda px-4 py-3 flex justify-between items-center">
          <h2 className="font-bold">
            Coleta · {formatDataHora(coleta.criado_em)}
          </h2>
          <button onClick={onClose} className="text-2xl px-2">×</button>
        </div>

        <div className="p-4 space-y-4">
          {!editando ? (
            <>
              <dl className="space-y-2 text-base">
                <Linha label="Motorista" valor={coleta.profiles?.nome || "—"} />
                <Linha label="Local" valor={coleta.local_nome} />
                <Linha label="Litros" valor={formatLitros(coleta.litros)} />
                <Linha label="Valor pago" valor={formatBRL(coleta.valor_pago)} />
                <Linha
                  label="R$/litro"
                  valor={`R$ ${custoLitro.toFixed(2).replace(".", ",")}`}
                />
                <Linha
                  label="Certificado"
                  valor={
                    coleta.certificado_tipo === "integral"
                      ? `Integral (${formatLitros(coleta.litros_certificado || 0)})`
                      : coleta.certificado_tipo === "parcial"
                      ? `Parcial (${formatLitros(coleta.litros_certificado || 0)})`
                      : "Não emitido"
                  }
                />
                {coleta.observacao && (
                  <Linha label="Observação" valor={coleta.observacao} />
                )}
                <Linha
                  label="Sincronizada"
                  valor={
                    coleta.sincronizado_em
                      ? formatDataHora(coleta.sincronizado_em)
                      : "—"
                  }
                />
              </dl>

              <button
                onClick={() => setEditando(true)}
                className="w-full px-4 py-2 bg-verde/10 border-2 border-verde text-verde rounded-xl font-medium hover:bg-verde hover:text-white transition-colors"
              >
                ✏️ Editar coleta
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-verde/5 border border-verde rounded-xl p-3 text-sm">
                Edição manual da coleta. Campos editáveis: litros, local, valor,
                certificado, observação. Motorista, foto, GPS e timestamps NÃO podem
                ser alterados.
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Litros</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-grande text-base"
                  value={litrosTexto}
                  onChange={(e) => setLitrosTexto(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Nome do local</label>
                <input
                  type="text"
                  className="input-grande text-base"
                  value={localNome}
                  onChange={(e) => setLocalNome(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Valor pago (R$)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-grande text-base"
                  value={valorTexto}
                  onChange={(e) => setValorTexto(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Certificado</label>
                <select
                  value={certTipo}
                  onChange={(e) => setCertTipo(e.target.value)}
                  className="input-grande text-base"
                >
                  <option value="integral">Integral</option>
                  <option value="parcial">Parcial</option>
                  <option value="nao">Não emitido</option>
                </select>
              </div>

              {certTipo === "parcial" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Litros no certificado
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input-grande text-base"
                    value={litrosCertTexto}
                    onChange={(e) => setLitrosCertTexto(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Observação</label>
                <textarea
                  className="input-grande text-base min-h-[80px] resize-none"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={salvarEdicao}
                  disabled={salvando}
                  className="flex-1 px-4 py-2 bg-verde text-white rounded-xl font-medium"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
                <button
                  onClick={() => setEditando(false)}
                  disabled={salvando}
                  className="px-4 py-2 bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {fotoUrl && (
            <button onClick={() => setAmpliada(true)} className="block w-full">
              <img
                src={fotoUrl}
                alt="Foto do local"
                className="w-full rounded-xl border border-cinza-borda"
              />
            </button>
          )}

          {coleta.gps_capturado && coleta.latitude && coleta.longitude ? (
            <div className="space-y-2">
              <MiniMapa
                lat={coleta.latitude}
                lng={coleta.longitude}
                accuracy={coleta.gps_accuracy || undefined}
              />
              <a
                href={`https://www.google.com/maps?q=${coleta.latitude},${coleta.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-base text-verde hover:underline"
              >
                Abrir no Google Maps →
              </a>
              {coleta.gps_accuracy && (
                <p className="text-sm text-cinza-suave text-center">
                  Precisão: ±{Math.round(coleta.gps_accuracy)}m
                </p>
              )}
            </div>
          ) : (
            <div className="card bg-slate-50 text-center text-cinza-suave">
              📍 Localização não capturada
            </div>
          )}

          {!editando && (
            <div className="pt-4 border-t border-cinza-borda">
              <details>
                <summary className="text-base text-alerta cursor-pointer">
                  🗑 Excluir coleta
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-cinza-suave">
                    Para confirmar, digite o nome do local:{" "}
                    <strong>{coleta.local_nome}</strong>
                  </p>
                  <input
                    type="text"
                    className="input-grande text-base"
                    value={confirmTexto}
                    onChange={(e) => setConfirmTexto(e.target.value)}
                    placeholder=""
                  />
                  <button
                    onClick={excluir}
                    disabled={confirmTexto !== coleta.local_nome || excluindo}
                    className="btn-perigo"
                  >
                    {excluindo ? "Excluindo..." : "Excluir permanentemente"}
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>

      {ampliada && fotoUrl && (
        <div
          className="fixed inset-0 bg-black z-[60] flex items-center justify-center p-4"
          onClick={() => setAmpliada(false)}
        >
          <img src={fotoUrl} alt="Foto ampliada" className="max-h-full max-w-full" />
        </div>
      )}
    </>
  );
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-cinza-suave shrink-0">{label}</dt>
      <dd className="font-medium text-right break-words">{valor}</dd>
    </div>
  );
}
