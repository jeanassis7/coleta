# Projeto Coleta — Contexto pra Claude

App PWA para coleta de óleo lubrificante usado (OLUC). Construído pelo **Evaner** pra empresa do irmão **Jean**.

## Quem usa

- **3 motoristas em campo** (Luis, Lucimar, Lucinei) — Android + 1 possivelmente iPhone. PWA instalado.
- Baixa familiaridade tecnológica — regra de ouro: **se exige mais de 3 toques e um pensamento, está complexo demais.**
- **Jean** — gestor, usa painel admin no computador.

## Rotas operacionais

Guaíra, Toledo, Cascavel, Foz do Iguaçu (oeste do PR). Muita área rural sem sinal — **offline-first é mandatório, não opcional.**

## Stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind**
- **Supabase** (Auth + Postgres + Storage) — projeto `jjhs-coleta`
- **Dexie** (IndexedDB) — fila offline no celular
- **Serwist** — Service Worker, estratégia `StaleWhileRevalidate` pra navegação (CRÍTICO pro offline funcionar com sinal ruim)
- **Leaflet + OSM** — mapa do admin (zero custo, sem API key)
- **PDFKit** — gera o manual do Jean

## URLs, acessos e credenciais

- **Produção:** https://coleta-inky.vercel.app
- **Admin (Jean):** https://coleta-inky.vercel.app/admin/login → `jean@coleta.local` / `Progevaner123$`
- **Dev (Evaner):** mesmo login → `evaner@coleta.local` / `senharolha` (role `dev`)
- **Repo:** https://github.com/jeanassis7/coleta (Evaner é colaborador com Write)
- **Supabase project:** `jjhs-coleta` (URL `zwghaoubzrkluckrcxwi.supabase.co`)
  - `DATABASE_URL` (session pooler) está no `.env.local` — permite rodar migrations daqui via `scripts/aplicar-migration.mjs`, sem abrir o SQL Editor
- **Motoristas** (todos em `@coleta.local`): Luis/`volante`, Lucimar/`tanque`, Lucinei/`lanterna`
- **Motorista de teste:** `teste1@coleta.local` / `teste123` (`is_teste=true` — invisível nos dashboards)

## Roles (3 níveis)

- **`motorista`** — PWA. Features novas chegam via flag individual em `profiles.features`.
- **`admin`** (Jean) — painel operacional.
- **`dev`** (Evaner) — herda tudo de admin + vê o que está em teste. `is_admin()` no Postgres cobre admin E dev, então RLS não precisa saber da diferença.

Helpers em `src/lib/auth/roles.ts`: `isDev`, `isAdminPuro`, `podeAcessarAdmin`, `hasFeature`.

⚠️ **Ao mexer em role/gate, checar 4 lugares** (bug real já aconteceu): `src/middleware.ts`, `/admin/(authed)/layout.tsx`, `/admin/login/page.tsx` e `/motorista/login/page.tsx`.

## Arquitetura — visão rápida

```
/motorista/*                    → PWA leve, offline-first
  /login                        → primeiro acesso (precisa internet)
  /                             → home (NOVA COLETA + [se features.carga] barra do
                                  caminhão, DESCARREGAR, ABASTECIMENTO, DESPESAS,
                                  CANCELAR CARGA) + [se features.saldo] card de saldo
  /nova-coleta                  → form principal, GPS captura ao abrir
  /confirmacao                  → tela de sucesso
  ── Módulo 1 (só com features.carga=true) ──
  /iniciar-carga                → boas-vindas → form (caminhão + km + foto do painel)
  /abastecimento                → posto, litros, valor, km, foto (antiburro de km)
  /despesa                      → valor, descrição, foto obrigatória
  /descarregar                  → peso bruto → líquido/litros, antiburros no confirmar
  /carga-encerrada              → resumo (duração, coletas, pesos)

/admin/*                        → painel web (sidebar vertical com grupos)
  /login                        → fora do (authed)
  /(authed)/                    → rotas protegidas
    /                           → dashboard: [Módulo 1] alertas + cargas ativas +
                                  descargas recentes, depois KPIs + análises + lista/mapa
    /mapa · /observacoes · /curadoria · /motoristas · /eventos   (como sempre)
    ── Módulo 1 (dev-only até o flip) ──
    /cargas                     → tabela densa (19 col) + umidade na coluna Umid.
    /abastecimentos             → lista + edição (corrigir lançamento errado)
    /adiantamentos              → saldo por motorista + enviar + acerto
    /adiantamentos/[id]         → histórico de dinheiro do motorista
    /caminhoes                  → CRUD da frota
    /dev/features               → toggles de feature por motorista de teste (só dev)

/api/admin/*                    → endpoints com service_role
  /motoristas[/id][/feature], /coletas/[id], /coletas/bulk-delete, /locais[/id],
  /caminhoes[/id], /descargas/[id], /abastecimentos/[id], /adiantamentos[/id],
  /acertos, /alertas/visto
/api/locais/proximos            → busca por proximidade (client motorista)
```

