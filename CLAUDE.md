# Projeto Coleta — Contexto pra Claude

App PWA para coleta de óleo lubrificante usado (OLUC). Construído pelo **Evaner** pra empresa do irmão **Jean**.

## Quem usa

- **3 motoristas em campo** (Luis, Lucimar, Lucinei) — Android, PWA instalado. Baixa familiaridade tecnológica — regra de ouro: **se exige mais de 3 toques e um pensamento, está complexo demais**.
- **Jean** — gestor, usa painel admin no computador.

## Rotas operacionais

Guaíra, Toledo, Cascavel, Foz do Iguaçu (oeste do PR). Muita área rural sem sinal — **offline-first é mandatório, não opcional**.

## Stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind**
- **Supabase** (Auth + Postgres + Storage) — projeto `jjhs-coleta`
- **Dexie** (IndexedDB) — fila offline no celular
- **Serwist** — Service Worker, estratégia `StaleWhileRevalidate` pra navegação (CRÍTICO pro offline funcionar com sinal ruim)
- **Leaflet + OSM** — mapa do admin (zero custo, sem API key)
- **PDFKit** — gera o manual do Jean

## URLs e acessos

- **Produção:** https://coleta-inky.vercel.app
- **Admin:** https://coleta-inky.vercel.app/admin/login → `jean@coleta.local` / `Progevaner123$`
- **Repo:** https://github.com/jeanassis7/coleta (Evaner é colaborador)
- **Supabase project:** `jjhs-coleta` (URL `zwghaoubzrkluckrcxwi.supabase.co`)

## Arquitetura — visão rápida

```
/motorista/*    → PWA leve, offline-first
  /login        → primeiro acesso (precisa internet)
  /             → home (NOVA COLETA, lista do dia, botão sync manual)
  /nova-coleta  → form principal
  /confirmacao  → tela de sucesso
/admin/*        → painel web normal
  /login        → fora do (authed)
  /(authed)/    → rotas protegidas
    /           → dashboard com KPIs + análises
    /mapa       → tab dedicada com agregação por local curado
    /observacoes → coletas com observação livre
    /curadoria  → admin agrupa coletas e cria locais canônicos
    /motoristas → CRUD + toggle exige_foto + senha visível
    /eventos    → log estruturado pra debug remoto
```

## Convenções IMPORTANTES

- **Tudo em português** (UI, comentários, variáveis quando faz sentido)
- **Timezone:** `America/Sao_Paulo` (UTC-3 fixo, sem horário de verão desde 2019). Helpers em `src/lib/admin/queries.ts` (`nowBrParts`, `fromBrParts`)
- **Valor pago é INTEIRO** (R$ sem decimal) — coluna `valor_pago integer`
- **Períodos** alinhados ao calendário: "Semana" = domingo a sábado, "Mês" = dia 1 a último dia. Comparações "vs anterior" usam **mesmo intervalo até a mesma data** (justo).
- **Email dos usuários** = identificador interno (`nome@coleta.local`), não é email real
- **Foto:** 800px / JPEG q60 / ~100KB. Comprimida no celular antes de salvar.
- **GPS:** captura ao abrir Nova Coleta (não no save). Timeout 10s. Flag `gps_pendente` impede sync antes de GPS resolver.

## Migrations já aplicadas (NÃO re-criar)

Em `supabase/migrations/`:
- `0001_initial.sql` — schema, RLS, storage bucket
- `0002_admin_features.sql` — `profiles.senha_visivel`
- `0003_locais.sql` — tabela `locais`, função `locais_proximos`, view `locais_com_stats`
- `0004_storage_rls_fix.sql` — UPDATE/DELETE policies pra fotos (resolveu bug "RLS violation")

## O que NÃO fazer

- **Não usar `supabase.auth.getUser()`** no client — faz chamada de rede, quebra offline. Use `getSession()`.
- **Não usar NetworkFirst** pra navegação do PWA — sinal ruim trava. `StaleWhileRevalidate` é deliberado.
- **Não amarrar RLS de storage em path string** comparison — historicamente bugou. Atual é "authenticated pode upload, SELECT é restrito" (segurança via path controlado pelo código).
- **Não criar features sem direção do Evaner** — ele é opinionado e prefere recortar escopo a adicionar coisas que "talvez sejam úteis".
- **Não adicionar tracking GPS contínuo** — limitação de PWA + LGPD + bateria. Discutido e descartado. Se virar prioridade, alternativa é rastreador veicular físico.
- **Não suportar iOS** — explicitamente Android-only no V1.

