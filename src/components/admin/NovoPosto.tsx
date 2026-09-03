"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cadastrar posto pelo nome, do escritório.
 *
 * Pede SÓ o nome de propósito. A coordenada quem tem é o motorista na bomba,
 * e o posto aprende sozinho no primeiro abastecimento com GPS (0063) — pedir
 * o ponto no mapa aqui levaria o gestor a chutar, e coordenada chutada entra
 * no raio de 100 m e passa a casar com abastecimento que não é dali.
 */
export function NovoPosto() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/postos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), confirmado: precisaConfirmar }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não deu pra cadastrar");
        if (r.precisaConfirmar) setPrecisaConfirmar(true);
        return;
      }
      setNome("");
      setPrecisaConfirmar(false);
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="bg-white border-2 border-verde text-verde font-semibold rounded-xl px-5 py-2 hover:bg-verde hover:text-white transition-colors"
      >
        ➕ Cadastrar posto
      </button>
    );
  }

  return (
    <div className="card border-2 border-verde space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Novo posto</h2>
        <button
          onClick={() => {
            setAberto(false);
            setErro(null);
            setPrecisaConfirmar(false);
          }}
          className="text-sm text-cinza-suave hover:text-cinza-texto"
        >
          cancelar
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Nome do posto</label>
        <input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setErro(null);
            setPrecisaConfirmar(false);
          }}
          placeholder="Centro Oeste"
          className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
        />
        <p className="text-xs text-cinza-suave mt-1">
          Só o nome. O posto descobre onde fica sozinho, no primeiro
          abastecimento que o motorista lançar lá pelo celular — e a partir daí
          ele passa a aparecer como sugestão na tela dele.
        </p>
      </div>

      {erro && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      <button
        onClick={salvar}
        disabled={salvando || nome.trim().length < 2}
        className={`w-full font-semibold rounded-xl px-5 py-2 text-white disabled:bg-cinza-borda disabled:text-cinza-suave ${
          precisaConfirmar ? "bg-amber-500" : "bg-verde"
        }`}
      >
        {salvando
          ? "Cadastrando..."
          : precisaConfirmar
            ? "CADASTRAR MESMO ASSIM"
            : "Cadastrar"}
      </button>
    </div>
  );
}