## Convenções IMPORTANTES

- **Tudo em português** (UI, comentários, variáveis quando faz sentido)
- **Timezone:** `America/Sao_Paulo` (UTC-3 fixo). Helpers `nowBrParts`, `fromBrParts` em `src/lib/admin/queries.ts`
- **Dinheiro tem DUAS convenções** (decisão do Evaner após teste de campo):
  - **Coleta:** `valor_pago integer`, valor cheio sempre (100, 125, 200). UI rejeita vírgula com aviso.
  - **Despesa/abastecimento/adiantamento/acerto:** `numeric(10,2)` COM centavos (combustível nunca é redondo). UI usa `InputDinheiro` (src/components/InputDinheiro.tsx) — máscara estilo banco, digita algarismos e preenche da direita ("68047" → R$ 680,47). NUNCA usar input de texto livre pra dinheiro — o parser antigo descartava vírgula e "520,12" virava 52.012.
- **Períodos** alinhados ao calendário BR:
  - Hoje = 00:00-23:59 BR
  - Semana = domingo a sábado da semana atual
  - Mês = dia 1 ao último dia do mês atual
  - Comparações "vs anterior" = **mesmo intervalo até mesma data** (justo)
- **Email dos usuários** = identificador interno `nome@coleta.local`, não é email real
- **Foto:** 800px / JPEG q60 / alvo 100KB. Comprimida no celular antes de salvar. Label na UI = "Foto da fachada/portão"
- **GPS:** captura ao ABRIR Nova Coleta (não no save). Timeout 10s. Flag `gps_pendente` impede sync antes de GPS resolver.

## Números "mágicos" com contexto

- **Curadoria — cluster GPS 20m:** agrupa coletas próximas pra sugerir merge (área urbana precisa)
- **Curadoria — cluster nome:** ainda agrupa se nome normalizado for igual (fallback pra GPS ruim)
- **Local canônico — raio_match_m: 100m FIXO:** NÃO é configurável pelo admin (decisão do Evaner de simplificar)
- **Sugestão pro motorista — busca 100m:** mostra locais cadastrados nesse raio. UI mostra SÓ o nome (sem metros)
- **Cleanup local — 24h:** coletas 100% sincronizadas apagadas do IndexedDB após 24h
- **Cleanup eventos — 7 dias:** eventos sincronizados apagados após 7 dias
- **Recovery GPS pendente — 30s:** libera flag se GPS travou

## Migrations já aplicadas (NÃO re-criar)

Em `supabase/migrations/` — aplicar com `node scripts/aplicar-migration.mjs <arquivo>`:
- `0001_initial.sql` — schema, RLS, storage bucket
- `0002_admin_features.sql` — `profiles.senha_visivel`
- `0003_locais.sql` — tabela `locais`, função `locais_proximos`, view `locais_com_stats`
- `0004_storage_rls_fix.sql` — UPDATE/DELETE policies pra fotos (resolveu bug "RLS violation")
- `0005_role_dev.sql` — role `dev` + `is_admin()` passa a cobrir admin E dev
- `0006_foundations.sql` — `profiles.features` (jsonb), `is_teste`, `mostra_saldo_app`
- `0007_cargas.sql` — `caminhoes`, `cargas` (índice único de 1 ativa), `coletas.carga_id`, `descargas` (peso_liquido generated), `despesas`, `abastecimentos` + RLS
- `0008_adiantamentos.sql` — `adiantamentos` (pendente/aceito/cancelado), `acertos` (`corte_em timestamptz`)
- `0009_client_ids_offline.sql` — `client_id` unique nas 3 tabelas (sync idempotente)
- `0010_valores_com_centavos.sql` — despesa/abastecimento/adiantamento/acerto viram `numeric(10,2)`
- `0011_acerto_saldo_negativo.sql` — remove CHECK >= 0 (empresa pode dever pro motorista)
- `0012_alertas_vistos.sql` — tabela de alertas dispensados no "OK, VI"

