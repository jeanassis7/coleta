"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getLocalDB } from "@/lib/db/dexie";
import { logEvent } from "@/lib/events/log";

export function MenuLogout({ nome, motoristaId }: { nome: string; motoristaId: string }) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const router = useRouter();

  async function sair() {
    // Bloqueia se tem pendentes
    const db = getLocalDB();
    const pendentes = await db.coletas_locais
      .filter((c) => c.motorista_id === motoristaId && (!c.registro_subido || !c.foto_subida))
      .count();

    if (pendentes > 0) {
      setMensagem(
        `Você tem ${pendentes} ${pendentes === 1 ? "coleta não enviada" : "coletas não enviadas"}. Conecte na internet e envie antes de sair.`
      );
      return;
    }

    await logEvent(motoristaId, "logout", {});
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/motorista/login");
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="text-2xl p-2 text-cinza-suave"
        aria-label="Menu"
      >
        ⋮
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/40 z-40 flex items-end"
          onClick={() => {
            setAberto(false);
            setConfirmando(false);
            setMensagem(null);
          }}
        >
          <div
            className="bg-white w-full rounded-t-3xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center py-2">
              <p className="text-xl font-semibold">{nome}</p>
            </div>

            {mensagem && (
              <div className="bg-alerta/10 border border-alerta text-alerta rounded-2xl p-4 text-center text-base font-medium">
                {mensagem}
              </div>
            )}

            {!confirmando ? (
              <button
                onClick={() => setConfirmando(true)}
                className="btn-perigo"
              >
                Sair desta conta
              </button>
            ) : (
              <>
                <p className="text-center text-base text-cinza-suave">
                  Tem certeza? Você vai precisar logar de novo.
                </p>
                <button onClick={sair} className="btn-perigo">
                  Sim, sair
                </button>
                <button
                  onClick={() => setConfirmando(false)}
                  className="btn-secundario"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
