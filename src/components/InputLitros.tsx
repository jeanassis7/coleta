"use client";

/**
 * Campo de litros com a MESMA mecânica do InputDinheiro (pedido do Evaner,
 * 20/08/2026): digita só algarismos e o valor preenche da direita, com duas
 * casas automáticas:
 *
 *   digita 5      → 0,05 L
 *   digita 505    → 5,05 L
 *   digita 12345  → 123,45 L
 *
 * Não existe vírgula pra digitar errado. O valor trafega em CENTILITROS
 * (inteiro), sem ambiguidade de parse — igual aos centavos do dinheiro.
 */
export function InputLitros({
  centilitros,
  onChange,
  autoFocus = false,
  grande = true,
}: {
  centilitros: number | null;
  onChange: (centilitros: number | null) => void;
  autoFocus?: boolean;
  /** true = estilo motorista (input-grande); false = estilo admin compacto */
  grande?: boolean;
}) {
  const display =
    centilitros === null
      ? ""
      : (centilitros / 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    const valor = digits === "" ? 0 : parseInt(digits, 10);
    onChange(valor === 0 ? null : valor);
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        inputMode="numeric"
        className={
          grande
            ? "input-grande text-2xl flex-1 text-right"
            : "flex-1 px-3 py-2 border border-cinza-borda rounded-xl text-right"
        }
        value={display}
        onChange={handleChange}
        placeholder="0,00"
        autoFocus={autoFocus}
      />
      <span
        className={
          grande
            ? "text-2xl font-bold text-cinza-texto"
            : "text-base font-semibold text-cinza-texto"
        }
      >
        L
      </span>
    </div>
  );
}

/** Converte centilitros (inteiro) em litros decimais pra salvar no banco. */
export function centilitrosParaLitros(centilitros: number): number {
  return Math.round(centilitros) / 100;
}

/** Converte litros decimais (vindos do banco) em centilitros inteiros. */
export function litrosParaCentilitros(litros: number): number {
  return Math.round(litros * 100);
}
