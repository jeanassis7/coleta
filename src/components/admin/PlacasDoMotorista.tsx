"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Quais caminhões este motorista pode dirigir (0046).
 *
 * NADA marcado = pode todos os caminhões ativos (comportamento de sempre).
 * Marcou um ou mais = o app do motorista só mostra ESSES no iniciar-carga —
 * nada de carro particular nem caminhão dos outros aparecendo pra ele.
 */
export function PlacasDoMotorista({
  motoristaId,
  caminhoes,
  atribuidos,
}: {
  motoristaId: string;
  caminhoes: { id: string; placa: string; marca: string }[];
  atribuidos: string[];
}) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set(atribuidos));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function toggle(id: string) {
    const s = new Set(marcados);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setMarcados(s);
    setOk(null);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/motoristas/${motoristaId}/caminhoes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caminhao_ids: [...marcados] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao salvar.");
        return;
      }
      setOk(
        marcados.size === 0
          ? "Salvo — ele pode dirigir qualquer caminhão ativo."
          : `Salvo — ele só vê ${marcados.size} caminhão(ões) no app.`
      );
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Caminhões que ele dirige</h2>
      <p className="text-sm text-cinza-suave mb-3">
        Marque as placas dele — o app só mostra essas na hora de iniciar
        carga. <strong>Nada marcado = pode todas.</strong>
      </p>
      {caminhoes.length === 0 ? (
        <p className="text-sm text-cinza-suave">Nenhum caminhão cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {caminhoes.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={marcados.has(c.id)}
                onChange={() => toggle(c.id)}
                className="w-5 h-5 cursor-pointer"
              />
              <span className="font-mono font-semibold">{c.placa}</span>
              <span className="text-cinza-suave">{c.marca}</span>
            </label>
          ))}
        </div>
      )}
      {erro && (
        <div className="mt-3 bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}
      {ok && (
        <div className="mt-3 bg-verde/10 border border-verde text-verde rounded-xl p-2 text-sm">
          {ok}
        </div>
      )}
      <button
        onClick={salvar}
        disabled={salvando}
        className="mt-3 btn-primario"
      >
        {salvando ? "Salvando…" : "Salvar placas"}
      </button>
    </div>
  );
}
