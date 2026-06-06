# App de Coleta OLUC — Design Spec (V1)

**Data:** 2026-06-06
**Autor:** Brainstorm com Claude (sessão JJHS)
**Status:** Em revisão

---

## 1. Visão geral

Sistema PWA para que 3 motoristas (Luis, Lucimar, Lucinei) registrem coletas de óleo lubrificante usado (OLUC) em campo, e que o gestor (Jean) acompanhe os lançamentos num painel administrativo. Rotas operacionais: Guaíra, Toledo, Cascavel, Foz do Iguaçu — muita área rural e estrada sem sinal.

### Objetivos
1. Lançamento de coleta com no máximo **3 toques e 1 pensamento** por etapa.
2. Funcionamento **100% offline** com sincronização automática transparente.
3. Painel administrativo com KPIs, mapa, filtros, exportação CSV.
4. **R$ 0/mês** de custo operacional no V1 (tudo em tier gratuito).

### Não-objetivos (V2+)
- Lançamentos administrativos, DRE, controle de vendas, gestão de frota.
- Normalização de cadastro de oficinas (será curadoria manual/LLM em V2).
- Otimização de rota / análise de frequência por cliente.
- Suporte a iPhone (declarado Android-only).

---

## 2. Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Framework | Next.js 15 (App Router) | Mono-repo motorista + admin, ecossistema PWA |
| UI | Tailwind CSS | Tipografia/contraste gigante com pouco código |
| Backend | Supabase | Auth + Postgres + Storage num só lugar, free tier robusto |
| Offline queue | Dexie.js (IndexedDB) | Wrapper amigável, queue robusta |
| PWA | Serwist | Sucessor oficial do next-pwa, mantido pela Vercel |
| Foto | browser-image-compression | Comprime no celular antes de subir |
| Mapa admin | Leaflet + react-leaflet + OSM | Zero custo, sem API key, base pra OSRM em V2 |
| Deploy | Vercel | Free tier, integra Next.js perfeito |
| Export CSV | papaparse | 1 dep, gera no client, download direto |
| Testes | Vitest + fake-indexeddb + msw + Playwright | Unit, integration, E2E |

---

