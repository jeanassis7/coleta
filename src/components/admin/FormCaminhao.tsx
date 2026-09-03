"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Caminhao } from "@/lib/admin/queries";

/**
 * Form de criar/editar VEÍCULO. Se receber prop `editando`, entra em modo edição.
 * Layout desktop-first (3 colunas). Motorista nunca vê essa tela.
 *
 * Caminhão × carro: a 0018 criou o tipo e deixou tanque e tara nulos pro
 * carro, mas o formulário e a rota nunca souberam disso — todo veículo
 * nascia caminhão e travava pedindo a capacidade do tanque de óleo. Uma
 * EcoSport não tem tanque de óleo (achado do Evaner, 03/09/2026).
 *
 * Carro nunca aparece pro motorista escolher ao iniciar carga — a RLS da
 * 0018 barra isso no banco, não só na query.
 */
export function FormCaminhao({
  editando,
  onFim,
}: {
  editando?: Caminhao | null;
  onFim?: () => void;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [placa, setPlaca] = useState(editando?.placa || "");
  const [marca, setMarca] = useState(editando?.marca || "");
  const [modelo, setModelo] = useState(editando?.modelo || "");
  const [cor, setCor] = useState(editando?.cor || "");
  const [capacidadeL, setCapacidadeL] = useState(
    editando?.capacidade_l != null ? String(editando.capacidade_l) : ""
  );
  const [taraKg, setTaraKg] = useState(
    editando?.tara_kg != null ? String(editando.tara_kg) : ""
  );
  const [tipo, setTipo] = useState<"caminhao" | "carro">(
    (editando?.tipo as "caminhao" | "carro") || "caminhao"
  );
  const [deQuem, setDeQuem] = useState(editando?.de_quem || "");
  const ehCarro = tipo === "carro";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const body = {
        placa: placa.trim().toUpperCase(),
        marca: marca.trim(),
        modelo: modelo.trim() || null,
        cor: cor.trim(),
        tipo,
        de_quem: deQuem.trim() || null,
        capacidade_l: ehCarro ? null : Number(capacidadeL),
        tara_kg: ehCarro ? null : Number(taraKg),
      };
      const url = editando
        ? `/api/admin/caminhoes/${editando.id}`
        : `/api/admin/caminhoes`;
      const method = editando ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro desconhecido");
        return;
      }
      if (!editando) {
        setPlaca("");
        setMarca("");
        setModelo("");
        setCor("");
        setCapacidadeL("");
        setTaraKg("");
      }
      router.refresh();
      onFim?.();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      onSubmit={salvar}
      className="card space-y-4"
    >
      <h2 className="text-lg font-semibold">
        {editando ? `Editar ${editando.placa}` : "Novo veículo"}
      </h2>

      <div className="flex gap-2">
        {(
          [
            ["caminhao", "🚛 Caminhão"],
            ["carro", "🚗 Carro"],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTipo(v)}
            className={`px-4 py-2 rounded-xl border-2 text-sm font-medium ${
              tipo === v
                ? "bg-verde text-white border-verde"
                : "bg-white border-cinza-borda"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      {ehCarro && (
        <p className="text-sm text-cinza-suave">
          Carro serve pra lançar gasto (abastecimento, manutenção) e não
          aparece pro motorista escolher ao iniciar carga.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Placa</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl uppercase"
            placeholder="AAA-0000 ou AAA1B23"
            value={placa}
            onChange={(e) => setPlaca(e.target.value)}
            required
            maxLength={8}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Marca</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            placeholder="Iveco, Volvo, Mercedes..."
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Modelo{" "}
            <span className="text-cinza-suave font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            placeholder="Tector, FH, Atego..."
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Cor</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            placeholder="Branco, Vermelho, Prata..."
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            required
          />
        </div>
        {ehCarro ? (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">
              De quem é{" "}
              <span className="text-cinza-suave font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              placeholder="Jean, Valdecir..."
              value={deQuem}
              onChange={(e) => setDeQuem(e.target.value)}
            />
          </div>
        ) : (
          <>
        <div>
          <label className="block text-sm font-medium mb-1">
            Capacidade do tanque de óleo (L)
          </label>
          <input
            type="number"
            inputMode="numeric"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            placeholder="18000"
            value={capacidadeL}
            onChange={(e) => setCapacidadeL(e.target.value)}
            required
            min={1}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Tara (kg)</label>
          <input
            type="number"
            inputMode="numeric"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            placeholder="8500"
            value={taraKg}
            onChange={(e) => setTaraKg(e.target.value)}
            required
            min={1}
          />
          <p className="text-xs text-cinza-suave mt-1">
            Média de pesos do caminhão vazio
          </p>
        </div>
          </>
        )}
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        {editando && (
          <button
            type="button"
            onClick={() => onFim?.()}
            className="px-4 py-2 rounded-xl border border-cinza-borda hover:bg-slate-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={salvando}
          className="px-6 py-2 rounded-xl bg-verde text-white font-medium hover:bg-verde/90 disabled:opacity-50"
        >
          {salvando
            ? "Salvando..."
            : editando
              ? "Salvar alterações"
              : ehCarro
                ? "Cadastrar carro"
                : "Cadastrar caminhão"}
        </button>
      </div>
    </form>
  );
}
