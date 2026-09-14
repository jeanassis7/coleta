# O app para de mentir, o maço confere sozinho e o admin edita tudo

> Desenhado em 14/09/2026 com o Evaner. Cinco frentes que nasceram de quatro
> queixas dele e de um áudio do Jean. Tudo aqui foi **medido em produção antes
> de ser desenhado** — os números estão preservados, porque foram eles que
> mudaram três das cinco decisões.

---

## Parte 0 — O que foi medido

Todo o resto depende destes números. Colhidos em 14/09/2026 contra o banco de
produção, janela de 120 dias.

### 0.1 O iPhone do Lucimar falha 17x mais

```
sync_failure:   Lucimar 50   ·   Luiz 3   ·   Lucinei 2
```

A mensagem é sempre a mesma: `insert: TypeError: Load failed`.

"Load failed" é como o **WebKit** escreve fetch abortado (o Chrome escreve
"Failed to fetch"). Confirmado também pelo `connection: null` nos eventos
dele — o Android manda `navigator.connection`, o iPhone não.

### 0.2 O insert NUNCA falhou — 37 de 37

```
client_ids que deram sync_failure:  37
desses, quantos estão no banco:     37   (100%)
```

**O servidor gravou todas.** O que morreu foi a resposta. O iOS mata a
conexão em voo quando o app vai pro bolso. O app marca pendente, o motorista
vê "não foi" e relança na mão — com `client_id` novo, que a idempotência não
pega.

### 0.3 A fila offline é usada em 7,2% das coletas

| Atraso entre lançar e chegar no servidor | coletas | % |
|---|---|---|
| Na hora (<2 min) | 283 | **92,8%** |
| 2–15 min | 6 | 2,0% |
| 15–60 min | 12 | 3,9% |
| 1–6 h | 2 | 0,7% |
| 6–24 h | 2 | 0,7% |

Pior caso: **15h02** (Lucinei), **6h06** (Lucimar).
Por motorista: Lucinei 13,0% · Lucimar 9,6% · Luiz 1,1%.

### 0.4 Não existem cargas simultâneas — o índice funciona

O `idx_cargas_uma_ativa_por_motorista` (unique parcial em `motorista_id`
where `status='ativa'`) está de pé e funcionando:

- cargas ativas agora: Lucimar 1, Lucinei 1, Luiz 0
- **zero** cargas se sobrepondo no tempo, em 145 cargas
- **zero** coletas fora da janela da própria carga
- as 2 cargas canceladas do Lucimar têm **zero** coletas cada

### 0.5 Mas ele cancelou e recomeçou 3x em 2 dias

```
11/09 22:16     cancelada, 0 coletas
12/09 21:03:13  cancelada, 0 coletas
12/09 21:04:05  ativa            <- 52 segundos depois
```

Mesmo mecanismo do 0.2, no único lugar que não tem fila.

### 0.6 As 140 coletas sem carga são históricas, não bug

Lucimar 88, Luiz 37, Lucinei 15 — **todas de agosto/2026**, antes do rollout
de `features.carga`. Nada a consertar.

---

## Parte 1 — O que foi DESCARTADO, e por quê

### Trocar o sistema para só-online com botão de sync manual

Proposto pelo Evaner nesta sessão. **Descartado com o número 0.2 na mão.**

O bug não é a fila. O bug é o fetch morrendo **depois** do servidor gravar.
Isso acontece igual num app só-online — é o WebKit abortando a conexão.

| | Hoje (com fila) | Só-online |
|---|---|---|
| Fetch morre pós-commit | acontece | **acontece igual** |
| App tenta de novo sozinho | sim | não existe |
| `client_id` barra o reenvio | sim (0009/0041) | some junto |
| Motorista relança na mão | vira a MESMA linha | vira **duplicata de verdade** |
| Coleta sem sinal | guardada | **perdida** (22 casos em 120 dias) |

A fila não causa as duplicatas — é o que as **impede**. A sensação de "o sync
dá problema demais" vem da fila **mentindo** (Parte 3), não de ela existir. Se
depois do conserto a queixa voltar, revisitar com dado novo.

**O que SOBREVIVEU da ideia:** a segunda metade dela — "fica pendente, mas ele
fica ciente que tá ali esperando" — apontou um buraco real. Virou a Parte 4.

### Grau de fidedignidade por campo no OCR

Confiança auto-declarada por LLM é mal calibrada — o modelo diz "95%" com a
mesma cara quando acerta e quando inventa. Decisão do Evaner: **só a soma**.
Se o total bate, os valores estão certos por aritmética.

Também descartada a leitura dupla (ler 2x e comparar divergências): guardada
como plano B se a soma vier errada com frequência.

### Subir o arquivo do relatório (PDF/Excel) e casar cheque a cheque

