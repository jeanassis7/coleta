"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getLocalDB } from "@/lib/db/dexie";
import { logEvent } from "@/lib/events/log";
import { clearCargaAtivaCached } from "@/lib/motorista/carga";
import { countTravados } from "@/lib/sync/queue";

export function MenuLogout({ nome, motoristaId }: { nome: string; motoristaId: string }) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const router = useRouter();

  async function sair() {
    // Bloqueia se tem QUALQUER lançamento não enviado (coleta, despesa,
    // abastecimento ou descarga) — sair com pendência perderia o vínculo
    // com esta conta.
    const db = getLocalDB();
    const [coletasP, despesasP, abastP, descargasP] = await Promise.all([
      db.coletas_locais
        .filter(
          (c) =>
            c.motorista_id === motoristaId &&
            (!c.registro_subido || !c.foto_subida)
        )
        .count(),
      db.despesas_locais
        .filter(
          (d) =>
            d.motorista_id === motoristaId &&
            (!d.registro_subido || !d.foto_subida)
        )
        .count(),
      db.abastecimentos_locais
        .filter(
          (a) =>
            a.motorista_id === motoristaId &&
            (!a.registro_subido || !a.foto_subida)
        )
        .count(),
      db.descargas_locais
        .filter(
          (d) =>
            d.motorista_id === motoristaId &&
            (!d.registro_subido || !d.foto_subida || !d.carga_encerrada_servidor)
        )
        .count(),
    ]);
    const pendentes = coletasP + despesasP + abastP + descargasP;

    // ⚠️ TRAVADO não bloqueia (varredura 22/08): lançamento que desistiu de
    // subir por erro de dado não vai subir com sinal nenhum, e mantê-lo aqui
    // prendia o motorista na conta pra sempre. Ele sai; o Jean resolve.
    const travados = await countTravados(motoristaId);
    if (pendentes > travados) {
      const faltam = pendentes - travados;
      setMensagem(
        `Você tem ${faltam} ${faltam === 1 ? "lançamento não enviado" : "lançamentos não enviados"}. Conecte na internet e envie antes de sair.`
      );
      return;
    }

    await logEvent(motoristaId, "logout", {});
    // Limpa caches locais dessa conta — evita que outro motorista logando
    // neste celular herde a carga ativa ou o perfil de quem saiu.
    clearCargaAtivaCached();
    localStorage.removeItem("coleta_perfil_id");
    localStorage.removeItem("coleta_perfil_nome");
    localStorage.removeItem("coleta_perfil_exige_foto");
    localStorage.removeItem("coleta_perfil_features");
    localStorage.removeItem("coleta_perfil_mostra_saldo");
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
