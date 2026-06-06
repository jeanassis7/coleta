"use client";

import { useState } from "react";
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

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);

    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error || !data.user) {
      setErro("Email ou senha errado. Tenta de novo.");
      setCarregando(false);
      return;
    }

    // Verifica role — motorista não pode entrar pelo admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, ativo")
      .eq("id", data.user.id)
      .maybeSingle();

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
