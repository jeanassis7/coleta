# Plano Módulo 1 — Cargas + Caminhões + Adiantamentos

> Documento vivo. Consolidação da sessão de brainstorm.
> Ler antes de implementar. Qualquer discordância → marcar aqui e ajustar antes do código.

---

## 1. Contexto

Fase 2 do projeto: transformar "app de coleta" em "controle operacional".

Módulo 1 é a espinha dorsal — sem ele, os módulos futuros (Vendas, Cheques, Caixa, DRE) ficam pendurados no ar. Ele cobre:

- **Cargas**: ciclo operacional do motorista (do início ao descarregamento)
- **Caminhões**: cadastro e gestão da frota
- **Descargas**: fechamento oficial com peso, cruzamento litros vs kg
- **Despesas** e **Abastecimentos**: gastos do motorista durante a carga
- **Adiantamentos**: controle do dinheiro que Jean entrega pra motorista trabalhar

Junto porque **um card do dashboard ("Cargas ativas com R$ na mão") depende dos 4 juntos**.

---

## 2. Regras arquiteturais transversais

Aplicam a tudo neste módulo e a tudo que vier depois.

### 2.1 Gate por role
- **Admin (Jean)**: gate por rota. Já protegido.
- **Dev (Evaner)**: herda admin + vê features gated por `isDev()`
- **Motorista**: gate por **feature flag** individual em `profiles.features` (jsonb)

Feature nova nasce **default OFF** pra todo motorista. Só ligamos manualmente pro motorista-teste, testamos, e quando validada, admin (Jean) começa a ligar pros motoristas reais gradualmente.

### 2.2 Segregação de dados de teste
- `profiles.is_teste boolean default false`
- Motoristas de teste **não aparecem** em: dashboard, KPIs, top locais, curadoria, exports
- **Aparecem em**: painel /admin/motoristas (badge "🧪 TESTE"), painel /admin/eventos, painel /admin/dev/features
- Isso preserva integridade do dashboard do Jean

### 2.3 GPS invisível pro motorista
Captura silenciosa em background em **todo** evento (coleta, descarga, abastecimento, despesa, aceite de adiantamento). Nunca aparece na UI. Nem ícone, nem confirmação, nem checkmark.

### 2.4 Foto obrigatória como filtro natural
- **Descarga**: foto opcional (papel da balança)
- **Coleta**: foto conforme toggle `exige_foto` do motorista (já existe)
- **Despesa**: foto obrigatória — sem foto, sem lançamento (auto-regulação)
- **Abastecimento**: foto obrigatória (posto sempre imprime cupom)

### 2.5 Admin desktop-first, motorista mobile-first
- Telas do painel admin: layout 2-3 colunas, tabelas densas, cabe sem scroll em 1280px+
- Telas do motorista: coluna única, botões grandes, 1 ação por tela

### 2.6 KG é a unidade oficial após descarga
- Motorista declara em **LITROS** (subjetivo, visual)
- Balança marca em **KG** (objetivo, medido)
- Estoque, venda, análise financeira: **KG**
- Litros aparecem só como referência (kg ÷ 0,9)
- Densidade fixa: **0,9 kg/L**

### 2.7 Ciclo de vida de feature
```
Estágio 1 — DEV-ONLY
  Toggle só dev vê, só liga em motorista-teste
  ↓
Estágio 2 — ADMIN-CONTROLLED
  Toggle aparece pro Jean, ele liga em 1 motorista real, gradua
  ↓
Estágio 3 — PADRÃO (opcional)
  Se todo motorista deve ter, remove toggle, vira default
```
Ex: `exige_foto` está no Estágio 2 hoje. `viagem`/`carga` vai começar no Estágio 1.

---

## 3. Fundações (pré-requisitos)

Isso vai antes de qualquer código do Módulo 1.

### 3.1 Schema — Migration `0006_foundations.sql`

```sql
alter table public.profiles
  add column features jsonb not null default '{}'::jsonb,
  add column is_teste boolean not null default false,
  add column mostra_saldo_app boolean not null default false;

create index idx_profiles_is_teste on public.profiles(is_teste);
```

### 3.2 Helpers em `src/lib/auth/roles.ts` (adicionar)

```ts
export function hasFeature(p: ProfileMinimo, feature: string): boolean {
  return !!p?.features?.[feature];
}
```

