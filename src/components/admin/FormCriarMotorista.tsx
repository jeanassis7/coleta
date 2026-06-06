"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FormCriarMotorista() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<"motorista" | "admin">("motorista");
  const [erro, setErro] = useState<string | null>(null);

  // Auto-gera email a partir do nome
  function handleNomeChange(v: string) {
    setNome(v);
    if (!email.includes("@") || email.endsWith("@coleta.local")) {
      const primeiro = v.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
      if (primeiro) setEmail(`${primeiro}@coleta.local`);
    }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/admin/motoristas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, senha, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "Falha ao criar");
        return;
      }
      setNome("");
      setEmail("");
      setSenha("");
      setRole("motorista");
      setAberto(false);
      router.refresh();
    } catch (err) {
      setErro(String(err));
    } finally {
      setCarregando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde-escuro"
      >
        + Adicionar motorista
      </button>
    );
  }

  return (
    <form onSubmit={criar} className="card space-y-3 max-w-md">
      <h3 className="font-semibold mb-2">Novo motorista</h3>
      <div>
        <label className="block text-sm font-medium mb-1">Nome</label>
        <input
          type="text"
          className="input-grande text-base"
          value={nome}
          onChange={(e) => handleNomeChange(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          className="input-grande text-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Senha temporária</label>
        <input
          type="text"
          className="input-grande text-base"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          minLength={6}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Tipo</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "motorista" | "admin")}
          className="input-grande text-base"
        >
          <option value="motorista">Motorista</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={carregando}
          className="px-4 py-2 bg-verde text-white rounded-xl font-medium"
        >
          {carregando ? "Criando..." : "Criar"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="px-4 py-2 bg-slate-100 rounded-xl"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
