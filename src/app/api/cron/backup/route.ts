import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { selectTudo } from "@/lib/supabase/select-tudo";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * Backup mensal em CSV — a foto de segurança do banco.
 *
 * POR QUÊ: o plano grátis do Supabase só guarda backup de 7 dias. Um bug
 * que grava errado e passa 3 semanas despercebido não teria mais versão
 * boa pra voltar. Este cron roda todo dia 1º (vercel.json) e despeja TODAS
 * as tabelas do schema public em CSV no bucket `backups`, numa pasta por
 * mês (aaaa-mm). Ver a migration 0056 pro desenho inteiro.
 *
 * A lista de tabelas vem do catálogo (RPC listar_tabelas_backup): tabela
 * nova entra no backup SOZINHA, igual ganha log sozinha (0022).
 *
 * SEGURANÇA SEM SEGREDO, por desenho: a rota não devolve dado nenhum (só
 * contagens) e é idempotente — disparar de novo só regrava o snapshot do
 * mês com dados mais novos. Quem pode disparar: o cron da Vercel (ou
 * alguém fingindo o user-agent dele — inócuo, pelo desenho acima) e um
 * admin logado (pra testar na mão). Se um dia existir CRON_SECRET no env
 * da Vercel, ele passa a valer também.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function csvDe(linhas: Record<string, unknown>[]): string {
  if (linhas.length === 0) return "";
  const colunas = Object.keys(linhas[0]);
  const celula = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    colunas.join(","),
    ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(",")),
  ].join("\n");
}

export async function GET(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  const secret = process.env.CRON_SECRET;
  const ehCron =
    ua.startsWith("vercel-cron") ||
    (!!secret && req.headers.get("authorization") === `Bearer ${secret}`);
  if (!ehCron) {
    const user = await exigirAdmin();
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data: tabelas, error: eTab } = await admin.rpc("listar_tabelas_backup");
  if (eTab) return NextResponse.json({ error: eTab.message }, { status: 500 });

  // Pasta por mês DO BRASIL (UTC-3): o cron das 6h UTC do dia 1º cai no
  // dia 1º BR também — mas a conta explícita evita surpresa na virada.
  const mes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
  const linhasPorTabela: Record<string, number | string> = {};

  for (const t of (tabelas as { tabela: string; colunas_ordem: string[] | null }[]) ?? []) {
    if (!t.colunas_ordem?.length) {
      // Sem PK não dá pra paginar com ordem estável — marca no manifesto
      // em vez de copiar linhas embaralhadas (ou pular calado).
      linhasPorTabela[t.tabela] = "SEM CHAVE PRIMÁRIA — não copiada";
      continue;
    }
    const linhas = await selectTudo<Record<string, unknown>>((de, ate) => {
      let q = admin.from(t.tabela).select("*");
      for (const c of t.colunas_ordem!) q = q.order(c);
      return q.range(de, ate);
    });
    const { error } = await admin.storage
      .from("backups")
      .upload(`${mes}/${t.tabela}.csv`, Buffer.from(csvDe(linhas), "utf8"), {
        contentType: "text/csv; charset=utf-8",
        upsert: true,
      });
    if (error) {
      return NextResponse.json(
        { error: `${t.tabela}: ${error.message}` },
        { status: 500 }
      );
    }
    linhasPorTabela[t.tabela] = linhas.length;
  }

  const manifesto = {
    gerado_em: new Date().toISOString(),
    mes,
    linhas: linhasPorTabela,
  };
  const { error: eMan } = await admin.storage
    .from("backups")
    .upload(
      `${mes}/_manifesto.json`,
      Buffer.from(JSON.stringify(manifesto, null, 2), "utf8"),
      { contentType: "application/json", upsert: true }
    );
  if (eMan) return NextResponse.json({ error: eMan.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    mes,
    tabelas: Object.keys(linhasPorTabela).length,
  });
}