## MÓDULO 1 (Cargas/ERP) — regras que valem pra tudo daqui pra frente

**Estágio atual: DEV-ONLY.** Jean não vê nada do módulo. A promoção pro admin é **um flip** de `MODULO1_LIBERADO_PARA_ADMIN` em `src/lib/auth/gate-modulo1.ts` — libera menu + páginas + endpoints de uma vez. Páginas usam `exigirAcessoModulo1OuRedirect()`, endpoints `exigirAcessoModulo1()`, telas compartilhadas (dashboard) `acessoModulo1Atual()`.

**Ciclo de vida de feature:** dev-only → admin liga por motorista (`profiles.features`) → vira padrão. Feature nova nasce **OFF** pra todos.

**Motorista de teste (`is_teste=true`):** invisível em dashboard, KPIs, curadoria, observações, exports. **Dev vê** (com badge 🧪); admin não. Ao criar query admin nova, decidir explicitamente.

**Ciclo = CARGA** (não "viagem"): dura 3-10 dias, encerra na descarga (pesagem na balança). Só 1 ativa por motorista (índice único no banco).

**Unidade:** motorista declara **LITROS**; da balança em diante é **KG** (densidade fixa **0,9 kg/L**). Estoque e venda em kg; litros só como referência.

**Tara:** fonte única é o cadastro do caminhão. A descarga grava um **snapshot** — se Jean recalibrar depois, descarga antiga preserva a tara da época.

**Offline-first vale pros 4 lançamentos** (coleta, despesa, abastecimento, descarga): GPS na hora + fila no IndexedDB + sync com `client_id` idempotente. *Iniciar carga* é a única ação que exige sinal (o servidor garante "1 carga ativa"). Descarga encerra a carga **localmente** na hora; o sync fecha no servidor.

**Antiburros são inline e só no clique do botão** — nunca enquanto digita. Padrão: primeiro toque mostra bloco amarelo explicando, segundo toque ("CONFIRMAR MESMO ASSIM") prossegue. Erro impossível (peso < tara, km < início da carga) **bloqueia** em vermelho.

**Compra direta (`compras_diretas`):** óleo que o GESTOR negocia e paga do caixa da empresa — o motorista não coletou. Não desconta saldo de ninguém, não entra em custo/certificado por motorista nem em comissão. Entra no estoque (em kg) e no custo médio do óleo (KPIs de topo do dashboard). Quem pesou lança em **kg** (medido); quem não pesou lança em **litros** (estimado, converte por 0,9). A flag `entra_no_estoque=false` cobre o caso raro do óleo ter ido num caminhão que ainda vai pesar na descarga — aí conta só o custo, senão o mesmo óleo entraria duas vezes.

> **Regra de processo pro tutorial do Jean** (não é código, é combinado): quem for pegar um caminhão que já tem óleo pra descarregar precisa avisar o motorista **encerrar a carga dele e mandar a foto do peso**. Buscar óleo de fora sempre com **caminhão vazio**.

**Alertas do dashboard** (`src/lib/admin/alertas.ts`): calculados na hora, texto **didático** (o que aconteceu → hipóteses de causa → o que fazer). `alertas_vistos` guarda os dispensados; a chave é a **ocorrência** (id do registro), então condição repetida em outro registro = alerta novo. Alerta estatístico só liga com base suficiente (30+ coletas ou 60+ dias) — alerta ruidoso ensina a ignorar alerta.

## O que NÃO fazer

