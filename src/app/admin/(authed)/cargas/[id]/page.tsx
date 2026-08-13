import Link from "next/link";
import nextDynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { buscarCargaCompleta } from "@/lib/admin/queries";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";
import { formatBRL, formatDataHora } from "@/lib/format";
import { LinhaDoTempoCarga } from "@/components/admin/LinhaDoTempoCarga";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { AdicionarColetaNaCarga } from "@/components/admin/AdicionarColetaNaCarga";
import type { PontoCarga } from "@/components/admin/MapaCarga";

const MapaCarga = nextDynamic(() => import("@/components/admin/MapaCarga"), {
  ssr: false,
  loading: () => (
    <div className="bg-slate-100 h-[420px] rounded-xl animate-pulse" />
  ),
});

export const dynamic = "force-dynamic";

export default async function CargaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirAcessoModulo1OuRedirect();
  const { id } = await params;
  const carga = await buscarCargaCompleta(id);
  if (!carga) notFound();

  const gastoColetas = carga.coletas.reduce((s, c) => s + Number(c.valor_pago), 0);
  const gastoDespesas = carga.despesas.reduce((s, d) => s + Number(d.valor), 0);
  const gastoAbast = carga.abastecimentos.reduce((s, a) => s + Number(a.valor), 0);
  const litrosCombustivel = carga.abastecimentos.reduce(
    (s, a) => s + Number(a.litros),
    0
  );
  const gastoTotal = gastoColetas + gastoDespesas + gastoAbast;
  const litrosDeclarados = carga.coletas.reduce((s, c) => s + Number(c.litros), 0);
  const pesoLiquido = carga.descarga?.peso_liquido_kg ?? null;
  const custoPorKg = pesoLiquido && pesoLiquido > 0 ? gastoTotal / pesoLiquido : null;
  const kmRodado =
    carga.km_final !== null && carga.km_final > carga.km_inicial
      ? carga.km_final - carga.km_inicial
      : null;
  const pctCheio =
    carga.capacidade_l > 0
      ? Math.round((litrosDeclarados / carga.capacidade_l) * 100)
      : 0;

  // Pontos do trajeto em ordem cronológica (só o que tem GPS)
  const pontos: PontoCarga[] = [
    ...carga.coletas.map((c) => ({
      tipo: "coleta" as const,
      latitude: c.latitude,
      longitude: c.longitude,
      quando: c.criado_em,
      titulo: c.local_nome,
      detalhe: `${Number(c.litros).toLocaleString("pt-BR")} L · ${formatBRL(Number(c.valor_pago))}`,
    })),
    ...carga.abastecimentos.map((a) => ({
      tipo: "abastecimento" as const,
      latitude: a.latitude,
      longitude: a.longitude,
      quando: a.criado_em,
      titulo: a.posto_nome,
      detalhe: `${Number(a.litros).toLocaleString("pt-BR")} L · ${formatBRL(Number(a.valor))}`,
    })),
    ...carga.despesas.map((d) => ({
      tipo: "despesa" as const,
      latitude: d.latitude,
      longitude: d.longitude,
      quando: d.criado_em,
      titulo: d.descricao,
      detalhe: formatBRL(Number(d.valor)),
    })),
    ...(carga.descarga
      ? [
          {
            tipo: "descarga" as const,
            latitude: carga.descarga.latitude,
            longitude: carga.descarga.longitude,
            quando: carga.descarga.criado_em,
            titulo: "Descarga",
            detalhe: `${carga.descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg líquidos`,
          },
        ]
      : []),
  ]
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .sort((a, b) => a.quando.localeCompare(b.quando))
    .map((p, i) => ({
      tipo: p.tipo,
      ordem: i + 1,
      latitude: p.latitude as number,
      longitude: p.longitude as number,
      titulo: p.titulo,
      detalhe: p.detalhe,
      quando: formatDataHora(p.quando),
    }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link href="/admin/cargas" className="text-cinza-suave hover:text-verde">
          ← Cargas
        </Link>
        <h1 className="text-2xl font-bold">
          Carga de {carga.motorista_nome}
          {carga.motorista_is_teste && <span title="Motorista de teste"> 🧪</span>}
        </h1>
        <StatusBadge status={carga.status} />
      </div>

      {/* Cabeçalho */}
      <div className="card mb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Info
          rotulo="Caminhão"
          valor={`${carga.caminhao_placa} ${carga.caminhao_marca} ${carga.caminhao_cor}`}
        />
        <Info rotulo="Início" valor={formatDataHora(carga.iniciada_em)} />
        <Info
          rotulo="Fim"
          valor={
            carga.encerrada_em ? formatDataHora(carga.encerrada_em) : "em andamento"
          }
        />
        <div>
          <p className="text-cinza-suave text-xs">Km rodado</p>
          <p className="font-medium">
            {kmRodado !== null
              ? `${kmRodado.toLocaleString("pt-BR")} km`
              : `saiu com ${carga.km_inicial.toLocaleString("pt-BR")}`}
          </p>
          {/* Foto do odômetro tirada ao iniciar a carga — é a prova do km
              declarado. Antes ficava só guardada, sem ninguém poder ver. */}
          {carga.foto_painel_path && (
            <p className="text-xs mt-1">
              <VisualizadorFoto
                path={carga.foto_painel_path}
                legenda={`Painel no início da carga · ${carga.km_inicial.toLocaleString("pt-BR")} km · ${formatDataHora(carga.iniciada_em)}`}
              />{" "}
              <span className="text-cinza-suave">foto do painel</span>
            </p>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi rotulo="Gasto em coletas" valor={formatBRL(gastoColetas)} />
        <Kpi rotulo="Combustível" valor={formatBRL(gastoAbast)} />
        <Kpi rotulo="Outras despesas" valor={formatBRL(gastoDespesas)} />
        <Kpi rotulo="Total da carga" valor={formatBRL(gastoTotal)} destaque />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          rotulo="Litros declarados"
          valor={`${litrosDeclarados.toLocaleString("pt-BR")} L`}
          nota={carga.capacidade_l > 0 ? `${pctCheio}% do tanque` : undefined}
        />
        <Kpi
          rotulo="Peso na balança"
          valor={
            pesoLiquido !== null
              ? `${pesoLiquido.toLocaleString("pt-BR")} kg`
              : "—"
          }
          nota={
            carga.descarga?.umidade_pct !== null &&
            carga.descarga?.umidade_pct !== undefined
              ? `umidade ${carga.descarga.umidade_pct}%`
              : carga.descarga
                ? "umidade pendente"
                : "sem descarga ainda"
          }
        />
        <Kpi
          rotulo="Custo por kg"
          valor={custoPorKg !== null ? formatBRL(custoPorKg) : "—"}
          nota={custoPorKg === null ? "só após descarregar" : undefined}
        />
        <Kpi
          rotulo="Consumo"
          valor={
            kmRodado !== null && litrosCombustivel > 0
              ? `${(kmRodado / litrosCombustivel).toFixed(2).replace(".", ",")} km/L`
              : "—"
          }
          nota={
            kmRodado === null
              ? "falta o km final"
              : litrosCombustivel === 0
                ? "sem abastecimento lançado"
                : `${litrosCombustivel.toLocaleString("pt-BR")} L de diesel`
          }
        />
      </div>

      {/* Trajeto */}
      {pontos.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">🗺 Trajeto da carga</h2>
          <p className="text-sm text-cinza-suave mb-2">
            Cada parada numerada na ordem em que aconteceu. A linha é reta entre
            os pontos — não é o caminho das ruas.
          </p>
          <MapaCarga pontos={pontos} />
        </div>
      )}

      {/* Linha do tempo */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h2 className="text-lg font-semibold">📋 Tudo que aconteceu</h2>
        <AdicionarColetaNaCarga
          cargaId={carga.id}
          motoristaNome={carga.motorista_nome}
          dataSugerida={new Date(
            new Date(carga.encerrada_em || carga.iniciada_em).getTime() -
              3 * 60 * 60 * 1000
          )
            .toISOString()
            .slice(0, 16)}
        />
      </div>
      <p className="text-sm text-cinza-suave mb-3">
        Em ordem cronológica. Clique em 📷 pra ver a foto de cada lançamento.
      </p>
      <LinhaDoTempoCarga carga={carga} />
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-cinza-suave text-xs">{rotulo}</p>
      <p className="font-medium">{valor}</p>
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div className={`card ${destaque ? "border-verde border-2" : ""}`}>
      <p className="text-xs text-cinza-suave">{rotulo}</p>
      <p className="text-xl font-bold font-mono">{valor}</p>
      {nota && <p className="text-xs text-cinza-suave mt-0.5">{nota}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ativa"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : status === "encerrada"
        ? "bg-green-100 text-green-800 border-green-300"
        : "bg-slate-100 text-slate-600 border-slate-300";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}