### 3.3 Nova rota dev-only: `/admin/dev/features`

- Só aparece no menu se `isDev(profile)`
- Lista motoristas de teste (com badge "🧪")
- Cada motorista tem lista de toggles: `carga`, `saldo`, etc.
- Toggle liga/desliga a flag em `profiles.features`

### 3.4 Cria motorista-teste-1

Via script `criar-motorista-teste.mjs`:
- Email: `teste1@coleta.local`
- Senha: `teste123` (Evaner troca depois)
- Nome: "Teste 1"
- Role: `motorista`
- `is_teste: true`
- `features: {}`

### 3.5 Filtro `is_teste=false` nas queries admin

Ajustar em `src/lib/admin/queries.ts` todas queries de:
- Dashboard KPIs
- Custo por motorista
- Certificado por motorista
- Top locais
- Curadoria
- Export CSV

Mantém tudo como está em:
- Aba /admin/motoristas (badge visual)
- Aba /admin/eventos

---

## 4. Módulo 1.A — Caminhões

### 4.1 Schema — parte de `0007_cargas.sql`

```sql
create table public.caminhoes (
  id uuid primary key default gen_random_uuid(),
  placa text not null unique,
  marca text not null,
  modelo text,
  cor text not null,
  capacidade_l integer not null check (capacidade_l > 0),
  tara_kg integer not null check (tara_kg > 0),
  ativo boolean not null default true,
  motivo_inativo text,
  criado_em timestamptz not null default now()
);
create index idx_caminhoes_ativo on public.caminhoes(ativo);
```

### 4.2 Tela `/admin/caminhoes` (desktop)

- Lista todos caminhões (ativos + inativos, com filtro)
- Colunas: Placa · Marca+Modelo · Cor · Capacidade · Tara · Status · Ações
- Ação: [Editar] [Toggle ativo]

### 4.3 Tela cadastro/edição (desktop, modal ou página)

Layout 3 colunas:
- Linha 1: Placa · Marca · Modelo (opcional)
- Linha 2: Cor · Capacidade (L) · Tara (kg) com hint "Média de pesos do caminhão vazio"
- Linha 3: Toggle Ativo. Se desligado, aparece campo motivo com placeholder `Ex: quebrou · vendeu em agosto de 2026`
- Footer: [Cancelar] [Salvar]

### 4.4 Display "canônico"

Onde caminhão aparece em outras UIs: `{placa} {marca} {cor}` (ex: `AAA-0000 Iveco Branco`). Ignora modelo.

### 4.5 Regras
- Placa UNIQUE (validação client + banco)
- Aceita formato antigo (AAA-0000) e Mercosul (AAA1B23)
- Motorista lê lista de caminhões ativos (RLS)
- Só admin/dev cria, edita, inativa

---

## 5. Módulo 1.B — Cargas

### 5.1 Schema — parte de `0007_cargas.sql`

```sql
create table public.cargas (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  caminhao_id uuid not null references public.caminhoes(id),
  km_inicial integer not null,
  km_final integer,
  foto_painel_path text,
  status text not null default 'ativa' check (status in ('ativa','encerrada','cancelada')),
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz,
  criado_em timestamptz not null default now()
);

create index idx_cargas_motorista_status on public.cargas(motorista_id, status);

-- Constraint: só 1 carga ativa por motorista
create unique index idx_cargas_uma_ativa_por_motorista 
  on public.cargas(motorista_id) 
  where status = 'ativa';

-- Coletas ganham vínculo com carga
alter table public.coletas
  add column carga_id uuid references public.cargas(id);
create index idx_coletas_carga on public.coletas(carga_id);
```

### 5.2 Fluxo do motorista — passo a passo

**5.2.1 Login → home**
- Se **NÃO tem carga ativa**: única tela = "Iniciar nova carga" (bloqueia coleta, descarga, menu)
- Se **TEM carga ativa**: home padrão com barra do caminhão + botões

**5.2.2 Home com carga ativa**
```
🚚 AAA-0000 Iveco Branco · 12.000L / 18.000L
████████████░░░░░░░░  67%

[    + NOVA COLETA    ]
[    🏁 DESCARREGAR   ]
[    ≡ MENU CARGA     ]
```

Cores da barra:
- 0-79%: verde, sem texto extra
- 80-100%: amarelo, texto sutil "Se você já descarregou, não esquece de finalizar"
- >100%: vermelho, texto "Você passou da capacidade — provavelmente esqueceu de finalizar uma carga"

