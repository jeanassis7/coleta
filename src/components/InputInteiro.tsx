"use client";

/**
 * Campo de NÚMERO CHEIO — litros de óleo, peso na balança, km, certificado.
 *
 * Regra absoluta do Evaner (22/08/2026):
 *   "é óleo: não tem casa decimal nem ponto nem vírgula.
 *    é dinheiro: duas casas que preenchem enquanto ele digita."
 *
 * Aqui é o primeiro caso. O ponto e a vírgula **não entram** — ele aperta
 * a tecla e nada acontece. O erro deixa de ser possível em vez de ser
 * barrado depois:
 *
 *   digita 12850   → 12850     (e não 12,85)
 *   digita 12.850  → 12850     (o ponto simplesmente não entra)
 *   digita 456000  → 456000    (e não 456)
 *
 * Isso mata na raiz três bugs reais achados na varredura de 22/08: peso
 * "12.850" virando 12,85 kg (menor que a tara), km "456.000" virando 456,
 * e certificado "1.200" virando 1,2 L.
 *
 * O separador de milhar aparece só na LEITURA (12.850), nunca na edição —
 * senão ele veria um ponto na tela e tentaria digitar um.
 */
export function InputInteiro({
  valor,
  onChange,
  autoFocus = false,
  grande = true,
  placeholder = "",
  maxDigitos = 9,
  sufixo,
}: {
  valor: number | null;
  onChange: (valor: number | null) => void;
  autoFocus?: boolean;
  /** true = estilo motorista (input-grande); false = admin compacto */
  grande?: boolean;
  placeholder?: string;
  maxDigitos?: number;
  /** Ex.: "L" ou "kg" — só decoração à direita */
  sufixo?: string;
}) {
  const display = valor === null ? "" : String(valor);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, maxDigitos);
    onChange(digits === "" ? null : parseInt(digits, 10));
  }

  const campo = (
    <input
      type="text"
      // numeric (não decimal): o teclado do celular nem mostra a vírgula.
      inputMode="numeric"
      pattern="[0-9]*"
      className={grande ? "input-grande text-2xl w-full" : "w-full px-3 py-2 border border-cinza-borda rounded-xl"}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  );

  if (!sufixo) return campo;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">{campo}</div>
      <span className="text-xl text-cinza-suave font-medium">{sufixo}</span>
    </div>
  );
}
