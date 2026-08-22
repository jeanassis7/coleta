# Varredura adversarial de 21/08/2026 — o "engolir calado"

> Nasceu de um buraco real: o pagamento de dívida aceitava valor MAIOR que o
> saldo devedor sem avisar. Três auditorias independentes varreram o
> financeiro atrás da MESMA classe de bug — **valor ou estado fora de faixa
> aceito em silêncio**. Resultado: **30 achados, 8 graves**.
>
> O padrão é sempre o mesmo: **o guard existe num lugar e falta no irmão.**
> (POST valida, PATCH não. DELETE checa ciclo fechado, POST não. A tela de
> Venda avisa, a ficha do Comprador não. A tela de Contas avisa do troco, a
> de Lançamentos não.) Ver `REGUA-DO-DINHEIRO.md`.

## Corrigidos em 21/08 ✅

| # | Achado | Como estava | Como ficou |
|---|---|---|---|
| 1 | **Custo sumia do DRE PARA SEMPRE** | conta CANCELADA continuava escondendo o fato de origem (anti-dobra não filtrava status) — e era o caminho que a própria tela ensina | `.neq("status","cancelada")` na lista de origens |
| 2 | **DRE truncava em 1.000 linhas** | 5 das 6 consultas sem paginação: 3 motoristas a 12 coletas/dia estouram num mês e o custo do óleo cai calado | todas via `selectTudo` |
| 3 | **Devolução > saldo do motorista** | sem nenhum guard; digitar 500000 achando R$ 500,00 punha R$ 5.000 numa conta que nunca recebeu | compara com `saldos_motoristas()`, explica e pede 2º clique |
| 4 | **Devolução retroativa em ciclo fechado** | o DELETE tinha o guard; o POST não | avisa quando a data é anterior ao último acerto |
| 5 | **Recebimento > dívida do comprador** | errar um zero virava crédito invisível de R$ 45 mil | compara com `saldo_compradores()`, 2º clique |
| 6 | **Cheque repassado > despesa** | pagar R$ 500 com cheque de R$ 3.000 inflava o resultado do mês em R$ 2.500 e o troco sumia | avisa o troco (e o caso inverso), 2º clique |
| 7 | **Conta PREVISTA paga pelo chute** | energia prevista 800, fatura 940 → gravava 800; banco e caixa divergiam calados | pagar prevista exige o valor real da fatura |
| 8 | **Editar venda comia o arredondamento** | mexer no nº da nota recalculava total = peso × preço e sumia R$ 40-150 da dívida | só recalcula se o preço mudou; total explícito manda |
| 9 | **Maço de cheques engolia correção** | reenvio com valor corrigido/cheque novo respondia ok e não aplicava nada | grava os novos de verdade e o aviso aparece na tela |
| 10 | **Desativar motorista sumia com o dinheiro** | o valor caía do patrimônio sem linha nenhuma, e a foto do caixa continuava contando (telas divergiam) | avisa e pede acerto; o card passa a mostrar inativo com saldo |
| 11 | **Editar dívida não revalidava parcelas** | (buraco no código escrito 1h antes) 8× R$ 1.200 com total R$ 96.000 passava calado | mesma conferência do POST |
| 12 | **Credor vazio no editar** | apagar o nome devolvia ok com o nome antigo | recusa com mensagem |

**Nenhuma dessas correções mexeu em dado existente** — todas são preventivas.
Conferido no banco em 21/08: 0 contas canceladas com origem, 0 vendas com
total divergente, maior mês tem 140 coletas (teto era 1.000), só o Lucimar
com saldo e ele está ativo.

## Segunda leva — 22/08, os 18 restantes ✅

**Placar: 30 de 30 fechados.**

### As três altas
| Achado | Como ficou |
|---|---|
| **Acerto sem idempotência (TOCTOU)** — clique duplo gravava dois acertos e creditava a conta em dobro | `acertos.client_id` unique (0054); um id por modal aberto; reenvio é reconhecido, não duplicado |
| **Vale maior que o pagamento sumia inteiro** — vale de 3.000 num salário de 2.000 zerava o vale e 1.000 de desconto deixavam de existir | compara a soma dos vales com o pagamento, explica e pede 2º clique |
| **Custo médio corrompido ficava invisível** — venda a descoberto deixa o valor negativo e o alerta some quando o saldo volta | `estoque_atual()` devolve `custo_confiavel` (0054) e a tela avisa até o inventário fazer o rebase |

### As nove médias
- **Saldo inicial zerava calado**: campo vazio virava `0` no envio; agora exige o número, e mexer no ponto de partida de conta COM movimento pede confirmação (o DELETE checava 8 tabelas, o PATCH nenhuma).
- **Transferência maior que o saldo da origem**: avisa quanto ficaria negativo.
- **Adiantamento sem teto**: compara com o saldo da conta (retroativo da regularização fica de fora, de propósito).
- **Editar valor de conta que veio de um fato**: recusado — o caminho é editar o fato, que sincroniza os dois.
- **Apagar conta com origem**: o guard existia só na tela; agora o servidor recusa e manda cancelar.
- **Recorrente sem pessoa**: categoria que pede dono não vira recorrente (a tabela não guarda pessoa) — some do dropdown e o servidor recusa.
- **Ficha do comprador escondia cheque devolvido** quando o saldo dava exatamente zero.
- **Antiburro da venda a prazo**: só avisa quando o pagamento PASSA do total; venda a prazo virou informação, não alerta.
- **`buscarLancamentos` com teto de 500**: paginado — a tela somava um total parcial como se fosse o total.

### As quatro baixas
- Corrigir a data de um pagamento agora move também o `vale_quitado_em` (era o "terceiro relógio" esquecido).
- `origem_tipo`/`origem_id` não entram mais do body (um POST podia sumir com uma coleta do DRE).
- Apagar comprador checa vendas, recebimentos E cheques (antes estourava FK crua).
- Os dois guards que descartavam o `error` da própria consulta agora falham fechado.

## O teste do caminho errado — `scripts/e2e-guards-dinheiro.mjs`

A pergunta 8 da régua virou arquivo, e roda no CI a cada push (transação
com ROLLBACK, nada sobra). **14 asserções**, cada uma com o valor errado de
propósito: pagar acima do saldo, parcela agendada que não pode abater,
apagar pagamento devolvendo a dívida, conta cancelada devolvendo o fato ao
DRE, `client_id` barrando o acerto duplicado, cheque devolvido que não pode
compensar, mistura de venda que não fecha, conta paga sem data.

**Achado de brinde:** ao rodar a suíte inteira, o E2E do Módulo 2 quebrou em
4 asserções — e **não era regressão minha**: o Evaner cadastrou uma vigência
real de comissão e o teste, que roda contra produção, passou a comparar com
ela. Mesmo modo de falha que já derrubara o bloco de estoque. O teste agora
se isola (limpa as vigências dentro da própria transação); a vigência real
dele segue intacta — conferido depois do rollback.

## O que fica de método

`REGUA-DO-DINHEIRO.md` — as 8 perguntas obrigatórias. E a regra nova de
prestação de contas: ao entregar algo de dinheiro, dizer **quais das 8
foram verificadas e o que se achou**. "Testei" sem dizer o quê foi
exatamente como o primeiro buraco passou.