Nunca bloqueia, nunca chama pra ação de descarregar. Só informativo.

**5.2.3 Tela Iniciar Carga**
Campos (coluna única, botões grandes):
- Caminhão (dropdown pré-selecionado com último usado por esse motorista)
- Km inicial (teclado numérico; sugerido = km final da carga anterior desse caminhão)
- Foto do painel (opcional — botão passa se não tirar)
- [ INICIAR CARGA ]

Ao confirmar: cria registro `cargas` com status='ativa'. Redireciona pra home.

**5.2.4 Menu Carga**
```
DESCARREGAR
ABASTECIMENTO
DESPESAS
CANCELAR CARGA   (só aparece se sem coletas E sem despesas E sem abastecimentos)
VOLTAR
```

**5.2.5 Nova Coleta**
Idêntica a hoje. Diferença invisível: `coleta.carga_id = carga_ativa.id`.

**5.2.6 Descarregar**
Ver seção 6.

**5.2.7 Cancelar Carga**
Só se `coletas.count = 0 AND despesas.count = 0 AND abastecimentos.count = 0`.
Confirmação simples → status='cancelada'.

### 5.3 Regras
- Só 1 carga ativa por motorista (enforced no schema)
- Coletas AUTO-vinculam à carga ativa (via API que já existe, só adicionar `carga_id`)
- Se motorista sem `features.carga = true`: fluxo antigo (sem gate, coleta vai com `carga_id = null`)
- Se motorista com `features.carga = true`: fluxo novo (obrigatório iniciar carga antes)

---

## 6. Módulo 1.C — Descargas

### 6.1 Schema — parte de `0007_cargas.sql`

```sql
create table public.descargas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  peso_bruto_kg integer not null check (peso_bruto_kg > 0),
  -- Snapshot do caminhoes.tara_kg NO MOMENTO da descarga. Fonte única
  -- de tara é o cadastro do caminhão (Jean edita lá). Motorista NUNCA
  -- edita tara na descarga. Se Jean atualizar a tara do cadastro depois,
  -- descargas antigas preservam a tara que valia quando foram feitas
  -- — cálculo histórico não muda. Snapshot é obrigatório.
  peso_tara_kg integer not null check (peso_tara_kg > 0),
  peso_liquido_kg integer generated always as (peso_bruto_kg - peso_tara_kg) stored,
  litros_estimados integer,
  umidade_pct numeric(4,2),
  foto_papel_path text,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_descargas_carga on public.descargas(carga_id);
```

### 6.2 Tela do motorista

```
Descarregar carga

🚚 AAA-0000 Iveco Branco
Tara: 8.500 kg (auto)

⚖️  Peso bruto (kg)
[    13.200    ]

Peso líquido: 4.700 kg
Estimativa: ≈ 5.220 L

📷 Foto do papel da balança (opcional)
[ Tirar foto ]

[   CONFIRMAR DESCARGA   ]
```

### 6.3 Regras

- `peso_bruto_kg > peso_tara_kg` (senão mostra erro "Peso bruto menor que a tara — confira")
- **Antiburro**: se peso_liquido diferir ±30% do esperado (soma_litros_coletas × 0,9), warning "Peso bem diferente do esperado. Confere?" com botão [continuar] [voltar]
- Ao confirmar → cria `descargas` + atualiza `cargas.status = 'encerrada'` + `cargas.encerrada_em = now()`
- Umidade fica `null` (Jean lança depois pelo painel dele)
- GPS silencioso

### 6.4 Resumo pós-descarga

```
✅ Carga encerrada

📅 Duração: 4 dias
📍 Coletas: 12 locais

⚖️  Peso bruto: 13.200 kg
    Tara:       - 8.500 kg
    Líquido:      4.700 kg

💧 Estimado: ≈ 5.220 L

[    OK    ]
```

Ao clicar OK → volta pra home → sem carga ativa → tela "Iniciar nova carga".

---

## 7. Módulo 1.D — Despesas e Abastecimentos

### 7.1 Schema — parte de `0007_cargas.sql`

