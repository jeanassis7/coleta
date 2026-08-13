"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function CargaEncerradaConteudo() {
  const router = useRouter();
  const params = useSearchParams();

  const pesoBruto = Number(params.get("peso_bruto") || "0");
  const tara = Number(params.get("tara") || "0");
  const liquido = Number(params.get("liquido") || "0");
  const litros = Number(params.get("litros") || "0");
  const coletas = Number(params.get("coletas") || "0");
  const kmRodado = Number(params.get("km") || "0");
  const iniciadaRaw = params.get("iniciada");

  let duracaoDias: number | null = null;
  if (iniciadaRaw) {
    const inicio = new Date(iniciadaRaw);
    if (!isNaN(inicio.getTime())) {
      const ms = Date.now() - inicio.getTime();
      duracaoDias = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
    }
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
      <div className="bg-white rounded-3xl shadow-lg p-8 text-center space-y-6">
        <div className="text-6xl">✅</div>
        <h1 className="text-2xl font-bold">Carga encerrada</h1>

        {duracaoDias !== null && (
          <div className="text-cinza-suave">
            📅 Duração: {duracaoDias} {duracaoDias === 1 ? "dia" : "dias"}
          </div>
        )}

        <div className="text-cinza-suave">
          📍 Coletas: {coletas} {coletas === 1 ? "local" : "locais"}
        </div>

        {kmRodado > 0 && (
          <div className="text-cinza-suave">
            🛣 Rodou: {kmRodado.toLocaleString("pt-BR")} km
          </div>
        )}

        <div className="border-t border-cinza-borda pt-4 space-y-2 text-left">
          <div className="flex justify-between">
            <span>Peso bruto:</span>
            <span className="font-mono">
              {pesoBruto.toLocaleString("pt-BR")} kg
            </span>
          </div>
          <div className="flex justify-between text-cinza-suave">
            <span>Tara:</span>
            <span className="font-mono">- {tara.toLocaleString("pt-BR")} kg</span>
          </div>
          <div className="flex justify-between font-bold text-lg border-t border-cinza-borda pt-2">
            <span>Líquido:</span>
            <span className="font-mono">
              {liquido.toLocaleString("pt-BR")} kg
            </span>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-3 text-cinza-suave">
          💧 Estimado: ≈ {litros.toLocaleString("pt-BR")} L
        </div>

        <button
          onClick={() => router.push("/motorista")}
          className="btn-primario text-2xl"
        >
          OK
        </button>
      </div>
    </main>
  );
}

export default function CargaEncerradaPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <CargaEncerradaConteudo />
    </Suspense>
  );
}