## 3. Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│ Browser do motorista (Android, PWA instalado)               │
│                                                              │
│  Next.js — rotas /motorista/*                                │
│   • Login (1ª vez só)                                        │
│   • Home com botão NOVA COLETA + lista do dia                │
│   • Nova coleta (litros, oficina, valor, foto)               │
│   • Confirmação                                              │
│                                                              │
│  Camada offline (Dexie/IndexedDB)                            │
│   • Tabela coletas_locais com Blob da foto                   │
│   • Sync worker (sem polling)                                │
│                                                              │
│  Service Worker (Serwist)                                    │
│   • Cache shell do app                                       │
│   • Background Sync API                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTPS (somente quando online)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase                                                     │
│  • Auth (email + senha, signup desabilitado)                │
│  • Postgres                                                  │
│    └─ profiles, coletas (com RLS)                            │
│  • Storage                                                   │
│    └─ bucket: fotos-coletas (privado, signed URLs)          │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTPS
                           │
┌─────────────────────────────────────────────────────────────┐
│ Browser do Jean (desktop)                                   │
│  Next.js — rotas /admin/*                                    │
│   • Login forte                                              │
│   • Dashboard com KPIs e filtros                             │
│   • Lista, mapa, detalhe                                     │
│   • Exportar CSV                                             │
│   • Gerenciar motoristas                                     │
└─────────────────────────────────────────────────────────────┘
```

### Princípios arquiteturais

1. **Offline-first no motorista.** Toda coleta vai pro IndexedDB imediatamente. Envio pro Supabase é assíncrono e nunca bloqueia o motorista.
2. **Otimismo no save.** Motorista vê "✅ Coleta salva!" no momento que ela chega no IndexedDB, não no servidor.
3. **Sync transparente.** Disparado por eventos discretos (`online`, `visibilitychange`, save), nunca por timer.
4. **Isolamento por rota.** `/motorista/*` é PWA leve. `/admin/*` é página web normal, sem service worker.
5. **RLS no Supabase como camada crítica de segurança.** Motorista só lê/escreve as próprias coletas.

### Estratégia de sync (proteção de bateria)

Crítica para uso em campo rural. Regras explícitas:

1. **Zero polling.** Sem `setInterval` checando conexão. Polling em zona rural sem sinal é o que mais acorda o rádio do celular.
2. **Sync dispara em 4 eventos discretos apenas:**
   - App abre, se `navigator.onLine === true`
   - Evento `online` do browser (sinal nativo do OS)
   - `visibilitychange` para visible, se online
   - Logo após salvar uma coleta nova, se online
3. **Background Sync API (via Serwist).** Quando offline ao salvar, o app **registra** um `sync` event no Service Worker. O Android decide quando há rede de verdade pra disparar — usa scheduler do OS, sem JS acordando rádio.
4. **Sem retry loop em memória.** Falha de envio = item permanece no IndexedDB, próxima tentativa só no próximo gatilho real. Sem `setTimeout` de retry.
5. **GPS só no save.** `getCurrentPosition` com timeout 5s — uma chamada, uma resposta, GPS desliga. **Nunca** `watchPosition`.
6. **Sem realtime/WebSocket no app do motorista.** Conexão persistente fora — manteria rádio ligado.
7. **Modo "totalmente offline detectado":** `navigator.onLine === false` na abertura → nem tenta sync inicial. Espera evento `online`.

### Botão de sync manual (proteção de fallback)

Aparece na Home **se e somente se**:
- Existe pelo menos 1 coleta em estado `pendente` (não enviada)
- `navigator.onLine === true`

Comportamento:
- Toca → spinner por até 30s → resultado.
- Sucesso: "✅ Tudo enviado" e botão some.
- Falha parcial: "Enviou X de Y. Tenta de novo." Botão volta.
- Falha total: "Não consegui enviar. Verifica o sinal." Botão volta.
- Debounce 10s entre toques.
- Offline: botão simplesmente não aparece.

Cobertura desse fallback: bugs no auto-sync, Android não disparando background sync, servidor lento por um período, falsos negativos do evento `online`.

---

## 4. Modelo de dados

### Postgres (Supabase)

#### `profiles` — extensão do `auth.users`

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role text not null check (role in ('motorista', 'admin')),
  ativo boolean not null default true,
  exige_foto boolean not null default false,  -- toggle por motorista
  criado_em timestamptz not null default now()
);
```

#### `coletas`

```sql
create table coletas (
  id uuid primary key default gen_random_uuid(),

  -- identificação
  motorista_id uuid not null references profiles(id),

  -- dados principais
  litros numeric(10,2) not null check (litros > 0),
  local_nome text not null,
  valor_pago integer not null check (valor_pago > 0),  -- R$ inteiros, sem decimal

  -- certificado de coleta
  certificado_tipo text not null check (certificado_tipo in ('integral','parcial','nao')),
  litros_certificado numeric(10,2),  -- null se 'nao', igual a litros se 'integral'

  -- observação livre
  observacao text,

  -- localização
  latitude double precision,
  longitude double precision,
  gps_accuracy double precision,    -- precisão em metros
  gps_capturado boolean not null default false,

  -- foto (pode ser null se exige_foto=false no momento da coleta)
  foto_path text,
  foto_url_cached text,

  -- metadados de captura automática
  device_id text,                   -- UUID persistente no device
  session_id text,                  -- UUID por login
  app_version text,                 -- versão do build

  -- timestamps
  criado_em timestamptz not null,
  sincronizado_em timestamptz default now(),

  -- idempotência
  client_id uuid not null unique
);

create index idx_coletas_motorista on coletas(motorista_id);
create index idx_coletas_criado_em on coletas(criado_em desc);
```

#### `app_events` — log estruturado de eventos do cliente

```sql
create table app_events (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid references profiles(id),
  session_id text,
  device_id text,
  event_type text not null,         -- 'gps_timeout' | 'gps_denied' | 'gps_error' | 'sync_failure' | 'login' | 'logout' | 'app_install' | 'foto_toggle_changed'
  payload jsonb,
  app_version text,
  criado_em timestamptz not null default now()
);

create index idx_app_events_motorista on app_events(motorista_id);
create index idx_app_events_type on app_events(event_type);
create index idx_app_events_criado_em on app_events(criado_em desc);
```

**Decisões-chave:**
- **`criado_em` vem do celular**, não do servidor. Coleta feita às 14h no campo, sincronizada às 19h em casa, mantém 14h como timestamp real. `sincronizado_em` é só pra auditar atraso.
- **`client_id` UUID com `unique`** = idempotência. Segundo INSERT da mesma coleta falha por violação de unique; cliente trata como sucesso. Zero risco de duplicata.
- **`gps_capturado` boolean separado.** Distingue "GPS realmente falhou no campo" de "ainda não foi pra produção".
- **`foto_path` separado de `foto_url_cached`.** Signed URLs expiram; cacheamos a última, regeneramos quando preciso.
- **Sem tabela `oficinas` no V1.** Texto livre em `oficina_nome`. Normalização será curadoria assistida em V2.

### Supabase Storage

```
bucket: fotos-coletas (privado)
estrutura: {motorista_id}/{client_id}.jpg
política: motorista lê/escreve só no próprio prefixo
         admin lê tudo
```

### Row Level Security (RLS)

**`profiles`:**
- Motorista SELECT só o próprio profile.
- Admin SELECT/INSERT/UPDATE todos.

**`coletas`:**
- Motorista SELECT só onde `motorista_id = auth.uid()`.
- Motorista INSERT só onde `motorista_id = auth.uid()`.
- Motorista **não pode** UPDATE/DELETE (imutabilidade pós-envio).
- Admin SELECT/UPDATE/DELETE tudo.

```sql
alter table coletas enable row level security;

create policy "motorista lê próprias coletas"
  on coletas for select
  using (motorista_id = auth.uid());

create policy "motorista insere próprias coletas"
  on coletas for insert
  with check (motorista_id = auth.uid());

create policy "admin tudo"
  on coletas for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );
```

### IndexedDB local (motorista, via Dexie)

```typescript
db.coletas_locais
{
  client_id: string (PK, UUID gerado no save)
  litros: number
  local_nome: string
  valor_pago: number             // inteiro
  certificado_tipo: 'integral' | 'parcial' | 'nao'
  litros_certificado: number | null
  observacao: string | null
  latitude: number | null
  longitude: number | null
  gps_accuracy: number | null
  gps_capturado: boolean
  device_id: string
  session_id: string
  app_version: string
  criado_em: number              // epoch ms
  foto_blob: Blob | null         // null se exige_foto=false
  foto_subida: boolean
  registro_subido: boolean
  tentativas: number
}

db.eventos_locais
{
  id: string (PK, UUID)
  event_type: string
  payload: object
  session_id: string
  device_id: string
  app_version: string
  criado_em: number
  enviado: boolean
}
```

Coleta considerada **enviada** somente quando `foto_subida === true` E `registro_subido === true`. Ordem do upload: foto primeiro (precisa do path), depois INSERT do registro.

---

## 5. UX do motorista

### Tela 0 — Login (apenas 1ª vez)

- Campos: email (`{primeiro_nome}@jjhs.local`) e senha. Olho 👁 pra revelar senha.
- Botão "ENTRAR" verde gigante.
- Sucesso → salva sessão no localStorage (Supabase client). **Nunca expira** automaticamente.
- Erro: "Senha errada, tenta de novo" — sem jargão.

### Tela 1 — Home (depois de logado)

- Saudação "Olá, {nome}" no topo.
- Botão verde gigante **NOVA COLETA** (60% da tela).
- Botão secundário **📤 Enviar agora** apenas se há pendentes + online (ver Seção 3).
- Lista "Minhas coletas" do dia, ordenada decrescente. Antigas removidas da view (permanecem no DB).
- Cada item: ícone `📱` (local) ou `☁️` (enviada) + hora + litros + oficina + valor.
- Tocar item → drawer com detalhe (sem edição em V1).

### Tela 2 — Nova Coleta

Uma tela única com campos visíveis (sem wizard):

1. **Quantos litros?** — input numérico grande, `inputmode="decimal"`, aceita vírgula ou ponto, normaliza pra ponto internamente.

2. **Entregou certificado?** — 3 botões grandes:
   - "✅ Sim, pelos {N}L" (caso comum — pre-preenche `litros_certificado = litros`)
   - "📝 Sim, mas só uma parte" (expande input numérico "Quantos litros no certificado?")
   - "❌ Não emitiu" (marca `certificado_tipo='nao'`)
   - Botão "Sim, pelos {N}L" atualiza dinamicamente conforme o valor de litros.

3. **Nome do local?** — text input, sem sugestões.

4. **Quanto pagou no total?** — `R$` como label **fora** do input (lado esquerdo, não dentro). Input numérico inteiro: `inputmode="numeric"`, sem decimal. Aceita só dígitos. Formatação visual só no `onBlur` (perde foco → exibe valor com separador de milhar). Robusto contra bugs de máscara em tempo real.

5. **Foto do local** — `<input type="file" accept="image/*" capture="environment">`. Após captura mostra thumbnail; botão vira "TROCAR FOTO".
   - **Só aparece se `profile.exige_foto === true`.** Quando `false`, esse card simplesmente não existe na UI.

6. **Algo a observar? (opcional)** — textarea de 3 linhas, sem validação, placeholder cinza.

Botão **SALVAR COLETA** verde, **disabled** até campos obrigatórios preenchidos e válidos (litros, certificado, local, valor, e foto se exigida).

### Linha do tempo do save

```
T+0ms     toca SALVAR
T+0ms     gera client_id UUID
T+0ms     dispara getCurrentPosition (async, timeout 5s)
T+50ms    comprime foto (alvo 640px largura, JPEG q=50, 30-60KB)
T+800ms   foto comprimida pronta
T+800ms   salva no IndexedDB (sem GPS ainda)
T+800ms   navega pra tela de confirmação ✅
                         ← motorista já não está mais esperando
T+800–5000ms (background)
          aguarda GPS responder
          se responde: UPDATE com lat/long, gps_capturado=true
          se timeout: deixa como está
T+5000ms+ tenta sync se online
          se falhar: registra background sync, fica na fila
```

**Confirmação visível em <1s.** GPS e sync rodam em background, motorista nunca espera.

### Tela 3 — Confirmação

- Ícone verde ✅ gigante + "Coleta salva!"
- Resumo: "50L · Mecânica Silva · R$ 80,00"
- Badge de estado: `📱 Salvo no celular` ou `☁️ Enviado`.
- Botões "NOVA COLETA" (encadear) e "IR PRO INÍCIO".
- Auto-retorna pra Home em 8s se nada for tocado.

### PWA install

- Primeira visita pelo navegador: prompt customizado "Instalar app".
- Tocar INSTALAR dispara `beforeinstallprompt` nativo do Chrome Android.
- "Agora não" some o prompt; reaparece em 7 dias.
- Detecta `(display-mode: standalone)` e suprime se já instalado.

### Logout discreto

Brief proíbe menus visíveis pro motorista, mas logout precisa existir (trocar dispositivo, reset por Jean).

- Ícone discreto **⋮** no canto superior direito da Home (24px, baixo contraste).
- Toca → drawer simples com nome do motorista logado + botão **"Sair desta conta"** vermelho.
- Após logout: redireciona pra tela de Login.
- Confirmação dupla: "Tem certeza? Você vai precisar logar de novo." → "Sim, sair".
- Coletas pendentes na fila local **bloqueiam logout** com mensagem clara: "Você tem 3 coletas não enviadas. Conecte na internet e envie antes de sair." (Senão Jean perde dados.)

### Tipografia e contraste

- Base font-size: **20px** mínimo (16px é mínimo pra evitar zoom no Android, mas vamos 20 pra leitura).
- Botões primários: altura **64px+**, font-size **24px**.
- Inputs: altura **56px+**, font-size **24px**.
- Contraste: texto principal AAA (>7:1), botões com fundo saturado.
- Sem ícones-só: sempre acompanhados de texto curto.

---

## 6. UX do admin (Jean)

### Login admin

- Rota `/admin/login`. Email + senha.
- Após login, valida `profile.role === 'admin'`. Se não, derruba sessão e mostra "Acesso negado".
- Senha forte exigida no cadastro: mínimo 12 caracteres.

### Dashboard `/admin`

Barra de filtros:
- **Período:** botões rápidos [Hoje] [Esta semana] [Este mês] + [Customizado] com 2 date pickers.
- **Motorista:** dropdown com os 3 ativos + "Todos".
- Estado vai pra URL (`?periodo=mes&motorista=luis`) pra compartilhamento.

KPIs (5 cards horizontais, atualizam com filtro):
1. Número de coletas
2. Total de litros
3. Total pago (R$)
4. Custo médio por litro (R$)
5. Número de motoristas ativos no período

Por motorista: lista com barra horizontal proporcional ao top performer + (coletas · litros · valor).

### Aba Lista

- Items ordenados por `criado_em` desc.
- Cada item: data/hora + motorista + oficina + litros + valor + custo/litro + status GPS + status sync.
- Clicar abre drawer com detalhe (foto ampliada por lightbox, mini-mapa Leaflet, "Abrir no Google Maps", botão excluir com confirmação dupla).

### Aba Mapa

- Leaflet fullwidth + tiles OSM.
- Pin colorido por motorista (3 cores fixas, mostradas em legenda).
- Clicar pin → popup com oficina, data, litros, valor, link "ver detalhe".
- Coletas sem GPS não aparecem; contador discreto "X coletas sem GPS no período".
- Sem clustering no V1 (até ~2000 pontos OK).

### Exportar CSV

- Aplica filtros atuais.
- Formato: vírgula como separador, UTF-8 com BOM, decimais com ponto.
- Colunas: `data, hora, motorista, oficina, litros, valor_pago, custo_por_litro, latitude, longitude, status`.
- Nome do arquivo: `coletas_{inicio}_a_{fim}.csv`.
- Gerado no client com papaparse, download direto.

### Gerenciar motoristas `/admin/motoristas`

- Lista os 3 motoristas com [Ativo/Desativado] e **toggle [Exige foto]** por motorista.
- **Adicionar:** nome + email gerado `{primeiro_nome}@jjhs.local` + senha temporária.
- Cria via endpoint Next.js server-side com `service_role` (nunca expor no client).
- **Desativar:** `ativo=false`. RLS bloqueia novos inserts daquele user.
- **Reset senha:** gera nova senha temporária, Jean comunica por WhatsApp.
- **Toggle exige_foto:** chave on/off por motorista. Toda mudança grava em `app_events` (auditoria de quem ligou/desligou e quando).

### `/admin/eventos` — log de eventos do app

- Lista cronológica de eventos com filtros: motorista, tipo de evento, período.
- Tipos rastreados:
  - `gps_timeout` (GPS demorou >5s) — payload: `{timeout_ms, coleta_client_id, permissions_state}`
  - `gps_denied` (permissão negada) — payload: `{coleta_client_id, primeira_negacao}`
  - `gps_error` (erro técnico) — payload: `{code, message, coleta_client_id}`
  - `sync_failure` (falha de sync) — payload: `{coleta_client_id, http_status, error}`
  - `login` / `logout`
  - `app_install` (PWA instalado)
  - `foto_toggle_changed` (Jean mudou exige_foto)
- KPI no dashboard principal: "% de coletas com GPS no período" — alarme visual se cair abaixo de 80%.
- No drawer de detalhe de coleta: seção "Eventos relacionados" busca por `coleta_client_id` no payload.

---

## 7. Erros e edge cases

### Motorista

| Cenário | Tratamento | Visível pro motorista |
|---|---|---|
| Sem internet ao salvar | Salva local, registra background sync | "📱 Salvo no celular" |
| GPS negado na 1ª vez | Salva sem coords, `gps_capturado=false` | Nada |
| GPS demora >5s | Timeout, salva sem coords | Nada |
| Câmera negada/cancelada | Botão SALVAR fica disabled | Botão TIRAR FOTO continua aceso |
| Foto >20MB original | Comprime, segue normal | Sem delay perceptível |
| Sessão expirou (improvável) | Auto-refresh do token | Nada |
| Sessão de fato inválida | Captura 401 no sync, redireciona pra login | "Sua sessão expirou, entra de novo" |
| IndexedDB cheio (>50MB) | Bloqueia novo save | "Memória cheia, conecta na internet pra enviar" |
| Sync retorna unique violation | Marca local como enviada (idempotência) | Já estava "☁️" antes |
| Sync retorna 5xx | Mantém na fila | Sem efeito |
| Sync retorna 4xx | Loga, marca como erro permanente | Badge "⚠️ Erro — fala com o Jean" |
| Storage upload da foto falha | Tenta de novo no próximo gatilho | Sem efeito visual |
| 50 coletas em row offline | Funciona, fila acumula | Contador "50 pendentes" |
| Valor=0 ou litros=0 | Validação client bloqueia | Botão SALVAR disabled |

### Admin

| Cenário | Tratamento | Visível pro Jean |
|---|---|---|
| Sem internet | Aviso no topo, desabilita ações | Banner claro |
| Filtro sem resultado | Estado vazio com mensagem | "Nenhuma coleta no período" |
| CSV com 10k+ linhas | Gera mesmo assim | Download normal |
| Signed URL expirou | Regenera ao clicar | Pequeno delay |
| Excluir falha | Toast de erro | "Falha ao excluir, tenta de novo" |
| Email duplicado ao criar motorista | Erro do Supabase Admin API | Toast "Email já existe" |

### Edge cases que merecem teste explícito

- **Sync no meio de um save:** lock no `client_id` durante save evita race.
- **Duas abas admin abertas:** last-write-wins explícito no V1 (risco baixo, só Jean).
- **PWA atualiza com fila pendente:** novo SW ativa, fila local persiste, sync continua.
- **Timezone:** `criado_em` em UTC no DB, exibição em `America/Sao_Paulo` (UTC-3 fixo, sem horário de verão desde 2019 no PR).
- **Caracteres especiais em `oficina_nome`:** "Mecânica & Auto Peças" deve atravessar CSV, SQL e UI sem corromper.

---

## 8. Estratégia de testes

### Filosofia

TDD em camadas. Unit pra lógica pura. Integration pros fluxos críticos com Supabase mockado. E2E só pro golden path.

### Camadas

1. **Unit (Vitest):**
   - Compressão de imagem (mock canvas) — arquivo final < target
   - Máscara de moeda — 8050 → R$ 80,50
   - Parser de litros — aceita "50", "50,5", "50.5"
   - Geração de UUID
   - Cálculo de KPIs (totais, médias, custo/litro)
   - Lógica de "deve disparar sync?" dado estados

2. **Dexie / IndexedDB (Vitest + fake-indexeddb):**
   - Inserir → aparece em getAll()
   - Marcar enviada → some de getPendentes()
   - 100 inserts → ordem preservada
   - Limpar enviadas com >7 dias → mantém pendentes

3. **Integration (Vitest + msw):**
   - Salvar online → POST → marca enviada
   - Salvar offline → fila → sync depois → marca enviada
   - Sync com unique violation → marca enviada
   - Sync com 500 → mantém na fila
   - Login → sessão persiste → reload → home direto
   - RLS: motorista A não vê coleta do B (mock)

4. **E2E motorista (Playwright):**
   - Golden path: login → home → nova coleta → preenche → salva → confirma → volta home → coleta na lista.
   - Não cobrimos offline em E2E (custo alto, coberto em integration).

5. **E2E admin (Playwright):**
   - Login → filtra → KPIs corretos → exporta CSV → CSV tem N linhas.
   - Detalhe abre → foto e mapa renderizam.

6. **Smoke manual checklist (release):**
   - Android real: instala PWA → tira foto → salva offline → liga wifi → vê sync.
   - GPS funciona com sinal e dá timeout sem sinal.
   - Bateria não cai mais que 3% em 1h offline com 5 coletas salvas.

### Cobertura alvo

- Lógica pura (compressão, validações, sync logic): **>90%**
- Camada Dexie: **>80%**
- Componentes UI: smoke tests focados no fluxo
- Sem meta de cobertura % global

### Fora de escopo de teste

- Performance com 10k coletas (V1 terá ~600/mês).
- Acessibilidade WCAG completa.
- Cross-browser (Chrome Android only, declarado).
- Pen test / security audit formal.

---

## 9. Segurança e privacidade

- **RLS é a camada crítica.** Toda regra de acesso é checada pelo Postgres, não pelo client.
- **`service_role` nunca exposta no client.** Endpoints Next.js server-side com Route Handlers usam `service_role` apenas para operações administrativas (criar motorista, reset senha).
- **Storage privado.** Fotos só acessíveis via signed URLs com expiração.
- **Bucket policies** isolam motorista por prefixo.
- **Senhas:** Supabase Auth (bcrypt). Senha admin mínimo 12 chars. Senhas motorista podem ser mais simples (ambiente controlado).
- **Sem dados de estrutura societária** no banco ou UI.
- **CSP estrita** no Next.js, sem inline scripts.
- **HTTPS-only** (forçado pela Vercel).
- **Cookies de sessão** com `SameSite=Lax`, `Secure`, `HttpOnly` onde aplicável.

---

## 10. Deploy e operação

### Ambiente

- **Repo:** monorepo único (Next.js + tudo).
- **Hosting:** Vercel (auto-deploy do branch main).
- **Supabase project:** 1 projeto, ambiente único (V1 sem staging — quando precisar, cria projeto staging separado).
- **Domínio:** definir junto. Sugestão: `coleta.jjhs.com.br` ou similar.

### Distribuição pros motoristas

- Jean cria os 3 usuários no painel admin.
- Manda por WhatsApp: link + email/senha + instruções de instalar PWA.
- Instruções com prints: "abre o link, toca em INSTALAR quando aparecer, vai pra tela inicial, abre o ícone JJHS Coleta, faz login uma vez só."

### Observabilidade mínima V1

- Supabase logs (built-in).
- Vercel logs (built-in).
- Console errors do motorista podem ser enviados via endpoint `/api/log-error` simples se necessário (V1.5).
- Sem Sentry/Datadog no V1.

---

## 11. Resumo do escopo V1

**Pronto pra produção:**
- 3 motoristas registram coletas offline-first.
- Jean vê painel com KPIs, lista, mapa, detalhe, export CSV.
- Sync transparente e botão manual de fallback.
- Custo zero.

**Adiado pra V2:**
- Normalização de cadastro de oficinas.
- Otimização de rota / OSRM.
- DRE, vendas, frota.
- Lançamentos administrativos.
- iPhone / iOS.
- Realtime / push notifications.
