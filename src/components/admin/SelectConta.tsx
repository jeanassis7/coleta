"use client";

import { useEffect } from "react";

export interface ContaOpcao {
  id: string;
  nome: string;
  tipo: "especie" | "banco";
}

const CHAVE_ULTIMA = "coleta.ultimaConta";

/**
 * De qual conta o dinheiro saiu / em qual entrou.
 *
 * Lembra a última conta usada e já vem escolhida — o Jean lança vários
 * movimentos seguidos da mesma conta olhando o extrato, e escolher toda vez
 * seria atrito puro.
 *
 * Quando não há conta cadastrada, explica o que fazer em vez de mostrar um
 * select vazio que trava o formulário sem dizer por quê.
 */
export function SelectConta({
  contas,
  valor,
  onChange,
  label = "De qual conta saiu",
  obrigatorio = true,
}: {
  contas: ContaOpcao[];
  valor: string;
  onChange: (id: string) => void;
  label?: string;
  obrigatorio?: boolean;
}) {
  // Pré-seleciona a última usada (ou a primeira) assim que a lista chega.
  useEffect(() => {
    if (valor || contas.length === 0) return;
    let ultima: string | null = null;
    try {
      ultima = window.localStorage.getItem(CHAVE_ULTIMA);
    } catch {
      // localStorage bloqueado — segue com a primeira conta
    }
    const existe = contas.some((c) => c.id === ultima);
    onChange(existe && ultima ? ultima : contas[0].id);
  }, [contas, valor, onChange]);

  function escolher(id: string) {
    onChange(id);
    try {
      window.localStorage.setItem(CHAVE_ULTIMA, id);
    } catch {
      // sem localStorage o pré-preenchimento some, o resto funciona
    }
  }

  if (contas.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
        Nenhuma conta cadastrada ainda. Cadastre em{" "}
        <a href="/admin/caixa" className="text-verde hover:underline font-medium">
          Caixa
        </a>{" "}
        — sem isso o dinheiro sairia do nada e o saldo não fecharia.
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {label}
        {!obrigatorio && <span className="text-cinza-suave"> (opcional)</span>}
      </label>
      <select
        value={valor}
        onChange={(e) => escolher(e.target.value)}
        className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
      >
        {contas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.tipo === "especie" ? "💵" : "🏦"} {c.nome}
          </option>
        ))}
      </select>
    </div>
  );
}