Decisão do Evaner: **digitar só o número total**. Muito mais simples, e o
controle que importa é o mesmo.

---

## Parte 2 (E) — A tela de cargas para de mentir

**Prioridade: primeira.** É a única coisa aqui fazendo o Jean tomar decisão
com informação errada, e não depende de nenhuma das outras.

### O problema

O Jean relatou por áudio que o Lucimar "tem 3 cargas em aberto" e que "uma
coleta foi pra segunda". Os dois fatos são falsos (0.4). O que ele viu:

| Início | Fim | Status | Coletas |
|---|---|---|---|
| 12/09 21:04 | **—** | ativa | 5 |
| 12/09 21:03 | **—** | cancelada | 0 |
| 11/09 22:16 | **—** | cancelada | 0 |
| 09/09 19:39 | 11/09 22:15 | encerrada | 11 |

Carga cancelada **não recebe `encerrada_em`** — só o status muda. A coluna
"Fim" fica vazia e ela parece aberta. E o badge de Status está na **coluna 19
de 19**, fora da tela sem rolar pro lado.

A leitura do Jean é razoável. A tela é que está errada.

### O desenho

- **E1.** O badge de Status sai da coluna 19 e vai pro começo, ao lado do
  motorista.
- **E2.** Linha cancelada fica visualmente apagada, e a coluna Fim mostra
  **"cancelada"** em vez de "—". Vazio e cancelada são coisas diferentes —
  mesma lição da 0057 (umidade vazia ≠ não analisada).
- **E3.** Apagar o texto morto da página: ela ainda fala de *"motorista de
  teste"* e *"só pra você (dev)"*. Os dois conceitos foram derrubados nas
  migrations 0023/0024.

Sem migration. Sem mudança de dado. Só leitura.

---

## Parte 3 (D) — O sync para de mentir

### O problema

Em `src/lib/sync/queue.ts:515` já existe o caminho certo para outro caso:

```js
if (insertErr.code === "23505") { /* já subiu, marca sincronizado */ }
```

Violação de chave única é tratada como sucesso. Mas **`TypeError: Load failed`
não tem `code`** — é erro de rede, não do Postgres. Cai no caminho genérico de
falha e o registro fica pendente tendo entrado (0.2).

O mesmo buraco existe em três lugares:

- `queue.ts:515` — coleta
- `queue.ts:266` — o caminho genérico dos outros 3 lançamentos
- `iniciar-carga/page.tsx:237` — a carga (0.5)

### O desenho

- **D1. Reconciliação por `client_id`.** Insert falhou com erro de **rede**
  (não de auth, não de validação) → consultar `where client_id = ?` antes de
  dar como pendente. Achou → sincronizado, mesmo tratamento do 23505. Não
  achou → pendente de verdade. **Resolve 37 de 37 dos casos medidos.**
- **D2.** Se a própria consulta de reconciliação falhar (offline de verdade),
  fica pendente — que é o comportamento correto.
- **D3.** Vale para os 4 lançamentos, não só coleta — o caminho genérico
  (`queue.ts:266`) tem o mesmo buraco.
- **D4.** Envolver os contadores de pendentes (`queue.ts:606-621`) em
  try/catch. O `UnknownError: Attempt to iterate a cursor that doesn't exist`
  (2 ocorrências, só no Lucimar) é a transação do Dexie morrendo quando o iOS
  congela o app no meio da varredura. O laço principal já usa `toArray()` e
  está seguro. É ruído de log, não perda de dado — mas é barato calar.
- **D5. Iniciar carga.** Não passa pela fila (exige sinal por desenho — o
  servidor é quem garante "1 ativa"). Erro de rede ao iniciar → reconsultar
  `cargas where motorista_id=? and status='ativa'` antes de mostrar falha.
  Achou uma criada agora → segue como sucesso.

### Como distinguir "erro de rede" de "erro de dado"

Critério: erro **sem `code` do Postgres** e com forma de falha de fetch
(`TypeError`, mensagem "Load failed" / "Failed to fetch" / "NetworkError").
Erro de dado tem `code` e deve continuar contando tentativa até o
`MAX_TENTATIVAS` de hoje. **Nunca reconciliar erro de validação** — ali o
registro realmente não entrou.

### Testes (régua #8)

Caso novo no `scripts/e2e-modulo1.mjs`: inserir uma coleta, simular falha de
rede na resposta, e provar que a reconciliação encontra a linha e marca
sincronizado **sem criar segunda linha**.

---

## Parte 4 (F) — A pendência para de se esconder

Nasceu da segunda metade da ideia descartada na Parte 1.

### O problema

`src/components/motorista/BotaoSyncManual.tsx:30`:

```js
if (pendentes === 0 || !online) return null;
```

