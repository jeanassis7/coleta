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
import { BarraCaminhao } from "@/components/motorista/BarraCaminhao";
import { AdiantamentoBlocking } from "@/components/motorista/AdiantamentoBlocking";
import { CardSaldo } from "@/components/motorista/CardSaldo";
import {
  fetchCargaAtiva,
  getCargaAtivaCached,
  resumoCargaAtiva,
} from "@/lib/motorista/carga";
import type { CargaAtivaCache } from "@/lib/types";

interface PerfilLocal {
  id: string;
  nome: string;
  exige_foto: boolean;
  features: Record<string, unknown>;
  mostra_saldo_app: boolean;
}

/**
 * Estado da carga ativa:
 *  - undefined = ainda resolvendo (cache vazio + esperando servidor)
 *  - null      = resolvido: NÃO tem carga → gate manda pra "Iniciar carga"
 *  - objeto    = resolvido: tem carga ativa
 * O redirect só dispara com null — nunca no meio da resolução (evita o
 * vai-e-volta de mandar pro iniciar-carga quando o servidor tinha carga).
 */
export default function MotoristaHomePage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilLocal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carga, setCarga] = useState<CargaAtivaCache | null | undefined>(
    undefined
  );
  const [litrosCarga, setLitrosCarga] = useState(0);
  const { pendentes, online, refresh } = useSyncTriggers();

  useEffect(() => {
    const carregar = async () => {
      const supabase = getSupabaseBrowser();

      // 1. Perfil cacheado pra abrir offline rápido
      const cachedId = localStorage.getItem("coleta_perfil_id");
      const cachedNome = localStorage.getItem("coleta_perfil_nome");
      const cachedExigeFoto = localStorage.getItem("coleta_perfil_exige_foto");
      const cachedFeaturesRaw = localStorage.getItem("coleta_perfil_features");
      const cachedFeatures = cachedFeaturesRaw
        ? (JSON.parse(cachedFeaturesRaw) as Record<string, unknown>)
        : {};
      const cachedMostraSaldo =
        localStorage.getItem("coleta_perfil_mostra_saldo") === "true";

      if (cachedId && cachedNome) {
        const p: PerfilLocal = {
          id: cachedId,
          nome: cachedNome,
          exige_foto: cachedExigeFoto === "true",
          features: cachedFeatures,
          mostra_saldo_app: cachedMostraSaldo,
        };
        setPerfil(p);
        sessionStorage.setItem("coleta_exige_foto", String(p.exige_foto));
        sessionStorage.setItem("coleta_motorista_id", p.id);
        sessionStorage.setItem("coleta_motorista_nome", p.nome);
        setCarregando(false);

        if (cachedFeatures?.carga) {
          const cachedCarga = getCargaAtivaCached(cachedId);
          if (cachedCarga) {
            setCarga(cachedCarga);
          } else if (!navigator.onLine) {
            // Offline sem cache: resolvido — sem carga. O iniciar-carga
            // mostra a tela honesta de "sem sinal".
            setCarga(null);
          }
          // Online sem cache: fica undefined até o fetch abaixo resolver.
        } else {
          setCarga(null);
        }
      }

      // 2. Verifica sessão local
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cachedId) router.push("/motorista/login");
        return;
      }

      // 3. Se online, atualiza perfil + carga em background
      if (navigator.onLine) {
        try {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("id, nome, role, ativo, exige_foto, features, mostra_saldo_app")
            .eq("id", session.user.id)
            .maybeSingle();
          if (error) {
            // Rede falhou no meio — resolve carga com o cache
            if (cachedFeatures?.carga) {
              setCarga(getCargaAtivaCached(session.user.id) ?? null);
            }
            if (!cachedId) setCarregando(false);
            return;
          }
          if (!profile || !profile.ativo) {
            localStorage.removeItem("coleta_perfil_id");
            localStorage.removeItem("coleta_perfil_nome");
            localStorage.removeItem("coleta_perfil_exige_foto");
            localStorage.removeItem("coleta_perfil_features");
            localStorage.removeItem("coleta_perfil_mostra_saldo");
            await supabase.auth.signOut();
            router.push("/motorista/login");
            return;
          }
          if (profile.role === "admin" || profile.role === "dev") {
            router.push("/admin");
            return;
          }
          const features = (profile.features || {}) as Record<string, unknown>;
          const p: PerfilLocal = {
            id: profile.id,
            nome: profile.nome,
            exige_foto: profile.exige_foto,
            features,
            mostra_saldo_app: !!profile.mostra_saldo_app,
          };
          setPerfil(p);
          localStorage.setItem("coleta_perfil_id", p.id);
          localStorage.setItem("coleta_perfil_nome", p.nome);
          localStorage.setItem("coleta_perfil_exige_foto", String(p.exige_foto));
          localStorage.setItem("coleta_perfil_features", JSON.stringify(features));
          localStorage.setItem(
            "coleta_perfil_mostra_saldo",
            String(p.mostra_saldo_app)
          );
          sessionStorage.setItem("coleta_exige_foto", String(p.exige_foto));
          sessionStorage.setItem("coleta_motorista_id", p.id);
          sessionStorage.setItem("coleta_motorista_nome", p.nome);
          setCarregando(false);

          if (features.carga) {
            const c = await fetchCargaAtiva(profile.id);
            setCarga(c);
          } else {
            setCarga(null);
          }
        } catch {
          if (cachedFeatures?.carga && cachedId) {
            setCarga(getCargaAtivaCached(cachedId) ?? null);
          }
          if (!cachedId) setCarregando(false);
        }
      } else if (!cachedId) {
        router.push("/motorista/login");
      }
    };
    carregar();
  }, [router]);

  // Gate: features.carga ligado + resolvido SEM carga → obriga iniciar
  useEffect(() => {
    if (perfil?.features?.carga && carga === null && !carregando) {
      router.push("/motorista/iniciar-carga");
    }
  }, [perfil, carga, carregando, router]);

  // Barra do caminhão: litros da carga (servidor snapshot + locais)
  useEffect(() => {
    if (!carga || !perfil) return;
    resumoCargaAtiva(carga.id, perfil.id).then((r) => setLitrosCarga(r.litros));
  }, [carga, perfil, pendentes]);

  if (carregando || !perfil) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-cinza-suave text-xl">Carregando...</p>
      </main>
    );
  }

  const temCarga = !!carga;
  const usaFluxoCarga = !!perfil.features?.carga;

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <EventLogger motoristaId={perfil.id} />
      <header className="flex items-center justify-between mb-6 mt-2">
        <h1 className="text-2xl font-bold">Olá, {perfil.nome}</h1>
        <MenuLogout nome={perfil.nome} motoristaId={perfil.id} />
      </header>

      {/* Tela de aceite de adiantamento — só pra quem tem a feature "saldo"
          ligada. Protege motorista real de ver tela estranha se alguém enviar
          adiantamento por engano antes da feature ser promovida. */}
      {!!perfil.features?.saldo && (
        <AdiantamentoBlocking motoristaId={perfil.id} />
      )}

      <InstallPrompt />

      {perfil.mostra_saldo_app && <CardSaldo motoristaId={perfil.id} />}

      {usaFluxoCarga && temCarga && carga && (
        <BarraCaminhao carga={carga} litrosCarregados={litrosCarga} />
      )}

      <Link href="/motorista/nova-coleta" className="block mb-4">
        <div className="bg-verde rounded-3xl p-10 text-center shadow-lg active:bg-verde-escuro transition-colors">
          <div className="text-6xl mb-2">➕</div>
          <p className="text-white text-3xl font-bold">NOVA COLETA</p>
        </div>
      </Link>

      {usaFluxoCarga && temCarga && (
        <>
          <Link href="/motorista/descarregar" className="block mb-4">
            <div className="bg-red-500 rounded-3xl p-8 text-center shadow-lg active:bg-red-600 transition-colors">
              <div className="text-5xl mb-1">🏁</div>
              <p className="text-white text-2xl font-bold">DESCARREGAR</p>
            </div>
          </Link>

          <Link href="/motorista/menu-carga" className="block mb-4">
            <div className="bg-slate-100 rounded-3xl p-6 text-center border-2 border-slate-200 active:bg-slate-200 transition-colors">
              <p className="text-slate-800 text-xl font-bold">≡ MENU CARGA</p>
            </div>
          </Link>
        </>
      )}

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
