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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/motorista/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, nome, role, ativo, exige_foto")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile || !profile.ativo) {
        await supabase.auth.signOut();
        router.push("/motorista/login");
        return;
      }
      if (profile.role === "admin") {
        router.push("/admin");
        return;
      }

      setPerfil({
        id: profile.id,
        nome: profile.nome,
        exige_foto: profile.exige_foto,
      });
      // Guarda preferência localmente pra Nova Coleta consultar
      sessionStorage.setItem("coleta_exige_foto", String(profile.exige_foto));
      sessionStorage.setItem("coleta_motorista_id", profile.id);
      sessionStorage.setItem("coleta_motorista_nome", profile.nome);
      setCarregando(false);
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