**Sem sinal, o aviso de pendência some da tela.** Esconde o botão porque não
dá pra apertar offline — e leva a informação junto. O motorista sem sinal
lança três coletas e a tela não diz nada.

É o oposto exato do que o Evaner pediu: *"fica pendente, mas ele fica ciente
que tá ali esperando."*

### O desenho

- **F1.** Separar o **aviso** do **botão**. `pendentes > 0` mostra sempre,
  online ou não. O botão "Enviar agora" continua só com sinal.
- **F2.** Offline: "**3 lançamentos guardados no celular.** Vão sozinhos
  quando pegar sinal." Sem alarme, sem vermelho — é o normal, não é erro.
- **F3.** Online com pendente: o que já existe hoje.

Vale pra iOS e pra Android igual.

---

## Parte 5 (A+B) — O maço de cheques confere sozinho

O OCR **já existe** (`/api/admin/cheques/ocr` + `LoteChequesPainel.tsx`,
feitos em 19/08). Já lê maço fotografado junto, até 10 fotos em levas de 3,
lança dentro de um comprador só, tem lista de conferência com a foto ao lado,
tique por cheque, e **não guarda a foto em lugar nenhum** — ela vive em
memória do navegador e some quando o painel fecha.

Falta a soma, e falta o botão estar no lugar certo.

### A — Soma de conferência

- **A1.** Campo novo **"Total do relatório"** (`InputDinheiro`) ao lado de
  comprador/data. **Opcional** — nem todo maço vem com papel; em branco é o
  comportamento de hoje.
- **A2.** Preenchido: o rodapé mostra ao vivo
  `8 de 10 conferidos · R$ 12.430,10 · faltam R$ 579,30`.
- **A3.** Soma dos **ticados** ≠ total → antiburro de duas etapas, amarelo,
  com a diferença e as três hipóteses (cheque não ticado / valor lido errado /
  cheque faltando no maço). Segundo clique "LANÇAR MESMO ASSIM" passa.
- **A4.** Comparação em **centavos inteiros**, nunca em float. `InputDinheiro`
  já vive em centavos.
- **A5. Guard no servidor:** `/api/admin/cheques/lote` passa a aceitar
  `total_conferencia` e `confirmado`. Total presente, não bate, sem
  `confirmado` → **409** com a diferença. A tela guia; o endpoint garante.
- **A6.** O total **não é gravado**. É ferramenta de conferência, não fato —
  não inventa migration.

#### Régua do dinheiro

1. **Maior que o limite** — é exatamente o que a diferença mede.
2. **Zero/negativo** — total vazio ou zero = sem conferência, comportamento de
   hoje. Não bloqueia.
3. **Dois cliques** — `recebimentos.client_id` único já cobre (0041).
4. **Apagar depois** — não grava nada, nada a desfazer.
5. **Conta duas vezes** — não grava nada, não dobra.
6. **Tela mascarando** — a diferença aparece **com sinal**. Nada de
   `Math.abs` escondendo de que lado falta.
7. **Guard no servidor** — A5.
8. **Teste do caminho errado** — caso no e2e com total errado de propósito,
   provando que volta 409 sem `confirmado` e passa com ele.

### B — "+ Adicionar na mão" embaixo

Hoje o botão está na linha 298 e as linhas novas são anexadas no **fim** da
lista. Com 8 cheques, o Jean rola pra cima pra criar o nono.

- **B1.** O botão desce pro rodapé, colado nos totais. Em cima fica só
  "📷 Ler por foto".
- **B2.** Linha nova entra no fim, a tela **rola até ela**, e o foco cai no
  campo Banco.

### Nota de privacidade (registrada, não bloqueante)

A foto **não fica no sistema** — nem Storage, nem banco. Mas ela **sai** pra
API da OpenAI. Na API (diferente do ChatGPT) não treinam com o dado e retêm
~30 dias para antiabuso. O Evaner foi informado e seguiu.

---

## Parte 6 (C) — O admin edita tudo na carga

### Correção de um erro meu

Eu havia dito que a descarga já era editável pelo admin. **Falso.** O `PATCH
/api/admin/descargas/[id]` só aceita **umidade** — nenhum campo de peso. Se o
motorista digitou o peso da balança errado, hoje não existe conserto a não ser
apagar a carga inteira. É o número que define o estoque todo.

### O estado real da relação admin → motorista

| O que o motorista lança | Corrige? | Apaga? | Onde |
|---|---|---|---|
| Coleta | sim | sim | drawer, na própria carga |
| Despesa | sim | sim | **só em `/admin/despesas`** |
| Abastecimento | sim | sim | **só em `/admin/abastecimentos`** |
| Descarga | **só umidade** | **não** | `/admin/cargas` |
| Carga (km, caminhão) | **não** | sim | — |
| Adiantamento / Acerto | sim / — | sim / sim | painel próprio |

