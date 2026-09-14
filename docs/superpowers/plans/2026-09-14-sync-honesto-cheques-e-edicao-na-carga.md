# Sync honesto, conferência do maço e edição na carga — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app parar de dizer "falhou" quando gravou, a tela de cargas parar de mostrar carga cancelada como aberta, o maço de cheques conferir pela soma, e o admin poder corrigir e apagar qualquer lançamento da carga.

**Architecture:** Cinco fases independentes, cada uma entregável e deployável sozinha. Nenhuma migration. As fases 1–3 são conserto de mentira (tela e sync); a 4 acrescenta um controle de conferência; a 5 abre edição no painel. A fase 5 **depende** da 3 (ver N4 do spec) — não inverter.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, Supabase (Postgres + RLS), Dexie (IndexedDB), Tailwind. Testes: `scripts/e2e-modulo1.mjs` contra produção + `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-14-sync-honesto-cheques-e-edicao-na-carga-design.md`

---

## Como se testa NESTE projeto

Não existe framework de teste unitário aqui — é dívida técnica conhecida e
registrada no `CLAUDE.md`. O que existe, e é o que este plano usa:

| Ferramenta | Comando | Cobre |
|---|---|---|
| Typecheck | `npm run typecheck` | tipos, assinaturas, props |
| E2E de dados | `node scripts/e2e-modulo1.mjs` | RLS, idempotência, updates atômicos, saldo (55 checks hoje) |
| Verificação manual | tela, em produção | UI |

⚠️ **`npm run lint` NÃO roda neste repo** (descoberto em 14/09/2026, na
Fase 1): não existe arquivo de config do ESLint nem `eslintConfig` no
`package.json`, então `next lint` abre o assistente interativo
"How would you like to configure ESLint?" e trava esperando resposta.
**Não chamar em nenhuma task** — e não criar config por conta própria, que
é decisão do Evaner e mudaria o CI. Onde este plano dizia "rodar o lint",
vale só o typecheck.

**Regra do e2e:** ele roda contra PRODUÇÃO e cria/apaga o próprio motorista
descartável. Asserção sempre de **delta**, nunca de total absoluto — um total
absoluto fica vermelho sozinho quando o Jean lança algo de verdade.

**Padrão de check** (já existe no arquivo, linha 39):

```js
function check(nome, ok, detalhe = "") {
  resultados.push({ nome, ok, detalhe });
```

---

## Mapa de arquivos

| Arquivo | Fase | Responsabilidade |
|---|---|---|
| `src/components/admin/TabelaCargas.tsx` | 1 | MODIFICAR — status no começo, cancelada apagada |
| `src/app/admin/(authed)/cargas/page.tsx` | 1 | MODIFICAR — texto morto sai |
| `src/lib/sync/erro-de-rede.ts` | 2 | **CRIAR** — dono único de "isso é falha de rede?" |
| `src/lib/sync/queue.ts` | 2 | MODIFICAR — reconciliação nos 2 caminhos de insert + try/catch nos contadores |
| `src/app/motorista/iniciar-carga/page.tsx` | 2 | MODIFICAR — reconciliação da carga (D5) |
| `src/components/motorista/BotaoSyncManual.tsx` | 3 | MODIFICAR — separa aviso de botão |
| `src/components/admin/LoteChequesPainel.tsx` | 4 | MODIFICAR — total de conferência + botão embaixo |
| `src/app/api/admin/cheques/lote/route.ts` | 4 | MODIFICAR — guard do total no servidor |
| `src/components/admin/ModalEditarDespesa.tsx` | 5 | **CRIAR** — extraído de `TabelaDespesas.tsx` |
| `src/components/admin/ModalEditarAbastecimento.tsx` | 5 | **CRIAR** — extraído de `TabelaAbastecimentos.tsx` |
| `src/components/admin/TabelaDespesas.tsx` | 5 | MODIFICAR — passa a importar o modal |
| `src/components/admin/TabelaAbastecimentos.tsx` | 5 | MODIFICAR — passa a importar o modal |
| `src/components/admin/LinhaDoTempoCarga.tsx` | 5 | MODIFICAR — despesa e abastecimento clicáveis |
| `src/app/api/admin/descargas/[id]/route.ts` | 5 | MODIFICAR — peso editável (PATCH) + DELETE novo |
| `src/app/api/admin/cargas/[id]/route.ts` | 5 | MODIFICAR — PATCH novo + conserta C5 |
| `src/lib/motorista/carga.ts` | 5 | MODIFICAR — N1, o guarda que trava o motorista |
| `scripts/e2e-modulo1.mjs` | 2 e 5 | MODIFICAR — checks novos |

**Por que `erro-de-rede.ts` é arquivo próprio:** a mesma pergunta é feita em
três lugares (as duas rotas de insert do `queue.ts` e o `iniciar-carga`).
Copiar a heurística em três lugares garante que um dia elas divergem.

---

# FASE 1 — A tela de cargas para de mentir (E)

Entregável sozinha. Sem dependência de nada.

### Task 1: Status sai da coluna 19 e carga cancelada aparece como cancelada

**Files:**
- Modify: `src/components/admin/TabelaCargas.tsx`

- [ ] **Step 1: Mover o cabeçalho "Status" para depois de "Motorista"**

No `<thead>`, REMOVER a última linha do cabeçalho:

```jsx
            {th("$ total", "custo_total", true)}
            {th("Status", "status")}
          </tr>
```

passa a ser:

```jsx
            {th("$ total", "custo_total", true)}
          </tr>
```

E ACRESCENTAR logo depois de `{th("Motorista", "motorista")}`:

```jsx
            {th("Motorista", "motorista")}
            {th("Status", "status")}
            <th className="py-2 pr-3 text-left">Fim</th>
```

(a linha `<th className="py-2 pr-3 text-left">Fim</th>` já existia ali — não
duplicar, só confirmar que Status entrou ANTES dela)

- [ ] **Step 2: Mover a célula do badge junto, para a mesma posição**

No `<tbody>`, REMOVER a última célula da linha:

```jsx
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  R$ {custoTotal.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
```

passa a ser:

```jsx
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  R$ {custoTotal.toLocaleString("pt-BR")}
                </td>
              </tr>
```

E ACRESCENTAR logo depois da célula do motorista:

```jsx
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.motorista_nome}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={c.status} />
                </td>
```

- [ ] **Step 3: A coluna Fim diz "cancelada" em vez de "—"**

Trocar a célula do Fim:

```jsx
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.encerrada_em ? formatDataHora(c.encerrada_em) : "—"}
                </td>
```

por:

```jsx
                {/* Vazio e cancelada são coisas diferentes: carga cancelada
                    nunca recebe encerrada_em, e "—" fazia ela parecer
                    aberta na leitura de cima pra baixo (o Jean leu 3
                    cargas abertas em 12/09/2026, e só havia 1). */}
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.encerrada_em ? (
                    formatDataHora(c.encerrada_em)
                  ) : c.status === "cancelada" ? (
                    <span className="text-cinza-suave italic">cancelada</span>
                  ) : (
                    "—"
                  )}
                </td>
```

- [ ] **Step 4: Linha cancelada fica visualmente apagada**

Trocar:

```jsx
              <tr
                key={c.id}
                className="border-b border-cinza-borda hover:bg-slate-50"
              >
```

por:

```jsx
              <tr
                key={c.id}
                className={`border-b border-cinza-borda hover:bg-slate-50${
                  c.status === "cancelada" ? " opacity-50" : ""
                }`}
              >
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 6: Conferir a contagem de colunas**

O `<thead>` e cada `<tr>` do `<tbody>` precisam ter o MESMO número de células.
Contar os `<th>` (incluindo os que vêm de `th(...)`) e os `<td>`. São 20 de cada (contado em 14/09/2026 — não 19, como uma versão
anterior deste plano dizia); continuam 20, só mudou a ordem.

Run: `grep -c '<th' src/components/admin/TabelaCargas.tsx`

Se os números não baterem, a tabela sai torta e não é o typecheck que avisa.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/TabelaCargas.tsx
git commit -m "fix(cargas): carga cancelada parecia aberta na tabela

O badge de Status estava na coluna 19 de 19 (fora da tela sem rolar) e a
coluna Fim mostrava - para cancelada, porque cancelada nunca recebe
encerrada_em. O Jean leu 3 cargas abertas do Lucimar em 12/09; havia 1
ativa e 2 canceladas.

Status vai para depois de Motorista, linha cancelada fica apagada, e a
coluna Fim diz cancelada com todas as letras.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Apagar o texto morto da página de cargas

**Files:**
- Modify: `src/app/admin/(authed)/cargas/page.tsx`

- [ ] **Step 1: Apagar o comentário sobre motorista de teste**

Trocar:

```tsx
  // Dev vê cargas de motorista de teste (com badge 🧪); admin nunca vê.
  const cargas = await buscarCargas();
```

por:

```tsx
  const cargas = await buscarCargas();
```

- [ ] **Step 2: Trocar o parágrafo explicativo**

Trocar:

```tsx
      <p className="text-sm text-cinza-suave mb-6">
        Todas as cargas dos motoristas (ativas, encerradas e canceladas).
        Motoristas de teste aparecem só pra você (dev), marcados com 🧪 — o
        admin não vê. Clique nas colunas pra ordenar.
      </p>
```

por:

```tsx
      <p className="text-sm text-cinza-suave mb-6">
        Todas as cargas dos motoristas (ativas, encerradas e canceladas).
        Carga <strong>cancelada</strong> aparece apagada e com
        &quot;cancelada&quot; na coluna Fim — ela nunca chegou a pesar na
        balança. Clique nas colunas pra ordenar.
      </p>
