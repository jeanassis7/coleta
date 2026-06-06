"use client";

import { useEffect, useState } from "react";
import { captureGPS } from "@/lib/gps/capture";
import type { LocalProximo } from "@/lib/types";

interface Props {
  /**
   * Quando motorista escolhe um local existente, sobe pro parent o id + nome.
   * Quando motorista escolhe "Outro local" ou edita o texto, sobe id = null.
   */
  onSelecionar: (escolha: { local_id: string | null; nome: string }) => void;
  nomeAtual: string;
  setNomeAtual: (s: string) => void;
}

type Estado =
  | { kind: "carregando" }
  | { kind: "vazio" }       // sem sugestões — mostra só o input
  | { kind: "tem"; locais: LocalProximo[]; usandoOutro: boolean; idEscolhido: string | null };

const RAIO_BUSCA_M = 200;

export function SugestaoLocal({ onSelecionar, nomeAtual, setNomeAtual }: Props) {
  const [estado, setEstado] = useState<Estado>({ kind: "carregando" });

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const gps = await captureGPS();
      if (cancelado) return;

      if (!gps.ok || !gps.latitude || !gps.longitude) {
        setEstado({ kind: "vazio" });
        return;
      }

      try {
        const res = await fetch(
          `/api/locais/proximos?lat=${gps.latitude}&lng=${gps.longitude}&raio=${RAIO_BUSCA_M}`
        );
        if (!res.ok) {
          setEstado({ kind: "vazio" });
          return;
        }
        const data = (await res.json()) as { locais: LocalProximo[] };
        if (cancelado) return;

        if (data.locais.length === 0) {
          setEstado({ kind: "vazio" });
        } else {
          setEstado({
            kind: "tem",
            locais: data.locais,
            usandoOutro: false,
            idEscolhido: null,
          });
        }
      } catch {
        setEstado({ kind: "vazio" });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  function escolherLocal(local: LocalProximo) {
    setEstado({
      kind: "tem",
      locais: estado.kind === "tem" ? estado.locais : [],
      usandoOutro: false,
      idEscolhido: local.id,
    });
    setNomeAtual(local.nome_canonico);
    onSelecionar({ local_id: local.id, nome: local.nome_canonico });
  }

  function escolherOutro() {
    if (estado.kind !== "tem") return;
    setEstado({ ...estado, usandoOutro: true, idEscolhido: null });
    setNomeAtual("");
    onSelecionar({ local_id: null, nome: "" });
  }

  function trocarTexto(s: string) {
    setNomeAtual(s);
    onSelecionar({ local_id: null, nome: s });
  }

  if (estado.kind === "carregando") {
    return (
      <input
        type="text"
        className="input-grande"
        placeholder=""
        value={nomeAtual}
        onChange={(e) => trocarTexto(e.target.value)}
        readOnly={false}
      />
    );
  }

  if (estado.kind === "vazio") {
    return (
      <input
        type="text"
        className="input-grande"
        value={nomeAtual}
        onChange={(e) => trocarTexto(e.target.value)}
      />
    );
  }

  // Tem sugestões
  if (estado.usandoOutro) {
    return (
      <div className="space-y-2">
        <input
          type="text"
          className="input-grande"
          value={nomeAtual}
          onChange={(e) => trocarTexto(e.target.value)}
          autoFocus
        />
        <button
          type="button"
          onClick={() => setEstado({ ...estado, usandoOutro: false })}
          className="text-sm text-cinza-suave underline"
        >
          ← Voltar pras sugestões
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-base text-cinza-suave">📍 Você está perto de:</p>
      {estado.locais.map((l) => {
        const escolhido = estado.idEscolhido === l.id;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => escolherLocal(l)}
            className={`w-full text-left p-4 rounded-2xl border-2 transition-colors ${
              escolhido
                ? "bg-verde text-white border-verde"
                : "bg-white border-cinza-borda active:bg-cinza-fundo"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">{l.nome_canonico}</span>
              <span
                className={`text-sm ${
                  escolhido ? "text-white/80" : "text-cinza-suave"
                }`}
              >
                {Math.round(l.distancia_m)}m
              </span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        onClick={escolherOutro}
        className="w-full text-left p-4 rounded-2xl border-2 border-cinza-borda bg-white active:bg-cinza-fundo"
      >
        <span className="text-lg font-semibold">➕ Outro local</span>
      </button>
    </div>
  );
}