O problema não é "não dá pra editar" — é que **da tela da carga só a coleta é
clicável**. Pra corrigir uma despesa o Jean sai da carga, vai pra outra tela e
caça a linha no meio das despesas de todos os motoristas.

### O desenho

- **C1. Linha do tempo clicável.** Despesa e abastecimento abrem edição igual
  à coleta. **Reuso** dos `ModalEditarDespesa` / `ModalEditarAbastecimento`
  que já existem dentro de `TabelaDespesas.tsx` / `TabelaAbastecimentos.tsx`:
  extraídos pra arquivo próprio e importados dos dois lugares. Zero regra
  duplicada.
- **C2. Peso da descarga editável.** O PATCH passa a aceitar `peso_bruto_kg` e
  o `peso_tara_kg` do snapshot (`peso_liquido_kg` é `GENERATED ALWAYS` —
  recalcula sozinho, não se escreve nele). Os antiburros do motorista valem
  igual no painel: peso ≤ tara **bloqueia em vermelho**; ±30% contra
  `soma_litros × 0,9` são duas etapas.
- **C3. Apagar descarga.** Reabre a carga (`status='ativa'`, `encerrada_em`
  nulo). **Bloqueia** se o motorista já tiver outra carga ativa — o índice
  único proíbe, e a mensagem explica em vez de vazar erro de banco. Duas
  etapas, porque tira óleo do estoque.
- **C4. Editar a carga.** `PATCH /api/admin/cargas/[id]` novo: `km_inicial`,
  `km_final`, `caminhao_id`, `iniciada_em`. Guards: `km_final > km_inicial`
  bloqueia; salto de 1.500 km contra o histórico do caminhão são duas etapas
  (o mesmo número que o motorista já vê).

### Régua do dinheiro (C2 e C3 mexem em estoque)

1. **Maior que o limite** — apagar descarga pode deixar o estoque **negativo**
   se o óleo já foi vendido. A tela mostra o saldo resultante; negativo pede
   segundo clique.
2. **Zero/negativo** — peso ≤ tara é impossível: vermelho, bloqueia.
3. **Dois cliques** — DELETE filtra por id; segunda vez é 404.
4. **Apagar depois** — o desfazer é **completo**: some a descarga *e* a carga
   reabre. Meio desfazer deixaria carga encerrada sem descarga.
5. **Conta duas vezes** — `movimentos_estoque` lê a tabela `descargas`, então
   some junto. Nada a dobrar.
6. **Tela mascarando** — mostrar o estoque resultante **inclusive negativo**.
   Nenhum `Math.max(0, ...)`.
7. **Guard no servidor** — todos os quatro, no endpoint.
8. **Teste do caminho errado** — três casos novos no `e2e-modulo1.mjs`: peso <
   tara, apagar descarga com outra carga ativa, `km_final < km_inicial`.

### Referência de cascata

O `DELETE /api/admin/cargas/[id]` já resolve a cascata inteira (descarga →
coletas → despesas → abastecimentos → contas não pagas → fotos, nessa ordem,
com conta **paga** sobrevivendo). C3 é a versão de um passo só disso — seguir
o mesmo desenho, não inventar outro.

### C5 — bug achado de brinde, conserta junto

No mesmo `DELETE /api/admin/cargas/[id]`:

```js
client.from("descargas").select("id, foto_path")
```

A coluna de foto da descarga chama **`foto_papel_path`**, não `foto_path`. A
consulta erra, `data` volta nulo, o `?? []` engole, e o resultado é:

- a **foto do papel da balança nunca é apagada** (blob órfão — inócuo, como o
  próprio comentário do arquivo diz);
- o `apagado.descargas` **sempre reporta 0**, mesmo tendo apagado uma. Esse é
  o que incomoda: o endpoint mente sobre o que fez.

Como C3 mexe exatamente nesse código, conserta junto.

---

## Ordem de execução

1. **E** — a tela de cargas (informação errada na mão do Jean, agora)
2. **D + D5** — o sync para de mentir (bug ativo há 2 meses)
3. **F** — a pendência aparece offline
4. **A + B** — cheques (mesma tela, mesma sessão)
5. **C** — editar tudo na carga

E, D e F não têm migration. C não tem migration (só endpoint + tela). A não
tem migration (A6). **Nenhuma migration nova neste spec.**

---

## O que fica pendente depois disto

- O e2e (`e2e-modulo1.mjs`, 55 checks) precisa rodar depois de D e de C — os
  dois mexem em caminho que ele cobre.
- Se a queixa de "sync dá problema" voltar **depois** de D+F, aí sim revisitar
  a arquitetura com dado novo. Antes disso não.
