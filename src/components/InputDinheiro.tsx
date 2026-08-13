"use client";

/**
 * Campo de dinheiro à prova de erro (estilo app de banco / PIX):
 * o usuário digita SÓ algarismos e o valor preenche da direita pra
 * esquerda com centavos automáticos:
 *
 *   digita 6      → R$ 0,06
 *   digita 68     → R$ 0,68
 *   digita 680    → R$ 6,80
 *   digita 68047  → R$ 680,47
 *
 * Não existe vírgula/ponto pra digitar errado — qualquer caractere que
 * não for algarismo é ignorado. O valor trafega em CENTAVOS (inteiro),
 * sem ambiguidade de parse. Backspace remove o último algarismo.
 */
export function InputDinheiro({
  centavos,
  onChange,
  autoFocus = false,
  grande = true,
}: {
  centavos: number | null;
  onChange: (centavos: number | null) => void;
  autoFocus?: boolean;
  /** true = estilo motorista (input-grande); false = estilo admin compacto */
  grande?: boolean;
}) {
  const display =
    centavos === null
      ? ""
      : (centavos / 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    const valor = digits === "" ? 0 : parseInt(digits, 10);
    onChange(valor === 0 ? null : valor);
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={
          grande
            ? "text-2xl font-bold text-cinza-texto"
            : "text-base font-semibold text-cinza-texto"
        }
      >
        R$
      </span>
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
    </div>
  );
}

/** Converte centavos (inteiro) em reais decimais pra salvar no banco. */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** Converte reais decimais (vindos do banco) em centavos inteiros. */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}
