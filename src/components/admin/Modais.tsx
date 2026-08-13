"use client";

import { useState } from "react";

/**
 * Modais genéricos DO APP — substituem confirm()/prompt() do navegador
 * (regra do Evaner: todo popup é do próprio app, nunca "de fora").
 */

export function ModalConfirmar({
  titulo,
  descricao,
  confirmarLabel = "Confirmar",
  perigo = false,
  carregando = false,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  descricao?: string;
  confirmarLabel?: string;
  /** true = ação destrutiva (botão vermelho) */
  perigo?: boolean;
  carregando?: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold">{titulo}</h2>
        {descricao && <p className="text-sm text-cinza-suave">{descricao}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onFechar}
            disabled={carregando}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={carregando}
            className={`px-5 py-2 rounded-xl text-white font-medium disabled:opacity-50 ${
              perigo ? "bg-alerta" : "bg-verde"
            }`}
          >
            {carregando ? "Aguarde..." : confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalInputTexto({
  titulo,
  descricao,
  placeholder = "",
  valorInicial = "",
  confirmarLabel = "Salvar",
  perigo = false,
  carregando = false,
  validar,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  descricao?: string;
  placeholder?: string;
  valorInicial?: string;
  confirmarLabel?: string;
  perigo?: boolean;
  carregando?: boolean;
  /** Retorna mensagem de erro se inválido, null se ok */
  validar?: (valor: string) => string | null;
  onConfirmar: (valor: string) => void;
  onFechar: () => void;
}) {
  const [valor, setValor] = useState(valorInicial);
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    const msg = validar ? validar(valor) : null;
    if (msg) {
      setErro(msg);
      return;
    }
    setErro(null);
    onConfirmar(valor);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold">{titulo}</h2>
        {descricao && <p className="text-sm text-cinza-suave">{descricao}</p>}
        <input
          type="text"
          className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmar();
            if (e.key === "Escape") onFechar();
          }}
          placeholder={placeholder}
          autoFocus
        />
        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onFechar}
            disabled={carregando}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={carregando}
            className={`px-5 py-2 rounded-xl text-white font-medium disabled:opacity-50 ${
              perigo ? "bg-alerta" : "bg-verde"
            }`}
          >
            {carregando ? "Aguarde..." : confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
