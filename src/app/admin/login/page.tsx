"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

function LoginConteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const erroQuery = params.get("erro");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(
    erroQuery === "acesso" ? "Acesso negado — essa conta não é admin." : null
  );

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
      setErro("Email ou senha inválidos.");
      setCarregando(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, ativo")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin" || !profile.ativo) {
      await supabase.auth.signOut();
      setErro("Acesso negado — essa conta não é admin.");
      setCarregando(false);
      return;
    }

    router.push("/admin");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-100">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-cinza-borda p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Painel Admin</h1>
        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="block text-base font-medium mb-2">Email</label>
            <input
              type="email"
              autoComplete="username"
              className="input-grande"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-base font-medium mb-2">Senha</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input-grande"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>
          {erro && (
            <div className="bg-alerta/10 border border-alerta text-alerta rounded-2xl p-3 text-center font-medium">
              {erro}
            </div>
          )}
          <button
            type="submit"
            disabled={carregando}
            className="btn-primario"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginConteudo />
    </Suspense>
  );
}