- **Não usar `supabase.auth.getUser()`** no client — faz chamada de rede, quebra offline. Use `getSession()`.
- **Não usar NetworkFirst** pra navegação do PWA — sinal ruim trava. `StaleWhileRevalidate` é deliberado.
- **Não amarrar RLS de storage em path string** comparison — historicamente bugou. Atual é "authenticated pode upload, SELECT é restrito" (segurança via path controlado pelo código).
- **Não reintroduzir raio_match_m configurável** — Evaner decidiu explicitamente que é 100m fixo pra todos.
- **Não mostrar metros na UI de sugestão do motorista** — decisão explícita, só nome.
- **Não criar features sem direção do Evaner** — ele é opinionado e prefere recortar escopo a adicionar coisas que "talvez sejam úteis".
- **Não adicionar tracking GPS contínuo** — limitação de PWA + LGPD + bateria. Discutido e descartado. Se virar prioridade, alternativa é rastreador veicular físico.
- **Não suportar iOS como target primário** — Android é o principal, iOS funciona mas com atenção extra na instalação (manual via Safari > Compartilhar > Adicionar à Tela de Início).
- **ZERO popup do navegador** — `alert()`, `confirm()` e `prompt()` são proibidos na UI. Admin usa `ModalConfirmar`/`ModalInputTexto` (`src/components/admin/Modais.tsx`); motorista usa confirmação em **duas etapas** na própria tela.
- **Não mostrar GPS pro motorista** — captura é silenciosa em TODO evento. Nem ícone, nem "GPS capturado ✓". Ele pode suspeitar; a UI nunca conta.
- **Não usar input de texto livre pra dinheiro** — sempre `InputDinheiro`. O parser antigo engolia vírgula e "520,12" virou R$ 52.012 em produção.
- **Não criar submenu no motorista** — o "MENU CARGA" existiu e foi cortado: tudo fica na home, um toque. Se a home crescer demais, discutir com o Evaner antes de esconder algo.
- **Não pedir confirmação enquanto o motorista digita** — validação só no clique do botão.
- **Não deixar o E2E encostar no Teste 1** — `scripts/e2e-modulo1.mjs` cria e apaga o próprio motorista descartável. O Teste 1 é o ambiente de teste manual do Evaner e pode ter carga ativa a qualquer momento.

## Ciclo de vida dos dados

| Dado | Servidor | Retenção local (IndexedDB do celular) |
|---|---|---|
| Coleta (registro) | Supabase Postgres, permanente | Apagada 24h após sync 100% |
| Despesa / Abastecimento / Descarga | Supabase Postgres, permanente | Apagados 24h após sync 100% |
| Foto (blob) | Supabase Storage, permanente | Blob apagado junto com o lançamento (24h) |
| Evento (log) | Supabase Postgres, permanente | Apagado 7 dias após sync |
| Perfil + carga ativa | Supabase Auth + Postgres | Cache em localStorage (limpo no logout) |

Cleanup automático roda dentro de cada `safeSync` — motorista não precisa fazer nada. Ver `limparColetasSincronizadasAntigas` e `limparGpsPendenteStale` em `src/lib/sync/queue.ts`.

## Estratégia de sync (proteção de bateria)

- Zero polling, zero `setInterval`
- 4 gatilhos discretos: mount, evento `online`, `visibilitychange` visible, após save
- Flag `inFlight` evita syncs simultâneos
- `getSession()` pra checar auth local (sem network)
- Se `navigator.onLine === false` → retorna imediato
- Botão "Enviar agora" manual só aparece se há pendente + online
- Erros categorizados: `auth` / `network` / `storage` / `data` / `unknown` — UI mostra mensagem específica + botão "Sair e entrar de novo" quando auth

## Eventos capturados (log robusto)

25+ tipos em `src/lib/types.ts` (union `EventType`):

- **Lifecycle:** `app_loaded`, `app_focused`, `app_blurred`
- **Rede:** `network_online`, `network_offline` (com `navigator.connection` info)
- **Auth:** `login`, `logout`, `session_expired`
- **Ações:** `nova_coleta_opened`, `coleta_saved_local`, `enviar_agora_clicked`, `foto_capture_started`, `foto_capture_cancelled`, `foto_compress_completed`, `foto_compress_failed`
- **GPS:** `gps_success`, `gps_timeout`, `gps_denied`, `gps_error`, `permission_geolocation_changed`
- **Sync:** `sync_started`, `sync_completed`, `sync_failure`, `sync_skipped_wrong_motorista`
- **JS:** `js_error`, `js_unhandled_rejection` (via window handlers em `EventLogger.tsx`)
- **PWA / admin:** `app_install`, `foto_toggle_changed`

`EventLogger.tsx` no motorista layout registra os listeners globais automaticamente.

