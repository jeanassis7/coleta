"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Curadoria do posto: renomear e juntar grafias.
 *
 * O merge SEMPRE absorve o outro posto NESTE — o que você está olhando é o
 * que sobrevive. Sem escolher "quem ganha" numa lista, não existe o clique
 * errado que apaga o posto certo.
 */
export function CuradoriaPosto({
  postoId,
  nomeAtual,
  outros,
}: {
  postoId: string;
  nomeAtual: string;
  outros: { id: string; nome: string; notas: number }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(nomeAtual);
  const [outroId, setOutroId] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const escolhido = outros.find((o) => o.id === outroId);

  async function chamar(corpo: Record<string, unknown>) {
    setErro(null);
    setOk(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/postos/${postoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não deu");
        setConfirmando(false);
        return null;
      }
      router.refresh();
      return r;
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="text-sm text-cinza-suave hover:text-verde"
      >
        ✎ Corrigir nome ou juntar postos
      </button>
    );
  }

  return (
    <div className="card space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Curadoria do posto</h3>
        <button
          onClick={() => setAberto(false)}
          className="text-sm text-cinza-suave hover:text-cinza-texto"
        >
          fechar
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Nome do posto</label>
        <div className="flex gap-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="flex-1 px-3 py-2 border border-cinza-borda rounded-xl"
          />
          <button
            onClick={async () => {
              const r = await chamar({ acao: "renomear", nome });
              if (r) setOk("Nome corrigido. O antigo virou apelido.");
            }}
            disabled={salvando || nome.trim() === nomeAtual || nome.trim().length < 2}
            className="px-4 py-2 rounded-xl bg-verde text-white text-sm font-semibold disabled:bg-cinza-borda disabled:text-cinza-suave"
          >
            Salvar
          </button>
        </div>
        <p className="text-xs text-cinza-suave mt-1">
          O nome antigo continua valendo como apelido — quem digitar ele ainda
          cai neste posto.
        </p>
      </div>

      {outros.length > 0 && (
        <div className="border-t border-cinza-borda pt-4">
          <label className="block text-sm font-medium mb-1">
            Juntar outro posto neste
          </label>
          <select
            value={outroId}
            onChange={(e) => {
              setOutroId(e.target.value);
              setConfirmando(false);
            }}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">— escolha o posto que é o mesmo que este —</option>
            {outros.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome} ({o.notas} {o.notas === 1 ? "nota" : "notas"})
              </option>
            ))}
          </select>

          {escolhido && (
            <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3 mt-3 text-sm">
              <p className="font-bold mb-1">O que vai acontecer</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>
                  As <strong>{escolhido.notas}</strong>{" "}
                  {escolhido.notas === 1 ? "nota" : "notas"} de{" "}
                  <strong>{escolhido.nome}</strong> passam para{" "}
                  <strong>{nomeAtual}</strong>.
                </li>
                <li>
                  &ldquo;{escolhido.nome}&rdquo; vira apelido deste posto.
                </li>
                <li>
                  O posto <strong>{escolhido.nome}</strong> deixa de existir.
                </li>
              </ul>
              <p className="mt-2 text-xs">
                Nenhuma dívida é apagada — ela só muda de posto. Isso não tem
                desfazer automático.
              </p>
            </div>
          )}

          <button
            onClick={async () => {
              if (!confirmando) {
                setConfirmando(true);
                return;
              }
              const r = await chamar({ acao: "juntar", outro_id: outroId });
              if (r) {
                setOutroId("");
                setConfirmando(false);
                setOk(
                  `Juntado: ${r.notas_movidas} nota(s) vieram de "${r.virou_apelido}".`
                );
              }
            }}
            disabled={salvando || !outroId}
            className={`w-full mt-3 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:bg-cinza-borda disabled:text-cinza-suave ${
              confirmando ? "bg-amber-500" : "bg-verde"
            }`}
          >
            {salvando
              ? "Juntando..."
              : confirmando
                ? `CONFIRMAR: juntar "${escolhido?.nome}" em "${nomeAtual}"`
                : "Juntar"}
          </button>
        </div>
      )}

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}
      {ok && (
        <div className="bg-verde/10 border border-verde text-verde rounded-xl p-3 text-sm">
          {ok}
        </div>
      )}
    </div>
  );
}