```sql
create table public.despesas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  motorista_id uuid not null references public.profiles(id),
  valor integer not null check (valor > 0),
  descricao text not null,
  foto_path text not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_despesas_carga on public.despesas(carga_id);
create index idx_despesas_motorista on public.despesas(motorista_id);

create table public.abastecimentos (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id),
  motorista_id uuid not null references public.profiles(id),
  posto_nome text not null,
  litros numeric(10,2) not null check (litros > 0),
  valor integer not null check (valor > 0),
  km_atual integer not null,
  foto_path text not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now()
);
create index idx_abastecimentos_carga on public.abastecimentos(carga_id);
```

### 7.2 Tela Despesa (motorista)

```
Nova despesa

💰 Valor (R$)
[    45    ]

✏️  Descrição
[ ex: almoço Foz          ]

📷 Foto do comprovante
[ Tirar foto ] ← obrigatória

[  SALVAR DESPESA  ]
```

Regras:
- Botão SALVAR fica cinza (desabilitado) até tirar a foto
- GPS silencioso
- `carga_id = carga_ativa.id`

### 7.3 Tela Abastecimento (motorista)

```
Abastecimento

⛽ Nome do posto
[ ex: Ipiranga Cascavel  ]

💧 Litros
[   120,5   ]

💰 Valor total (R$)
[   680     ]

📍 Km atual
[   150.847 ]  ← sugere último km conhecido

📷 Foto do cupom
[ Tirar foto ] ← obrigatória

[  SALVAR ABASTECIMENTO  ]
```

Regras:
- Todos campos obrigatórios
- Foto obrigatória
- Preço/L calc auto no back (não aparece pro motorista)
- Km atual: sugerido = max(km_inicial_carga, km_ultimo_abastecimento_carga)

---

## 8. Módulo 1.E — Adiantamentos

### 8.1 Schema — Migration `0008_adiantamentos.sql`

```sql
create table public.adiantamentos (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  valor integer not null check (valor > 0),
  data_envio timestamptz not null default now(),
  forma_pagamento text not null check (forma_pagamento in ('dinheiro','pix')),
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  status text not null default 'pendente' check (status in ('pendente','aceito','cancelado')),
  aceito_em timestamptz,
  gps_aceite_lat double precision,
  gps_aceite_lng double precision,
  pular_contador integer not null default 0,
  criado_em timestamptz not null default now()
);
create index idx_adiantamentos_motorista_status on public.adiantamentos(motorista_id, status);

create table public.acertos (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references public.profiles(id),
  -- Timestamp de corte do ciclo. Todas as queries de saldo comparam
  -- eventos (adiantamentos.aceito_em, coletas.criado_em, despesas.criado_em,
  -- abastecimentos.criado_em) contra este valor. Usar timestamptz garante
  -- que o corte é preciso ao segundo, não ao dia — evita bug de coleta
  -- às 14h antes de acerto às 16h cair no ciclo errado.
  corte_em timestamptz not null default now(),
  valor_devolvido integer not null default 0 check (valor_devolvido >= 0),
  valor_vale integer not null default 0 check (valor_vale >= 0),
  valor_saldo integer not null default 0 check (valor_saldo >= 0),
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
create index idx_acertos_motorista_corte on public.acertos(motorista_id, corte_em desc);
```

### 8.2 Fluxo: Jean lança adiantamento

**Tela `/admin/adiantamentos` — modal "Novo adiantamento"**
- Motorista (dropdown)
- Valor (R$)
- Forma: [Dinheiro] [PIX] (radio)
- Observação (opcional)
- [Cancelar] [Enviar]

Ao enviar → cria `adiantamentos` com `status='pendente'`, `registrado_por = jean.id`.

### 8.3 Fluxo: Motorista aceita

**Tela BLOCKING no PWA motorista** — aparece toda vez que abre o app se há adiantamento pendente:

```
💰 Recebimento de R$ 5.000

Jean enviou R$ 5.000 pra você
em 13/08 às 10:32

Forma: PIX
Observação: Adiantamento agosto

Você já recebeu esse dinheiro?

[    ✓ JÁ RECEBI       ]
[    ⏸ AINDA NÃO RECEBI ]
```

**Ao clicar JÁ RECEBI**:
- Confirmação dupla: "Tem certeza que já recebeu R$ 5.000? Isso não tem volta."
- [Cancelar] [Sim, tenho certeza]
- Se confirmar → `status='aceito'`, `aceito_em = now()`, GPS capturado silencioso
- Tela some, motorista prossegue