## Coisas curiosas que aprendi e podem confundir

- **Compilação de path emoji 💧 quebra em PDFKit** — usar SVG path no lugar
- **Storage `upsert: true` precisa de UPDATE policy** — Supabase faz UPDATE quando objeto existe (migration 0004 fixou)
- **`getSession()` é local-only**, `getUser()` é network — preferir o primeiro no client
- **`navigator.connection` API** funciona em Android Chrome mas não em Safari/iOS — capturar com try/catch (já feito)
- **Dexie filter `c.gps_pendente === true`** trata `undefined` como false — bom pra backward compat
- **Service Worker cacheOnNavigation** no Serwist tem comportamento implícito — checar antes de adicionar runtime caching custom
- **Supabase FREE TIER PAUSA APÓS 7 DIAS SEM ATIVIDADE** — em produção com motoristas usando diariamente nunca pausa, mas em desenvolvimento longo (~30 dias) pausa. Solução: dashboard Supabase → botão "Restore project" (2-5 min, sem perda de dados).
- **Foto RLS "new row violates policy"** — era falta de UPDATE policy + estava amarrando path a string comparison. Migration 0004 relaxou pra "authenticated pode upload".
- **iOS Safari NÃO tem `beforeinstallprompt`** — motorista iPhone precisa instalar manual via Compartilhar > Adicionar à Tela de Início. Fluxo pós-instalação é idêntico.

## Workflow de deploy

```cmd
cd C:\Users\Evaner\Desktop\JJHS
git add .
git commit -m "descreve a mudança"
git push
# Vercel detecta o push e faz deploy em ~2 min
```

Scripts auxiliares:
- `node scripts/aplicar-migration.mjs <arquivo.sql>` — aplica migration direto no Postgres (usa `DATABASE_URL`, roda em transação)
- `node scripts/e2e-modulo1.mjs` — **rodar após qualquer mexida no Módulo 1**: 35 checks contra produção (RLS, idempotência, updates atômicos, queries aninhadas do admin e dos alertas, cálculo de saldo, filtros `is_teste`). Cria e apaga o próprio motorista descartável.
- `node scripts/limpar-lancamentos-teste.mjs [email]` — zera lançamentos de um motorista de teste pra recomeçar limpo (recusa perfil real)
- `node scripts/criar-motorista-teste.mjs [nome] [email] [senha]` — cria motorista sandbox (também dá pra criar pelo painel, checkbox só visível pro dev)
- `node scripts/criar-dev.mjs` — cria/atualiza o usuário dev do Evaner
- `node scripts/gerar-icones.mjs` — regenera PNGs a partir de `icone-gota.jfif`
- `node scripts/gerar-tutorial-pdf.mjs` — regenera o manual do Jean (`tutorial-coleta.pdf` fica na raiz, ignorado pelo .gitignore)

## Features especiais no admin

**Bulk delete:** checkbox por coleta na aba Lista + botão "Apagar X coletas" (confirma digitando APAGAR).

**Separar cluster (curadoria):** checkbox por coleta dentro do cluster expandido. Se algumas marcadas → aparece modo separação com 2 formulários lado a lado ("Local 1" / "Local 2"), cada um cria um local canônico separado com centro GPS médio próprio.

**Google Maps clicável:** coordenadas nos clusters/coletas são `<a>` que abre `https://www.google.com/maps?q=lat,lng`.

**Filtros com label explicativo (intervaloLabel):** o `Filtros.tsx` recebe uma prop opcional que mostra "Mostrando X (esta semana de domingo a sábado)". Melhora legibilidade — feature adicionada pelo Evaner direto.

**TopLocais com chevron animado:** botão de expandir cluster é um círculo com ▼ que rotaciona ao abrir — polido pelo Evaner.

## TO-DO / Backlog futuro

Categorizado por valor estimado vs esforço. Ordem decidida pelo Evaner conforme uso real.

### Curto prazo (quando aparecer demanda real)

- [ ] **Curadoria de locais** — Jean fará após 40-90 dias de uso real (decisão consciente pra ter base com nomes reais de campo)
- [ ] **Lançamentos administrativos** — Jean inserir coleta retroativa quando motorista esqueceu / pediu por WhatsApp. Hoje ele pode editar coletas mas não criar novas
- [ ] **Reconhecimento visual da foto** — validar se 800px ficou ok pra outro motorista identificar fachada. Se não, subir pra 1024px (~150KB)

