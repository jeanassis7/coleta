"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModalInputTexto } from "@/components/admin/Modais";

/**
 * Apagar a carga inteira — lançamentos, descarga, contas amarradas e fotos.
 *
 * Existe pro perfil de TESTE e pra carga aberta por engano. Fica discreto no
 * fim da página de propósito: carga real de produção não se apaga, se
 * preserva (é o lastro do estoque e do dinheiro).
 */
export function ApagarCarga({
  cargaId,
  motoristaNome,
}: {
  cargaId: string;
  motoristaNome: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function apagar() {
    setApagando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/cargas/${cargaId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao apagar.");
        return;
      }
      router.push("/admin/cargas");
      router.refresh();
    } finally {
      setApagando(false);
      setAberto(false);
    }
  }

  return (
    <details className="mt-8 text-sm">
      <summary className="cursor-pointer text-cinza-suave hover:text-alerta">
        🗑 Apagar esta carga
      </summary>
      <div className="mt-2 border border-alerta/40 rounded-xl p-3 space-y-2">
        <p className="text-cinza-suave">
          Apaga a carga de <strong>{motoristaNome}</strong> com TUDO dentro:
          coletas, despesas, abastecimentos, descarga, contas amarradas ainda
          não pagas, e as fotos. O estoque e o saldo do motorista recalculam
          sozinhos. É pra carga de <strong>teste ou engano</strong> — carga
          real se preserva.
        </p>
        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2">
            {erro}
          </div>
        )}
        <button
          onClick={() => setAberto(true)}
          className="px-4 py-2 rounded-xl border border-alerta text-alerta hover:bg-alerta/10"
        >
          Apagar carga…
        </button>
      </div>
      {aberto && (
        <ModalInputTexto
          titulo="Apagar esta carga?"
          descricao={`Some tudo, permanentemente. Pra confirmar, digite APAGAR.`}
          confirmarLabel="Apagar de vez"
          perigo
          carregando={apagando}
          validar={(v) => (v.trim().toUpperCase() === "APAGAR" ? null : "Digite APAGAR")}
          onConfirmar={apagar}
          onFechar={() => setAberto(false)}
        />
      )}
    </details>
  );
}