**Ao clicar AINDA NÃO RECEBI**:
- Sem motivo, sem confirmação
- `pular_contador += 1`
- Tela some (motorista pode trabalhar)
- Volta a aparecer na próxima vez que abrir o app

Se `pular_contador >= 10`: aparece alerta pro Jean no dashboard ("Motorista tá pulando o aceite há 10+ vezes").

### 8.3.1 Regras de concorrência (evitar "dinheiro fantasma")

Aceite e cancelamento precisam ser atômicos no servidor. Sem isso:
motorista carrega tela cached mostrando "pendente" → Jean cancela →
motorista clica "JÁ RECEBI" → dinheiro entra no saldo indevidamente.

**Aceite (motorista clica JÁ RECEBI):**
```sql
update adiantamentos
set status='aceito', aceito_em=now(),
    gps_aceite_lat=?, gps_aceite_lng=?
where id=? and status='pendente'
returning *;
```

Se `0 rows affected` → não está mais `pendente` (Jean cancelou entre load
e clique). Cliente mostra: "Esse adiantamento foi cancelado pelo Jean.
Fala com ele." Tela some, nada entra no saldo.

**Cancelamento (Jean clica Cancelar):**
```sql
update adiantamentos
set status='cancelado'
where id=? and status='pendente'
returning *;
```

Se `0 rows affected` → motorista já aceitou. Jean vê: "Motorista já
aceitou esse adiantamento. Se quer reverter, faz ajuste manual no
próximo acerto."

Mesma proteção vale pra qualquer operação de mudança de estado.

### 8.4 Fluxo: Jean cancela pendente

Se Jean lançou errado (valor errado, motorista errado), enquanto `status='pendente'`:
- Botão [Cancelar] na linha
- Confirmação → `status='cancelado'`
- Cria novo se quiser corrigir

**Não permitir editar.** Só deletar+criar (evita bugs de estado).

### 8.5 Fluxo: Acerto

Aba `/admin/adiantamentos` → botão [Acerto] na linha do motorista:

**Modal Acerto**:
```
Acerto de Lucimar

Recebeu (últimos adiantamentos aceitos): R$ 15.000
Gastou (coletas + despesas + abastecimentos): R$ 12.860
Saldo atual: R$ 2.140

────────────────────────

Como você quer dividir R$ 2.140:

Devolvido (em cash): [    2000    ]
Vale (desconto salário): [    140    ]
Fica de saldo: [    0    ]

Total: R$ 2.140 ✓  (deve bater com saldo atual)

Observação: [                              ]

[Cancelar] [Confirmar acerto]
```

Validação: `devolvido + vale + saldo = saldo_atual`. Se não bater, botão fica cinza.

Ao confirmar → cria `acertos`. **Todos adiantamentos com `status='aceito'` até essa data ficam "consolidados"** (implicitamente — próximo cálculo de saldo começa depois do último acerto).

### 8.6 Cálculo de saldo

```
saldo_atual(motorista) = 
    Σ adiantamentos WHERE status='aceito' AND aceito_em > ultimo_acerto.corte_em
  − Σ coletas.valor_pago WHERE motorista AND criado_em > ultimo_acerto.corte_em
  − Σ despesas.valor WHERE motorista AND criado_em > ultimo_acerto.corte_em
  − Σ abastecimentos.valor WHERE motorista AND criado_em > ultimo_acerto.corte_em
  + ultimo_acerto.valor_saldo (se existe)
```

**Regra crítica**: todos os cortes usam o MESMO campo (`ultimo_acerto.corte_em`),
gravado atomicamente com `default now()` no momento em que Jean confirma o acerto.
Isso elimina ambiguidade temporal (date vs timestamptz coerção) e garante que
uma coleta lançada às 14h antes de um acerto às 16h fica corretamente no
ciclo velho, não no novo.

Se motorista nunca teve acerto: `corte_em` implícito = data de criação do
perfil dele (ou epoch — todas as queries pegam tudo).

### 8.7 Visão do motorista (se `mostra_saldo_app = true`)

Card na home:

```
💰 Seu dinheiro

Último recebido
R$ 5.000 · 13/08 via PIX

Gastou em coletas    R$ 2.140
Gastou em despesas   R$    280
Gastou em combustível R$   580

═════════════════════
Na mão                R$ 2.000
═════════════════════

[Ver detalhes ▾]
```

