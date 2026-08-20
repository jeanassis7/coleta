# MANUAL DO SOFTWARE — Sistema Coleta

> Escrito em 20/08/2026 e atualizado no fim do mesmo dia, depois da onda de
> correções da auditoria (código em produção: https://coleta-inky.vercel.app).
> Feito pra quem nunca viu o sistema conseguir operar do zero.
>
> O manual tem 6 partes:
> **1.** O que é o sistema e as ideias por trás ·
> **2.** O aplicativo do motorista ·
> **3.** O painel do gestor, tela por tela ·
> **4.** Receitas de bolo (passo a passo das tarefas do dia a dia) ·
> **5.** Problemas comuns e como resolver ·
> **6.** Glossário

---

# PARTE 1 — O QUE É O SISTEMA

## 1.1 Em uma frase

O sistema acompanha o ciclo inteiro do óleo usado: **o motorista coleta → o óleo vira estoque → o estoque vira venda → a venda vira dinheiro → o dinheiro vira relatório**. Cada etapa é lançada uma vez só, e os relatórios se montam sozinhos.

## 1.2 As duas metades

| | Quem usa | Onde | O que faz |
|---|---|---|---|
| **Aplicativo do motorista** | Luis, Lucimar, Lucinei | Celular (app instalado) | Lança coleta, abastecimento, despesa e descarga. Funciona **sem internet** — guarda tudo no celular e envia sozinho quando pega sinal. |
| **Painel do gestor** | Jean (e Evaner) | Computador, no navegador | Vê tudo, cadastra tudo, controla o dinheiro: estoque, vendas, cheques, contas, caixa, DRE. |

## 1.3 As ideias que valem pra tudo

Entender estas 8 ideias é entender o sistema. Todo o resto é botão.

**1. A unidade de trabalho é a CARGA, não o dia.**
O motorista inicia uma carga (escolhe o caminhão, anota o km), roda de 3 a 10 dias coletando, e encerra quando **descarrega na balança**. Um motorista só pode ter **uma carga aberta por vez** — o sistema impede a segunda.

**2. O motorista mede em LITROS; da balança em diante, tudo é QUILO.**
A conversão é sempre a mesma: **1 litro = 0,9 kg**. Os litros que o motorista declara são estimativa; o que vale é o peso da balança na descarga. Estoque e venda são sempre em kg.

**3. Existem dois óleos: FINO e GROSSO.**
Cada um tem seu estoque e seu custo. **Motorista só traz fino.** Grosso só entra por **compra direta** (óleo que o gestor negociou e pagou com dinheiro da empresa).

**4. O motorista anda com dinheiro da empresa na mão.**
O gestor envia **adiantamentos**; o motorista paga o óleo, o diesel e as despesas com esse dinheiro. O sistema calcula o **saldo na mão dele**: o que recebeu menos o que gastou. De tempos em tempos o gestor faz um **acerto**, que fecha o ciclo e divide o que sobrou em três: **devolvido** (voltou em dinheiro), **vale** (desconta do próximo salário) e **saldo** (fica pra próxima). O saldo pode ficar **negativo** — aí é a empresa que deve pro motorista.

**5. Dinheiro não aparece nem some.**
Toda entrada entra em alguma conta (espécie ou banco); toda saída sai de uma. Saque e depósito são **transferência** (o mesmo dinheiro mudando de bolso), nunca despesa. É isso que faz o caixa fechar.

**6. Cheque na mão NÃO é dinheiro na conta.**
Quando o comprador entrega o cheque, a dívida dele quita — mas o dinheiro está no papel. O cheque tem três destinos: **depositar e compensar** (aí vira dinheiro na conta), **repassar** (pagar uma despesa da empresa com ele), ou **voltar** (aí a dívida do comprador renasce sozinha).

**7. O DRE é regime de CAIXA.**
O relatório de resultado conta o gasto no dia em que o dinheiro **saiu**, e a receita no dia em que o dinheiro **entrou**. Venda paga em cheque só vira receita quando o cheque **compensa** — pode ser 60 dias depois. Por isso um mês bom pode aparecer ruim no papel (a venda foi feita mas o dinheiro não entrou) — isso é esperado e se corrige sozinho com o tempo.

**8. O comprador tem CONTA CORRENTE, não "venda paga".**
O saldo dele é: tudo que comprou menos tudo que pagou. Pode ficar devendo, pode ficar com crédito. Não existe amarrar pagamento a venda específica.

## 1.4 De onde os números vêm (importante pra confiar nos relatórios)

- **Estoque** é **calculado**, não digitado: descargas e compras diretas entram sozinhas, vendas saem sozinhas. O **inventário** (contar o tanque a cada 2-3 meses) alinha o número com a realidade — a diferença fica registrada como perda ou sobra em reais.
- **Custo médio do óleo** = tudo que se pagou pelo óleo ÷ quilos em estoque. O custo de **buscar** o óleo (diesel, despesas, comissão) fica de fora de propósito — aparece no DRE como gasto do mês.
- **Km atual de um caminhão** não é digitado: é o maior km entre fins de carga e abastecimentos.
- **GPS**: o aplicativo captura a localização em todo lançamento do motorista (coleta, despesa, abastecimento, descarga, aceite de adiantamento). A tela do motorista não mostra nada disso — decisão de projeto. O gestor vê os pontos no mapa do painel.

---

# PARTE 2 — O APLICATIVO DO MOTORISTA

## 2.1 Antes de começar

- O app é instalado no celular (Android: o próprio app oferece "Instalar"; iPhone: Safari → Compartilhar → Adicionar à Tela de Início).
- O **primeiro login precisa de internet**. Depois disso, o app funciona offline: tudo que o motorista lançar fica guardado no celular e **sobe sozinho** quando pegar sinal (o app tenta ao abrir, ao voltar o sinal e depois de cada lançamento).
- O login é um "email" interno (ex.: `luis@coleta.local`) e uma senha que o gestor define. O gestor consegue ver e trocar essa senha no painel (tela Motoristas).
- Alguns recursos só aparecem se o gestor ligar pra aquele motorista (tela **Features** do painel): o fluxo de **carga** (iniciar carga, abastecimento, despesa, descarregar) e o de **saldo** (card "Seu dinheiro" + tela de aceite de adiantamento).

## 2.2 A tela inicial (home)

De cima pra baixo:

1. **"Olá, {nome}"** com o menu ⋮ (sair da conta).
2. Se houver **adiantamento pendente** (e a feature saldo ligada): a tela de aceite toma a frente — ver 2.8.
3. Card **"💰 Seu dinheiro"** (se ligado): o saldo da empresa na mão dele.
4. **Barra do caminhão** (se tem carga aberta): placa e quanto do tanque já foi usado. Com 80% aparece o lembrete pra não esquecer de descarregar; passou de 100%, o aviso de que provavelmente esqueceu de finalizar.
5. Botão grande **➕ NOVA COLETA**.
6. Com carga aberta: **🏁 DESCARREGAR**, **⛽ ABASTECIMENTO**, **💵 DESPESAS** e — só se a carga ainda não tem nenhum lançamento — **✗ CANCELAR CARGA**.
7. Card **📤 Enviar agora** (só quando há lançamentos esperando e tem sinal).
8. **"Coletas dessa carga"**: a lista do que já lançou, com ☁️ (já enviada) ou 📱 (ainda no celular).

## 2.3 Nova coleta (o lançamento de todo dia)

1. Toque em **➕ NOVA COLETA**.
2. **Quantos litros?** — digite (aceita vírgula).
3. **Entregou certificado?** — **❌ Não emitiu** / **📝 Sim, mas só uma parte** (aí pergunta quantos litros) / **✅ Sim, pelos X L**.
4. **Nome do local?** — se você está perto de um lugar já cadastrado, ele aparece como sugestão: **um toque e pronto**. Senão, **➕ Outro local** e digite o nome.
5. **Quanto pagou no total?** — valor **inteiro, sem vírgula** (ex.: 150). Se digitar vírgula, o app avisa: "Só número inteiro, sem vírgula (ex: 150)". Óleo doado? Lance **0**.
6. **Foto da fachada/portão** — só aparece se o gestor exige foto desse motorista.
7. Observação, se quiser. Toque **✅ SALVAR COLETA**.

**Avisos possíveis (só quando toca em salvar, nunca enquanto digita):**
- Menos de 20 litros ou certificado maior que os litros → **bloqueia** em vermelho até corrigir.
- Preço por litro estranho (fora de R$ 0,50–4,00/L) → aviso amarelo pedindo confirmação; se estiver certo mesmo, toque **SALVAR ASSIM MESMO**. (Coleta de R$ 0 sempre cai nesse aviso — é só confirmar.)

Depois de salvar, a tela de confirmação mostra "☁️ Enviado" ou "📱 Salvo no celular" e volta pro início sozinha em 8 segundos. **Sem sinal, está salvo do mesmo jeito** — sobe depois.

## 2.4 Iniciar carga (a única ação que precisa de internet)

Aparece sozinha quando o motorista tem a feature de carga e nenhuma carga aberta.

1. Tela de boas-vindas → **🚀 INICIAR NOVA CARGA**.
2. **Caminhão** (já vem o último usado) → **Km inicial** (já vem o último km conhecido — confira com o painel!) → **foto do painel** (tire sempre — é o comprovante do km).
3. **🚀 INICIAR CARGA**.

Sem sinal, a tela avisa ("Iniciar uma carga precisa de internet — é rapidinho, qualquer 3G serve") e **destrava sozinha** quando o sinal voltar. Se a última descarga ainda não subiu, ela pede pra esperar o sinal ("Descarga esperando sinal").

## 2.5 Abastecimento

1. **Nome do posto** — se o GPS reconhecer o posto, é um toque na sugestão.
2. **Como pagou?** — **PAGUEI AGORA** (saiu do dinheiro que você carrega) ou **ASSINEI A NOTA** (o posto cobra da empresa depois — não sai do seu bolso).
3. **Litros** → **Valor total** (os centavos entram sozinhos: digite 68047 e vira R$ 680,47) → **Km atual** (já vem sugerido).
4. **Foto do cupom** — obrigatória. → **✅ SALVAR ABASTECIMENTO**.

**Avisos de km:** km menor que o do início da carga **bloqueia** (é impossível); km menor que o último registro ou salto maior que 1.500 km pedem confirmação — confira e, se estiver certo, toque de novo.

## 2.6 Despesa

**Valor** (centavos automáticos) → **Descrição** (ex.: "almoço", "borracharia") → **foto do comprovante (obrigatória)** → **✅ SALVAR DESPESA**. Funciona offline.

## 2.7 Descarregar (encerra a carga)

1. Na balança, toque **🏁 DESCARREGAR**.
2. **Peso bruto (kg)** — o número do papelzinho da balança. O app mostra na hora o **peso líquido** (bruto − tara do caminhão) e a estimativa em litros.
3. **Km do painel agora** → **foto do papel da balança** (opcional, mas recomendada) → **✅ CONFIRMAR DESCARGA**.

**Avisos:** peso menor que a tara **bloqueia** (número errado, confira). Peso muito diferente do esperado pelas coletas (mais de 30%), carga sem nenhuma coleta, ou km estranho → aviso amarelo, confirma no segundo toque.

A carga encerra **na hora, mesmo sem sinal** — a tela de resumo mostra duração, coletas, km rodado e o peso. O servidor fica sabendo no próximo sinal.

## 2.8 Aceite de adiantamento (feature "saldo")

Quando o gestor envia dinheiro, o app mostra na abertura: "Jean enviou R$ X pra você". O motorista toca **✓ JÁ RECEBI** (e confirma: "Isso não tem volta") ou **⏸ AINDA NÃO RECEBI** (a pergunta volta na próxima abertura). **O valor só entra no saldo depois do aceite.** Pular muitas vezes acende um aviso no painel do gestor.

## 2.9 Regras de ouro pro motorista

- **Nunca precisa de sinal pra lançar** (só pra iniciar carga). Lançou, tá salvo.
- **Lance na hora**, não deixe pra depois — o app existe pra isso.
- Errou o caminhão ou o km ao iniciar? **CANCELAR CARGA** (só funciona enquanto não há nenhum lançamento nela — e precisa de sinal).
- Não dá pra sair da conta com lançamentos pendentes — conecte e envie antes.
- O app novo demora pra aparecer? Feche e abra o app 2 vezes.

---

# PARTE 3 — O PAINEL DO GESTOR, TELA POR TELA

Entre em **/admin** com email e senha de admin. O menu lateral tem os grupos:
**📊 Dashboard** · **🚚 OPERAÇÃO** (Caixa, Lançamentos, DRE, Remuneração, Estoque, Vendas, Cheques, Contas a pagar, Cargas, Abastecimentos, Despesas, Compra direta, Adiantamentos) · **📈 ANÁLISE** (Mapa, Observações) · **📋 CADASTROS** (Motoristas, Locais/curadoria, Caminhões, Compradores) · **⚙️ SISTEMA** (Eventos, Features, Log*).
*Log só aparece pra quem tem permissão especial.

## 3.1 Dashboard (a tela de todo dia)

De cima pra baixo:
1. **Três cards de situação**: Estoque (kg e R$), A receber (dos compradores), Cheques em carteira. Clicou, vai pra tela.
2. **⚠️ Alertas** — o sistema vigia sozinho e avisa aqui: carga parada 15 dias, caminhão acima da capacidade, peso da balança divergente, umidade não lançada, motorista que não confirma adiantamento, dinheiro parado na mão (mais de R$ 3.000 há 15 dias), coletas sem foto/GPS, preço fora da curva, coleta de R$ 0 ("foi doação?" — doação é legítima, o aviso é só pra conferir), documento vencendo, km da troca de óleo, cheque vencido na carteira, estoque negativo. Cada alerta explica **o que aconteceu, as causas prováveis e o que fazer**. O botão **"OK, VI"** dispensa aquele alerta **só pra você** — cada admin tem a própria dispensa (se acontecer de novo em outro registro, volta pra todo mundo).
3. **Cargas ativas** — quem está na rua, há quantos dias, quão cheio está o tanque, quanto dinheiro tem na mão.
4. **Descargas recentes** — com atalho "Lançar umidade →".
5. **Filtros** (Hoje / Semana / Mês / Customizado + motorista) e os **KPIs comparando com o período anterior**: coletas, litros, total pago, R$/litro, motoristas ativos, % com GPS.
6. Análises: litros por motorista, **custo R$/L por motorista** (do mais barato pro mais caro), % de certificado emitido, top locais.
7. **Lista/Mapa das coletas** + exportar CSV. Clicar numa coleta abre o painel lateral com tudo (foto, mapa, editar, excluir). É na edição da coleta que fica o checkbox **"Pagamento pela sede"** (quando o escritório pagou o fornecedor direto — não desconta do motorista e nasce a conta a pagar).

## 3.2 Grupo OPERAÇÃO — o dinheiro

### Caixa (`/admin/caixa`)
O ponto de partida do financeiro. **Cadastre as contas primeiro** (ex.: "Espécie" e "Banco do Brasil"): pra cada uma, **quanto tinha no COMEÇO do dia** e de que dia é — esse é o corte; nada anterior é somado. (Regra de ouro: informe o saldo de **antes** dos lançamentos daquele dia — se contar no fim do dia, o que entrou e saiu hoje conta duas vezes. Na dúvida, use o saldo de ontem à noite com a data de hoje.)

A tela mostra o saldo de cada conta, o card **"Na mão dos motoristas"** e o card **Patrimônio** — tudo que a empresa tem, em seis linhas: cada conta, dinheiro na mão dos motoristas, **valor em estoque**, **óleo nos caminhões** (coletado e ainda não pesado), **cheques em aberto** (carteira + depositados) e o **TOTAL**. O óleo é valorado pelo **preço de referência** (R$/litro, editável ali mesmo — um valor só pra fino e grosso; é régua de comparação mês a mês, não custo contábil). O botão **⇄ Transferir entre contas** registra saque/depósito/PIX entre contas suas (não é despesa, não entra no DRE).

### Lançamentos (`/admin/lancamentos`)
O que **já saiu**, no ritmo do extrato do banco. Formulário sempre aberto: **Quando** → **Saiu de** (qual conta) → **O que foi** (categoria do plano de contas) → **Valor** → observação. Categorias como Salário, Comissão, Encargos de funcionário e Transferência a sócio pedem **de quem**.
- **Pagamento do mês dos funcionários**: siga a receita da seção **4.6 — Como lançar pagamentos** (Comissão + Salário por pessoa no dia dos PIX; guias como Encargos "Empresa toda" quando chegarem). Fica separadinho e o DRE mostra cada custo no lugar certo.
- Escolhendo **Salário** + uma pessoa que tem **vale** de acerto pendente, aparece o bloco "Esse pagamento quita algum vale?" — marque os vales que estão sendo descontados. É o sistema lembrando por você. (Se algum vale marcado ficar de fora — já quitado por outro pagamento, por exemplo — a tela **avisa**, não finge que descontou.)
- O checkbox **"Paguei com um cheque da carteira"** é o jeito certo de **repassar** um cheque: a despesa nasce registrada e o cheque sai da carteira, amarrado a ela.
- As categorias **automáticas** (venda, óleo, combustível, troca de óleo, pneus, manutenção) **não aparecem** aqui — o sistema calcula sozinho da origem; lançar na mão dobraria o número.

### DRE (`/admin/dre`)
O resultado do período, **regime de caixa**: Receita → (−) Custo do óleo → **Margem bruta** → (−) Operacionais → (−) Fixas → **Resultado operacional** → (−) Financeiro → (−) Impostos → **Resultado**. Linhas com a marca **"auto"** o sistema calcula sozinho; a flecha ▸ abre o detalhe — por pessoa (Salário, Óleo dos motoristas) ou por origem do dinheiro: a **Receita abre em três** (à vista, cheques compensados, cheques repassados), pra você ver de onde o dinheiro está vindo. Se algum dia aparecer uma linha **"Não classificado"**, é dinheiro pago numa categoria que saiu do plano — reclassifique o lançamento que ela some. Nada se edita aqui — o que muda é o lançamento de origem.

### Remuneração (`/admin/remuneracao`)
Salário, comissão, bônus e pró-labore com **vigência**: um valor que vale **a partir de** uma data. Mudou o combinado? Não edite — crie uma vigência nova; o passado não recalcula. A comissão é **proporcional** (100 L numa base de 200 pagam metade), conta **pelos litros da descarga** (o peso da balança — absorve até coleta que o motorista esqueceu de lançar; carga sem descarga fica pendente até pesar), e hoje é **uma regra só pra todos** (vigência "Todos"). **Esse número não entra no DRE sozinho**: quando pagar, lance em Lançamentos na categoria Comissão.

### Estoque (`/admin/estoque`)
Dois cards (fino e grosso) com kg, custo médio e valor. **A primeira ação da vida do estoque é "Abrir estoque"**: conte o tanque e informe **quanto custa o kg** — sem isso o custo médio nasce zero e contamina tudo. Depois, a cada 2-3 meses, **"Fazer inventário"**: digite o que contou; o sistema corrige a quantidade, **mantém o custo médio** e registra a diferença como perda/sobra em reais. O inventário vale sempre **pro dia de hoje** (a data é travada — contou no domingo, lance no domingo). Embaixo, o extrato de todos os movimentos.

### Vendas (`/admin/vendas`)
**+ Nova venda**: comprador → **peso da balança** (é o que ele paga) → quanto era **grosso** (o resto sai do fino) → preço por kg **ou** valor total (um recalcula o outro) → veículo que levou (ou "O comprador veio buscar") → pagamento: o que entrou agora (Pix/Dinheiro/Transferência + em qual conta) e/ou **+ Adicionar cheque** (banco, emitente, bom para, valor). O que não for pago **fica em aberto na conta do comprador**. Vender mais do que o estoque marca dá aviso — confirma no segundo toque e depois faça um inventário.

### Cheques (`/admin/cheques`)
A carteira. Fluxo de cada cheque:
1. Nasce **"Na carteira"** (veio de uma venda, de um pagamento do comprador ou do maço).
2. **Depositar** → vira "Depositado" (ainda não é dinheiro!).
3. **Compensou** → o sistema pergunta **em qual conta caiu** → agora sim é dinheiro no caixa.
4. **Voltou** → a dívida do comprador **renasce sozinha**; se o cheque tinha pago uma conta, ela **volta a ser devida** e a tela avisa. Depois dá pra **Reapresentar**.
5. **Repassar não tem botão aqui** — repassar É pagar algo com o cheque: use Contas a pagar (pagar com cheque) ou Lançamentos (paguei com cheque).

O botão **+ Lançar maço de cheques** deixa fotografar até 10 cheques e conferir um a um antes de lançar (nada entra sem o seu tique). Sem a leitura por foto configurada, lança na mão — funciona igual.

### Contas a pagar (`/admin/contas`)
Tudo que a empresa deve. Quatro abas: **A pagar** / **Previstas** (estimativas — não contam como dívida) / **Pagas** / **Recorrentes**.
- **Prevista → a pagar**: quando o boleto chega, **"Confirmar valor"**.
- **Editar**: conta ainda não paga pode ter valor e vencimento corrigidos (o caso clássico: o óleo da sede com vencimento combinado depois — 3, 15 ou 30 dias). O que já foi pago não se edita — se pagou errado, apaga o pagamento e refaz.
- **Pagar**: escolha a forma (Pix/Dinheiro/Depósito/Boleto/**Cheque da carteira**) — pagando de conta, diga qual; pagando com cheque, ele sai da carteira e não sai de conta nenhuma.
- **Parcelas**: criar uma conta em N parcelas gera N contas, uma por mês, cada uma se pagando sozinha.
- **Recorrentes**: aluguel, energia, contador. Cadastre uma vez; todo mês o botão **"Gerar contas do mês"** cria as contas (apertar duas vezes não duplica). Valor que varia (energia) nasce como prevista.

### Cargas · Abastecimentos · Despesas · Compra direta · Adiantamentos
- **Cargas**: a tabela de todas as viagens, com umidade (botão "lançar" em cada descarga). Clicando na data, o **detalhe da carga**: custos, mapa do trajeto, linha do tempo de tudo que aconteceu, e o botão **"+ Adicionar coleta"** (retroativa — pro motorista que coletou e esqueceu de lançar; desconta do saldo dele; funciona mesmo com a carga encerrada).
- **Abastecimentos / Despesas**: listas completas com filtros, edição e exclusão (atenção: apagar um gasto **aumenta** o saldo do motorista — a tela avisa). Abastecimento de nota assinada aparece com o selo **"assinou a nota"** — a conta a pagar do posto nasceu sozinha e está em Contas a pagar; corrigir ou apagar o abastecimento corrige/apaga a dívida junto. O botão **"+ Lançar pelo painel"** serve pros gastos de veículo que não vieram de carga (carro da empresa, entrega do gestor) — inclusive com "Assinou a nota", que já cria a conta a pagar do posto.
- **Compra direta**: óleo que o gestor comprou. Em kg (pesou) ou litros (estimou); fino ou grosso; **de qual conta o dinheiro saiu** (obrigatório — o caixa desconta na hora); e a pergunta-chave: **o caminhão estava vazio?** Se tinha óleo de motorista dentro, o peso vai contar na descarga dele — a compra registra só o custo, senão o óleo entraria duas vezes.
- **Adiantamentos**: enviar dinheiro (valor + de qual conta + forma) e fazer **acerto** — a tela mostra o saldo e você divide em **Devolvido / Vale / Fica de saldo** (a soma tem que bater; o botão só habilita quando bate). Saldo negativo inverte os campos: **Pagar agora / Somar no salário / Levar pro próximo ciclo**. Cada motorista tem a página de histórico completa.

## 3.3 Grupo ANÁLISE

- **Mapa**: onde as coletas acontecem — locais cadastrados com contagem de visitas, coletas soltas por motorista.
- **Observações**: tudo que os motoristas escreveram no campo de observação, num lugar só.

## 3.4 Grupo CADASTROS

- **Motoristas**: **+ Adicionar motorista** (nome, email gerado sozinho, senha temporária, tipo). Na tabela: ativar/desativar, **exige foto** na coleta, **saldo no app**, **resetar senha** e — importante — a coluna **Senha** com o "👁 mostrar": é aqui que você vê a senha pra passar pro motorista. A ficha de cada um guarda os **documentos** (CNH, toxicológico, MOPP, cursos) com data de vencimento e arquivo.
- **Locais (curadoria)**: as coletas chegam com o nome que o motorista digitou. Aqui você agrupa as parecidas e cria o **local oficial** — que vira sugestão de um toque pros motoristas nas próximas coletas ali. Dá pra separar um cluster em dois locais quando o GPS misturou vizinhos.
- **Caminhões**: placa, marca, cor, **capacidade do tanque** e **tara** (o peso vazio — é ele que transforma o peso da balança em peso de óleo). A **ficha** de cada caminhão mostra a próxima troca de óleo por km (com semáforo), km/L e gasto do mês, o histórico de **manutenções** (a prazo vira conta a pagar sozinha; troca de óleo marca o km da próxima) e os **documentos** (IPVA, CIV, CIPP etc. — com valor preenchido, entra no caixa futuro como previsão). Documento renovado? Botão **"Renovar"** na própria lista: muda o vencimento (e o valor/arquivo se quiser), mantém o histórico e ajusta a previsão sozinho.
- **Compradores**: as fundições. Cadastro simples + a **ficha com a conta corrente**: saldo explicado linha a linha, botão **+ Registrar pagamento** (Pix/Dinheiro/Transferência/Cheque) e o extrato completo.

## 3.5 Grupo SISTEMA

- **Eventos**: diagnóstico técnico do app dos motoristas (erros, sync, GPS, fotos). No dia a dia, ignore — é a caixa-preta pra quando algo der errado.
- **Features**: liga os recursos novos **por motorista** ("Cargas + viagem" e "Adiantamentos no app"). Ligue em um, acompanhe uns dias, estenda pros outros. Desligar não apaga nada.
- **Log**: quem alterou o quê pelo painel, com data e hora (visível só pra quem tem a permissão).

---

# PARTE 4 — RECEITAS DE BOLO

## 4.1 GUIA DE LARGADA — do zero ao primeiro lançamento

### A ideia que organiza tudo: o DIA DO CORTE

**Não tente reconstruir o passado.** Escolha um dia de largada (hoje, ou o
dia 1 do próximo mês) e trate assim: *tudo que aconteceu ANTES desse dia já
está resumido nos saldos de partida; tudo DEPOIS é lançado.* O sistema foi
desenhado exatamente pra isso — cada conta financeira tem um "corte", e nada
anterior a ele é somado. Reconstruir meses antigos só cria trabalho e erro.
A única exceção: **boletos futuros já conhecidos** (mesmo de compra antiga)
entram em Contas a pagar, porque ainda vão sair do caixa.

### Fase 0 — Limpeza (5 min)
Apagar o que é teste: o perfil **Suzana**, o caminhão **AAA-0000** e o
**Teste 1** (se não for mais usar).

### Fase 1 — O dinheiro (tudo depende disso)
1. **Caixa** → cadastrar as contas (**Espécie** e **Banco do Brasil**), cada
   uma com **quanto tinha no COMEÇO do dia da largada** (na dúvida: o saldo
   de ontem à noite, com a data de hoje). *Sem isso, nada de dinheiro
   funciona — e errado aqui, o caixa nunca mais bate.*
2. No card **Patrimônio**, definir o **preço de referência** do óleo
   (R$/litro — ex.: 2,80).

### Fase 1½ — A REGULARIZAÇÃO (zerar o saldo fantasma dos motoristas)

Se os motoristas já lançavam coleta antes do módulo de dinheiro, o saldo
deles está **negativo e fictício** (o sistema viu o dinheiro sair pelas
coletas, mas nunca viu os PIX que chegaram por fora). Conserta-se com **um
adiantamento de regularização** por motorista, na virada de cada um:

1. Decida qual é o **saldo REAL na mão dele hoje** (ex.: R$ 0, ou R$ 500).
2. **Adiantamentos → + R$** → valor = *o negativo que aparece* + *o saldo
   real* (ex.: aparece −40.470 e ele tem 500 na mão → 40.970) → campo
   **"Quando foi" = uma data ANTES do corte das contas** → observação
   "regularização — dinheiro enviado por fora antes do sistema".
3. Ligar **features "saldo"** pro motorista → ele **aceita** no app (é
   verdade — ele recebeu esse dinheiro ao longo do tempo) → o saldo dele
   passa a ser o real. De quebra, ele aprende o aceite.

Por que a data no passado: datado antes do corte da conta financeira, o
adiantamento conserta o saldo do motorista **sem descontar o caixa** —
aquele dinheiro já está embutido no saldo de partida do banco.

### Fase 2 — Os cadastros (15 min)
3. **Caminhões** reais: placa, capacidade do tanque, **tara** (é ela que
   transforma o peso da balança em peso de óleo — capricho).
4. **Motoristas**: conferir os três, senhas, decidir quem exige foto.
5. **Compradores**: as fundições.

### Fase 3 — O estoque (o número mais importante da largada)
6. **Estoque → Abrir estoque**: contar o tanque e informar **quanto custa o
   kg**. É a ÚNICA vez na vida do sistema que o custo é digitado — errado
   aqui contamina toda margem daí pra frente. Fino e grosso separados.

### Fase 4 — As regras de pagar gente
7. **Remuneração → vigências**: Salário "Todos" = **R$ 3.287,23** (o bruto
   fixo do holerite: base + periculosidade) e Comissão "Todos" = o valor a
   cada 200 L, valendo a partir do dia da largada.

### Fase 5 — As contas que se repetem
8. **Contas a pagar → Recorrentes**: DAE/eSocial (estimada), FGTS
   (estimada), sindicato, luz/água/internet, contabilidade, sistema — tudo
   que chega todo mês. As estimadas nascem como previsão; chegou o boleto,
   "Confirmar valor".

### Fase 6 — Os primeiros lançamentos (construindo confiança)
A ordem certa é do simples pro complexo, conferindo o caixa a cada passo:
9. **Primeiro lançamento da vida**: um gasto pequeno e real do extrato
   (Lançamentos). Depois olhe o Caixa: **bateu com o banco?** Se sim, o
   sistema está calibrado.
10. **Primeiro adiantamento**: envie um pelo painel; o motorista aceita no
    app (precisa da feature "saldo" ligada pra ele).
11. **Primeira folha**: quando os holerites chegarem, seguir a **seção
    4.6** de papel na mão.
12. **Features → "Cargas + viagem"** em UM motorista. Acompanhar uns dias
    (coletas, abastecimento, descarga), conferir os números, aí estender
    pros outros.

### O ritmo depois da largada
- **Todo dia, 2 min**: abrir o dashboard — os alertas contam se algo pede
  atenção.
- **Quando olhar o extrato**: lançar o que saiu (regra de ouro da 4.6).
- **Fim de mês**: a rotina da seção 4.5.

## 4.2 O ciclo de uma carga (o que o gestor faz)

1. Motorista inicia a carga no app — ela aparece em **Cargas ativas** no dashboard.
2. Durante a rota: acompanhar pelo dashboard (litros, saldo na mão, alertas).
3. Motorista descarrega → conferir o ticket na balança → a descarga aparece no dashboard → **lançar a umidade** (link direto).
4. O óleo entrou no estoque sozinho, com custo = soma do que foi pago nas coletas daquela carga.
5. Se o motorista esqueceu alguma coleta: detalhe da carga → **+ Adicionar coleta**.

## 4.3 O ciclo do dinheiro do motorista

1. **Enviar**: Adiantamentos → **+ R$** → valor, de qual conta, forma. 
2. O motorista **aceita no app** (só aí conta no saldo dele).
3. Ele gasta (óleo, diesel, despesas) — o saldo desce sozinho.
4. **Acertar** (quando for a hora): Adiantamentos → **Acerto** → dividir em Devolvido / Vale / Saldo.
5. **No pagamento do salário** (Lançamentos → categoria Salário → pessoa): o sistema mostra os **vales pendentes** — marque os que está descontando.

## 4.4 O ciclo da venda e do cheque

1. **Vendas → + Nova venda**: peso da balança, mistura, preço, o que entrou agora e os cheques.
2. Cheques caem na **carteira** (tela Cheques, ordenados por "bom para").
3. No banco: **Depositar** → quando cair na conta: **Compensou** (diga a conta).
4. Pra pagar um fornecedor com cheque: **Contas a pagar → Pagar → Cheque** (ou Lançamentos → "Paguei com um cheque da carteira"). Nunca procure um botão "repassar" — repassar é pagar algo com ele.
5. Cheque voltou? **Cheques → Voltou** — a dívida do comprador renasce e, se ele tinha pago uma conta, ela volta a ser devida (a tela avisa). O que costuma acontecer depois: a conta se paga por PIX, e o comprador também paga por PIX.

## 4.5 Rotina de fim de mês

1. **Contas a pagar → Recorrentes → "Gerar contas do mês"**.
2. Confirmar valores das previstas cujo boleto chegou (**"Confirmar valor"**).
3. Pagar tudo seguindo a seção **4.6 — Como lançar pagamentos** (leia ela
   uma vez com calma; depois vira automático).
4. Ler o **DRE** do mês.
5. A cada 2-3 meses: **inventário** do estoque.

## 4.6 COMO LANÇAR PAGAMENTOS ⭐ (leia antes de pagar qualquer coisa)

> Esta é a parte com mais detalhe do sistema inteiro. A boa notícia: é UMA
> regra + quatro receitas. Entendeu a regra, as receitas viram hábito.

### A regra de ouro (vale pra todo pagamento)

**Cada lançamento = um dinheiro que saiu do banco de verdade, naquele dia,
naquele valor.** Nunca lance um valor que não bata com um débito do extrato.
É isso que faz o Caixa da tela fechar com o banco no centavo — e é assim que
você descobre erro: se desencontrou, algum lançamento não corresponde a um
débito real (ou um débito real ficou sem lançamento).

### Receita 1 — A folha dos funcionários (a mais detalhada)

O holerite de cada motorista tem 4 linhas de ganho: **Horas normais** e
**Periculosidade** (o fixo), **Comissões** (o prêmio por litro — o número
que nasce na sua tela de Remuneração) e **DSR s/ comissões** (descanso
remunerado que a lei manda pagar junto da comissão — o contador calcula,
você só soma). Os descontos (INSS, IRRF, sindicato, consignado) **não são
dinheiro seu**: são dinheiro DELES que a empresa segura e entrega nas guias
do mês seguinte. O **Total Líquido** é o PIX do dia.

**No dia dos PIX — 2 lançamentos por motorista** (em Lançamentos):

| # | Categoria | De quem | Valor |
|---|---|---|---|
| 1 | **Comissão dos motoristas** | o motorista | **COMISSÕES + DSR** do holerite, somados |
| 2 | **Salário** | o motorista | **Total Líquido − o valor do item 1** (os vales pendentes aparecem aqui pra marcar) |

*Exemplo real (folha 07/2026, Lucimar): Comissão = 2.555,56 + 378,60 =
R$ 2.934,16; Salário = 4.975,10 − 2.934,16 = R$ 2.040,94. Soma = o PIX de
R$ 4.975,10 — fecha no centavo.*

**Quando as guias chegarem (mês seguinte) — 1 lançamento por boleto, valor
cheio, TUDO JUNTO** (decisão de 20/08/2026 — não separe por funcionário: a
DAE não abre por pessoa no holerite, e ratear no chute é inventar número):

| Boleto | Categoria | De quem |
|---|---|---|
| DAE / eSocial (INSS + IRRF) | **Encargos de funcionário** | **Empresa toda (guia coletiva)** |
| FGTS digital | **Encargos de funcionário** | Empresa toda |
| Guia do sindicato | **Encargos de funcionário** | Empresa toda |
| Consignado (empréstimo do funcionário repassado ao banco) | **Salário** | a pessoa, obs. "consignado" |

**Por que assim:** a Comissão aparece bruta no Custo do Óleo (e tem que
bater com a linha COMISSÕES do contador — que veio da sua tela de
Remuneração: o circuito fecha). Os Encargos mostram o custo escondido de
empregar. E cada lançamento bate com um débito real.

**Dica:** cadastre DAE, FGTS e sindicato como **despesas recorrentes
estimadas** — todo mês aparecem como previsão, chegou o boleto é só
"Confirmar valor" e pagar.

### Receita 2 — Boleto / conta de fornecedor (posto, manutenção, IPVA...)

Se a dívida **já está** em Contas a pagar (nota assinada, manutenção a
prazo, óleo da sede, documento, recorrente): **Contas a pagar → Pagar** →
forma → de qual conta saiu → data. Pronto — ela entra no DRE sozinha.
**Não lance de novo em Lançamentos** (dobraria).
Se o gasto **não está** lá (pagou algo na hora, direto do extrato):
**Lançamentos**, categoria certa, conta de onde saiu.

### Receita 3 — Pagar com CHEQUE da carteira

Nunca procure um botão "repassar". Pagar com cheque É o repasse:
- dívida que já existe → **Contas a pagar → Pagar → Cheque** → escolhe o
  cheque;
- gasto na hora → **Lançamentos → "Paguei com um cheque da carteira"**.
O cheque sai da carteira amarrado à despesa, e **não sai dinheiro de conta
nenhuma** (quitou com o papel).

### Receita 4 — Dinheiro pro motorista trabalhar (NÃO é Lançamentos!)

Adiantamento e acerto têm tela própria: **Adiantamentos**. Enviar dinheiro
= "+ R$" (valor, conta, forma). Fechar o ciclo = "Acerto" (devolvido / vale
/ saldo). O pró-labore dos sócios é em **Lançamentos → Transferência a
sócio** com a pessoa.

### O que NUNCA lançar como pagamento

- **Saque, depósito, PIX entre contas suas** → é Caixa → "⇄ Transferir"
  (mesmo dinheiro mudando de bolso, não é despesa).
- **Categorias automáticas** (venda, óleo, combustível, troca de óleo,
  pneus, manutenção) → o sistema calcula da origem; nem aparecem no
  dropdown. Se sentir falta delas, o lugar certo é a tela de origem.

## 4.7 Tarefas pontuais

| Quero... | Onde |
|---|---|
| Ver/trocar a senha de um motorista | Motoristas → coluna Senha ("👁 mostrar") / "Resetar senha" |
| Óleo doado (R$ 0) | O motorista lança valor 0 no app (confirma o aviso) |
| Coleta que o escritório pagou direto | Dashboard → abrir a coleta → Editar → "Pagamento pela sede" |
| Diesel que o posto vai cobrar depois | Motorista usa "ASSINEI A NOTA" no app; gasto de carro/entrega: Abastecimentos → "+ Lançar pelo painel" → "Assinou a nota" |
| Registrar manutenção | Ficha do caminhão → "+ Lançar manutenção" (a prazo = nasce conta a pagar; troca de óleo = marca o km da próxima) |
| Documento com custo (IPVA, seguro) | Ficha do caminhão/motorista → "+ Cadastrar documento" com o valor → vira previsão no caixa futuro |
| Pró-labore | Lançamentos → "Transferência a sócio" → pessoa |
| Apagar lançamento errado do motorista | Abastecimentos/Despesas → Apagar (atenção: o saldo do motorista sobe) |
| Exportar pra Excel | Botão "📥 Exportar CSV" (Dashboard, Cargas, Abastecimentos, Despesas, Compra direta) |

---

# PARTE 5 — PROBLEMAS COMUNS

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Mudança nova não aparece no app do motorista | O app serve a versão guardada e atualiza por baixo | Fechar e abrir o app 2 vezes |
| App do motorista não abre / login falha | Mais de 7 dias sem ninguém usar → o banco (Supabase, plano grátis) hiberna | Dashboard do Supabase → "Restore project" (2-5 min, sem perda) |
| Coleta não subiu | Sem sinal, ou foto travada | Esperar sinal; card "Enviar agora"; se persistir, tela **Eventos** filtra "Sync falhou" com o motivo |
| "Sua sessão expirou" no app | Sessão venceu | Botão "Sair e entrar de novo" (nada se perde — os lançamentos ficam no celular) |
| Motorista lançou errado | Acontece | Abastecimentos/Despesas/coleta → Editar ou Apagar pelo painel |
| Alerta que não devia aparecer | Situação já conhecida | "OK, VI" — some; se acontecer de novo em outro registro, volta |
| Estoque negativo | Venda maior que o registrado | Contar o tanque e fazer inventário |
| Não consigo lançar venda | Falta comprador cadastrado | Cadastrar em Compradores |
| Não consigo enviar adiantamento | Falta conta financeira | Cadastrar em Caixa |
| Painel lento / preso no esqueleto | Já aconteceu de forma intermitente | Recarregar; se persistir, F12 → Network com Preserve log e avisar o Evaner |

**Regra de investigação**: quase tudo que dá errado no app do motorista fica registrado em **⚙️ Eventos** com o motivo — o motorista não precisa saber descrever o problema.

---

# PARTE 6 — GLOSSÁRIO

| Termo | Significado |
|---|---|
| **Carga** | O ciclo de trabalho do motorista: inicia com caminhão+km, dura 3-10 dias, encerra na descarga. Só uma aberta por motorista. |
| **Descarga** | A pesagem na balança que encerra a carga. Peso líquido = bruto − tara. |
| **Tara** | Peso do caminhão vazio (do cadastro). A descarga guarda uma cópia da tara da época — recalibrar depois não muda o passado. |
| **Fino / Grosso** | Os dois tipos de óleo, com estoques e custos separados. Motorista só traz fino. |
| **0,9** | A densidade: 1 litro de óleo = 0,9 kg. Fixa no sistema inteiro. |
| **Compra direta** | Óleo que o gestor comprou com dinheiro da empresa (não passou por motorista). |
| **Adiantamento** | Dinheiro enviado pro motorista trabalhar. Só conta no saldo dele quando ele **aceita** no app. |
| **Acerto** | Fecha o ciclo do dinheiro do motorista: divide o saldo em devolvido / vale / saldo. Cria um "corte" — nada antes dele conta de novo. |
| **Vale** | Parte do acerto que será descontada do salário. O sistema lembra na hora de pagar. |
| **Saldo negativo** | O motorista gastou do próprio bolso — a empresa deve a ele. |
| **Paga pela sede** | Coleta que o escritório pagou direto ao fornecedor: não desconta do motorista, vira conta a pagar. |
| **Assinei a nota** | Abastecimento que o posto cobra da empresa depois: não sai do bolso do motorista. |
| **Conta corrente (comprador)** | Saldo = tudo que comprou − tudo que pagou. Não existe "venda paga". |
| **Em carteira / Depositado / Compensado / Repassado / Devolvido** | Os estados do cheque. Só **compensado** é dinheiro na conta. |
| **Bom para** | A data a partir da qual o cheque pode ser depositado. |
| **Conta financeira** | Onde o dinheiro vive: espécie ou banco. Todo movimento diz de qual conta saiu / em qual entrou. |
| **Transferência** | Dinheiro mudando entre contas suas (saque, depósito). Não é despesa. |
| **Prevista** | Conta com valor estimado. Aparece no planejamento, não conta como dívida, não entra no DRE. |
| **DRE** | O relatório "o mês foi bom?". Regime de caixa: conta quando o dinheiro se move. |
| **Regime de caixa** | Gasto pesa no dia que saiu; receita no dia que entrou (cheque: quando compensa). |
| **Plano de contas** | A lista de categorias de gasto/receita. "Automática" = o sistema calcula sozinho; "lançável" = você digita do extrato. |
| **Vigência** | Um valor de remuneração que vale a partir de uma data. Mudou? Cria-se outra; o passado fica. |
| **Custo médio** | Valor do estoque ÷ quilos. Recalculado a cada entrada (ponderado móvel). |
| **Inventário** | Contagem real do tanque. Corrige a quantidade, preserva o custo, registra a diferença em R$. |
| **Abertura** | O primeiro inventário — a única vez que o custo por kg é digitado. |
| **Curadoria** | Transformar os nomes digitados pelos motoristas em locais oficiais com GPS. |
| **Feature** | Recurso ligado por motorista, um de cada vez (rollout gradual). |
| **Antiburro** | Os avisos do app: erro impossível bloqueia em vermelho; número suspeito pede confirmação em amarelo (segundo toque). |
| **PWA** | O tipo de app instalado no celular do motorista — funciona offline. |
| **Sync** | O envio automático dos lançamentos do celular pro servidor. |

---

*Manual gerado a partir do código em produção em 20/08/2026. Se uma tela mudou, o código manda — avise o Evaner pra atualizar o manual.*