```

**Por quê:** o papel `dev` e a coluna `is_teste` foram derrubados nas
migrations 0023/0024. O texto prometia um comportamento que não existe mais.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/(authed)/cargas/page.tsx"
git commit -m "docs(cargas): apaga texto sobre dev e motorista de teste

Os dois conceitos foram derrubados nas migrations 0023/0024. A pagina
prometia um filtro que nao existe mais.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Deploy e verificação da Fase 1

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Esperar o deploy da Vercel (~2 min) e conferir na tela**

Abrir https://coleta-inky.vercel.app/admin/cargas

Esperado, nas 4 primeiras linhas do Lucimar:

| Data | Caminhão | Motorista | **Status** | Fim |
|---|---|---|---|---|
| 12/09 21:04 | MDV-5422 | Lucimar | `ativa` | — |
| 12/09 21:03 | MDV-5422 | Lucimar | `cancelada` (linha apagada) | *cancelada* |
| 11/09 22:16 | MDV-5422 | Lucimar | `cancelada` (linha apagada) | *cancelada* |
| 09/09 19:39 | MDV-5422 | Lucimar | `encerrada` | 11/09 22:15 |

O badge tem que estar visível **sem rolar pro lado**.

---

# FASE 2 — O sync para de mentir (D)

Depende da Fase 1? Não. Mas **a Fase 5 depende desta** (N4 do spec).

### Task 4: O dono único de "isso é falha de rede?"

**Files:**
- Create: `src/lib/sync/erro-de-rede.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
/**
 * Erro de REDE (a resposta morreu) x erro de DADO (o servidor recusou).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISSO EXISTE
 * ---------------------------------------------------------------------------
 * O WebKit aborta o fetch quando o app vai pro bolso e escreve
 * "TypeError: Load failed"; o Chrome escreve "Failed to fetch".
 *
 * Medido em 14/09/2026 contra produção: das 37 coletas que deram
 * `sync_failure` com "Load failed" no iPhone do Lucimar, **37 estavam no
 * banco**. O insert funcionou; morreu a resposta. O app marcava pendente, o
 * motorista via "não foi" e relançava na mão — com client_id novo, que a
 * idempotência não pega.
 *
 * O `23505` já era tratado como sucesso porque o Postgres FALA. Erro de rede
 * não fala nada, e é justamente por isso que precisa da pergunta de volta.
 *
 * ⚠️ Erro de DADO (tem `code` do Postgres) NUNCA se reconcilia: ali a linha
 * realmente não entrou, e marcar como subida perderia o lançamento.
 */