## Ciclo de vida dos dados

| Dado | Servidor | Retenção local (IndexedDB do celular) |
|---|---|---|
| Coleta (registro) | Supabase Postgres, permanente | Apagada 24h após sync 100% |
| Foto (blob) | Supabase Storage, permanente | Blob apagado junto com a coleta (24h) |
| Evento (log) | Supabase Postgres, permanente | Apagado 7 dias após sync |
| Perfil | Supabase Auth + Postgres | Cache em localStorage pra login offline |

Cleanup automático roda dentro de cada `safeSync` — motorista não precisa fazer nada. Ver `limparColetasSincronizadasAntigas` em `src/lib/sync/queue.ts`.

## Coisas curiosas que aprendi e podem confundir

- **Compilação de path emoji 💧 quebra em PDFKit** — usar SVG path no lugar
- **Storage `upsert: true` precisa de UPDATE policy** — Supabase faz UPDATE quando objeto existe
- **`getSession()` é local-only**, `getUser()` é network — preferir o primeiro no client
- **`navigator.connection` API** funciona em Android Chrome mas não em todos browsers — capturar com try/catch
- **Dexie filter `c.gps_pendente === true`** trata `undefined` como false — bom pra backward compat
- **Service Worker cacheOnNavigation** no Serwist tem comportamento implícito — checar antes de adicionar runtime caching custom

## Workflow de deploy

```cmd
cd C:\Users\Evaner\Desktop\JJHS
git add .
git commit -m "descreve a mudança"
git push
# Vercel detecta o push e faz deploy em ~2 min
```

Scripts auxiliares:
- `node scripts/gerar-icones.mjs` — regenera PNGs a partir de `icone-gota.jfif`
- `node scripts/gerar-tutorial-pdf.mjs` — regenera o manual do Jean

## TO-DO / Backlog futuro

Categorizado por valor estimado vs esforço. Ordem decidida pelo Evaner conforme uso real.

### Curto prazo (quando aparecer demanda real)

- [ ] **Curadoria de locais** — Jean fará após 40-90 dias de uso real (decisão consciente pra ter base com nomes reais de campo). Quando começar, validar UX da página.
- [ ] **Lançamentos administrativos** — Jean inserir coleta retroativa quando motorista esqueceu / pediu por WhatsApp. Hoje ele pode editar coletas mas não criar novas.
- [ ] **Reconhecimento visual da foto** — validar se 800px ficou ok pra outro motorista identificar fachada. Se não, subir pra 1024px (~150KB).

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
- [ ] **iOS support** — se algum motorista comprar iPhone
- [ ] **Rastreador veicular físico** — alternativa séria ao tracking via PWA, R$50-200 + R$15/mês por veículo

### Dívidas técnicas

- [ ] **Testes automatizados** — spec menciona TDD mas nada implementado. Backlog real.
- [ ] **Monitoramento de erros centralizado** — hoje só temos `app_events`. Sentry ou similar quando crescer.
- [ ] **Backup PITR do Supabase** — free tier só tem 7 dias. Upgrade Pro ($25/mês) quando dados forem valiosos.

### Coisas que considerei mas descartei (com motivo)

- ❌ **PIN de 4 dígitos no lugar de senha** — Evaner escolheu senha tradicional explicitamente
- ❌ **Tracking GPS contínuo do motorista** — PWA não suporta background, bateria pesada
- ❌ **Login PIN simplificado** — substituído por senha + senha_visivel no admin
- ❌ **Rastreador via WhatsApp Live Location** — alternativa zero-código mencionada se realmente precisar

## Quando o Evaner voltar com bugs

Ordem natural de investigação:

1. **Bug no fluxo do motorista?** → Veja `app_events` em `/admin/eventos`, filtre por ❌ erros. Eventos têm payload rico.
2. **Coletas presas?** → Filtre `sync_failure` e `sync_skipped_wrong_motorista`. Cada um tem `motivo` claro.
3. **Foto não chegou?** → Filtre `foto_compress_failed` e `sync_failure` com `fase: "upload_foto"`.
4. **GPS estranho?** → Filtre eventos `gps_*`. `accuracy` no payload mostra qualidade.
5. **App não abre?** → Provavelmente cache do Service Worker. Force refresh ou limpar cache.

Os logs foram instrumentados especificamente pra que o motorista NÃO precise descrever o problema — Evaner consegue debugar remotamente pelo painel.
