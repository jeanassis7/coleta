import { getSupabaseServer } from "@/lib/supabase/server";
import { kmAtualPorCaminhao } from "@/lib/admin/frota";
import { labelDocumento, situacaoDocumento } from "@/lib/documentos";
import type { Alerta } from "@/lib/admin/alertas";

/**
 * Alertas de frota, documentos, cheque e estoque.
 *
 * Módulo separado do `alertas.ts` porque aquele arquivo já passa de 500
 * linhas e este assunto (o que vence) não se cruza com o de lá (o que o
 * motorista lançou).
 *
 * Mesmo tom didático do resto: o que aconteceu → por que pode ter
 * acontecido → o que fazer. Alerta que só acusa ensina a ignorar alerta.
 */

const real = (n: number) =>
  `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function formatData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export async function alertasFrota(): Promise<Alerta[]> {
  const supabase = await getSupabaseServer();
  const alertas: Alerta[] = [];

  // -------------------------------------------------------------------
  // Documento vencido ou vencendo — caminhão e motorista
  // -------------------------------------------------------------------
  try {
    const [{ data: docs }, { data: caminhoes }, { data: perfis }] =
      await Promise.all([
        supabase.from("documentos").select("*").order("vencimento"),
        supabase.from("caminhoes").select("id, placa"),
        supabase.from("profiles").select("id, nome"),
      ]);

    const placa = new Map(
      ((caminhoes as { id: string; placa: string }[]) ?? []).map((c) => [
        c.id,
        c.placa,
      ])
    );
    const nome = new Map(
      ((perfis as { id: string; nome: string }[]) ?? []).map((p) => [
        p.id,
        p.nome,
      ])
    );

    for (const d of (docs as {
      id: string;
      caminhao_id: string | null;
      motorista_id: string | null;
      tipo: string;
      descricao: string | null;
      vencimento: string;
      alerta_dias: number;
    }[]) ?? []) {
      const { situacao, dias } = situacaoDocumento(
        d.vencimento,
        d.alerta_dias
      );
      if (situacao === "ok") continue;

      const doQue = d.caminhao_id
        ? `do caminhão ${placa.get(d.caminhao_id) ?? "—"}`
        : `de ${nome.get(d.motorista_id ?? "") ?? "—"}`;
      const href = d.caminhao_id
        ? `/admin/caminhoes/${d.caminhao_id}`
        : `/admin/motoristas/${d.motorista_id}`;
      const doc = labelDocumento(d.tipo, d.descricao);

      alertas.push({
        // O vencimento entra na chave: renovou o documento (vencimento novo)
        // = ocorrência nova = o alerta volta a valer no próximo ciclo. Sem
        // isso, um "OK, VI" na CNH de 2026 silenciava a de 2031 pra sempre.
        // A situação também entra: dispensar o "vencendo" amarelo não pode
        // engolir o "vencido" vermelho do mesmo ciclo.
        chave: `documento:${d.id}:${d.vencimento}:${situacao}`,
        icone: situacao === "vencido" ? "🚨" : "📄",
        severidade: situacao === "vencido" ? "alta" : "media",
        titulo:
          situacao === "vencido"
            ? `${doc} vencido`
            : `${doc} vencendo`,
        texto:
          situacao === "vencido"
            ? `O ${doc} ${doQue} venceu em ${formatData(d.vencimento)} — ` +
              `${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"} atrás. ` +
              `Documento vencido pega multa em fiscalização e, dependendo do ` +
              `caso, o veículo não roda. Se já renovou, é só cadastrar a data ` +
              `nova na ficha que este aviso some.`
            : `O ${doc} ${doQue} vence em ${formatData(d.vencimento)}` +
              (dias === 0
                ? " — hoje."
                : `, daqui a ${dias} dia${dias === 1 ? "" : "s"}.`) +
              ` Dá pra resolver sem correria agora. Depois de renovar, ` +
              `atualize a data na ficha.`,
        link: { href, label: "Abrir ficha" },
        data: d.vencimento,
      });
    }
  } catch {
    // segue
  }

  // -------------------------------------------------------------------
  // Caminhão passou da troca de óleo — por KM ou por DATA (0043), o que
  // vencer PRIMEIRO manda.
  // -------------------------------------------------------------------
  try {
    const [{ data: trocas }, { data: caminhoes }, kmAtual] = await Promise.all([
      supabase
        .from("manutencoes")
        .select("caminhao_id, proxima_km, proxima_data, criado_em")
        .eq("tipo", "troca_oleo")
        .or("proxima_km.not.is.null,proxima_data.not.is.null")
        .order("criado_em", { ascending: false }),
      supabase.from("caminhoes").select("id, placa, ativo"),
      kmAtualPorCaminhao(),
    ]);

    // A troca que vale é a MAIS RECENTE lançada de cada caminhão — é ela
    // que carrega o alvo atual (km e/ou data).
    const alvo = new Map<string, { km: number | null; data: string | null }>();
    for (const t of (trocas as {
      caminhao_id: string;
      proxima_km: number | null;
      proxima_data: string | null;
    }[]) ?? []) {
      if (!alvo.has(t.caminhao_id)) {
        alvo.set(t.caminhao_id, { km: t.proxima_km, data: t.proxima_data });
      }
    }

    const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    for (const c of (caminhoes as {
      id: string;
      placa: string;
      ativo: boolean;
    }[]) ?? []) {
      if (!c.ativo) continue;
      const a = alvo.get(c.id);
      if (!a) continue;
      const km = kmAtual.get(c.id);

      const passouKm = a.km != null && km != null && km > a.km;
      const passouData = a.data != null && hojeBr > a.data;
      if (!passouKm && !passouData) continue;

      const motivo = passouKm
        ? `a próxima estava marcada pra ${a.km!.toLocaleString("pt-BR")} km e o caminhão já está em ${km!.toLocaleString("pt-BR")} km — ${(km! - a.km!).toLocaleString("pt-BR")} km a mais`
        : `a próxima estava marcada pra ${formatData(a.data!)} e já passou`;

      alertas.push({
        chave: `troca_oleo:${c.id}:${a.km ?? ""}:${a.data ?? ""}`,
        icone: "🛢️",
        severidade: "media",
        titulo: `${c.placa} passou da troca de óleo`,
        texto:
          `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. ` +
          `Pode ser que a troca já tenha sido feita e só não foi lançada. ` +
          `Se foi, lance na ficha do caminhão que o aviso some.`,
        link: { href: `/admin/caminhoes/${c.id}`, label: "Abrir ficha" },
      });
    }
  } catch {
    // segue
  }

  // -------------------------------------------------------------------
  // Cheque que passou do "bom para" e continua na carteira
  // -------------------------------------------------------------------
  // Só este. "Bom para esta semana" e "devolvido sem resolver" foram
  // removidos a pedido do Evaner (19/08/2026): o primeiro avisa de algo que
  // ele já sabe pela agenda, e o segundo de algo que ele resolve na hora —
  // os dois viravam ruído na tela do dashboard.
  //
  // ⚠️ O status é 'em_carteira', não 'carteira'. Errar aqui não dá erro
  // nenhum: só faz o alerta nunca acender.
  try {
    const { data: cheques } = await supabase
      .from("cheques")
      .select("id, banco, emitente, valor, bom_para")
      .eq("status", "em_carteira");

    const hoje = new Date();
    const hojeIso = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
    );

    for (const ch of (cheques as {
      id: string;
      banco: string | null;
      emitente: string | null;
      valor: number;
      bom_para: string;
    }[]) ?? []) {
      const dias = Math.round(
        (new Date(`${ch.bom_para.slice(0, 10)}T00:00:00Z`).getTime() -
          hojeIso.getTime()) /
          86_400_000
      );
      if (dias >= 0) continue;

      const quem = ch.emitente || ch.banco || "sem emitente";
      alertas.push({
        chave: `cheque_vencido:${ch.id}`,
        icone: "🏦",
        severidade: "alta",
        titulo: "Cheque passou do bom para e continua na carteira",
        texto:
          `O cheque de ${quem}, ${real(Number(ch.valor))}, era bom para ` +
          `${formatData(ch.bom_para)} — ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"} ` +
          `atrás — e ainda não foi depositado nem repassado. Pode ser só que o ` +
          `depósito não foi lançado aqui. Se já depositou, marque na tela de cheques.`,
        link: { href: "/admin/cheques", label: "Ver cheques" },
        data: ch.bom_para,
      });
    }
  } catch {
    // segue
  }

  // -------------------------------------------------------------------
  // Estoque negativo
  // -------------------------------------------------------------------
  try {
    const { data: estoque } = await supabase.rpc("estoque_atual");
    for (const e of (estoque as {
      tipo_oleo: string;
      saldo_kg: number;
    }[]) ?? []) {
      const saldo = Number(e.saldo_kg);
      if (saldo >= 0) continue;
      alertas.push({
        chave: `estoque_negativo:${e.tipo_oleo}`,
        icone: "📉",
        severidade: "media",
        titulo: `Estoque de ${e.tipo_oleo} está negativo`,
        texto:
          `A conta do estoque de ${e.tipo_oleo} deu ${saldo.toLocaleString("pt-BR")} kg, ` +
          `ou seja, saiu mais do que o sistema sabe que entrou. Isso quase ` +
          `sempre é entrada que não foi lançada — uma descarga, uma compra ` +
          `direta — e não venda errada. É sinal de que está na hora de contar ` +
          `o tanque e lançar o inventário: a contagem vira a nova base e o ` +
          `número volta a bater.`,
        link: { href: "/admin/estoque", label: "Ver estoque" },
      });
    }
  } catch {
    // segue
  }

  return alertas;
}
