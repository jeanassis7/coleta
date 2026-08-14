"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Resumo {
  peso_bruto: number;
  tara: number;
  liquido: number;
  litros: number;
  coletas: number;
  km: number;
  iniciada: string | null;
}

/**
 * Resumo da carga encerrada.
 *
 * Os números chegam por sessionStorage, NÃO pela URL — com parâmetros na
 * URL, o Service Worker não encontrava esta página no cache e o motorista
 * sem sinal via "não é possível acessar esse site", mesmo com a descarga
 * já salva no celular. URL fixa abre offline sempre.
 */
export default function CargaEncerradaPage() {
  const router = useRouter();
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("coleta_resumo_carga");
      if (raw) setResumo(JSON.parse(raw) as Resumo);
    } catch {
      // sem resumo — mostra a tela genérica de sucesso
    }
  }, []);

  let duracaoDias: number | null = null;
  if (resumo?.iniciada) {
    const inicio = new Date(resumo.iniciada);
    if (!isNaN(inicio.getTime())) {
      const ms = Date.now() - inicio.getTime();
      duracaoDias = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
    }
  }

  function voltar() {
    sessionStorage.removeItem("coleta_resumo_carga");
    router.push("/motorista");
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
      <div className="bg-white rounded-3xl shadow-lg p-8 text-center space-y-6">
        <div className="text-6xl">✅</div>
        <h1 className="text-2xl font-bold">Carga encerrada</h1>

        {resumo && (
          <>
            {duracaoDias !== null && (
              <div className="text-cinza-suave">
                📅 Duração: {duracaoDias} {duracaoDias === 1 ? "dia" : "dias"}
              </div>
            )}

            <div className="text-cinza-suave">
              📍 Coletas: {resumo.coletas}{" "}
              {resumo.coletas === 1 ? "local" : "locais"}
            </div>

            {resumo.km > 0 && (
              <div className="text-cinza-suave">
                🛣 Rodou: {resumo.km.toLocaleString("pt-BR")} km
              </div>
            )}

            <div className="border-t border-cinza-borda pt-4 space-y-2 text-left">
              <div className="flex justify-between">
                <span>Peso bruto:</span>
                <span className="font-mono">
                  {resumo.peso_bruto.toLocaleString("pt-BR")} kg
                </span>
              </div>
              <div className="flex justify-between text-cinza-suave">
                <span>Tara:</span>
                <span className="font-mono">
                  - {resumo.tara.toLocaleString("pt-BR")} kg
                </span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-cinza-borda pt-2">
                <span>Líquido:</span>
                <span className="font-mono">
                  {resumo.liquido.toLocaleString("pt-BR")} kg
                </span>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 text-cinza-suave">
              💧 Estimado: ≈ {resumo.litros.toLocaleString("pt-BR")} L
            </div>
          </>
        )}

        <button onClick={voltar} className="btn-primario text-2xl">
          OK
        </button>
      </div>
    </main>
  );
}