### Médio prazo (semanas/meses)

- [ ] **Rollout efetivo da foto** — semanas 1-3 OFF, semana 4 em 1 motorista, semana 5 em todos
- [ ] **Detector de outliers automático** — alerta se R$/L > 2× média do motorista
- [ ] **Análise de frequência por cliente** — só faz sentido após curadoria ter dados (3+ meses)
- [ ] **Heatmap dia × hora** — produtividade visual
- [ ] **Tendência 12 semanas** — gráfico de linha
- [ ] **Snapshot mensal automático** — backup em CSV no Storage

### Longo prazo / V2

- [ ] **DRE e controle financeiro** — V1 só tem export CSV; DRE estruturado virá depois
- [ ] **Otimização de rota** — usar OSRM (gratuito com OSM) quando volume justificar
- [ ] **Multi-tenant** — se Evaner quiser oferecer pra outras empresas similares
- [ ] **iOS install helper** — detectar iOS user-agent e mostrar tutorial visual passo a passo
- [ ] **Rastreador veicular físico** — alternativa séria ao tracking via PWA, R$50-200 + R$15/mês por veículo

### Dívidas técnicas

- [ ] **Testes automatizados** — spec menciona TDD mas nada implementado
- [ ] **Monitoramento de erros centralizado** — hoje só temos `app_events`. Sentry ou similar quando crescer
- [ ] **Backup PITR do Supabase** — free tier só tem 7 dias. Upgrade Pro ($25/mês) quando dados forem valiosos

### Coisas que considerei mas descartei (com motivo)

- ❌ **PIN de 4 dígitos no lugar de senha** — Evaner escolheu senha tradicional explicitamente
- ❌ **Tracking GPS contínuo do motorista** — PWA não suporta background, bateria pesada
- ❌ **raio_match_m configurável pelo admin** — Evaner simplificou pra 100m fixo
- ❌ **Distância em metros na sugestão pro motorista** — só nome, sem informação técnica
- ❌ **Rastreador via WhatsApp Live Location** — alternativa zero-código mencionada se realmente precisar

## Quando o Evaner voltar com bugs

Ordem natural de investigação:

1. **Bug no fluxo do motorista?** → Veja `app_events` em `/admin/eventos`, filtre por ❌ erros. Eventos têm payload rico.
2. **Coletas presas?** → Filtre `sync_failure` e `sync_skipped_wrong_motorista`. Cada um tem `motivo` claro. Se `sync_skipped_wrong_motorista`, coleta foi feita por outro motorista no mesmo celular (edge case testes).
3. **Foto não chegou?** → Filtre `foto_compress_failed` e `sync_failure` com `fase: "upload_foto"`. Payload tem `path`, `tamanho_bytes`, `session_user_id`, `coleta_motorista_id`, `ids_batem` — geralmente diagnostica na hora.
4. **GPS estranho?** → Filtre eventos `gps_*`. `accuracy` no payload mostra qualidade.
5. **App não abre?** → Provavelmente cache do Service Worker OU Supabase pausou (7 dias inativo). Force refresh, ou vai no dashboard Supabase e restaura.
6. **Login falha com "email/senha inválido"?** → Se foi >7 dias sem uso, Supabase pausou. Restaure o projeto.

Os logs foram instrumentados especificamente pra que o motorista NÃO precise descrever o problema — Evaner consegue debugar remotamente pelo painel.

## Como o Evaner trabalha (importante pra próximas sessões)

- **Ele pede alteração aqui, o Claude implementa + faz deploy** (git push automático). Não é ele quem edita código.
- **Ele é opinionado sobre UX e escopo** — se algo tá dando complexidade demais, ele corta.
- **Ele testa cada mudança em produção** com o celular dele antes de dar OK.
- **Ele às vezes ajusta o código direto pra polir UI** (ex: chevron, intervaloLabel) — respeitar essas mudanças, não reverter.
- **Perguntas técnicas ele quer resposta honesta** — se algo não vai funcionar (ex: 1m raio GPS), explicar o motivo e sugerir alternativa realista.
- **Ele quer feedback antes de implementar mudanças questionáveis**, não "sim senhor" cego.