"Ver detalhes" abre lista completa: histórico de tudo desde último acerto.

---

## 9. Painel do Jean — Sidebar nova e telas

### 9.1 Sidebar vertical à esquerda com grupos

Substituir o header horizontal atual por sidebar:

```
📊 Dashboard

🚚 OPERAÇÃO
   Cargas
   Descarregamentos
   Caminhões
   Adiantamentos

📈 ANÁLISE
   Mapa
   Observações

📋 CADASTROS
   Motoristas
   Locais (Curadoria)

⚙️ SISTEMA
   Eventos
   Dev / Features   ← só dev vê

─────────
🧪 Evaner  DEV
[ Sair ]
```

- Grupos colapsáveis (clique abre/fecha filhos)
- No mobile: hamburger que abre overlay
- Item ativo destacado em verde

### 9.2 Dashboard — cards novos

**Card "Cargas ativas"** (tabela compacta):

| Motorista | Caminhão | Dias | % cheio | Coletas | Litros | R$ na mão |
|---|---|---|---|---|---|---|
| Lucimar | AAA-1234 Iveco | 4 | 85% 🟠 | 8 | 15.300 | R$ 2.140 |
| Luis | BBB-5678 Volvo | 2 | 42% | 3 | 7.560 | R$ 3.780 |

Clique na linha → drill down da carga.

**Card "Descarregamentos recentes"** (últimos 3):
```
Lucimar · 28/07 · 4.700 kg · [Lançar umidade]
Luis · 25/07 · 3.200 kg · umidade 8% ✓
Lucinei · 22/07 · 5.100 kg · [Lançar umidade]
```

**Card "Alertas"** (se houver — se vazio, some).
Formato:
```
🟠 O que aconteceu
Texto humano didático explicando fluxo → problema → causa → ação.

📅 Data · Ver [tela relevante] →     [ OK, VI ]
```

Botão OK marca como visto (não aparece mais). Se condição voltar, alerta novo aparece.

### 9.3 Lista de alertas (linguagem humana)

Ver seção 10.

### 9.4 `/admin/cargas` — tabela densa

19 colunas com sticky column (Data) e sticky header row. Scroll horizontal dentro do container.

Colunas: **Data**, Caminhão, Motorista, Início, Fim, Duração, Coletas, Tara, Bruto, Líquido, Litros (calc), Km rodados, N despesas, $ despesas, N abastecimentos, $ abastecimento, $ coletas, $ total, R$/kg, Umidade, Status

Ordem padrão: **Data desc**. Todas colunas clicáveis pra ordenar.

Clique na linha → drawer lateral com detalhe completo (cada coleta, despesa, abastecimento, descarga, mapa).

### 9.5 `/admin/descarregamentos` — tabela + lançar umidade

Cada descarga como linha:
- Data · Motorista · Caminhão · Peso bruto · Tara · Líquido · Litros estim. · Umidade · Ações

Ação principal: [Lançar umidade] (se `null`) — modal simples pedindo %.

### 9.6 `/admin/adiantamentos`

Tabela superior (motoristas ativos com saldo atual):

| Motorista | Último envio | Status | Saldo atual | Ações |
|---|---|---|---|---|
| Lucimar | R$5.000 · PIX · 13/08 | ✓ Aceito | R$ 2.140 | [+ R$] [Acerto] |
| Luis | R$5.000 · Dinheiro | ⏳ Pendente | — | [+ R$] [Cancelar] |
| Lucinei | R$3.000 · Dinheiro | ✓ Aceito | R$ 4.720 | [+ R$] [Acerto] |

Aba "Histórico" — lista todos adiantamentos + acertos por motorista.

### 9.7 `/admin/caminhoes`

Ver seção 4.2.

### 9.8 `/admin/dev/features` (só dev)

Painel de toggles por motorista:
- Lista motoristas com `is_teste = true`
- Cada linha: toggles ligáveis (carga, saldo, futuros)
- Ligar/desligar altera `profiles.features`

---

## 10. Alertas — texto humano completo

Cada alerta tem: **O que aconteceu · Possíveis causas · Ação · Botão OK**

