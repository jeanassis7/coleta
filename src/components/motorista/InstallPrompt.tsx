"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY_ULTIMA_RECUSA = "coleta_install_dismissed_at";
const DIAS_PARA_REAPARECER = 7;

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Já instalado?
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Recusou recentemente?
    const ultima = localStorage.getItem(KEY_ULTIMA_RECUSA);
    if (ultima) {
      const ms = Date.now() - parseInt(ultima, 10);
      const dias = ms / (1000 * 60 * 60 * 24);
      if (dias < DIAS_PARA_REAPARECER) return;
    }

    function handler(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisivel(true);
    }

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function instalar() {
    if (!deferred) return;
    await deferred.prompt();
    const result = await deferred.userChoice;
    if (result.outcome === "accepted") {
      setVisivel(false);
    } else {
      localStorage.setItem(KEY_ULTIMA_RECUSA, String(Date.now()));
      setVisivel(false);
    }
  }

  function recusar() {
    localStorage.setItem(KEY_ULTIMA_RECUSA, String(Date.now()));
    setVisivel(false);
  }

  if (!visivel) return null;

  return (
    <div className="card bg-verde/5 border-verde mb-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl">📲</span>
        <div className="flex-1">
          <p className="font-bold text-lg mb-1">Instalar app</p>
          <p className="text-base text-cinza-suave mb-3">
            Pra usar offline e ficar mais rápido, instala na tela inicial.
          </p>
          <div className="flex gap-3">
            <button onClick={instalar} className="btn-primario flex-1">
              INSTALAR
            </button>
            <button onClick={recusar} className="btn-secundario flex-1">
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