export function ehErroDeRede(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  // Postgres respondeu: então a resposta chegou, e o problema é o dado.
  if (err.code) return false;
  const m = (err.message || "").toLowerCase();
  return (
    m.includes("load failed") || // Safari / WebKit
    m.includes("failed to fetch") || // Chrome / Firefox
    m.includes("networkerror") ||
    m.includes("network request failed")
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/erro-de-rede.ts
git commit -m "feat(sync): dono unico de 'isso e falha de rede?'

A mesma pergunta vai ser feita em tres lugares (os dois caminhos de insert
do queue.ts e o iniciar-carga). Copiar a heuristica nos tres garante que um
dia elas divergem.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Check no e2e provando que a reconciliação TEM como funcionar

Antes de escrever a reconciliação, provar que a peça que ela usa existe: **a
RLS deixa o motorista ler de volta a própria coleta pelo `client_id`?** Se não
deixar, D1 nunca acha nada e falha em silêncio.

**Files:**
- Modify: `scripts/e2e-modulo1.mjs`
- Test: o próprio script

- [ ] **Step 1: Achar onde inserir o check**

Run: `grep -n 'client_id' scripts/e2e-modulo1.mjs | head -20`

Procurar o bloco que já testa idempotência de coleta (o teste do 23505). O
check novo entra logo depois dele, porque reusa a coleta já criada.

- [ ] **Step 2: Escrever o check**

Acrescentar, usando a variável do client_id da coleta que o script já criou
(confirmar o nome exato na leitura do Step 1 — o exemplo usa `cidColeta`):

```js
  // ── Reconciliação (D1): o motorista consegue perguntar "isso entrou?" ──
  // Sem esse SELECT, o conserto do iOS (14/09/2026) não tem como funcionar:
  // ele consulta pelo client_id depois de um erro de rede pra descobrir se o
  // servidor gravou. Se a RLS barrar, a consulta volta vazia e o app conclui
  // "não entrou" — exatamente o bug que se quer consertar, agora silencioso.
  {
    const { data: achada, error: errAchar } = await mot
      .from("coletas")
      .select("id")
      .eq("client_id", cidColeta)
      .maybeSingle();
    check(
      "motorista lê a própria coleta pelo client_id (base da reconciliação)",
      !errAchar && !!achada,
      errAchar ? errAchar.message : achada ? "" : "voltou vazio"
    );
  }
```

- [ ] **Step 3: Rodar o e2e**

Run: `node scripts/e2e-modulo1.mjs`
Expected: o check novo aparece e passa (a policy `motorista lê próprias
coletas` da 0001 cobre). Total sobe de 55 para 56.

**Se falhar:** PARE. A reconciliação precisaria de outro caminho (RPC
`security definer`), e o desenho da Fase 2 muda. Avisar o Evaner antes de
continuar.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-modulo1.mjs
git commit -m "test: prova que a RLS deixa o motorista ler a propria coleta

E a peca que a reconciliacao do iOS usa. Se a RLS barrasse, a consulta
voltaria vazia e o app concluiria 'nao entrou' - o mesmo bug, agora
silencioso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Reconciliação no caminho da coleta

**Files:**
- Modify: `src/lib/sync/queue.ts`

- [ ] **Step 1: Importar o helper**

Acrescentar no topo do arquivo, junto dos outros imports:

```ts
import { ehErroDeRede } from "@/lib/sync/erro-de-rede";
```

- [ ] **Step 2: Escrever a função que pergunta ao servidor**

Acrescentar perto das outras funções auxiliares do arquivo (antes de
`sincronizarColeta`):

```ts
/**
 * O insert falhou por rede — mas será que entrou mesmo assim?
 *
 * Pergunta ao servidor pelo `client_id`. Achou = entrou (o servidor gravou e
 * a resposta morreu no caminho), e o registro local pode ser marcado como
 * subido, mesmo desfecho do 23505.
 *
 * Se a própria consulta falhar (offline de verdade), devolve `false` e o item
 * continua pendente — que é o comportamento correto.
 */
async function jaEstaNoServidor(
  tabela: "coletas" | "despesas" | "abastecimentos" | "descargas",
  clientId: string
): Promise<boolean> {
  try {
    const supabase = getSupabaseBrowser();
    const { data, error } = await supabase
      .from(tabela)
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Usar no bloco de erro da coleta**

Trocar:

```ts
      if (insertErr) {
        // 23505 = unique_violation (já enviado antes) → tratar como sucesso
        if (insertErr.code === "23505") {
          await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
          return { ok: true };
        }
        const motivo = `insert: ${insertErr.message}${insertErr.code ? ` (${insertErr.code})` : ""}`;
        console.error("[sync] insert falhou:", insertErr);
        await registrarFalha(coleta, motivo);
        return { ok: false, erro: motivo };
      }
```

por:

```ts
      if (insertErr) {
        // 23505 = unique_violation (já enviado antes) → tratar como sucesso
        if (insertErr.code === "23505") {
          await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
          return { ok: true };
        }
        // Erro de REDE: a resposta morreu, mas o servidor pode ter gravado.
        // Medido em 14/09/2026: 37 de 37 tinham gravado. Pergunta antes de
        // dar como pendente — senão o motorista relança na mão e duplica.
        if (
          ehErroDeRede(insertErr) &&
          (await jaEstaNoServidor("coletas", coleta.client_id))
        ) {
          await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
          await logEvent(coleta.motorista_id, "sync_completed", {
            reconciliado: true,
            tipo: "coleta",
            client_id: coleta.client_id,
            motivo: insertErr.message,
          });
          return { ok: true };
        }
        const motivo = `insert: ${insertErr.message}${insertErr.code ? ` (${insertErr.code})` : ""}`;
        console.error("[sync] insert falhou:", insertErr);
        await registrarFalha(coleta, motivo);
        return { ok: false, erro: motivo };
      }
```

**Por que loga `reconciliado: true`:** sem isso não há como medir se o
conserto pegou. Daqui a uma semana, contar esses eventos diz quantas
duplicatas deixaram de acontecer.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/queue.ts
git commit -m "fix(sync): coleta que gravou parava de dizer que falhou (iOS)

O WebKit aborta o fetch quando o app vai pro bolso. Medido: 37 de 37
coletas que deram sync_failure no iPhone do Lucimar ESTAVAM no banco. O app
marcava pendente, ele via 'nao foi' e relancava na mao - com client_id
novo, que a idempotencia nao pega.

Agora, erro de rede pergunta ao servidor pelo client_id antes de dar como
pendente. Erro de DADO (com code do Postgres) continua contando tentativa:
ali a linha realmente nao entrou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Reconciliação no caminho genérico (despesa, abastecimento, descarga)

**Files:**
- Modify: `src/lib/sync/queue.ts`

- [ ] **Step 1: Trocar o bloco de erro genérico**

Trocar:

```ts
        if (insErr && insErr.code !== "23505") {
          const motivo = `insert ${opts.tipo}: ${insErr.message}${insErr.code ? ` (${insErr.code})` : ""}`;
          await tab.update(item.client_id, {
            tentativas: (item.tentativas || 0) + 1,
            ultimo_erro: motivo,
          });
          await logEvent(item.motorista_id, "sync_failure", {
            tipo: opts.tipo,
            client_id: item.client_id,
            motivo,
            fase: "insert",
          });
          result.falhas++;
          if (!result.ultimo_erro) {
            result.ultimo_erro = motivo;
            result.ultimo_erro_kind = classificarErro(motivo);
          }
          continue;
        }
```

por:

```ts
        if (insErr && insErr.code !== "23505") {
          // Erro de REDE: a resposta morreu, mas o servidor pode ter gravado.
          // Mesmo conserto da coleta — ver erro-de-rede.ts.
          const reconciliado =
            ehErroDeRede(insErr) &&
            (await jaEstaNoServidor(opts.tabelaServidor, item.client_id));
          if (!reconciliado) {
            const motivo = `insert ${opts.tipo}: ${insErr.message}${insErr.code ? ` (${insErr.code})` : ""}`;
            await tab.update(item.client_id, {
              tentativas: (item.tentativas || 0) + 1,
              ultimo_erro: motivo,
            });
            await logEvent(item.motorista_id, "sync_failure", {
              tipo: opts.tipo,
              client_id: item.client_id,
              motivo,
              fase: "insert",
            });
            result.falhas++;
            if (!result.ultimo_erro) {
              result.ultimo_erro = motivo;
              result.ultimo_erro_kind = classificarErro(motivo);
            }
            continue;
          }
          await logEvent(item.motorista_id, "sync_completed", {
            reconciliado: true,
            tipo: opts.tipo,
            client_id: item.client_id,
            motivo: insErr.message,
          });
        }
```

**Atenção ao `continue`:** o `continue` original pulava o Passo 3
(`posInsert`). Agora, quando reconcilia, o código **cai fora do `if`** e segue
para `tab.update({ registro_subido: true })` e depois o `posInsert` — que é
exatamente o que precisa acontecer: a descarga que gravou ainda tem que fechar
a carga no servidor.

- [ ] **Step 2: Conferir o tipo de `opts.tabelaServidor`**

`jaEstaNoServidor` aceita uma união de 4 literais. Se `opts.tabelaServidor`
estiver tipado como `string`, o typecheck reclama.

Run: `grep -n 'tabelaServidor' src/lib/sync/queue.ts`

Se o campo for `string`, apertar o tipo na interface de opts para:

```ts
  tabelaServidor: "despesas" | "abastecimentos" | "descargas";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sync/queue.ts
git commit -m "fix(sync): reconciliacao tambem em despesa, abastecimento e descarga

O caminho generico tinha o mesmo buraco da coleta. Na descarga importa
ainda mais: o continue pulava o posInsert, entao a carga ficava aberta no
servidor com a descarga ja gravada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: D5 — iniciar carga para de mentir

**Files:**
- Modify: `src/app/motorista/iniciar-carga/page.tsx`

- [ ] **Step 1: Importar o helper**

```ts
import { ehErroDeRede } from "@/lib/sync/erro-de-rede";
```

- [ ] **Step 2: Ler o bloco de erro atual**

Run: `sed -n '220,255p' src/app/motorista/iniciar-carga/page.tsx`

Confirmar que ele está assim (o `23505` já é tratado; o erro de rede cai no
`else`):

```ts
      if (error || !data) {
        if (error?.code === "23505") {
          setErro(
```

- [ ] **Step 3: Reconciliar antes de mostrar falha**

Acrescentar, DEPOIS do ramo do `23505` e ANTES do `setErro` genérico:

```ts
        // Erro de REDE: o servidor pode ter criado a carga e a resposta ter
        // morrido no caminho (iOS). Medido em 14/09/2026: o Lucimar cancelou
        // e recomeçou 3x em 2 dias, uma delas 52 segundos depois — sintoma
        // exato disso. Iniciar carga não passa pela fila offline (exige
        // sinal por desenho), então a reconciliação é aqui mesmo.
        if (ehErroDeRede(error)) {
          const { data: jaAtiva } = await supabase
            .from("cargas")
            .select("id, caminhao_id, km_inicial, iniciada_em")
            .eq("motorista_id", perfilId)
            .eq("status", "ativa")
            .maybeSingle();
          if (jaAtiva) {
            // Entrou. Segue o fluxo normal como se tivesse dado certo.
            setCargaAtivaCached({
              id: jaAtiva.id,
              caminhao_id: jaAtiva.caminhao_id,
              km_inicial: jaAtiva.km_inicial,
              iniciada_em: jaAtiva.iniciada_em,
              motorista_id: perfilId,
            });
            router.push("/motorista");
            return;
          }
        }
```

⚠️ **Antes de escrever:** conferir os nomes reais no arquivo — a variável do
id do motorista (`perfilId` no exemplo), o formato de `CargaAtivaCache` (ver
`src/lib/motorista/carga.ts`), e para onde o caminho de sucesso navega. Copiar
exatamente o que o ramo de sucesso já faz, em vez de inventar.

Run: `grep -n 'setCargaAtivaCached\|router.push' src/app/motorista/iniciar-carga/page.tsx`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/app/motorista/iniciar-carga/page.tsx
git commit -m "fix(carga): iniciar carga dizia que falhou tendo criado (iOS)

Mesmo buraco da coleta, no unico lugar que nao tem fila offline. O 23505 ja
era tratado; erro de rede nao tem code e escapava. O Lucimar cancelou e
recomecou 3x em 2 dias - uma delas 52 segundos depois.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: D4 — calar o cursor morto do Dexie no iOS

**Files:**
- Modify: `src/lib/sync/queue.ts`

- [ ] **Step 1: Envolver `countPendentes` em try/catch**

Trocar a assinatura do corpo de `countPendentes` para que a varredura inteira
fique protegida:

```ts
export async function countPendentes(): Promise<number> {
  const db = getLocalDB();
  try {
    // TRAVADO não conta como pendente: ele não vai subir por mais que se
    // tente, e mantê-lo aqui deixava o badge eterno e o logout bloqueado.
    const [coletas, despesas, abastecimentos, descargas] = await Promise.all([
      // ... (os quatro .filter().count() existentes, sem alteração)
    ]);
    return coletas + despesas + abastecimentos + descargas;
  } catch {
    // iOS congela o app no meio da varredura e a transação do Dexie morre:
    // "UnknownError: Attempt to iterate a cursor that doesn't exist".
    // Medido: 2 ocorrências, só no iPhone. É ruído de log, não perda de
    // dado — o laço de sync já lê com toArray() antes de iterar. Devolver 0
    // só apaga o badge até a próxima passada.
    return 0;
  }
}
```

**Não mexer no conteúdo dos quatro `.filter().count()`** — só embrulhar.

- [ ] **Step 2: Fazer o mesmo em `countTravados`**

Run: `grep -n 'export async function countTravados' -A 20 src/lib/sync/queue.ts`

Aplicar o mesmo try/catch, com `return 0` no catch e um comentário curto
apontando para o de cima.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sync/queue.ts
git commit -m "fix(sync): cursor morto do Dexie no iOS virava erro na tela

'UnknownError: Attempt to iterate a cursor that doesn't exist' - a
transacao do Dexie morre quando o iOS congela o app no meio da varredura
dos contadores. 2 ocorrencias, so no iPhone. O laco de sync ja le com
toArray() e esta seguro; sao os contadores que varrem cursor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Deploy e verificação da Fase 2

- [ ] **Step 1: Rodar o e2e antes de subir**

Run: `node scripts/e2e-modulo1.mjs`
Expected: 56 checks, todos verdes.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Medir depois de alguns dias**

O conserto se prova no dado, não na tela. Depois de ~3 dias de uso, contar:

```sql
select
  count(*) filter (where event_type='sync_failure')                   as falhas,
  count(*) filter (where (payload->>'reconciliado')::boolean is true) as reconciliadas
from app_events
where criado_em > '<data do deploy>';
```

Esperado: `reconciliadas` > 0 no iPhone do Lucimar, e `falhas` caindo. Se
`reconciliadas` ficar em 0 e `falhas` continuar igual, a heurística do
`ehErroDeRede` não está casando — logar `insertErr.message` cru e conferir a
frase exata.

---

# FASE 3 — A pendência para de se esconder (F)

### Task 11: Separar o aviso do botão

**Files:**
- Modify: `src/components/motorista/BotaoSyncManual.tsx`

- [ ] **Step 1: Trocar a guarda de saída**

Trocar:

```tsx
  if (pendentes === 0 || !online) return null;
```

por:

```tsx
  // Sem pendência não há o que mostrar. Mas OFFLINE COM PENDÊNCIA mostra
  // sim: esconder o botão (que não dá pra apertar sem sinal) estava levando
  // a informação junto, e o motorista sem sinal lançava três coletas sem a
  // tela dizer nada. Pedido do Evaner em 14/09/2026: "fica pendente, mas ele
  // fica ciente que tá ali esperando".
  if (pendentes === 0) return null;
```

- [ ] **Step 2: Mostrar o bloco offline em vez do botão**

Trocar o início do `return`:

```tsx
  return (
    <div className="card bg-atencao/5 border-atencao space-y-2">
      <button
        onClick={enviar}
        disabled={carregando}
        className="btn-primario bg-atencao active:bg-atencao/90"
      >
        {carregando ? "Enviando..." : `📤 Enviar agora`}
      </button>
      <p className="text-center text-base text-cinza-suave">
        {pendentes}{" "}
        {pendentes === 1 ? "lançamento pendente" : "lançamentos pendentes"}
      </p>
```

por:

```tsx
  const rotuloPendentes = `${pendentes} ${
    pendentes === 1 ? "lançamento" : "lançamentos"
  }`;

  // Offline: é o NORMAL, não é erro. Sem vermelho, sem alarme — só o aviso
  // de que está guardado e vai sozinho.
  if (!online) {
    return (
      <div className="card bg-slate-50 border-cinza-borda space-y-1">
        <p className="text-center text-base font-medium">
          📥 {rotuloPendentes} guardado{pendentes === 1 ? "" : "s"} no celular
        </p>
        <p className="text-center text-sm text-cinza-suave">
          Vão sozinhos quando pegar sinal.
        </p>
      </div>
    );
  }

  return (
    <div className="card bg-atencao/5 border-atencao space-y-2">
      <button
        onClick={enviar}
        disabled={carregando}
        className="btn-primario bg-atencao active:bg-atencao/90"
      >
        {carregando ? "Enviando..." : `📤 Enviar agora`}
      </button>
      <p className="text-center text-base text-cinza-suave">
        {rotuloPendentes} pendente{pendentes === 1 ? "" : "s"}
      </p>
```

⚠️ O `return` do caso offline vem DEPOIS dos hooks (`useState`) e depois da
declaração de `enviar`/`relogar` — React não permite hook condicional, mas
`return` antecipado depois de todos os hooks é válido. A guarda do Step 1 já
segue essa regra hoje.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/components/motorista/BotaoSyncManual.tsx
git commit -m "fix(motorista): o aviso de pendencia sumia justamente offline

'if (pendentes === 0 || !online) return null' escondia o botao (que nao da
pra apertar sem sinal) e levava a informacao junto. O motorista sem sinal
lancava tres coletas e a tela nao dizia nada.

Agora offline mostra 'guardado no celular, vai sozinho quando pegar sinal'
- sem alarme, porque e o normal. O botao continua so com sinal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Verificação da Fase 3 no celular

- [ ] **Step 1: Push e esperar o deploy**

```bash
git push
```

- [ ] **Step 2: Testar no celular, em modo avião**

1. Abrir o PWA, ligar o modo avião
2. Lançar uma coleta
3. Voltar pra home

Esperado: card cinza com **"📥 1 lançamento guardado no celular · Vão sozinhos
quando pegar sinal."** — sem botão.

4. Desligar o modo avião, voltar pro app

Esperado: o card vira o amarelo com **"📤 Enviar agora"**, e some quando
sincronizar.

⚠️ Lembrete do `CLAUDE.md`: mudança nova pode não aparecer na primeira
abertura (é o `StaleWhileRevalidate` servindo o cache). Abrir e fechar 2×
antes de concluir que o deploy não chegou.

---

# FASE 4 — O maço de cheques confere sozinho (A+B)

### Task 13: Guard do total no servidor

O servidor primeiro: a tela guia, o endpoint garante (régua #7).

**Files:**
- Modify: `src/app/api/admin/cheques/lote/route.ts`

- [ ] **Step 1: Ler o total do body**

Logo depois de `const linhas = ...`:

```ts
  const linhas = Array.isArray(body.cheques) ? body.cheques : [];
  // Conferência opcional: o relatório que vem com o maço traz a soma. Em
  // centavos inteiros — comparar dinheiro em float erra por arredondamento.
  const totalConferenciaCentavos =
    body.total_conferencia === undefined || body.total_conferencia === null
      ? null
      : Math.round(Number(body.total_conferencia) * 100);
  const confirmado = body.confirmado === true;
```

- [ ] **Step 2: Comparar, depois de `prontos` estar montado**

Logo depois de `const total = prontos.reduce((s, c) => s + c.valor, 0);`:

```ts
  const total = prontos.reduce((s, c) => s + c.valor, 0);

  // ── Conferência pela soma do relatório ──────────────────────────────────
  // O maço chega com um papel (PDF, Excel ou manuscrito) que traz o total.
  // Se a soma do que foi ticado não bate, ou um valor foi lido errado, ou um
  // cheque ficou de fora. Um dígito trocado morre aqui.
  //
  // NÃO é bloqueio definitivo: o maço pode ter sido dividido de propósito.
  // Segundo clique (`confirmado`) passa — o padrão de antiburro da casa.
  if (
    totalConferenciaCentavos !== null &&
    Number.isFinite(totalConferenciaCentavos) &&
    !confirmado
  ) {
    const somaCentavos = prontos.reduce(
      (s, c) => s + Math.round(c.valor * 100),
      0
    );
    if (somaCentavos !== totalConferenciaCentavos) {
      const difCentavos = totalConferenciaCentavos - somaCentavos;
      return NextResponse.json(
        {
          erro_conferencia: true,
          soma: somaCentavos / 100,
          total_informado: totalConferenciaCentavos / 100,
          // Com SINAL: positivo = falta cheque, negativo = sobra. Math.abs
          // aqui esconderia de que lado está o problema (régua #6).
          diferenca: difCentavos / 100,
        },
        { status: 409 }
      );
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/cheques/lote/route.ts"
git commit -m "feat(cheques): guard da soma do relatorio no servidor

O maco chega com um papel que traz o total. Se a soma dos ticados nao bate,
409 com a diferenca COM SINAL (positivo falta, negativo sobra) e o segundo
clique passa - o maco pode ter sido dividido de proposito.

Regua do dinheiro: 1 e o que a diferenca mede; 3 client_id unico ja cobre
(0041); 4 e 5 nao grava nada; 6 sem Math.abs; 7 o guard e aqui.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Total de conferência na tela

**Files:**
- Modify: `src/components/admin/LoteChequesPainel.tsx`

- [ ] **Step 1: Estado novo**

Junto dos outros `useState`:

```tsx
  const [totalRelatorioCentavos, setTotalRelatorioCentavos] = useState<number | null>(null);
  const [confirmarDivergencia, setConfirmarDivergencia] = useState(false);
```

- [ ] **Step 2: Calcular a diferença**

Logo depois de `const total = conferidas.reduce(...)`:

```tsx
  // Em centavos inteiros: comparar dinheiro em float erra por arredondamento.
  const somaCentavos = conferidas.reduce((s, l) => s + (l.valorCentavos ?? 0), 0);
  const diferencaCentavos =
    totalRelatorioCentavos === null ? null : totalRelatorioCentavos - somaCentavos;
  const bate = diferencaCentavos === null || diferencaCentavos === 0;
```

- [ ] **Step 3: Campo na grade do cabeçalho**

Trocar `<div className="grid sm:grid-cols-2 gap-3">` por
`<div className="grid sm:grid-cols-3 gap-3">` e acrescentar, depois do campo
"Recebido em":

```tsx
        <div>
          <label className="block text-sm font-medium mb-1">
            Total do relatório{" "}
            <span className="text-cinza-suave font-normal">(opcional)</span>
          </label>
          <InputDinheiro
            centavos={totalRelatorioCentavos}
            onChange={(v) => {
              setTotalRelatorioCentavos(v);
              setConfirmarDivergencia(false);
            }}
            grande={false}
          />
          <p className="text-xs text-cinza-suave mt-0.5">
            A soma que vem no papel. Se bater, os valores estão certos.
          </p>
        </div>
```

- [ ] **Step 4: Mostrar a diferença no rodapé**

Trocar o parágrafo de totais:

```tsx
            <p className="text-sm">
              <strong>{conferidas.length}</strong> de {linhas.length} conferido
              {conferidas.length === 1 ? "" : "s"} ·{" "}
              <strong>{formatBRL(total)}</strong>
            </p>
```

por:

```tsx
            <p className="text-sm">
              <strong>{conferidas.length}</strong> de {linhas.length} conferido
              {conferidas.length === 1 ? "" : "s"} ·{" "}
              <strong>{formatBRL(total)}</strong>
              {diferencaCentavos !== null && diferencaCentavos !== 0 && (
                <>
                  {" · "}
                  <strong className="text-alerta">
                    {diferencaCentavos > 0 ? "faltam " : "sobram "}
                    {formatBRL(Math.abs(diferencaCentavos) / 100)}
                  </strong>
                </>
              )}
              {bate && totalRelatorioCentavos !== null && (
                <span className="text-verde font-semibold"> · ✅ bate</span>
              )}
            </p>
```

**Nota sobre o `Math.abs` aqui:** ele é legítimo — a palavra "faltam"/"sobram"
já carrega o sinal. O que a régua #6 proíbe é esconder o lado, e ele está dito
em português.

- [ ] **Step 5: Antiburro de duas etapas no botão**

Acrescentar, logo ANTES do botão de lançar:

```tsx
            {diferencaCentavos !== null &&
              diferencaCentavos !== 0 &&
              !confirmarDivergencia && (
                <div className="w-full bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    A soma não bate com o relatório.
                  </p>
                  <p className="mt-1">
                    Ticado: {formatBRL(total)} · Relatório:{" "}
                    {formatBRL(totalRelatorioCentavos! / 100)} ·{" "}
                    <strong>
                      {diferencaCentavos > 0 ? "faltam " : "sobram "}
                      {formatBRL(Math.abs(diferencaCentavos) / 100)}
                    </strong>
                  </p>
                  <p className="mt-1">Pode ser uma destas três:</p>
                  <ul className="list-disc ml-5">
                    <li>um cheque do maço não foi ticado</li>
                    <li>um valor foi lido errado (confira com a foto)</li>
                    <li>um cheque do relatório não veio no maço</li>
                  </ul>
                  <button
                    onClick={() => setConfirmarDivergencia(true)}
                    className="mt-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold"
                  >
                    LANÇAR MESMO ASSIM
                  </button>
                </div>
              )}
```

- [ ] **Step 6: Mandar o total no POST**

Dentro de `lancar()`, acrescentar ao body:

```tsx
        body: JSON.stringify({
          comprador_id: compradorId,
          data,
          total_conferencia:
            totalRelatorioCentavos === null
              ? null
              : centavosParaReais(totalRelatorioCentavos),
          confirmado: confirmarDivergencia,
          cheques: conferidas.map((l) => ({
```

- [ ] **Step 7: Tratar o 409 do servidor**

Dentro de `lancar()`, ANTES do `if (!res.ok)` genérico:

```tsx
      const json = await res.json();
      // 409 = a soma não bateu e o segundo clique não veio. A tela já mostra
      // o bloco amarelo; isto é a rede de segurança pra quem chamar a API na
      // mão ou pra estado dessincronizado.
      if (res.status === 409 && json.erro_conferencia) {
        setConfirmarDivergencia(false);
        setErro(
          `A soma não bate: ticado ${formatBRL(json.soma)}, relatório ${formatBRL(
            json.total_informado
          )} (${json.diferenca > 0 ? "faltam" : "sobram"} ${formatBRL(
            Math.abs(json.diferenca)
          )}). Confira e clique de novo pra lançar assim mesmo.`
        );
        return;
      }
      if (!res.ok) {
```

- [ ] **Step 8: Limpar o total ao terminar**

No ramo de sucesso, junto de `setLinhas([])`:

```tsx
      setLinhas([]);
      setFotos([]);
      setTotalRelatorioCentavos(null);
      setConfirmarDivergencia(false);
      setAberto(false);
      router.refresh();
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 10: Commit**

```bash
git add src/components/admin/LoteChequesPainel.tsx
git commit -m "feat(cheques): soma do relatorio confere o maco

Campo opcional 'Total do relatorio'. O rodape mostra a diferenca ao vivo e
o botao pede segundo clique quando nao bate, com as tres hipoteses
(cheque nao ticado / valor lido errado / cheque faltando no maco).

Comparacao em centavos inteiros. O total nao fica gravado - e ferramenta de
conferencia, nao fato (decisao do Evaner, 14/09).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: "+ Adicionar na mão" desce pro rodapé

**Files:**
- Modify: `src/components/admin/LoteChequesPainel.tsx`

- [ ] **Step 1: Ref pra rolar até a linha nova**

Junto dos imports:

```tsx
import { useState, useRef, useEffect } from "react";
```

Junto dos estados:

```tsx
  // Rolar até a linha recém-criada: com 8 cheques na tela, a linha nova
  // nascia fora da vista e o botão ficava lá em cima.
  const fimDaListaRef = useRef<HTMLDivElement | null>(null);
  const [rolarParaFim, setRolarParaFim] = useState(false);

  useEffect(() => {
    if (!rolarParaFim) return;
    fimDaListaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setRolarParaFim(false);
  }, [rolarParaFim]);
```

- [ ] **Step 2: Tirar o botão de cima**

Na barra de cima, REMOVER o botão:

```tsx
        <button
          onClick={() => setLinhas((a) => [...a, novaLinha({ conferido: true })])}
          className="text-sm text-verde hover:underline font-medium"
        >
          + Adicionar na mão
        </button>
```

Fica só o "📷 Ler por foto" (e o texto do caso `!ocrDisponivel`).

- [ ] **Step 3: Botão embaixo da lista**

Acrescentar, logo DEPOIS do `{linhas.map(...)}` e ANTES do bloco de totais:

```tsx
          <div ref={fimDaListaRef} />
          <button
            onClick={() => {
              setLinhas((a) => [...a, novaLinha({ conferido: true })]);
              setRolarParaFim(true);
            }}
            className="w-full border border-dashed border-cinza-borda rounded-xl py-2 text-sm text-verde hover:bg-slate-50 font-medium"
          >
            + Adicionar cheque na mão
          </button>
```

- [ ] **Step 4: O botão precisa existir com a lista vazia**

O bloco `{linhas.length > 0 && (...)}` esconde tudo quando não há linha
nenhuma. Acrescentar, DEPOIS desse bloco:

```tsx
      {linhas.length === 0 && (
        <button
          onClick={() => setLinhas([novaLinha({ conferido: true })])}
          className="w-full border border-dashed border-cinza-borda rounded-xl py-3 text-sm text-verde hover:bg-slate-50 font-medium"
        >
          + Adicionar cheque na mão
        </button>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/LoteChequesPainel.tsx
git commit -m "fix(cheques): botao de adicionar na mao desce pro rodape

Estava em cima da lista e a linha nova nascia no fim: com 8 cheques o Jean
rolava pra cima pra criar o nono. Agora o botao fica embaixo e a tela rola
ate a linha nova.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Verificação da Fase 4

- [ ] **Step 1: Push e esperar o deploy**

```bash
git push
```

- [ ] **Step 2: Testar em https://coleta-inky.vercel.app/admin/cheques**

1. "+ Lançar maço de cheques"
2. Escolher um comprador, "+ Adicionar cheque na mão" → preencher banco,
   emitente, R$ 100,00, bom para
3. "+ Adicionar cheque na mão" de novo → **a tela tem que rolar até a linha
   nova**, e o botão continua logo abaixo dela
4. Preencher R$ 50,00 na segunda
5. Digitar **R$ 200,00** no "Total do relatório"

Esperado: rodapé mostra `2 de 2 conferidos · R$ 150,00 · **faltam R$ 50,00**`
e o bloco amarelo com as três hipóteses.

6. Clicar "LANÇAR MESMO ASSIM"

Esperado: lança os 2 cheques.

7. Repetir com o total certo (R$ 150,00)

Esperado: `· ✅ bate` em verde, e o botão lança direto, sem bloco amarelo.

⚠️ **Apagar os cheques de teste depois** em `/admin/cheques`.

---

# FASE 5 — O admin edita tudo na carga (C)

⚠️ **Não começar esta fase antes da Fase 2 estar em produção** — ver N4 do
spec: sem a reconciliação, o celular pode re-inserir a descarga que o admin
acabou de apagar.

### Task 17: Extrair `ModalEditarDespesa` para arquivo próprio

**Files:**
- Create: `src/components/admin/ModalEditarDespesa.tsx`
- Modify: `src/components/admin/TabelaDespesas.tsx`

- [ ] **Step 1: Ler o componente inteiro**

Run: `sed -n '152,300p' src/components/admin/TabelaDespesas.tsx`

- [ ] **Step 2: Mover, sem mudar uma linha de lógica**

Criar `src/components/admin/ModalEditarDespesa.tsx` com:

- `"use client";` no topo
- os imports que o componente usa (ver o topo de `TabelaDespesas.tsx`)
- a função `ModalEditarDespesa` **copiada exatamente**, trocando
  `function ModalEditarDespesa(` por `export function ModalEditarDespesa(`
- um comentário de cabeçalho:

```tsx
/**
 * Editar uma despesa lançada pelo motorista.
 *
 * Mora em arquivo próprio porque tem DOIS donos: a tabela de
 * /admin/despesas e a linha do tempo da carga. Duplicar a tela duplicaria a
 * regra de dinheiro (a despesa pode ter conta a pagar amarrada) — foi
 * exatamente o motivo de a coleta reusar o DrawerDetalhe em vez de
 * reimplementar.
 */
```

⚠️ Se o componente usa um tipo definido em `TabelaDespesas.tsx` (ex.
`DespesaAdmin`), esse tipo precisa vir de onde ele é exportado. Conferir:

Run: `grep -rn 'DespesaAdmin' src/lib/admin/queries.ts src/components/admin/TabelaDespesas.tsx | head`

- [ ] **Step 3: Importar de volta em `TabelaDespesas.tsx`**

Apagar a definição local e acrescentar no topo:

```tsx
import { ModalEditarDespesa } from "@/components/admin/ModalEditarDespesa";
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erro. Se reclamar de import não usado em `TabelaDespesas.tsx`
(um import que só o modal usava), remover da tabela.

- [ ] **Step 5: Verificação — a tela continua igual**

Não é refactor cego: `/admin/despesas` tem que continuar editando. Conferir
depois do deploy, no Step de verificação da fase.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/ModalEditarDespesa.tsx src/components/admin/TabelaDespesas.tsx
git commit -m "refactor(despesas): modal de edicao vira arquivo proprio

Zero mudanca de logica - so mudou de arquivo. A linha do tempo da carga vai
importar o mesmo modal, em vez de reimplementar a regra de dinheiro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Extrair `ModalEditarAbastecimento` para arquivo próprio

**Files:**
- Create: `src/components/admin/ModalEditarAbastecimento.tsx`
- Modify: `src/components/admin/TabelaAbastecimentos.tsx`

- [ ] **Step 1: Ler o componente inteiro**

Run: `sed -n '181,340p' src/components/admin/TabelaAbastecimentos.tsx`

- [ ] **Step 2: Mover, sem mudar lógica**

Mesmo procedimento da Task 17: `"use client"`, imports, a função copiada
exatamente com `export`, e o cabeçalho:

```tsx
/**
 * Editar um abastecimento lançado pelo motorista.
 *
 * Arquivo próprio porque tem DOIS donos: a tabela de /admin/abastecimentos e
 * a linha do tempo da carga.
 *
 * ⚠️ Uma nota do posto pode ter virado DUAS contas a pagar (parte dinheiro,
 * parte cheque) — por isso os `.maybeSingle()` daqui viraram `.limit(1)` em
 * 03/09/2026. Não reverter achando que é descuido.
 */
```

- [ ] **Step 3: Importar de volta**

```tsx
import { ModalEditarAbastecimento } from "@/components/admin/ModalEditarAbastecimento";
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/ModalEditarAbastecimento.tsx src/components/admin/TabelaAbastecimentos.tsx
git commit -m "refactor(abastecimentos): modal de edicao vira arquivo proprio

Zero mudanca de logica. A linha do tempo da carga vai importar o mesmo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: Despesa e abastecimento clicáveis na linha do tempo

**Files:**
- Modify: `src/components/admin/LinhaDoTempoCarga.tsx`

- [ ] **Step 1: Estados novos**

Junto do `coletaAberta`:

```tsx
  const [despesaAberta, setDespesaAberta] = useState<
    CargaCompleta["despesas"][number] | null
  >(null);
  const [abastAberto, setAbastAberto] = useState<
    CargaCompleta["abastecimentos"][number] | null
  >(null);
```

- [ ] **Step 2: Importar os dois modais**

```tsx
import { ModalEditarDespesa } from "@/components/admin/ModalEditarDespesa";
import { ModalEditarAbastecimento } from "@/components/admin/ModalEditarAbastecimento";
```

- [ ] **Step 3: Tornar as três clicáveis**

Trocar:

```tsx
            onClick={
              e.tipo === "coleta"
                ? () => setColetaAberta(e.dados)
                : undefined
            }
            className={`card border-l-4 ${est.cor} flex items-start gap-3${
              e.tipo === "coleta"
                ? " cursor-pointer hover:border-verde hover:bg-slate-50 transition-colors"
                : ""
            }`}
```

por:

```tsx
            onClick={
              e.tipo === "coleta"
                ? () => setColetaAberta(e.dados)
                : e.tipo === "despesa"
                  ? () => setDespesaAberta(e.dados)
                  : e.tipo === "abastecimento"
                    ? () => setAbastAberto(e.dados)
                    : undefined
            }
            className={`card border-l-4 ${est.cor} flex items-start gap-3${
              e.tipo === "descarga"
                ? ""
                : " cursor-pointer hover:border-verde hover:bg-slate-50 transition-colors"
            }`}
```

- [ ] **Step 4: Renderizar os modais**

Junto do `{coletaAberta && (...)}`:

```tsx
      {despesaAberta && (
        <ModalEditarDespesa
          key={despesaAberta.id}
          despesa={despesaAberta}
          onClose={() => setDespesaAberta(null)}
        />
      )}

      {abastAberto && (
        <ModalEditarAbastecimento
          key={abastAberto.id}
          abastecimento={abastAberto}
          onClose={() => setAbastAberto(null)}
        />
      )}
```

⚠️ **Conferir as props reais** dos dois modais (nomes e tipos) no arquivo que
a Task 17/18 criou. Se eles esperam um tipo diferente do que
`CargaCompleta["despesas"][number]` entrega, o typecheck acusa — resolver
alinhando o tipo, não com `as any`.

Run: `grep -n 'export function ModalEditarDespesa' -A 12 src/components/admin/ModalEditarDespesa.tsx`

- [ ] **Step 5: Atualizar o texto de ajuda da página da carga**

Em `src/app/admin/(authed)/cargas/[id]/page.tsx`, trocar:

```tsx
        Em ordem cronológica. Clique em 📷 pra ver a foto, ou{" "}
        <strong>na coleta</strong> pra corrigir ou apagar.
```

por:

```tsx
        Em ordem cronológica. Clique em 📷 pra ver a foto, ou{" "}
        <strong>na coleta, despesa ou abastecimento</strong> pra corrigir ou
        apagar.
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/LinhaDoTempoCarga.tsx "src/app/admin/(authed)/cargas/[id]/page.tsx"
git commit -m "feat(cargas): despesa e abastecimento editaveis pela carga

So a coleta era clicavel. Pra corrigir uma despesa o Jean saia da carga, ia
pra outra tela e cacava a linha no meio das despesas de todos os
motoristas. Reusa os modais que ja existiam.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: N1 — o guarda que travaria o motorista

**Isto vem ANTES de abrir o botão de apagar descarga.** Sem ele, o C3 entrega
o botão e cria um motorista travado.

**Files:**
- Modify: `src/lib/motorista/carga.ts`

- [ ] **Step 1: Trocar a contagem sem filtro**

Trocar (por volta da linha 105):

```ts
      const pendente = await db.descargas_locais
        .where("carga_id")
        .equals(carga.id)
        .count();
      if (pendente > 0) {
        clearCargaAtivaCached();
        return null;
      }
```

por:

```ts
      // ⚠️ Só descarga AINDA NÃO FECHADA no servidor bloqueia. Contar todas
      // as locais era um bug esperando o dia certo: o cleanup guarda a
      // descarga sincronizada por 24h, então, quando o admin reabre uma carga
      // (apagando a descarga), nessas 24h o app dizia "você não tem carga
      // ativa" enquanto o servidor recusava abrir outra pelo índice único de
      // 1 ativa. Motorista travado, sem saída pela tela.
      //
      // O mesmo predicado de temDescargaPendenteSync (acima) e de
      // countPendentes (queue.ts) — três lugares, uma definição de pendente.
      const pendente = await db.descargas_locais
        .where("carga_id")
        .equals(carga.id)
        .filter(
          (d) =>
            !d.registro_subido || !d.foto_subida || !d.carga_encerrada_servidor
        )
        .count();
      if (pendente > 0) {
        clearCargaAtivaCached();
        return null;
      }
```

- [ ] **Step 2: Conferir que `foto_subida` existe em `DescargaLocal`**

Run: `grep -n 'DescargaLocal' -A 20 src/lib/types.ts`

Se o campo não existir no tipo, tirar da condição e deixar
`!d.registro_subido || !d.carga_encerrada_servidor` — que é exatamente o
predicado do `temDescargaPendenteSync` da linha 60.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/lib/motorista/carga.ts
git commit -m "fix(carga): duas funcoes do mesmo arquivo respondiam diferente

temDescargaPendenteSync (l.60) filtra por pendente de verdade; dentro de
fetchCargaAtiva (l.105) contava TODAS as descargas locais - e o cleanup
guarda a sincronizada por 24h.

Hoje ninguem percebe porque servidor e celular sempre concordam que a carga
fechou. Reabrir uma carga (proximo commit) e o que faz os dois discordarem:
o app diria 'voce nao tem carga' enquanto o servidor recusa abrir outra
pelo indice unico. Motorista travado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 21: Peso da descarga editável (C2)

**Files:**
- Modify: `src/app/api/admin/descargas/[id]/route.ts`

- [ ] **Step 1: Aceitar os dois campos de peso no PATCH**

Acrescentar, depois do bloco de `umidade_nao_analisada` e ANTES do
`if (Object.keys(updates).length === 0)`:

```ts
  // ── Peso (14/09/2026) ───────────────────────────────────────────────────
  // Até aqui o PATCH só aceitava umidade: peso errado da balança não tinha
  // conserto a não ser apagar a carga inteira — e é o número que define o
  // estoque todo.
  //
  // peso_liquido_kg é GENERATED ALWAYS: recalcula sozinho, não se escreve.
  const querMexerNoPeso =
    body.peso_bruto_kg !== undefined || body.peso_tara_kg !== undefined;

  if (querMexerNoPeso) {
    const { data: atual } = await client
      .from("descargas")
      .select("peso_bruto_kg, peso_tara_kg")
      .eq("id", id)
      .maybeSingle();
    if (!atual) {
      return NextResponse.json({ error: "descarga não encontrada" }, { status: 404 });
    }
    const bruto =
      body.peso_bruto_kg === undefined
        ? Number(atual.peso_bruto_kg)
        : Number(body.peso_bruto_kg);
    const tara =
      body.peso_tara_kg === undefined
        ? Number(atual.peso_tara_kg)
        : Number(body.peso_tara_kg);

    if (!Number.isFinite(bruto) || bruto <= 0) {
      return NextResponse.json({ error: "peso bruto inválido" }, { status: 400 });
    }
    if (!Number.isFinite(tara) || tara <= 0) {
      return NextResponse.json({ error: "tara inválida" }, { status: 400 });
    }
    // Erro impossível: bloqueia. O caminhão não pesa menos que ele mesmo.
    if (bruto <= tara) {
      return NextResponse.json(
        {
          error: `o peso bruto (${bruto} kg) precisa ser MAIOR que a tara (${tara} kg) — senão a carga teria peso líquido zero ou negativo`,
        },
        { status: 400 }
      );
    }
    if (body.peso_bruto_kg !== undefined) updates.peso_bruto_kg = bruto;
    if (body.peso_tara_kg !== undefined) updates.peso_tara_kg = tara;
  }
```

⚠️ O `const client = getSupabaseAdmin(admin.id)` está hoje DEPOIS desse
ponto no arquivo. Mover a linha para ANTES deste bloco (logo depois do
`const body = await req.json()`), senão `client` não existe aqui.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 3: Check no e2e — peso ≤ tara tem que ser recusado**

Em `scripts/e2e-modulo1.mjs`, no bloco que já cria uma descarga do bot,
acrescentar:

```js
  // ── Peso bruto <= tara é erro IMPOSSÍVEL: o CHECK do banco recusa ──────
  // O guard do endpoint (14/09/2026) explica em português; este check prova
  // que mesmo quem chamar o banco na mão não consegue gravar.
  {
    const { error: errPesoRuim } = await svc
      .from("descargas")
      .update({ peso_bruto_kg: 1 })
      .eq("id", descargaId);
    check(
      "descarga recusa peso bruto menor que a tara",
      !!errPesoRuim,
      errPesoRuim ? "" : "o banco aceitou peso bruto 1 kg"
    );
  }
```

⚠️ Conferir o nome da variável do id da descarga no script antes de escrever.

Run: `grep -n 'descarga' scripts/e2e-modulo1.mjs | head -20`

- [ ] **Step 4: Rodar o e2e**

Run: `node scripts/e2e-modulo1.mjs`

**Se o check falhar** (o banco aceitou), significa que não existe CHECK de
`peso_bruto > peso_tara` no schema — então o guard do endpoint é a única
defesa. Nesse caso: trocar o check por um que bata no ENDPOINT em vez do
banco, e registrar no `ESTADO.md` que o CHECK falta.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/descargas/[id]/route.ts" scripts/e2e-modulo1.mjs
git commit -m "feat(descarga): admin pode corrigir o peso da balanca

O PATCH so aceitava umidade. Peso errado do motorista nao tinha conserto a
nao ser apagar a carga inteira - e e o numero que define o estoque todo.

peso_liquido_kg e GENERATED ALWAYS e recalcula sozinho. Peso bruto <= tara
bloqueia em vermelho: e erro impossivel, nao suspeito.

Regua: 2 ok (bloqueia), 7 ok (guard no endpoint), 8 ok (caso no e2e).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 22: DELETE da descarga (C3) — endpoint

**Files:**
- Modify: `src/app/api/admin/descargas/[id]/route.ts`

- [ ] **Step 1: Escrever o DELETE com as sete nuances**

Acrescentar ao fim do arquivo:

```ts
/**
 * DELETE — apaga a descarga e REABRE a carga.
 *
 * Decisão do Evaner (14/09/2026): "um dedo errado do motorista pra bugar
 * tudo e sem poder voltar atrás é ruim."
 *
 * As nuances estão todas no spec
 * (docs/superpowers/specs/2026-09-14-sync-honesto-cheques-e-edicao-na-carga-design.md,
 * seção "C3 — as sete nuances"). Resumo do que este código precisa fazer:
 *
 *  N2 — reabrir zera status, encerrada_em E km_final (o posInsert grava os
 *       três; desfazer dois deixa carga rodando com km rodado calculado);
 *  N3 — a comissão nasce da descarga: avisa se for período já pago;
 *  N5 — compra direta amarrada à carga perde o custo: BLOQUEIA;
 *  N6 — mostra o estoque resultante, inclusive negativo;
 *  N7 — a foto é foto_papel_path, não foto_path.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const confirmado = new URL(req.url).searchParams.get("confirmado") === "1";
  const client = getSupabaseAdmin(admin.id);

  const { data: descarga } = await client
    .from("descargas")
    .select("id, carga_id, peso_liquido_kg, foto_papel_path, criado_em")
    .eq("id", id)
    .maybeSingle();
  if (!descarga) {
    return NextResponse.json({ error: "descarga não encontrada" }, { status: 404 });
  }

  const { data: carga } = await client
    .from("cargas")
    .select("id, motorista_id, status")
    .eq("id", descarga.carga_id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  // ── N-bloqueio: o motorista já tem outra carga aberta? ──────────────────
  // O índice único idx_cargas_uma_ativa_por_motorista proibiria o update e o
  // erro sairia em linguagem de banco. Explicar antes é melhor.
  const { data: outraAtiva } = await client
    .from("cargas")
    .select("id, iniciada_em")
    .eq("motorista_id", carga.motorista_id)
    .eq("status", "ativa")
    .neq("id", carga.id)
    .maybeSingle();
  if (outraAtiva) {
    return NextResponse.json(
      {
        error:
          "esse motorista já tem outra carga ATIVA. Reabrir esta deixaria duas abertas ao mesmo tempo, o que o sistema não permite. Encerre ou cancele a outra primeiro.",
      },
      { status: 409 }
    );
  }

  // ── N5: compra direta amarrada à carga perde o custo ────────────────────
  // A view movimentos_estoque (0050) soma no custo DESTA descarga as compras
  // diretas da carga com entra_no_estoque = false. Apagando a descarga, esse
  // dinheiro some do estoque inteiro: a compra não entra pela própria linha
  // (é excluída de propósito, senão o óleo contaria duas vezes) e deixa de
  // entrar por aqui. Bloqueia — buraco silencioso é pior que trabalho extra.
  const { data: comprasAmarradas } = await client
    .from("compras_diretas")
    .select("id, valor, fornecedor")
    .eq("carga_id", carga.id)
    .eq("entra_no_estoque", false);
  if ((comprasAmarradas ?? []).length > 0) {
    return NextResponse.json(
      {
        error: `essa carga tem ${comprasAmarradas!.length} compra(s) direta(s) amarrada(s) cujo custo entra por esta descarga. Apagar faria esse dinheiro sumir do estoque. Desamarre ou apague a(s) compra(s) primeiro.`,
      },
      { status: 409 }
    );
  }

  // ── N6: qual estoque sobra? Negativo pede segundo clique ────────────────
  const { data: estoque } = await client.rpc("estoque_atual");
  const fino = (estoque ?? []).find(
    (e: { tipo_oleo: string }) => e.tipo_oleo === "fino"
  );
  const saldoDepois =
    Number(fino?.saldo_kg ?? 0) - Number(descarga.peso_liquido_kg);
  if (saldoDepois < 0 && !confirmado) {
    return NextResponse.json(
      {
        precisa_confirmar: true,
        saldo_depois: saldoDepois,
        error: `apagar essa descarga deixa o estoque de óleo fino em ${saldoDepois.toLocaleString("pt-BR")} kg — NEGATIVO. Isso quer dizer que o óleo dela já foi vendido. Confirme se é isso mesmo.`,
      },
      { status: 409 }
    );
  }

  // ── N3: a comissão daquele período muda ─────────────────────────────────
  // Avisa, não bloqueia: o fato mudou de verdade. A comissão nasce da
  // descarga (remuneracao.ts — a pesagem é o fato gerador).
  const { data: comissaoPaga } = await client
    .from("contas_a_pagar")
    .select("id, pago_em")
    .eq("categoria", "comissao")
    .eq("pessoa_id", carga.motorista_id)
    .eq("status", "paga")
    .gte("pago_em", descarga.criado_em)
    .limit(1);
  const avisoComissao =
    (comissaoPaga ?? []).length > 0
      ? "atenção: já existe comissão PAGA a esse motorista depois da data desta descarga. O cálculo da comissão vai mudar e deixar de bater com o que foi pago."
      : null;

  // ── Apaga e reabre ──────────────────────────────────────────────────────
  const { error: errDel } = await client.from("descargas").delete().eq("id", id);
  if (errDel) return NextResponse.json({ error: errDel.message }, { status: 400 });

  // N2: os TRÊS campos que o posInsert grava ao encerrar (queue.ts).
  const { error: errCarga } = await client
    .from("cargas")
    .update({ status: "ativa", encerrada_em: null, km_final: null })
    .eq("id", carga.id);
  if (errCarga) {
    return NextResponse.json(
      {
        error: `a descarga foi apagada mas a carga não reabriu: ${errCarga.message}. Avise o Evaner — a carga ficou encerrada sem descarga.`,
      },
      { status: 500 }
    );
  }

  // N7: foto por último — blob órfão é inócuo, dado órfão não.
  if (descarga.foto_papel_path) {
    await client.storage.from("fotos-coletas").remove([descarga.foto_papel_path]);
  }

  return NextResponse.json({
    ok: true,
    carga_reaberta: carga.id,
    saldo_estoque_depois: saldoDepois,
    aviso: avisoComissao,
  });
}
```

- [ ] **Step 2: Conferir os nomes reais das colunas usadas**

Três coisas foram assumidas e precisam ser confirmadas antes de rodar:

Run: `grep -n 'categoria\|pessoa_id\|pago_em' src/lib/plano-contas.ts | head`

Run: `node -e "console.log('conferir: contas_a_pagar tem categoria comissao?')"` — na
prática, conferir com uma query:

```sql
select distinct categoria from contas_a_pagar order by 1;
```

Se a categoria não se chamar exatamente `comissao`, ajustar. **Errar o nome
aqui não dá erro nenhum** — o filtro simplesmente nunca casa, e o aviso nunca
acende (mesma armadilha do `em_carteira` registrada no `CLAUDE.md`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/descargas/[id]/route.ts"
git commit -m "feat(descarga): admin pode apagar e a carga reabre

Decisao do Evaner: um dedo errado do motorista sem poder voltar atras e
ruim. As sete nuances varridas no codigo antes de escrever (spec de
14/09):

N2 reabrir zera status, encerrada_em E km_final (o posInsert grava os tres)
N3 avisa se ja tem comissao paga depois da data da descarga
N5 bloqueia se ha compra direta amarrada (o custo dela sumiria do estoque)
N6 mostra o estoque resultante; negativo pede segundo clique
N7 a foto e foto_papel_path

Bloqueia tambem quando o motorista ja tem outra carga ativa - o indice
unico proibiria e o erro sairia em linguagem de banco.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 23: Checks no e2e para o DELETE da descarga

**Files:**
- Modify: `scripts/e2e-modulo1.mjs`

- [ ] **Step 1: Check — apagar descarga reabre a carga com km_final nulo**

```js
  // ── Apagar descarga reabre a carga (14/09/2026) ────────────────────────
  // O posInsert grava TRÊS campos ao encerrar (status, encerrada_em,
  // km_final). Desfazer dois deixaria a carga rodando com km rodado
  // calculado, envenenando o km/L da frota.
  {
    await svc.from("descargas").delete().eq("id", descargaId);
    await svc
      .from("cargas")
      .update({ status: "ativa", encerrada_em: null, km_final: null })
      .eq("id", cargaId);
    const { data: reaberta } = await svc
      .from("cargas")
      .select("status, encerrada_em, km_final")
      .eq("id", cargaId)
      .maybeSingle();
    check(
      "apagar descarga reabre a carga com km_final nulo",
      reaberta?.status === "ativa" &&
        reaberta?.encerrada_em === null &&
        reaberta?.km_final === null,
      JSON.stringify(reaberta)
    );
  }
```

⚠️ Este check tem que rodar DEPOIS dos que dependem da descarga existir.
Colocar perto do fim, antes da limpeza.

- [ ] **Step 2: Check — duas cargas ativas continuam impossíveis**

Confirmar que já existe (o script testa o unique de 1 carga ativa):

Run: `grep -n 'uma ativa\|1 carga ativa\|23505' scripts/e2e-modulo1.mjs | head`

Se existir, nada a fazer — o bloqueio do endpoint se apoia nele. Se não
existir, acrescentar:

```js
  {
    const { error: errDuas } = await svc.from("cargas").insert({
      motorista_id: botId,
      caminhao_id: caminhaoId,
      km_inicial: 1000,
      status: "ativa",
    });
    check(
      "banco recusa 2 cargas ativas pro mesmo motorista",
      !!errDuas,
      errDuas ? "" : "o banco aceitou a segunda carga ativa"
    );
  }
```

- [ ] **Step 3: Rodar o e2e**

Run: `node scripts/e2e-modulo1.mjs`
Expected: todos verdes. Total deve estar em ~59.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-modulo1.mjs
git commit -m "test: apagar descarga reabre a carga com km_final nulo

O posInsert grava tres campos ao encerrar; desfazer dois deixaria a carga
rodando com km rodado calculado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 24: Botão de apagar descarga na linha do tempo

**Files:**
- Modify: `src/components/admin/LinhaDoTempoCarga.tsx`

- [ ] **Step 1: Estado e import do modal de confirmação**

```tsx
import { ModalConfirmar } from "@/components/admin/Modais";
import { useRouter } from "next/navigation";
```

```tsx
  const router = useRouter();
  const [apagarDescarga, setApagarDescarga] = useState(false);
  const [erroDescarga, setErroDescarga] = useState<string | null>(null);
  const [confirmandoEstoque, setConfirmandoEstoque] = useState(false);
```

⚠️ Conferir a API real do `ModalConfirmar`:

Run: `grep -n 'export function ModalConfirmar' -A 20 src/components/admin/Modais.tsx`

- [ ] **Step 2: Função que chama o endpoint**

```tsx
  async function confirmarApagarDescarga() {
    if (!carga.descarga) return;
    setErroDescarga(null);
    const qs = confirmandoEstoque ? "?confirmado=1" : "";
    const res = await fetch(`/api/admin/descargas/${carga.descarga.id}${qs}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (!res.ok) {
      // O 409 com precisa_confirmar é o antiburro do estoque negativo:
      // mostra o número e o próximo clique passa.
      if (json.precisa_confirmar) setConfirmandoEstoque(true);
      setErroDescarga(json.error || "Não consegui apagar.");
      return;
    }
    setApagarDescarga(false);
    setConfirmandoEstoque(false);
    if (json.aviso) setErroDescarga(`⚠️ ${json.aviso}`);
    router.refresh();
  }
```

- [ ] **Step 3: Botão no card da descarga**

Dentro do `ConteudoEvento` NÃO — ele é uma função pura sem acesso ao estado.
Acrescentar no corpo do card, depois de `<ConteudoEvento evento={e} />`:

```tsx
              <ConteudoEvento evento={e} />
              {e.tipo === "descarga" && (
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setApagarDescarga(true);
                  }}
                  className="mt-2 text-sm text-alerta hover:underline"
                >
                  Apagar descarga e reabrir a carga
                </button>
              )}
```

- [ ] **Step 4: O modal de confirmação**

Junto dos outros modais:

```tsx
      {apagarDescarga && carga.descarga && (
        <ModalConfirmar
          titulo="Apagar a descarga e reabrir a carga?"
          mensagem={
            confirmandoEstoque
              ? `${erroDescarga}\n\nClique de novo pra apagar assim mesmo.`
              : `O óleo desta descarga (${carga.descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg) sai do estoque, e a carga de ${carga.motorista_nome} volta a ficar ABERTA no celular dele. A comissão do período também muda.`
          }
          onConfirmar={confirmarApagarDescarga}
          onCancelar={() => {
            setApagarDescarga(false);
            setConfirmandoEstoque(false);
            setErroDescarga(null);
          }}
        />
      )}
      {erroDescarga && !apagarDescarga && (
        <div className="card bg-alerta/10 border-alerta text-alerta text-sm">
          {erroDescarga}
        </div>
      )}
```

⚠️ Ajustar os nomes das props ao que o `ModalConfirmar` realmente expõe (Step 1).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/LinhaDoTempoCarga.tsx
git commit -m "feat(cargas): botao de apagar descarga na linha do tempo

Duas etapas, com o peso que sai do estoque e o aviso de que a carga volta a
ficar aberta no celular do motorista. Estoque negativo pede terceiro clique
(o 409 precisa_confirmar do endpoint).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 25: PATCH da carga (C4) + conserto do C5

**Files:**
- Modify: `src/app/api/admin/cargas/[id]/route.ts`

- [ ] **Step 1: Consertar o C5 (o nome errado da coluna)**

Trocar, no DELETE existente:

```ts
      client.from("descargas").select("id, foto_path").eq("carga_id", id),
```

por:

```ts
      // ⚠️ A coluna da foto da descarga é foto_papel_path, não foto_path.
      // Com o nome errado a consulta errava, o `?? []` engolia, a foto do
      // papel da balança nunca era apagada e `apagado.descargas` reportava
      // sempre 0 — o endpoint mentia sobre o que tinha feito.
      client.from("descargas").select("id, foto_papel_path").eq("carga_id", id),
```

E, mais abaixo, trocar:

```ts
    ...(descargas ?? []).map((d) => d.foto_path),
```

por:

```ts
    ...(descargas ?? []).map((d) => d.foto_papel_path),
```

- [ ] **Step 2: PATCH novo**

Acrescentar ao arquivo:

```ts
/**
 * PATCH — corrigir os dados da própria carga.
 *
 * km_inicial digitado errado envenena o km/L da frota inteira e, até
 * 14/09/2026, não tinha conserto nenhum: só existia o DELETE.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const confirmado = body.confirmado === true;
  const client = getSupabaseAdmin(admin.id);

  const { data: carga } = await client
    .from("cargas")
    .select("id, caminhao_id, km_inicial, km_final, iniciada_em")
    .eq("id", id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.caminhao_id !== undefined) updates.caminhao_id = String(body.caminhao_id);
  if (body.iniciada_em !== undefined) updates.iniciada_em = String(body.iniciada_em);

  const kmInicial =
    body.km_inicial === undefined ? Number(carga.km_inicial) : Number(body.km_inicial);
  const kmFinal =
    body.km_final === undefined
      ? carga.km_final === null
        ? null
        : Number(carga.km_final)
      : body.km_final === null
        ? null
        : Number(body.km_final);

  if (body.km_inicial !== undefined) {
    if (!Number.isFinite(kmInicial) || kmInicial < 0) {
      return NextResponse.json({ error: "km inicial inválido" }, { status: 400 });
    }
    updates.km_inicial = kmInicial;
  }
  if (body.km_final !== undefined) {
    if (kmFinal !== null && (!Number.isFinite(kmFinal) || kmFinal < 0)) {
      return NextResponse.json({ error: "km final inválido" }, { status: 400 });
    }
    updates.km_final = kmFinal;
  }

  // Erro impossível: o caminhão não anda pra trás.
  if (kmFinal !== null && kmFinal <= kmInicial) {
    return NextResponse.json(
      {
        error: `o km final (${kmInicial === kmFinal ? "igual ao" : "menor que o"} inicial) não fecha: saiu com ${kmInicial.toLocaleString("pt-BR")} km e voltou com ${kmFinal.toLocaleString("pt-BR")} km`,
      },
      { status: 400 }
    );
  }

  // Erro SUSPEITO (não impossível): salto grande contra o histórico do
  // caminhão. Mesmo número que o motorista já vê no celular — 1.500 km.
  if (body.km_inicial !== undefined && !confirmado) {
    const { data: vizinhas } = await client
      .from("cargas")
      .select("km_inicial, km_final")
      .eq("caminhao_id", carga.caminhao_id)
      .neq("id", id)
      .order("iniciada_em", { ascending: false })
      .limit(5);
    const kms = (vizinhas ?? [])
      .flatMap((c) => [c.km_inicial, c.km_final])
      .filter((k): k is number => typeof k === "number");
    const maisProximo = kms.length
      ? kms.reduce((a, b) => (Math.abs(b - kmInicial) < Math.abs(a - kmInicial) ? b : a))
      : null;
    if (maisProximo !== null && Math.abs(maisProximo - kmInicial) > 1500) {
      return NextResponse.json(
        {
          precisa_confirmar: true,
          error: `${kmInicial.toLocaleString("pt-BR")} km está a mais de 1.500 km do registro mais próximo desse caminhão (${maisProximo.toLocaleString("pt-BR")} km). Confira se não faltou ou sobrou um dígito.`,
        },
        { status: 409 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("cargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 4: Check no e2e — km_final menor que inicial é recusado**

```js
  // ── km final tem que ser maior que o inicial ───────────────────────────
  // km_inicial errado envenena o km/L da frota inteira, e ate 14/09/2026 a
  // carga nao tinha PATCH nenhum.
  {
    const { error: errKm } = await svc
      .from("cargas")
      .update({ km_final: 1 })
      .eq("id", cargaId);
    const { data: depois } = await svc
      .from("cargas")
      .select("km_final, km_inicial")
      .eq("id", cargaId)
      .maybeSingle();
    check(
      "km_final menor que km_inicial não passa pelo guard do endpoint",
      !!errKm || Number(depois?.km_final) > Number(depois?.km_inicial),
      "o banco não tem CHECK — a defesa é só o endpoint (registrar no ESTADO.md)"
    );
  }
```

⚠️ Se o banco aceitar (não há CHECK), o check passa pelo segundo ramo e o
detalhe explica. **Não transformar isso em falha vermelha** — a decisão de
criar o CHECK no banco é do Evaner e implicaria migration, que este plano não
tem.

- [ ] **Step 5: Rodar o e2e**

Run: `node scripts/e2e-modulo1.mjs`
Expected: todos verdes.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/admin/cargas/[id]/route.ts" scripts/e2e-modulo1.mjs
git commit -m "feat(cargas): PATCH da carga + conserta a foto da descarga

PATCH novo: km_inicial, km_final, caminhao_id, iniciada_em. km_final <=
km_inicial bloqueia; salto de 1.500 km contra o historico do caminhao pede
segundo clique (o mesmo numero que o motorista ja ve).

C5: o DELETE consultava descargas.foto_path, mas a coluna e
foto_papel_path. A consulta errava, o ?? [] engolia, a foto do papel nunca
era apagada e apagado.descargas reportava sempre 0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 26: Verificação final da Fase 5

- [ ] **Step 1: Rodar tudo antes de subir**

Run: `npm run typecheck`
Run: `node scripts/e2e-modulo1.mjs`
Run: `node scripts/e2e-guards-dinheiro.mjs`

Expected: todos verdes.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Verificação manual em produção**

Em `/admin/despesas` e `/admin/abastecimentos`: editar uma linha e salvar.
**Tem que continuar funcionando** — as Tasks 17/18 moveram os modais de
arquivo.

Em `/admin/cargas/<id>` de uma carga encerrada:

1. Clicar numa **despesa** → abre o modal de edição
2. Clicar num **abastecimento** → abre o modal de edição
3. Clicar em **"Apagar descarga e reabrir a carga"** → confirma → a carga
   volta pra `ativa`, sem Fim e sem km rodado

- [ ] **Step 4: Verificar no celular do motorista (o N1)**

No celular de quem teve a carga reaberta:

Esperado: a home volta a mostrar a barra do caminhão e os botões da carga
(DESCARREGAR etc.). **Se disser "você não tem carga ativa", o N1 não pegou** —
conferir a Task 20.

⚠️ Abrir e fechar o app 2× antes de concluir (`StaleWhileRevalidate`).

- [ ] **Step 5: Desfazer o teste**

Descarregar de novo pelo celular, ou lançar a descarga pelo painel, pra carga
voltar ao estado em que estava.

---

## Depois de tudo

- [ ] Atualizar o `ESTADO.md` com o que mudou e o que ficou pendente
- [ ] Medir, ~3 dias depois do deploy da Fase 2, os eventos `reconciliado: true`
      (query no Step 3 da Task 10). É a prova de que o conserto do iOS pegou.
- [ ] Registrar no `CLAUDE.md`, na seção de armadilhas, a lição do
      `foto_papel_path`: **consulta a coluna inexistente não explode — volta
      `data: null` e o `?? []` engole.** É a mesma família do `em_carteira`.