| Tipo | Texto |
|---|---|
| ⏰ Carga esquecida | "Lucimar iniciou uma carga há 18 dias e não lançou nada de novo. Se ele descarregou de verdade, precisa finalizar aqui pra encerrar essa carga. Se não descarregou, tudo bem — provavelmente parou de trabalhar (folga, doente, etc)." |
| ⚖️ Peso divergente | "Lucimar lançou várias coletas em litros. Na conversão pra kg (multiplicando por 0,9), deveria ter dado ~4.500 kg. Só que ao pesar na balança, deu 3.100 kg — 32% a menos. Pode ser: erro na balança, água/borra no óleo (deveria dar mais peso, mas dá menos = óleo mais leve que o normal), coleta declarada errada, ou vazamento." |
| 💧 Umidade pendente | "Descarga de Lucimar do dia 28/07 ficou 7 dias sem lançamento de umidade. Se você testou e esqueceu de lançar, tá aqui pra registrar. Se não testou, tudo bem — a umidade fica em branco e nenhum desconto é aplicado." |
| 💰 Vale alto sem gasto | "Luis recebeu R$3.500 há 10 dias e não gastou quase nada em coletas ou despesas. Pode ser normal (motorista tá parado por algum motivo) ou pode ser algo errado (perdeu, esqueceu de lançar coletas). Vale checar com ele." |
| 📷 Foto faltando | "Lucinei tem 4 coletas dos últimos dias sem foto (o toggle de foto tá ligado pra ele). Pode ser celular com câmera travada, memória cheia, ou ele burlando o processo. Fica de olho." |
| 🛑 Coleta suspeita | "Luis pagou R$2,50/L numa coleta hoje. A média dele nos últimos 30 dias é R$0,85/L. Diferença de quase 3x. Pode ser óleo raro (motor grande, óleo específico), preço combinado com cliente antigo, ou lançamento errado." *[só ativa se motorista tem ≥ 60 dias de histórico OU ≥ 30 coletas — antes disso a média é instável e o alerta viraria ruído]* |
| 📍 GPS falhando | "Lucimar teve 5 coletas esta semana sem GPS capturado. Isso quebra o mapa e a curadoria de locais. Pode ser celular com GPS desligado, permissão retirada, ou ele coletando dentro de galpão fechado (sinal ruim). Vale conversar." |
| 🔋 Caminhão >100% | "O caminhão AAA-1234 do Lucimar tá marcando 112% cheio no sistema, mas a capacidade é 18.000L. Ele provavelmente descarregou e esqueceu de finalizar a carga aqui no app. Não precisa fazer nada agora — na próxima vez que ele descarregar, é só finalizar essa carga (mesmo que junte 2 descargas físicas em 1 lançamento). O peso na balança vai ser o total real, então o dado fecha certo." |
| ⏸ Pular repetido | "Lucimar tá pulando o aceite de um adiantamento há 10+ vezes. Provavelmente esqueceu, ou tá com dúvida se recebeu de verdade. Fala com ele." |

---

## 11. Migrations SQL — lista completa

Ordem de aplicação:

1. **`0006_foundations.sql`** — features flag, is_teste, mostra_saldo_app
2. **`0007_cargas.sql`** — caminhoes, cargas, descargas, despesas, abastecimentos, coletas.carga_id
3. **`0008_adiantamentos.sql`** — adiantamentos, acertos

Cada migration aplicada via `node scripts/aplicar-migration.mjs supabase/migrations/000X_nome.sql`.

RLS completa em cada tabela nova:
- Motorista: acesso apenas aos próprios registros
- Admin (via `is_admin()` que cobre dev): acesso total

---

## 12. Ordem de implementação (roadmap sugerido)

Cada item = 1 PR/commit lógico. Testa em produção com motorista-teste antes de avançar.

### Bloco 0 — Fundações (pré-requisitos)
1. Migration 0006
2. Script criar-motorista-teste
3. Helper `hasFeature()`
4. Tela `/admin/dev/features`
5. Filtro `is_teste=false` em todas queries admin

### Bloco 1 — Caminhões (rápido)
6. Migration 0007 (só tabela caminhoes)
7. Tela `/admin/caminhoes` (CRUD)

### Bloco 2 — Cargas motorista (grosso)
8. Migration 0007 restante (cargas, coletas.carga_id)
9. Tela "Iniciar carga" (gate `features.carga`)
10. Adaptar home motorista: barra do caminhão + botões
11. Auto-vincular coleta à carga (API existente)
12. Menu carga

