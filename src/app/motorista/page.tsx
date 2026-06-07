"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useSyncTriggers } from "@/lib/sync/trigger";
import { InstallPrompt } from "@/components/motorista/InstallPrompt";
import { BotaoSyncManual } from "@/components/motorista/BotaoSyncManual";
import { ListaColetasDia } from "@/components/motorista/ListaColetasDia";
import { MenuLogout } from "@/components/motorista/MenuLogout";
import { EventLogger } from "@/components/motorista/EventLogger";

interface PerfilLocal {
  id: string;
  nome: string;
  exige_foto: boolean;
}

export default function MotoristaHomePage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilLocal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const { pendentes, online, refresh } = useSyncTriggers();

  useEffect(() => {
    const carregar = async () => {
      const supabase = getSupabaseBrowser();

      // 1. PRIMEIRO: tenta usar perfil cacheado pra abrir offline rápido
      const cachedId = localStorage.getItem("coleta_perfil_id");
      const cachedNome = localStorage.getItem("coleta_perfil_nome");
      const cachedExigeFoto = localStorage.getItem("coleta_perfil_exige_foto");

      if (cachedId && cachedNome) {
        const perfilCacheado: PerfilLocal = {
          id: cachedId,
          nome: cachedNome,
          exige_foto: cachedExigeFoto === "true",
        };
        setPerfil(perfilCacheado);
        sessionStorage.setItem("coleta_exige_foto", String(perfilCacheado.exige_foto));
        sessionStorage.setItem("coleta_motorista_id", perfilCacheado.id);
        sessionStorage.setItem("coleta_motorista_nome", perfilCacheado.nome);
        setCarregando(false);
      }

      // 2. Verifica sessão local (sem chamada de rede)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Sem sessão cacheada e sem cache de perfil = primeira vez ou logout
        if (!cachedId) {
          router.push("/motorista/login");
        }
        return;
      }

      // 3. Se está online, atualiza o perfil em background pra pegar mudanças (ex: exige_foto)
      if (navigator.onLine) {
        try {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("id, nome, role, ativo, exige_foto")
            .eq("id", session.user.id)
            .maybeSingle();

          if (error) {
            // Network error — segue com cache
            if (!cachedId) setCarregando(false);
            return;
          }

          if (!profile || !profile.ativo) {
            // Conta desativada de verdade — força logout
            localStorage.removeItem("coleta_perfil_id");
            localStorage.removeItem("coleta_perfil_nome");
            localStorage.removeItem("coleta_perfil_exige_foto");
            await supabase.auth.signOut();
            router.push("/motorista/login");
            return;
          }
          if (profile.role === "admin") {
            router.push("/admin");
            return;
          }

          // Atualiza cache + estado
          const perfilNovo: PerfilLocal = {
            id: profile.id,
            nome: profile.nome,
            exige_foto: profile.exige_foto,
          };
          setPerfil(perfilNovo);
          localStorage.setItem("coleta_perfil_id", perfilNovo.id);
          localStorage.setItem("coleta_perfil_nome", perfilNovo.nome);
          localStorage.setItem("coleta_perfil_exige_foto", String(perfilNovo.exige_foto));
          sessionStorage.setItem("coleta_exige_foto", String(perfilNovo.exige_foto));
          sessionStorage.setItem("coleta_motorista_id", perfilNovo.id);
          sessionStorage.setItem("coleta_motorista_nome", perfilNovo.nome);
          setCarregando(false);
        } catch {
          // Erro de rede — segue com cache se houver
          if (!cachedId) setCarregando(false);
        }
      } else if (!cachedId) {
        // Offline E sem cache: primeira abertura sem internet — manda pro login
        // (vai mostrar mensagem amigável de "precisa de internet pra primeira vez")
        router.push("/motorista/login");
      }
    };
    carregar();
  }, [router]);

  if (carregando || !perfil) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-cinza-suave text-xl">Carregando...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <EventLogger motoristaId={perfil.id} />
      <header className="flex items-center justify-between mb-6 mt-2">
        <h1 className="text-2xl font-bold">Olá, {perfil.nome}</h1>
        <MenuLogout nome={perfil.nome} motoristaId={perfil.id} />
      </header>

      <InstallPrompt />

      <Link href="/motorista/nova-coleta" className="block mb-4">
        <div className="bg-verde rounded-3xl p-10 text-center shadow-lg active:bg-verde-escuro transition-colors">
          <div className="text-6xl mb-2">➕</div>
          <p className="text-white text-3xl font-bold">NOVA COLETA</p>
        </div>
      </Link>

      <div className="mb-4">
        <BotaoSyncManual
          pendentes={pendentes}
          online={online}
          onSyncDone={refresh}
          motoristaId={perfil.id}
        />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">Minhas coletas hoje</h2>
          {!online && (
            <span className="text-base text-cinza-suave">📵 sem sinal</span>
          )}
        </div>
        <ListaColetasDia motoristaId={perfil.id} />
      </div>
    </main>
  );
}
