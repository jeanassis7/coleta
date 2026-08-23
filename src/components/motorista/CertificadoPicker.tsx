"use client";

import { useEffect, useState } from "react";
import { formatLitros } from "@/lib/format";
import { InputInteiro } from "@/components/InputInteiro";
import type { CertificadoTipo } from "@/lib/types";

interface Props {
  litros: number | null;
  valor: { tipo: CertificadoTipo | null; litrosCert: number | null };
  onChange: (v: { tipo: CertificadoTipo; litrosCert: number | null }) => void;
}

export function CertificadoPicker({ litros, valor, onChange }: Props) {
  const [parcialLitros, setParcialLitros] = useState<number | null>(null);

  // Se trocar litros, e estiver em "integral", atualiza litros_certificado
  useEffect(() => {
    if (valor.tipo === "integral" && litros !== null && litros !== valor.litrosCert) {
      onChange({ tipo: "integral", litrosCert: litros });
    }
  }, [litros, valor.tipo, valor.litrosCert, onChange]);

  if (litros === null || litros <= 0) {
    return (
      <div className="card text-center text-cinza-suave">
        Preencha os litros primeiro
      </div>
    );
  }

  function selecionar(tipo: CertificadoTipo) {
    if (tipo === "integral") {
      onChange({ tipo: "integral", litrosCert: litros });
    } else if (tipo === "parcial") {
      onChange({ tipo: "parcial", litrosCert: parcialLitros });
    } else {
      onChange({ tipo: "nao", litrosCert: null });
    }
  }

  // Certificado segue a MESMA regra do óleo (decisão do Evaner, 22/08):
  // número cheio, sem ponto nem vírgula. Era aqui que "1.200" virava 1,2 L
  // e entrava calado no relatório de certificados.
  function handleParcialChange(v: number | null) {
    setParcialLitros(v);
    onChange({ tipo: "parcial", litrosCert: v });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => selecionar("nao")}
        className={`w-full text-left p-5 rounded-2xl border-2 text-lg font-semibold transition-colors ${
          valor.tipo === "nao"
            ? "bg-verde text-white border-verde"
            : "bg-white border-cinza-borda active:bg-cinza-fundo"
        }`}
      >
        ❌ Não emitiu
      </button>

      <button
        type="button"
        onClick={() => selecionar("parcial")}
        className={`w-full text-left p-5 rounded-2xl border-2 text-lg font-semibold transition-colors ${
          valor.tipo === "parcial"
            ? "bg-verde text-white border-verde"
            : "bg-white border-cinza-borda active:bg-cinza-fundo"
        }`}
      >
        📝 Sim, mas só uma parte
      </button>

      {valor.tipo === "parcial" && (
        <div className="bg-white border-2 border-verde rounded-2xl p-4">
          <label className="block text-base font-medium mb-2">
            Quantos litros no certificado?
          </label>
          <InputInteiro
            valor={parcialLitros}
            onChange={handleParcialChange}
            autoFocus
            sufixo="L"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => selecionar("integral")}
        className={`w-full text-left p-5 rounded-2xl border-2 text-lg font-semibold transition-colors ${
          valor.tipo === "integral"
            ? "bg-verde text-white border-verde"
            : "bg-white border-cinza-borda active:bg-cinza-fundo"
        }`}
      >
        ✅ Sim, pelos {formatLitros(litros)}
      </button>
    </div>
  );
}
