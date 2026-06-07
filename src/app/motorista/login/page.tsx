"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { logEvent } from "@/lib/events/log";
import { rotateSessionId } from "@/lib/device/device-id";

export default function MotoristaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Se já tem sessão local, manda direto pra Home (funciona offline também)
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.push("/motorista");
      }
    });
  }, [router]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!navigator.onLine) {
      setErro(
        "Sem internet. O primeiro login precisa de conexão (4G ou Wi-Fi). Depois que entrar uma vez, o app funciona offline normalmente."
      );
      return;
    }

    setCarregando(true);

    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error || !data.user) {
      const msg = error?.message?.toLowerCase() || "";
      if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("err_")) {
        setErro(
          "Não consegui falar com o servidor. Verifica a internet e tenta de novo."
        );
      } else if (msg.includes("invalid login")) {
        setErro("Email ou senha errado. Tenta de novo.");
      } else if (error?.message) {
        setErro(error.message);
      } else {
        setErro("Não consegui entrar. Tenta de novo.");
      }
      setCarregando(false);
      return;
    }

    // Verifica role — motorista não pode entrar pelo admin
    const { data: profile, error: errProfile } = await supabase
      .from("profiles")
      .select("role, ativo")
      .eq("id", data.user.id)
      .maybeSingle();

    if (errProfile) {
      setErro("Conectei mas não consegui pegar seu perfil. Tenta de novo.");
      setCarregando(false);
      return;
    }

    if (!profile || !profile.ativo) {
      await supabase.auth.signOut();
      setErro("Conta desativada. Fale com o Jean.");
      setCarregando(false);
      return;
    }

    if (profile.role === "admin") {
      router.push("/admin");
      return;
    }

    rotateSessionId();
    await logEvent(data.user.id, "login", { via: "motorista" });
    router.push("/motorista");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-block mb-4">
            <img
              src="/icons/icon-192.png"
              alt="Coleta"
              className="w-32 h-32 rounded-3xl shadow-lg"
            />
          </div>
          <h1 className="text-3xl font-bold text-cinza-texto">Coleta</h1>
        </div>

        {!online && (
          <div className="bg-atencao/10 border-2 border-atencao rounded-2xl p-4 mb-4 text-center">
            <p className="text-base font-medium text-cinza-texto">
              📵 Sem internet
            </p>
            <p className="text-sm text-cinza-suave mt-1">
              O primeiro login precisa de conexão. Conecta em 4G ou Wi-Fi e tenta.
            </p>
          </div>
        )}

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="block text-lg font-medium mb-2">Email</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              className="input-grande"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-lg font-medium mb-2">Senha</label>
            <div className="relative">
              <input
                type={verSenha ? "text" : "password"}
                autoComplete="current-password"
                className="input-grande pr-16"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setVerSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl"
                aria-label="Mostrar/esconder senha"
              >
                {verSenha ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {erro && (
            <div className="bg-alerta/10 border border-alerta text-alerta rounded-2xl p-4 text-center text-lg font-medium">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={carregando || !email || !senha}
            className="btn-primario"
          >
            {carregando ? "Entrando..." : "ENTRAR"}
          </button>
        </form>
      </div>
    </main>
  );
}
