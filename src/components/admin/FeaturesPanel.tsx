"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MotoristaTeste {
  id: string;
  nome: string;
  features: Record<string, unknown> | null;
  mostra_saldo_app: boolean;
}

interface FeatureDef {
  key: string;
  label: string;
  descricao: string;
}

export function FeaturesPanel({
  motoristas,
  featuresDisponiveis,
}: {
  motoristas: MotoristaTeste[];
  featuresDisponiveis: FeatureDef[];
}) {
  const router = useRouter();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  async function toggleFeature(
    motoristaId: string,
    feature: string,
    valorAtual: boolean
  ) {
    const key = `${motoristaId}:${feature}`;
    setLoadingKey(key);
    try {
      const res = await fetch(`/api/admin/motoristas/${motoristaId}/feature`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, valor: !valorAtual }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingKey(null);
    }
  }

  async function toggleMostraSaldo(motoristaId: string, valorAtual: boolean) {
    const key = `${motoristaId}:saldo`;
    setLoadingKey(key);
    try {
      const res = await fetch(`/api/admin/motoristas/${motoristaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mostra_saldo_app: !valorAtual }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {motoristas.map((m) => (
        <div key={m.id} className="card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold">{m.nome}</h2>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-300">
              🧪 TESTE
            </span>
          </div>

          <div className="space-y-3">
            {featuresDisponiveis.map((f) => {
              // "saldo" é campo separado no schema (profiles.mostra_saldo_app),
              // não vive dentro de profiles.features
              if (f.key === "saldo") {
                const ligado = !!m.mostra_saldo_app;
                const loading = loadingKey === `${m.id}:saldo`;
                return (
                  <FeatureRow
                    key={f.key}
                    def={f}
                    ligado={ligado}
                    loading={loading}
                    onToggle={() => toggleMostraSaldo(m.id, ligado)}
                  />
                );
              }

              const ligado = !!(m.features?.[f.key]);
              const loading = loadingKey === `${m.id}:${f.key}`;
              return (
                <FeatureRow
                  key={f.key}
                  def={f}
                  ligado={ligado}
                  loading={loading}
                  onToggle={() => toggleFeature(m.id, f.key, ligado)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureRow({
  def,
  ligado,
  loading,
  onToggle,
}: {
  def: FeatureDef;
  ligado: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-4 p-3 border border-cinza-borda rounded-xl">
      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={ligado}
          disabled={loading}
          onChange={onToggle}
          className="w-5 h-5 cursor-pointer"
        />
      </label>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{def.label}</span>
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
            {def.key}
          </code>
          {ligado && (
            <span className="text-xs font-semibold text-verde">✓ ligado</span>
          )}
        </div>
        <p className="text-sm text-cinza-suave mt-1">{def.descricao}</p>
      </div>
    </div>
  );
}