### Bloco 3 — Despesas e abastecimentos
13. Migration 0007 restante (despesas, abastecimentos)
14. Tela Despesa (motorista)
15. Tela Abastecimento (motorista)

### Bloco 4 — Descargas
16. Migration 0007 restante (descargas)
17. Tela Descarregar (motorista)
18. Tela resumo pós-descarga

### Bloco 5 — Admin novo layout
19. Sidebar vertical com grupos
20. `/admin/cargas` (tabela sticky + drill down)
21. `/admin/descarregamentos` (com lançar umidade)

### Bloco 6 — Dashboard
22. Card "Cargas ativas"
23. Card "Descarregamentos recentes"
24. Card "Alertas" (implementa os 8 alertas)

### Bloco 7 — Adiantamentos (Jean)
25. Migration 0008
26. `/admin/adiantamentos` — tabela principal + modal novo adiantamento
27. Cálculo de saldo (server function ou query)
28. Modal acerto

### Bloco 8 — Adiantamentos (motorista)
29. Tela BLOCKING de aceite (com double check)
30. Card "Seu dinheiro" na home (se `mostra_saldo_app`)
31. Toggle `mostra_saldo_app` em `/admin/motoristas`

### Bloco 9 — Polimento e testes
32. Testar todos fluxos como motorista-teste
33. Documentar bugs encontrados, corrigir
34. Ativar features gradualmente pros motoristas reais (só com autorização do Evaner)

**Estimativa**: 3-5 semanas de implementação corrida.

---

## 13. Critérios de aceite

Feature considerada "pronta" quando:

- ✅ Testada como motorista-teste em produção
- ✅ Sem erros no `/admin/eventos` durante teste
- ✅ Motorista real não vê nada mudou (gate funcionando)
- ✅ Jean vê o que era esperado no painel dele
- ✅ Dado bate: coleta lançada aparece na carga, na descarga, no saldo

---

## 14. Fora de escopo (V2 ou depois)

Coisas discutidas mas descartadas pra este módulo:

- Push notification pra adiantamento
- Umidade automatizada (máquina compra futura)
- PIX processado pelo próprio app (Opção C — só quando volume justificar)
- Cartão empresa (Flash/Caju) — controle fica no painel do próprio cartão
- Módulo Vendas
- Módulo Cheques
- Módulo Estoque (aparecerá naturalmente após Vendas)
- Módulo Caixa Consolidado
- DRE automática
- Anotação motorista → Jean (WhatsApp resolve)
- Lavagem como categoria específica (motorista escreve em Despesas se quiser)

---

## 15. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Motorista low-tech não adotar fluxo de carga | Fluxo mais simples possível (pré-select caminhão, sugerir km inicial). Menu escondido. Fluxo antigo continua funcionando se `features.carga = false`. |
| Jean confuso com painel novo | Sidebar mantém itens antigos onde estavam. Novidades ficam em grupo OPERAÇÃO. Explicações humanas nos alertas. |
| Dado de teste contaminar dashboard | `is_teste=false` filtro global aplicado em todas queries admin. Testar filtro antes de qualquer teste real. |
| Motorista aceitar adiantamento errado | Double check na tela de aceite. Jean pode cancelar pendente. Sem edição pra evitar bugs. |
| Peso vs litros divergindo constantemente | Alerta didático mostra hipóteses. Antiburro no peso ±30%. Umidade quando entrar refina o dado. |
| Sistema fora do ar durante operação | Motorista continua com fluxo offline (Dexie). Jean pode operar via WhatsApp temporariamente. |

---

## 16. Perguntas ainda em aberto pra este documento

Nenhuma. Todas as decisões foram fechadas na sessão de brainstorm que gerou este plano.

Se durante a leitura você (Evaner) identificar ponto não decidido ou querer alterar, **anota aqui embaixo antes de codar**:

```
- [ ] (adicionar se necessário)
```

---

## 17. Próximos passos

1. Você lê este plano (30-45 min)
2. Marca aqui pontos que quer alterar (seção 16)
3. Se ok, começamos pelo **Bloco 0 (fundações)**
4. Cada bloco terminado, você valida em produção como motorista-teste
5. Avança pro próximo bloco só com teu OK

Estimativa: primeira feature útil (cadastro de caminhão + tela iniciar carga) em ~1 semana. Módulo completo em ~1 mês.
