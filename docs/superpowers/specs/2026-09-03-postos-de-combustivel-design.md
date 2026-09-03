# Postos de combustível — design

> Brainstorm Evaner × Claude, 03/09/2026. Nasceu de um acerto real com o
> posto que já aconteceu e não tinha onde ser lançado.

## O tamanho do problema (medido, não estimado)

Em 03/09/2026, com 9 dias de histórico de abastecimento:

- **3 abastecimentos, todos de nota assinada**, R$ 1.681,52. Zero pagos na hora.
- **Zero** com posto identificado (`local_id` sempre nulo), **zero** postos cadastrados.
- O gatilho da 0034 funciona: as 3 contas a pagar nasceram sozinhas e estão abertas.

E a bagunça já nasceu, com uma armadilha dentro:

| Data | Nome digitado | GPS |
|---|---|---|
| 25/08 | Texas | −24,9788 / −53,4920 |
| 27/08 | Posto texas | −24,9790 / −53,4921 |
| 02/09 | Texas | −24,9927 / −53,4525 |

Os dois primeiros estão a ~20 m: **mesmo posto, duas grafias**. O terceiro está
a ~4,3 km: **outro posto com o mesmo nome**. Agrupar por texto juntaria dívidas
de lugares diferentes; agrupar por **GPS** acerta os dois casos.

## Por que agora

Três problemas foram colocados na mesma conversa. Eles não têm a mesma
urgência, e a ordem importa:

1. **O sócio abastecendo na nota da empresa** — o mais caro e o menos visível.
   Hoje toda nota assinada vira `combustivel` no DRE. Quando o Jean ou o
   Valdecir abastece o carro particular na mesma nota, o custo operacional
   infla e a retirada do sócio desaparece. Ninguém percebe até o número já
   ter mentido por meses.
2. **A identificação do posto** — barata agora, cara depois. Duas grafias em
   três lançamentos viram quinze em noventa dias.
3. **O fechamento com troco** — o único dos três caminhos de pagamento que
   não tem casa hoje.

**Decisão do Evaner (03/09): o Valdecir é sócio para fins do software.** O
comentário da 0018 dizia que o carro dele era "custo operacional legítimo" —
essa premissa fica revogada aqui.

## Fase 1 — O posto vira entidade

**Reusa `locais` com `tipo='posto'`** (a 0018 já criou a coluna e a
`locais_proximos()` já aceita `p_tipo`). Tabela nova seria uma segunda dona da
mesma verdade, e jogaria fora a busca por GPS e a curadoria que já existem.

- Backfill dos postos a partir dos abastecimentos, **agrupando por GPS (100 m)**,
  não por nome. O nome mais frequente vira `nome_canonico`; as outras grafias
  entram em `apelidos`.
- `abastecimentos.local_id` passa a ser preenchido.
- **App do motorista:** sugestão por GPS (a mesma máquina da coleta, só
  trocando o tipo), com a lista dos postos já usados como reserva. Digitar
  livre continua possível — posto novo na estrada existe — mas deixa de ser o
  caminho padrão.
- **Painel:** dropdown de postos.

## Fase 2 — Operação × sócio

- `abastecimentos.socio_id` — quem abasteceu por fora da operação.
- CHECK: `socio_id` e `motorista_id` não coexistem. Abastecimento de sócio é
  lançado no painel; o do motorista vem do celular.
- O gatilho da 0034 passa a **rotear a categoria**: sem `socio_id` →
  `combustivel` (custo operacional); com → `transferencia_socio` +
  `pessoa_id` preenchido. A categoria já existe no plano de contas, no grupo
  `fixa` e com `pedePessoa`.
- Abastecimento de sócio fica **fora do km/L e do custo da frota** — senão o
  carro do Jean envenena o consumo do caminhão.
- O carro particular é cadastrado como veículo `tipo='carro'` (a 0018 previu
  isso). `caminhao_id` é NOT NULL e continua sendo — afrouxar a restrição
  seria pagar com uma regra existente por um cadastro que leva um minuto.

## Fase 3 — Saldo por posto

- RPC `saldo_postos()`: por posto, as contas a pagar em aberto (das notas
  assinadas e das lançadas na mão).
- `/admin/postos` — lista com o saldo de cada um.
- `/admin/postos/[id]` — extrato: cada nota (quem assinou, qual veículo,
  quanto), cada pagamento, e o saldo.

## Fase 4 — Fechamento do posto

Escolhe o posto, marca as notas que entram no acerto, vê o total, paga.

- **Tudo em cheque** → quita as contas selecionadas.
- **Parte cheque, parte dinheiro** → o pagamento parcial **já existe** no
  endpoint de contas a pagar; a tela só distribui entre as notas.
- **Cheque a maior, posto devolve dinheiro** → o troco entra como
  `entrada_avulsa` (0047: entra no caixa, fica fora do DRE, porque é caixa e
  não resultado) na conta que recebeu.

⚠️ **Trava obrigatória:** cheque de valor maior que o total **sem troco
informado é recusado**. Esse é o buraco que a varredura de 21/08 registrou —
*cheque repassado maior que a despesa inflando o resultado*. Aqui ele fica
fechado por construção, não por disciplina de quem lança.

Idempotência por `client_id` (padrão das 0041/0054): clique duplo não paga
duas vezes.

## Fase 5 — Curadoria de postos

Juntar as grafias que escaparem do picker. Com a Fase 1 isso vira exceção,
mas quem escreveu "Texas" e "Posto texas" vai escrever "Texas BR" um dia.

## Fora de escopo

- Preço por litro por posto / comparação entre postos.
- Limite de crédito por posto.
- O acerto que já aconteceu: o Evaner lança pela tela quando a Fase 4 estiver
  pronta, com data retroativa. Ele é o primeiro caso de uso real, não um
  problema à parte.

## Pergunta em aberto

Os dois "Texas" (a 4,3 km) são a **mesma rede com o mesmo dono**? Se o acerto
é feito com um CNPJ só, o saldo precisa ser consolidado; se são donos
diferentes, precisam ficar separados. O desenho suporta os dois — o que muda
é se eles nascem como um posto ou como dois.
