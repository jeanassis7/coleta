"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDB } from "@/lib/db/dexie";
import { formatBRL, formatLitros } from "@/lib/format";

function ConfirmacaoConteudo() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cid = searchParams.get("cid");
  const [contador, setContador] = useState(8);

  const coleta = useLiveQuery(async () => {
    if (!cid) return null;
    const db = getLocalDB();
    return db.coletas_locais.get(cid);
  }, [cid]);

  useEffect(() => {
    if (contador <= 0) {
      router.push("/motorista");
      return;
    }
    const t = setTimeout(() => setContador((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [contador, router]);

  if (!coleta) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-cinza-suave text-xl">Carregando...</p>
      </main>
    );
  }

  const enviada = coleta.registro_subido && coleta.foto_subida;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="text-9xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-6">Coleta salva!</h1>
        <div className="card text-left mb-4">
          <p className="text-xl font-semibold">
            {formatLitros(coleta.litros)} · {coleta.local_nome}
          </p>
          <p className="text-xl font-semibold text-verde mt-1">
            {formatBRL(coleta.valor_pago)}
          </p>
        </div>
        <p className="text-lg mt-4">
          {enviada ? "☁️ Enviado" : "📱 Salvo no celular"}
        </p>
      </div>

      <div className="w-full space-y-3">
        <button
          onClick={() => router.push("/motorista/nova-coleta")}
          className="btn-primario"
        >
          NOVA COLETA
        </button>
        <button
          onClick={() => router.push("/motorista")}
          className="btn-secundario"
        >
          IR PRO INÍCIO ({contador}s)
        </button>
      </div>
    </main>
  );
}

export default function ConfirmacaoPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-cinza-suave text-xl">Carregando...</p>
        </main>
      }
    >
      <ConfirmacaoConteudo />
    </Suspense>
  );
}
