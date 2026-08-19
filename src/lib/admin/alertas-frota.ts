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
        chave: `documento:${d.id}`,
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
  // Caminhão passou do km da próxima troca de óleo
  // -------------------------------------------------------------------
  try {
    const [{ data: trocas }, { data: caminhoes }, kmAtual] = await Promise.all([
      supabase
        .from("manutencoes")
        .select("caminhao_id, proxima_km")
        .eq("tipo", "troca_oleo")
        .not("proxima_km", "is", null),
      supabase.from("caminhoes").select("id, placa, ativo"),
      kmAtualPorCaminhao(),
    ]);

    // A troca que vale é a de MAIOR proxima_km: se houve três, a última manda.
    const alvo = new Map<string, number>();
    for (const t of (trocas as { caminhao_id: string; proxima_km: number }[]) ??
      []) {
      if ((alvo.get(t.caminhao_id) ?? 0) < t.proxima_km) {
        alvo.set(t.caminhao_id, t.proxima_km);
      }
    }

    for (const c of (caminhoes as {
      id: string;
      placa: string;
      ativo: boolean;
    }[]) ?? []) {
      if (!c.ativo) continue;
      const proxima = alvo.get(c.id);
      const km = kmAtual.get(c.id);
      if (proxima == null || km == null || km <= proxima) continue;

      alertas.push({
        chave: `troca_oleo:${c.id}:${proxima}`,
        icone: "🛢️",
        severidade: "media",
        titulo: `${c.placa} passou do km da troca de óleo`,
        texto:
          `A última troca marcou a próxima pra ${proxima.toLocaleString("pt-BR")} km ` +
          `e o caminhão já está em ${km.toLocaleString("pt-BR")} km — ` +
          `${(km - proxima).toLocaleString("pt-BR")} km a mais. ` +
          `O km vem do fim das cargas e dos abastecimentos, então pode ser que ` +
          `a troca já tenha sido feita e só não foi lançada. Se foi, lance na ` +
          `ficha do caminhão que o aviso some.`,
        link: { href: `/admin/caminhoes/${c.id}`, label: "Abrir ficha" },
      });
    }
  } catch {
    // segue
  }

  // -------------------------------------------------------------------
  // Cheques
  // -------------------------------------------------------------------
  try {
    // ⚠️ O status é 'em_carteira', não 'carteira' (CHECK da migration 0017).
    // Errar aqui não dá erro nenhum — só faz o alerta nunca acender.
    const { data: cheques } = await supabase
      .from("cheques")
      .select("id, banco, emitente, valor, bom_para, status")
      .in("status", ["em_carteira", "devolvido"]);

    const hoje = new Date();
    const hojeIso = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
    );
    const emDias = (d: string) =>
      Math.round(
        (new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime() -
          hojeIso.getTime()) /
          86_400_000
      );

    for (const ch of (cheques as {
      id: string;
      banco: string | null;
      emitente: string | null;
      valor: number;
      bom_para: string;
      status: string;
    }[]) ?? []) {
      const quem = ch.emitente || ch.banco || "sem emitente";
      const valor = real(Number(ch.valor));

      if (ch.status === "devolvido") {
        alertas.push({
          chave: `cheque_devolvido:${ch.id}`,
          icone: "❌",
          severidade: "alta",
          titulo: "Cheque devolvido sem resolver",
          texto:
            `O cheque de ${quem}, ${valor}, voltou e continua em aberto. ` +
            `Enquanto não for resolvido, esse dinheiro está contado como ` +
            `recebido e não é. Combine a reapresentação ou outra forma de ` +
            `pagamento com o comprador e dê baixa na tela de cheques.`,
          link: { href: "/admin/cheques", label: "Ver cheques" },
          data: ch.bom_para,
        });
        continue;
      }

      const dias = emDias(ch.bom_para);
      if (dias < 0) {
        alertas.push({
          chave: `cheque_vencido:${ch.id}`,
          icone: "🏦",
          severidade: "alta",
          titulo: "Cheque passou do bom para e continua na carteira",
          texto:
            `O cheque de ${quem}, ${valor}, era bom para ${formatData(ch.bom_para)} — ` +
            `${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"} atrás — e ainda ` +
            `não foi depositado nem repassado. Pode ser só que o depósito não ` +
            `foi lançado aqui. Se já depositou, marque na tela de cheques.`,
          link: { href: "/admin/cheques", label: "Ver cheques" },
          data: ch.bom_para,
        });
      } else if (dias <= 7) {
        alertas.push({
          chave: `cheque_semana:${ch.id}`,
          icone: "📅",
          severidade: "media",
          titulo: "Cheque bom para esta semana",
          texto:
            `O cheque de ${quem}, ${valor}, fica bom para ${formatData(ch.bom_para)}` +
            (dias === 0 ? " — hoje." : `, daqui a ${dias} dia${dias === 1 ? "" : "s"}.`) +
            ` Depositar no dia evita esquecer e evita o cheque virar problema ` +
            `de cobrança depois.`,
          link: { href: "/admin/cheques", label: "Ver cheques" },
          data: ch.bom_para,
        });
      }
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
