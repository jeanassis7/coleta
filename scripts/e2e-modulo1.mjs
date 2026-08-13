/**
 * E2E da camada de dados do Módulo 1 — roda contra produção.
 *
 * ISOLAMENTO: cria um motorista próprio descartável ("E2E Bot",
 * is_teste=true) e deleta ele no final. NUNCA toca no Teste 1 nem em
 * qualquer dado que não criou — o Teste 1 é o ambiente de teste MANUAL
 * do Evaner e pode ter carga ativa a qualquer momento.
 *
 * Testa: RLS como motorista, unique de 1 carga ativa, inserts idempotentes
 * (client_id 23505), coluna generated peso_liquido, update atômico de
 * carga/adiantamento, queries aninhadas do admin (PostgREST nested filter),
 * cálculo de saldo, acerto com corte_em.
 *
 * LIMPA tudo que criou no final (registros, fotos, o próprio bot).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ws from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

const envRaw = readFileSync("C:/Users/Evaner/Desktop/JJHS/.env.local", "utf8");
for (const linha of envRaw.split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

const svc = createClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });
const mot = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const resultados = [];
function check(nome, ok, detalhe = "") {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

// JPEG mínimo válido (4 bytes SOI+EOI)
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const criados = {
  caminhaoId: null,
  cargaId: null,
  coletaClientId: randomUUID(),
  despesaClientId: randomUUID(),
  abastClientId: randomUUID(),
  descargaClientId: randomUUID(),
  adiantamentoId: null,
  acertoId: null,
  motoristaId: null,
  fotos: [],
};

async function main() {
  // ---- setup: motorista descartável só deste run ----
  const E2E_EMAIL = `e2e-bot-${Date.now()}@coleta.local`;
  const E2E_SENHA = randomUUID();
  const { data: criado, error: errBot } = await svc.auth.admin.createUser({
    email: E2E_EMAIL, password: E2E_SENHA, email_confirm: true,
  });
  if (errBot || !criado?.user) throw new Error("criar bot: " + errBot?.message);
  const { error: errPerfil } = await svc.from("profiles").insert({
    id: criado.user.id, nome: "E2E Bot", role: "motorista",
    ativo: true, exige_foto: false, is_teste: true, features: {},
  });
  if (errPerfil) throw new Error("perfil bot: " + errPerfil.message);
  const teste1 = { id: criado.user.id }; // "motorista" deste run
  criados.motoristaId = teste1.id;

  const { data: dev } = await svc.from("profiles").select("id").eq("role", "dev").limit(1).maybeSingle();
  if (!dev) throw new Error("dev não encontrado");

  const { data: cam, error: errCam } = await svc
    .from("caminhoes")
    .insert({ placa: "ZZZ9Z99", marca: "TesteE2E", cor: "Cinza", capacidade_l: 10000, tara_kg: 8000 })
    .select().maybeSingle();
  if (errCam) throw new Error("criar caminhão E2E: " + errCam.message);
  criados.caminhaoId = cam.id;

  const { error: errLogin } = await mot.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_SENHA,
  });
  check("login motorista E2E", !errLogin, errLogin?.message);
  if (errLogin) throw new Error("sem login não dá pra seguir");

  // ---- 1. motorista lê caminhões ativos (RLS) ----
  const { data: cams, error: e1 } = await mot.from("caminhoes").select("id, placa").eq("ativo", true);
  check("RLS: motorista lê caminhões ativos", !e1 && (cams || []).some((c) => c.id === cam.id), e1?.message);

  // ---- 2. motorista cria carga ----
  const { data: carga, error: e2 } = await mot
    .from("cargas")
    .insert({ motorista_id: teste1.id, caminhao_id: cam.id, km_inicial: 100000 })
    .select("id, status, iniciada_em").maybeSingle();
  check("motorista cria carga (status ativa)", !e2 && carga?.status === "ativa", e2?.message);
  criados.cargaId = carga?.id;

  // ---- 3. segunda carga ativa → bloqueada pelo índice único ----
  const { error: e3 } = await mot
    .from("cargas")
    .insert({ motorista_id: teste1.id, caminhao_id: cam.id, km_inicial: 100001 });
  check("índice único: 2ª carga ativa rejeitada (23505)", e3?.code === "23505", e3?.code || "inseriu (ERRADO)");

  // ---- 4. coleta vinculada à carga ----
  const { error: e4 } = await mot.from("coletas").insert({
    motorista_id: teste1.id,
    litros: 500,
    local_nome: "Cliente E2E",
    valor_pago: 400,
    certificado_tipo: "nao",
    criado_em: new Date().toISOString(),
    client_id: criados.coletaClientId,
    carga_id: carga.id,
  });
  check("coleta com carga_id", !e4, e4?.message);

  // ---- 5. upload de foto como motorista (storage RLS) ----
  const fotoDespesa = `${teste1.id}/despesa-${criados.despesaClientId}.jpg`;
  const { error: e5 } = await mot.storage.from("fotos-coletas")
    .upload(fotoDespesa, JPG, { upsert: true, contentType: "image/jpeg" });
  check("storage: upload foto despesa", !e5, e5?.message);
  criados.fotos.push(fotoDespesa);

  // ---- 6. despesa + idempotência ----
  const payloadDespesa = {
    client_id: criados.despesaClientId,
    carga_id: carga.id,
    motorista_id: teste1.id,
    valor: 45,
    descricao: "almoço E2E",
    foto_path: fotoDespesa,
    criado_em: new Date().toISOString(),
  };
  const { error: e6 } = await mot.from("despesas").insert(payloadDespesa);
  check("despesa insere", !e6, e6?.message);
  const { error: e6b } = await mot.from("despesas").insert(payloadDespesa);
  check("despesa retry → 23505 (idempotente)", e6b?.code === "23505", e6b?.code || "duplicou (ERRADO)");

  // ---- 7. abastecimento ----
  const fotoAbast = `${teste1.id}/abastecimento-${criados.abastClientId}.jpg`;
  await mot.storage.from("fotos-coletas").upload(fotoAbast, JPG, { upsert: true, contentType: "image/jpeg" });
  criados.fotos.push(fotoAbast);
  const { error: e7 } = await mot.from("abastecimentos").insert({
    client_id: criados.abastClientId,
    carga_id: carga.id,
    motorista_id: teste1.id,
    posto_nome: "Posto E2E",
    litros: 120.5,
    valor: 680,
    km_atual: 100200,
    foto_path: fotoAbast,
    criado_em: new Date().toISOString(),
  });
  check("abastecimento insere", !e7, e7?.message);

  // ---- 8. descarga + generated column + idempotência ----
  const { data: desc, error: e8 } = await mot.from("descargas").insert({
    client_id: criados.descargaClientId,
    carga_id: carga.id,
    peso_bruto_kg: 8450,
    peso_tara_kg: 8000,
    litros_estimados: 500,
    criado_em: new Date().toISOString(),
  }).select("peso_liquido_kg").maybeSingle();
  check("descarga insere + peso_liquido generated = 450", !e8 && desc?.peso_liquido_kg === 450,
    e8?.message || `liquido=${desc?.peso_liquido_kg}`);
  const { error: e8b } = await mot.from("descargas").insert({
    client_id: criados.descargaClientId,
    carga_id: carga.id,
    peso_bruto_kg: 8450,
    peso_tara_kg: 8000,
  });
  check("descarga retry → 23505 (idempotente)", e8b?.code === "23505", e8b?.code || "duplicou (ERRADO)");

  // ---- 9. fechar carga atomicamente (como o sync faz) ----
  const { data: fech1 } = await mot.from("cargas")
    .update({ status: "encerrada", encerrada_em: new Date().toISOString() })
    .eq("id", carga.id).eq("status", "ativa").select();
  check("fechar carga atômico: 1ª vez fecha", (fech1 || []).length === 1);
  const { data: fech2 } = await mot.from("cargas")
    .update({ status: "encerrada" })
    .eq("id", carga.id).eq("status", "ativa").select();
  check("fechar carga atômico: retry → 0 rows (ok)", (fech2 || []).length === 0);

  // ---- 10. query aninhada do /admin/cargas (sintaxe PostgREST — risco D7) ----
  const SELECT_CARGAS = `id, motorista_id, caminhao_id, km_inicial, km_final, status,
       iniciada_em, encerrada_em,
       profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
       caminhoes(placa, marca, cor, capacidade_l),
       coletas(id, litros, valor_pago),
       despesas(id, valor),
       abastecimentos(id, valor),
       descargas(peso_bruto_kg, peso_tara_kg, peso_liquido_kg, litros_estimados, umidade_pct, criado_em)`;
  const { data: cargasSemTeste, error: e10 } = await svc.from("cargas")
    .select(SELECT_CARGAS).eq("profiles.is_teste", false).order("iniciada_em", { ascending: false });
  check("query /admin/cargas roda sem erro", !e10, e10?.message);
  check("filtro is_teste esconde carga do teste",
    !e10 && !(cargasSemTeste || []).some((c) => c.id === carga.id));
  const { data: cargasTodas, error: e10b } = await svc.from("cargas").select(SELECT_CARGAS);
  const minha = (cargasTodas || []).find((c) => c.id === carga.id);
  check("agregados da carga corretos (1 coleta, 1 despesa, 1 abast, 1 descarga)",
    !e10b && minha && minha.coletas?.length === 1 && minha.despesas?.length === 1 &&
    minha.abastecimentos?.length === 1 && minha.descargas?.length === 1,
    e10b?.message || (minha ? `c=${minha.coletas?.length} d=${minha.despesas?.length} a=${minha.abastecimentos?.length} desc=${minha.descargas?.length}` : "carga não veio"));

  // ---- 11. query aninhada do /admin/descarregamentos (3 níveis — risco D7) ----
  const SELECT_DESC = `id, carga_id, peso_bruto_kg, peso_tara_kg, peso_liquido_kg,
       litros_estimados, umidade_pct, foto_papel_path, criado_em,
       cargas!inner(
         motorista_id,
         profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
         caminhoes(placa)
       )`;
  const { data: descSemTeste, error: e11 } = await svc.from("descargas")
    .select(SELECT_DESC).eq("cargas.profiles.is_teste", false);
  check("query /admin/descarregamentos roda sem erro", !e11, e11?.message);
  check("filtro aninhado is_teste esconde descarga do teste",
    !e11 && !(descSemTeste || []).some((d) => d.carga_id === carga.id));
  const { data: descTodas } = await svc.from("descargas").select(SELECT_DESC);
  check("descarga do teste aparece sem filtro",
    (descTodas || []).some((d) => d.carga_id === carga.id));

  // ---- 12. lançar umidade (como o PATCH do admin faz) ----
  const { error: e12 } = await svc.from("descargas")
    .update({ umidade_pct: 12.5 }).eq("client_id", criados.descargaClientId);
  const { data: descUmid } = await svc.from("descargas")
    .select("umidade_pct").eq("client_id", criados.descargaClientId).maybeSingle();
  check("umidade lançada = 12.5", !e12 && Number(descUmid?.umidade_pct) === 12.5,
    e12?.message || `umidade=${descUmid?.umidade_pct}`);

  // ---- 13. adiantamento: envia (Jean) → aceita atômico (motorista) ----
  const { data: adiant, error: e13 } = await svc.from("adiantamentos").insert({
    motorista_id: teste1.id, valor: 5000, forma_pagamento: "pix",
    observacao: "E2E", registrado_por: dev.id,
  }).select("id, status").maybeSingle();
  check("adiantamento criado pendente", !e13 && adiant?.status === "pendente", e13?.message);
  criados.adiantamentoId = adiant?.id;

  const { data: aceite } = await mot.from("adiantamentos")
    .update({ status: "aceito", aceito_em: new Date().toISOString() })
    .eq("id", adiant.id).eq("status", "pendente").select();
  check("aceite atômico: 1 row", (aceite || []).length === 1);
  const { data: aceite2 } = await mot.from("adiantamentos")
    .update({ status: "aceito" }).eq("id", adiant.id).eq("status", "pendente").select();
  check("aceite duplo → 0 rows", (aceite2 || []).length === 0);
  const { data: cancelPos } = await svc.from("adiantamentos")
    .update({ status: "cancelado" }).eq("id", adiant.id).eq("status", "pendente").select();
  check("cancelar após aceite → 0 rows (409 do endpoint)", (cancelPos || []).length === 0);

  // ---- 14. saldo: 5000 − 400 (coleta) − 45 (despesa) − 680 (abast) = 3875 ----
  const corte0 = "1970-01-01T00:00:00Z";
  const soma = async (tabela, campo) => {
    const { data } = await svc.from(tabela).select(campo)
      .eq("motorista_id", teste1.id).gt("criado_em", corte0);
    return (data || []).reduce((s, r) => s + Number(r[campo]), 0);
  };
  const { data: ads } = await svc.from("adiantamentos").select("valor")
    .eq("motorista_id", teste1.id).eq("status", "aceito").gt("aceito_em", corte0);
  const somaAd = (ads || []).reduce((s, a) => s + Number(a.valor), 0);
  const saldo = somaAd - (await soma("coletas", "valor_pago")) -
    (await soma("despesas", "valor")) - (await soma("abastecimentos", "valor"));
  check("saldo calculado = 3875", saldo === 3875, `saldo=${saldo}`);

  // ---- 15. acerto com corte: saldo pós-acerto = valor_saldo carry ----
  const { data: acerto, error: e15 } = await svc.from("acertos").insert({
    motorista_id: teste1.id, valor_devolvido: 3000, valor_vale: 800,
    valor_saldo: 75, registrado_por: dev.id,
  }).select("id, corte_em").maybeSingle();
  check("acerto criado com corte_em timestamptz", !e15 && !!acerto?.corte_em, e15?.message);
  criados.acertoId = acerto?.id;
  const { data: adsPos } = await svc.from("adiantamentos").select("valor")
    .eq("motorista_id", teste1.id).eq("status", "aceito").gt("aceito_em", acerto.corte_em);
  const { data: colPos } = await svc.from("coletas").select("valor_pago")
    .eq("motorista_id", teste1.id).gt("criado_em", acerto.corte_em);
  const saldoPos = (adsPos || []).length === 0 && (colPos || []).length === 0 ? 75 : -1;
  check("pós-acerto: eventos antigos fora do ciclo, saldo = carry 75", saldoPos === 75,
    `adiantamentos pós-corte=${(adsPos || []).length}, coletas pós-corte=${(colPos || []).length}`);

  // ---- 16. dashboard: coleta de teste invisível ----
  const { data: dash, error: e16 } = await svc.from("coletas")
    .select("*, profiles!coletas_motorista_id_fkey!inner(nome, is_teste)")
    .eq("profiles.is_teste", false)
    .gte("criado_em", new Date(Date.now() - 3600_000).toISOString());
  check("dashboard: coleta do teste invisível", !e16 &&
    !(dash || []).some((c) => c.client_id === criados.coletaClientId), e16?.message);

  // ---- 17. curadoria: coleta de teste invisível ----
  const { data: cur, error: e17 } = await svc.from("coletas")
    .select("id, client_id, profiles!coletas_motorista_id_fkey!inner(nome, is_teste)")
    .eq("profiles.is_teste", false).is("local_id", null);
  check("curadoria: coleta do teste invisível", !e17 &&
    !(cur || []).some((c) => c.client_id === criados.coletaClientId), e17?.message);

  // ---- 18. queries do motor de alertas (PostgREST aninhado — risco de 400) ----
  const { error: eA1 } = await svc.from("cargas").select(
    `id, iniciada_em,
     profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
     caminhoes(placa, capacidade_l),
     coletas(litros, criado_em),
     despesas(criado_em),
     abastecimentos(criado_em)`
  ).eq("status", "ativa").eq("profiles.is_teste", false);
  check("alertas: query de cargas ativas roda", !eA1, eA1?.message);

  const { error: eA2 } = await svc.from("descargas").select(
    `id, peso_liquido_kg, umidade_pct, criado_em,
     cargas!inner(
       profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
       coletas(litros)
     )`
  ).eq("cargas.profiles.is_teste", false);
  check("alertas: query de descargas roda", !eA2, eA2?.message);

  const { error: eA3 } = await svc.from("adiantamentos").select(
    `id, valor, pular_contador,
     profiles!adiantamentos_motorista_id_fkey!inner(nome, is_teste)`
  ).eq("status", "pendente").gte("pular_contador", 10).eq("profiles.is_teste", false);
  check("alertas: query de adiantamentos pulados roda", !eA3, eA3?.message);

  const { error: eA4 } = await svc.from("coletas").select(
    `id, motorista_id, litros, valor_pago, gps_capturado, foto_path, local_nome, criado_em,
     profiles!coletas_motorista_id_fkey!inner(nome, is_teste, exige_foto)`
  ).eq("profiles.is_teste", false).limit(5);
  check("alertas: query de coletas (foto/gps/preco) roda", !eA4, eA4?.message);

  // ---- 19. alertas_vistos: dispensar e ler de volta ----
  const chaveTeste = `e2e_teste:${criados.coletaClientId}`;
  const { error: eV1 } = await svc.from("alertas_vistos").upsert({
    chave: chaveTeste, visto_por: dev.id,
  });
  check("alertas_vistos: dispensa grava", !eV1, eV1?.message);
  const { data: vistos } = await svc.from("alertas_vistos").select("chave");
  check("alertas_vistos: dispensa aparece na leitura",
    (vistos || []).some((v) => v.chave === chaveTeste));
  await svc.from("alertas_vistos").delete().eq("chave", chaveTeste);

  await mot.auth.signOut();
}

async function cleanup() {
  console.log("\n🧹 Limpando dados do E2E...");
  try {
    // SÓ ids que este run criou — nunca deletes amplos por motorista
    // (o Teste 1 do Evaner vive no mesmo banco).
    if (criados.acertoId) await svc.from("acertos").delete().eq("id", criados.acertoId);
    if (criados.adiantamentoId) await svc.from("adiantamentos").delete().eq("id", criados.adiantamentoId);
    await svc.from("descargas").delete().eq("client_id", criados.descargaClientId);
    await svc.from("despesas").delete().eq("client_id", criados.despesaClientId);
    await svc.from("abastecimentos").delete().eq("client_id", criados.abastClientId);
    await svc.from("coletas").delete().eq("client_id", criados.coletaClientId);
    if (criados.cargaId) await svc.from("cargas").delete().eq("id", criados.cargaId);
    if (criados.caminhaoId) await svc.from("caminhoes").delete().eq("id", criados.caminhaoId);
    if (criados.fotos.length) await svc.storage.from("fotos-coletas").remove(criados.fotos);
    // Por fim, o próprio bot
    if (criados.motoristaId) {
      await svc.from("app_events").delete().eq("motorista_id", criados.motoristaId);
      await svc.from("profiles").delete().eq("id", criados.motoristaId);
      await svc.auth.admin.deleteUser(criados.motoristaId);
    }
    console.log("🧹 Limpo (incluindo o bot).");
  } catch (e) {
    console.error("⚠️ cleanup parcial:", e.message);
  }
}

main()
  .catch((e) => {
    console.error("💥 E2E abortou:", e.message);
    resultados.push({ nome: "execução completa", ok: false, detalhe: e.message });
  })
  .finally(async () => {
    await cleanup();
    const falhas = resultados.filter((r) => !r.ok);
    console.log(`\n===== ${resultados.length - falhas.length}/${resultados.length} passaram =====`);
    if (falhas.length) {
      console.log("FALHAS:");
      for (const f of falhas) console.log(`  ❌ ${f.nome} — ${f.detalhe}`);
      process.exit(1);
    }
    process.exit(0);
  });
