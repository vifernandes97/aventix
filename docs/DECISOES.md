# Decisões de arquitetura — Aventix

> Acumula. Registra o porquê e a alternativa descartada, não a regra em si
> (regra permanente mora no CLAUDE.md).
> Entradas abaixo de 2026-07-27 são registro retroativo das decisões tomadas
> até a criação deste arquivo; as datas individuais não foram preservadas.


## 2026-08-25 — Lançamento adiado para outubro; escopo do pagamento redesenhado

O combinado era lançar com **Pix integral apenas**, porque ~90% dos pagamentos do
Quadri Club são Pix. Em 25/08, depois de ver o sistema apresentado, o cliente
voltou atrás: só quer lançar quando **todas as formas de pagamento** estiverem
prontas e integradas. **Sistema pronto em setembro; uso real no início de
outubro.**

**Por que aceitar o adiamento em vez de defender o lançamento parcial:** o marco
de negócio deixou de ser uma data e passou a ser um **evento** — o vídeo do
influenciador **@grandecampinas** no início de outubro, que despeja os leads
**de uma vez**. Lançar antes com meia forma de pagamento não antecipa receita
relevante (o movimento atual é pequeno), e chegar no vídeo com o cliente pedindo
cartão no meio do pico é o pior dos dois mundos. O adiamento troca pressa por
uma janela real de teste.

**Alternativa descartada:** lançar em agosto só com Pix integral e adicionar
cartão depois, em produção. Descartada porque o cliente **explicitamente não
quer** — e porque o cartão não é um acréscimo isolado: ele arrasta preço por
método, chargeback e conciliação de líquido, que mexem no mesmo código do Pix.
Fazer isso com venda real correndo é mais caro que fazer antes.

**Consequência assumida:** o sistema fica **pronto e parado** por semanas, em
produção, sem uso real. O risco disso é conhecido e tem nome: código que não roda
com gente de verdade acumula bug que só aparece no volume. O mitigador acordado
são os **testes com clientes reais antes do vídeo** (seção 17).

**Reabrir quando:** o vídeo mudar de data, ou o cliente pedir para vender antes.
Aí a pergunta é qual fase mínima entrega venda completa — hoje, Fase A.

## 2026-08-25 — Preço cheio na experiência, com desconto do Pix configurável por tenant

A experiência cadastra o **valor cheio** (Montanha 349,99). O Pix ganha um
**desconto configurável** (7% no Quadri Club) e o cartão paga o cheio, **sem
acréscimo**.

**Por que desconto no Pix e não taxa no cartão**, sendo a diferença aritmética a
mesma: as duas formas produzem números idênticos e leituras opostas. Acréscimo no
cartão é percebido como punição, derruba conversão e esbarra na expectativa (e na
leitura corrente do CDC) de que o preço anunciado é o preço a pagar. Desconto no
Pix é percebido como vantagem. Como o valor final é o mesmo, escolher a moldura
melhor é de graça.

**Por que CONFIGURÁVEL e não 7% em código:** o Aventix é produto **multi-tenant**
(seção 1). Um `0.07` chumbado faria o **segundo cliente exigir deploy** para
mudar o próprio desconto — transformando configuração de negócio em tarefa de
desenvolvedor, que é exatamente o que o produto existe para evitar. O custo de
tornar configurável agora é uma coluna; depois, é uma migration com dado vivo.

**Alternativa descartada:** cadastrar o preço já com desconto e somar taxa no
cartão. Descartada pela moldura acima, e porque tornaria o valor cadastrado
dependente do método — o dono não saberia mais responder "quanto custa a
trilha?" olhando o cadastro.

**Consequência assumida:** o número que o dono cadastra **não é** o número que a
maioria dos clientes paga (90% pagam Pix, com desconto). A tela do CRUD precisa
mostrar os dois, senão ele cadastra 349,99 achando que é o que vai receber.

**Reabrir quando:** algum tenant precisar de desconto **por experiência** e não
por tenant. Hoje não há caso, e a coluna por tenant é o suficiente.

## 2026-08-25 — Reserva com sinal pago é `confirmed` + `partial`, nunca `pending_payment`

Sinal pago → `status='confirmed'` com `payment_state='partial'`.

**Por quê:** a vaga **está garantida** e o recurso alocado. O saldo é pendência
**financeira**, não reserva incompleta — e os dois eixos já são separados no
modelo de propósito (`status` vs. `payment_state`, seção 4.6).

**Manter `pending_payment` seria ativamente errado, não só impreciso:** o **cron
de hold** (seção 12) varre `pending_payment` com `hold_expires_at` vencido e
expira a reserva, **liberando a vaga**. Ou seja, o cliente que pagou metade
perderia o passeio 15 minutos depois de pagar, por classificação interna, com
dinheiro dele já na conta do tenant. O bug seria silencioso do lado do sistema e
brutal do lado do cliente.

**Alternativa descartada:** criar um status novo (`partially_paid`) no enum
`reservation_status`. Descartada porque duplicaria no eixo de **reserva** uma
informação que já existe no eixo **financeiro**, e obrigaria toda query de agenda,
calendário e disponibilidade a conhecer mais um valor — com o risco clássico de
alguma delas esquecer e passar a ignorar reservas legítimas.

**Consequência assumida:** "confirmada" deixa de significar "paga". Toda tela que
mostrar reserva confirmada precisa olhar `payment_state` antes de dizer qualquer
coisa sobre dinheiro, e o painel precisa do marcador de saldo em aberto
(seção 11.1).

## 2026-08-25 — Configuração financeira em tabela própria, fora de `settings`

Desconto por método e taxas da maquininha vão para **tabela própria**, não para
`settings`.

**O motivo é uma armadilha medida, não preferência de estilo:** `seedTenant()`
**sobrescreve** toda linha de `settings` cujo valor divirja do template (regra das
duas casas, seção 19, descoberta em 21/08). O dono configuraria 7%, funcionaria
por semanas, e o valor **sumiria** no dia em que alguém rodasse o seed — sem
erro, sem log, e ninguém associaria o preço mudado ao seed que rodou por outro
motivo. Dinheiro é o pior lugar possível para esse tipo de falha.

**Segundo motivo, independente do primeiro:** separa **o que a Neosoluti define**
do **que o dono edita**. Hoje `settings` mistura rótulo de UI com regra de
negócio, e configuração financeira do lado errado dessa fronteira é convite a
alguém editar taxa achando que edita texto.

**Taxas em TABELA, não campo único:** débito, crédito à vista e crédito parcelado
têm percentuais diferentes. Um campo só produziria número errado com **aparência
de certo** — que é pior que número obviamente errado, porque ninguém confere.

**Alternativa descartada:** `settings` com prefixo (`fin_pix_discount`), que
seria mais rápido. Descartada pelo primeiro motivo: o prefixo não protege de
nada, o seed sobrescreve igual.

**Reabrir quando:** nunca, provavelmente — mas se `seedTenant()` deixar de
sobrescrever settings, o primeiro motivo cai e sobra só o segundo.

## 2026-08-25 — Valores de dinheiro são congelados no registro do pagamento

No momento do registro, gravam-se **congelados** na linha do pagamento: valor
bruto, modalidade, percentual aplicado e valor líquido. Depois disso o sistema só
**lê**. A configuração vale para o **próximo** registro, jamais para os
anteriores.

**Por quê, com o cenário concreto:** em setembro registra R$ 150 a 5% e mostra
R$ 142,50. Em novembro a operadora reajusta para 6%, o dono atualiza a tela, e **a
reserva de setembro passa a mostrar R$ 141,00**. O passado muda sozinho, a
conferência com o extrato bancário quebra, e nada acusa erro — o sistema está
"apenas" aplicando a configuração vigente.

**É a mesma família de decisão da seção 4.6** ("a reserva congela o que foi
vendido"), aplicada ao lado financeiro: registro de dinheiro é **fato histórico**,
não valor derivado.

**Alternativa descartada:** guardar só bruto e modalidade, recalculando o líquido
na leitura a partir da configuração vigente. Descartada pelo cenário acima. É a
opção que parece mais limpa (menos colunas, uma fonte de verdade) e é justamente a
que corrompe o histórico.

**Para o Asaas o líquido é LIDO, não calculado:** eles informam o líquido na
consulta da cobrança, e recalcular por fora produziria divergência com o extrato
deles na primeira mudança de tarifa. **Só a maquininha exige cálculo**, porque
acontece fora do provedor.

## 2026-08-25 — Cartão via `invoiceUrl` do Asaas, sem formulário próprio

O cliente é redirecionado para a fatura do Asaas e digita o cartão lá.

**Por quê:** a documentação de PCI-DSS do Asaas diz que, na integração via API,
"os dados passam pelo back-end da sua aplicação" e "sua infraestrutura permanece
no escopo". E o Asaas **não oferece tokenização client-side** — não existe
componente JS deles que capture o cartão no navegador e devolva um token. Não há
terceira opção: **ou o cliente digita numa página do Asaas, ou o número do cartão
passa pelo nosso servidor**, com todo o escopo de conformidade que isso arrasta
para um projeto tocado por um dev solo.

**Alternativa descartada 1 — formulário de cartão no wizard (API):** melhor
experiência, sem redirect, e é o que a maioria dos concorrentes faz. Descartada
pelo escopo de PCI acima. O ganho de conversão não paga a responsabilidade.

**Alternativa descartada 2 — Asaas Checkout:** resolveria o PCI do mesmo jeito,
mas traz **objeto próprio, família própria de eventos de webhook e expiração
própria**. Seriam **dois sistemas de pagamento convivendo** no mesmo código, com
dois conjuntos de estado para manter idempotentes — sendo dev solo. A
`invoiceUrl` reaproveita os eventos `PAYMENT_*` que já funcionam e já foram
exercitados (seção 8).

**Consequência assumida:** o cliente **sai do nosso domínio** para pagar, e a
página que ele vê é do Asaas, com a marca deles. É custo de conversão e de marca,
aceito conscientemente.

**Lacuna que isto abre:** **chargeback**. Com cartão, a compra pode ser contestada
meses depois, e o sistema passa a poder ter reserva `confirmed`, **realizada**,
com pagamento revertido — combinação que a máquina de estados (seção 5) não
conhece. Tratada na Fase E; registrada aqui para não ser descoberta em produção.

## 2026-08-25 — Política de cancelamento: sinal não devolve, reagendamento por WhatsApp

Decidido com o cliente: cancelamento pelo cliente com sinal pago **não devolve**,
sem escalonamento por antecedência; **no-show** não devolve o sinal e não cobra o
saldo; **estorno** é manual pelo painel do Asaas; **reagendamento** é por
WhatsApp, manual, e **não é feature**.

**Por que registrar uma política de negócio aqui:** ela **remove requisitos** de
software, e essa é a parte que se perde. Sem devolução parcial não há cálculo de
retenção; sem escalonamento por antecedência não há janela de tempo influenciando
valor; sem reagendamento no sistema não há realocação de vaga, que é a
funcionalidade mais cara da lista (envolve disponibilidade, hold e a exclusion
constraint ao mesmo tempo). Qualquer proposta futura que reintroduza um desses
três está **mudando a política**, não melhorando a implementação.

**Alternativa descartada:** devolução escalonada por antecedência (padrão do
setor: 100% acima de 7 dias, 50% acima de 48h, 0% depois). Descartada pelo
cliente, e o efeito colateral é bem-vindo: escalonamento exigiria estorno
automático, que a seção 8-C mantém manual justamente porque as taxas do Pix **não
voltam** e um estorno integral pode ser recusado por saldo insuficiente.

**Contradição herdada, que precisa ser resolvida no texto:** o texto oficial
publicado pelo cliente promete **reagendamento com 48h de antecedência** mas não
diz **como**. Como nunca há devolução, a cláusula das 48h só faz sentido se der
direito a **remarcar** — e o texto precisa dizer que a remarcação é pelo
**WhatsApp**, senão o cliente procura no sistema um botão que não existe e conclui
que perdeu o dinheiro. Entra no **Termo v2**.

**Reabrir quando:** o volume do vídeo de outubro mostrar que cancelamento manual
por WhatsApp não escala. Aí o que entra primeiro é reagendamento self-service, não
devolução.

## 2026-08-24 — Idade do garupa conta na data do PASSEIO; a do condutor continua na data da RESERVA

`createReservation` passou a ter **duas regras de idade com bases de data
diferentes**, e as duas são deliberadas:

| Papel | Regra | Base da conta | Desde |
|---|---|---|---|
| Condutor | 18 anos (habilitação) | data do **agendamento** (`todayLocalDate()`) | 17/08 |
| Garupa | idade mínima **por experiência** (6 na Fazenda, 12 na Montanha) | data do **passeio** (`start_at`) | 24/08 |

**Isto está escrito aqui porque a divergência parece bug.** Quem abrir o arquivo
daqui a seis meses vê duas contas de idade lado a lado, uma ancorada em hoje e
outra no passeio, e a leitura natural é "descuido, vou alinhar". Alinhar é
exatamente o que não pode ser feito sem decisão própria — ver o último bloco.

**Por que o garupa conta no passeio:** é regra de **segurança operacional**, e o
que importa é a idade de quem vai subir no quadriciclo **no dia**. Uma criança
que faz 12 anos entre reservar e viajar tem 12 no passeio — recusá-la seria
recusar dinheiro por tecnicismo de calendário, e a mãe que reservou não teria
como entender o "não". O caso é real e barato de suportar: a conta usa
`ageOnDate(birthdate, start_at)` em vez de `ageFromBirthdate`, que ancora em hoje.

**Por que o condutor continua na data da reserva:** é regra de **habilitação
legal** (CNH), não de segurança operacional, e a decisão de 17/08 escolheu
explicitamente a forma simples — o comentário original diz "regra
deliberadamente simples — sem cálculo de 'faz aniversário antes do passeio'".
Nada mudou desde então que justifique reabrir isso de carona numa tarefa sobre
garupa.

**Alternativa descartada: alinhar os dois em `start_at`.** É a opção mais
limpa de ler, e foi considerada. Descartada porque **não é refatoração, é
mudança de comportamento numa regra legal**: contar no passeio é estritamente
mais permissivo, então passaria a aceitar quem faz 18 **entre reservar e
viajar**. Isso é defensável (no dia ele tem 18 e pode ter CNH), mas é decisão de
negócio — envolve o tenant, o termo e o risco de alguém aparecer sem carteira
porque a tirou na semana do passeio. Merece decisão própria, não um efeito
colateral.

**Consequência assumida:** as duas bases convivem, e quem mexer numa precisa
saber da outra. A defesa contra o "conserto" silencioso são três coisas, nesta
ordem: esta entrada, os comentários nos dois pontos de `createReservation`, e o
caso **R4** do grupo R — que constrói uma criança que faz aniversário
exatamente na data do passeio e **afirma que hoje ela tem um ano a menos**.
Alinhar as regras na data da reserva quebra R4 com uma mensagem que aponta para
a regra, não para o teste.

**Reabrir quando:** o tenant pedir para aceitar condutor que completa 18 antes
do passeio — e aí a mudança é a do condutor, decidida por si, não "para ficar
igual ao garupa".

## 2026-08-24 — Idade mínima é coluna por experiência, com `0` significando "sem mínimo"

A regra veio do cliente por escrito (6 na Trilha da Fazenda, 12 na Trilha da
Montanha) e virou `experiences.min_passenger_age`, não constante de código.

**Por que por experiência:** os dois números diferem **entre trilhas do mesmo
tenant**, então a regra é do passeio e não do negócio. Uma constante faria a
próxima trilha herdar o número da anterior — errado, e silencioso até alguém
aparecer com uma criança no ponto de encontro.

**`NOT NULL DEFAULT 0`, com `0` = sem idade mínima.** Contraste deliberado com
`emergency_contact_*` (0002), que nasceu nullable porque **não havia valor
retroativo possível**; aqui há default com significado, então nenhum consumidor
precisa tratar ausência. **Custo reconhecido:** `0` é valor **sentinela** — a
coluna diz "idade zero" para significar "regra ausente", e uma coluna anulável
expressaria isso com mais honestidade. Aceito por ora; **reabrir se** a
semântica confundir alguém na prática.

**A proteção contra "esqueci de configurar" mora no CRUD**, que expõe o campo com
o texto "Use 0 para não exigir idade mínima" — e não no banco, porque um default
mais restritivo (12, digamos) bloquearia venda de trilha que não precisa de
mínimo, que é o erro mais caro dos dois.

**>>> RISCO DE DEPLOY, VERIFICAR EM PRODUÇÃO <<<** O backfill da migration 0005
casa por **nome** (`WHERE name = 'Trilha da Fazenda'`), mesma chave de
reconciliação do seed — id não serve, as trilhas já foram recriadas uma vez (ids
3 e 4) quando o template as renomeou em 28/07. **Se o nome em produção divergir
minimamente** (espaço, acento, maiúscula), o `UPDATE` não casa, as duas ficam com
`0`, e `0` é "sem mínimo": a migration passa, o boot passa, o sistema aceita
criança de qualquer idade e **nada acusa erro**. Falha surda, da mesma família
das três desta semana. Depois do deploy, obrigatoriamente:

```sql
SELECT id, name, min_passenger_age FROM experiences;
```

Esperado: `Trilha da Fazenda | 6` e `Trilha da Montanha | 12`. Qualquer `0` ali
significa que a regra **não está valendo**, e o conserto é um `UPDATE` manual
com o nome real (protocolo da seção 19: `psql -c` isolado, conferido em conexão
nova).

## 2026-08-23 — Etapa 1 usa `[slug]` dinâmico com guarda, não pasta literal

A seção 2-B mandava a Etapa 1 pôr a LP na pasta **literal**
`app/(public)/agendamento/quadriclub/`, com o argumento de que um slug
desconhecido responderia 404 de graça, enquanto `[slug]` sem guarda serviria a
página do Quadri Club para qualquer endereço. Fizemos `[slug]` dinâmico.

**O argumento antigo está certo na segunda metade, e é ela que decide.** O
problema do `[slug]` nunca foi o `[slug]`: era o "sem guarda". Com
`findTenantBySlug()` + `notFound()`, o slug desconhecido dá exatamente o mesmo
404, e o dinâmico entrega o que o literal não entrega — o slug deixa de ser
**decorativo** e passa a resolver o tenant de verdade, no banco. A pasta literal
teria reservado o formato da URL sem construir nada da multi-tenancy; seria
trabalho de mudança de endereço pago duas vezes.

**Alternativa descartada:** pasta literal agora, `[slug]` na Etapa 2. Descartada
porque as duas mudanças mexem no mesmo arquivo e no mesmo teste, e fazer o
movimento de endereço duas vezes é a única parte disto que tem risco real (link
divulgado, histórico do git, rota de build).

**Reabrir quando:** nunca, provavelmente. Se reabrir, é para tirar a guarda —
e aí é porque a Etapa 2 entrou e ela virou desnecessária.

## 2026-08-23 — A raiz do app é o login, e não redireciona para agendamento

`app.aventix.com.br/` responde 307 para `/admin/login`. Não serve a LP, e
**não** redireciona para `/agendamento/quadriclub`.

**Por que não redirecionar para a LP do Quadri Club:** é o mesmo erro de
"a raiz é do primeiro cliente", só que escondido atrás de um redirect — e
escondido é pior, porque some da árvore de rotas e só aparece no dia do segundo
cliente, quando já existe gente com o endereço salvo. Quem chega na raiz sem
contexto é o dono (ou o dev); o cliente final chega pelo link do ManyChat, que
aponta direto para a LP.

**Custo assumido:** zero hoje, e o contexto é o que torna a decisão barata — o
fluxo do ManyChat ainda não foi configurado, então não existe link em produção
apontando para a raiz. Fazer isto depois custaria coordenar com material já
divulgado.

**307, nunca 308** (regra 1 da seção 2-B). Medido na origem: `redirect()` do App
Router emite digest `NEXT_REDIRECT;replace;/admin/login;307;`, e o
`prerender-manifest` do build grava `"status": 307` — o 307 sobrevive à
prerenderização estática, que é como o Easypanel serve a raiz.
`permanentRedirect()` emitiria 308 e ficaria cacheado no navegador praticamente
para sempre, sequestrando a raiz quando o site comercial nascer.

## 2026-08-23 — O slug mora em lib/seed.ts, não no template de segmento

`SEED_TENANT_SLUG = 'quadriclub'` fica ao lado de `SEED_TENANT_ID` e
`SEED_TENANT_NAME`. A instrução original mandava pôr em
`lib/templates/quadriciclo.ts`, invocando a "regra das duas casas" (seção 19).

**O template é dado de SEGMENTO; o slug é identidade de TENANT.** `quadriciclo`
descreve um ramo de negócio e existe para ser reaplicado — o segundo, o terceiro
e o décimo cliente de passeio de quadriciclo recebem o mesmo template, cada um
com o seu slug. Gravar `'quadriclub'` lá dentro amarraria o segmento a um tenant
e destruiria a razão de o template existir, justamente na véspera de o produto
começar a procurar o cliente 2.

**A regra das duas casas não se aplica aqui.** Ela existe porque `seedTenant()`
**sobrescreve** toda `settings` cujo valor divirja do template, e um valor
digitado à mão no banco sumiria no seed seguinte. A linha de `tenants` não é
sobrescrita: o seed só a **insere** quando ausente. Não há segunda casa para
manter em dia.

**Consequência que virou regra:** o seed nunca reescreve slug de tenant
existente, e é deliberado — slug é endereço público, e um seed que o mudasse
alteraria a URL divulgada ao cliente sem ninguém pedir. Renomear slug é
migration.

## 2026-08-23 — A barreira da Etapa 2 testa a divergência, não conta linhas

A Etapa 1 abriu uma janela: a URL resolve tenant por slug, `getTenantId()` ainda
devolve 1 fixo. Com dois tenants isso serve dados do cliente 1 sob a marca do
cliente 2, sem erro nenhum aparecendo. A barreira contra isso é
`assertResolvedTenantIsCurrent()` (lança) mais o grupo O de testes.

**Descartada:** um teste que conta linhas em `tenants` e falha se houver mais de
uma. Ele depende de rodar **depois** dos cinco arquivos que criam tenant vizinho
para provar isolamento (J..N) — ou seja, depende de ordem alfabética de arquivo.
Uma barreira que some quando alguém renomeia um teste, e some em silêncio, é a
mesma categoria de falha que ela existe para impedir.

**O que foi feito:** a barreira cria um segundo tenant de verdade e prova que a
LP dele **se recusa a renderizar** — a divergência em si, no componente de página
real, independente de ordem e de paralelismo. O tripwire de catálogo continua
existindo como complemento (pega quem acrescentar um tenant ao seed), mas
distingue fixture de tenant real pelo **prefixo do slug**
(`tenant-vizinho-`), não por ordem.

**Critério de conclusão da Etapa 2:** `assertResolvedTenantIsCurrent()` e
`tests/o-barreira-multi-tenant.test.ts` devem ser **apagados** no commit que
fizer `getTenantId()` resolver o tenant da requisição. Poder apagá-los é como se
sabe que a Etapa 2 terminou.

## 2026-08-22 — Duplicação da regra de precedência mantida deliberadamente

`lib/calendar.ts:getDayGrid` reimplementa a mesma regra do passo 1 de
`lib/availability.ts`: exceção de agenda tem precedência sobre `operating_hours`
(seção 6). São duas cópias da mesma lógica, uma governando o que o motor VENDE e
outra o que o calendário DESENHA. O comentário no próprio `getDayGrid` já
registrava a dívida e dizia onde ela deveria ser paga — "quando o CRUD de
horários da Fase 3 entrar e um terceiro consumidor aparecer". O CRUD entrou hoje.
A dívida **fica**.

**Por que não unificar agora:** unificar significa mexer em `availability.ts`,
que é o motor de venda, a dois dias do go-live. A assimetria de risco decide
sozinha: o modo de falha de manter as duas cópias é a grade DESENHADA divergir da
grade VENDIDA — tela mentindo, nas duas direções, sem overbooking, porque a trava
real é a exclusion constraint e a vaga vendida é congelada em
`reservation_resources.period`. O modo de falha de refatorar o motor às pressas é
não vender, ou vender errado. Trocar risco de UI por risco de receita na véspera
não se paga.

**O que foi feito no lugar:** a tela nova de exceções **consome** `getDayGrid` e
`getWeeklyGrid` para montar o contraste "hoje × com a exceção", em vez de
reimplementar a precedência pela quarta vez. O CRUD apenas escreve as linhas; a
regra continua morando nos dois lugares que já existiam, e não em três.

**Alternativa descartada:** extrair a precedência para um helper único e fazer
`availability.ts` e `getDayGrid` passarem a consumi-lo, antes do go-live.
Descartada pelo motivo acima — é a mudança certa, no momento errado.

**Consequência assumida:** as duas cópias precisam andar juntas até lá. Quem
mexer na precedência de um lado tem que mexer do outro, e a fonte da verdade em
caso de divergência é `availability.ts`, porque é ela que decide a venda.

**Reabrir quando:** primeira semana pós go-live, ou antes disso se um quarto
consumidor da regra aparecer — o quarto é o sinal de que o custo de manter
cópias sincronizadas passou o custo de extrair.

## 2026-08-22 — CRUDs de grade têm DELETE real; experiências continua sem

`schedule_exceptions`, `operating_hours` e `blackouts` ganharam DELETE de
verdade, enquanto o CRUD de experiências continua sem — lá desativar é
`PATCH { ativo: false }`. A assimetria é deliberada e vale registrar, porque
quem chegar depois vai ver duas famílias de CRUD com regras opostas no mesmo
admin e presumir descuido.

**O critério é a referência, não a prudência:** `reservations.experience_id`
aponta para `experiences`, então apagar uma experiência quebraria histórico ou
seria barrada pela FK. **Nenhuma FK aponta para as três tabelas de grade.**
Apagar uma faixa de horário não deixa órfão nem quebra nada, e "desativar" ali
seria uma coluna nova inventada para imitar um cuidado que não se aplica.

**O que a decisão obriga a tela a dizer:** apagar grade **não cancela reserva já
vendida**. A vaga vive em `reservation_resources.period`, congelada na venda
(seção 4.6), e a grade governa apenas o que ainda pode ser vendido. Sem esse
aviso o dono apaga o sábado achando que cancelou os passeios de sábado, não avisa
ninguém, e os clientes aparecem no ponto de encontro. Por isso o texto aparece
duas vezes na tela de horários: no topo e dentro da confirmação de exclusão, que
é o instante em que ele age. Três testes provam o comportamento no banco.

**Alternativa descartada:** replicar o `ativo: false` nas três por consistência
visual entre telas. Descartada porque exigiria migration para adicionar a coluna,
e porque uma faixa de horário "inativa" é um conceito que não existe no domínio —
o dono pensa em "esse horário não existe mais", não em "esse horário está
pausado".

**Reabrir quando:** alguma tabela de grade passar a ser referenciada por outra
(por exemplo, se um dia uma reserva guardar de qual faixa ela nasceu). Aí o
DELETE vira o problema que hoje ele não é.

## 2026-08-21 — E-mail de confirmação cortado do go-live

Não existe Resend, não existe `lib/notifications.ts`, e não vai existir até
depois de 24/08. Verificado no código antes de decidir: zero ocorrências de
`resend`, `sendMail` ou `notification` em `lib/`, `app/`, `scripts/` e
`instrumentation.ts`, e nenhuma dependência de e-mail no `package.json`. Os
documentos se contradiziam sobre isso; nenhum lado tinha sido conferido.

**Por quê:** a seção 9 prevê cinco e-mails (termo, confirmação, lembrete, saldo
quitado, cancelamento), e construí-los a três dias do go-live competiria com a
tela de status e com os CRUDs operacionais, que atingem o cliente e o dono no
dia 1 de um jeito que e-mail nenhum substitui.

**Consequência direta, e é grande:** a tela `confirmed` de `/reserva/[id]` passa
a ser a **única** confirmação que o cliente recebe. Isso mudou o desenho dela:
não é um visto verde, é um comprovante — data por extenso, horário com o fuso
nomeado, duração, ponto de encontro, o que levar e contato, com o pedido
explícito de printar a tela. Foi também o que justificou criar a setting
`support_whatsapp`: o Quadri Club vende por ManyChat, então mandar para e-mail um
cliente que já está no WhatsApp é tirá-lo do canal onde o dono responde.

**Alternativa descartada:** construir só o e-mail de confirmação, deixando os
outros quatro para depois. Descartada porque o custo não está no template e sim
na infraestrutura — conta Resend, domínio verificado, SPF/DKIM, fila assíncrona,
tratamento de falha que não derrube a reserva —, e esse custo é pago inteiro no
primeiro e-mail.

**Consequência assumida:** cliente que fechar a aba e perder o link fica sem
comprovante nenhum. O mitigador é o link ser recuperável (`/reserva/{id}`
sobrevive a refresh) e o WhatsApp existir na tela.

**Reabrir quando:** primeira semana pós go-live. É a primeira coisa da lista
depois que o dinheiro estiver entrando.

## 2026-08-20 — Etapa 1 da migração de URL adiada; só a metade de infra entra antes do go-live

A decisão de 19/08 priorizou a Etapa 1 (mover a LP para
`app.aventix.com.br/agendamento/quadriclub`) **antes** do go-live, sob a premissa
de que o cliente divulgaria o link em material impresso — artefato que não se
corrige com deploy. **A premissa estava errada:** o link vai viver num fluxo do
ManyChat, editável a qualquer momento e sem custo. Com isso o custo de adiar cai
de "dívida com terceiro" para "editar um campo depois", e a Etapa 1 perde a
prioridade sobre o que falta do MVP — em especial a tela de status com polling,
cujo buraco (cliente paga e a tela segue dizendo "falta pagar") atinge o primeiro
cliente real e **não** se corrige editando link.

**O que entra antes do go-live, mesmo assim:** apenas a parte de painel —
registro DNS `app` e o domínio `app.aventix.com.br` adicionado ao MESMO serviço
no Easypanel. Sem código, sem deploy, sem rebuild. **Por que essa metade não
espera:** a URL do webhook de produção é cadastrada UMA vez no painel do Asaas, e
migrá-la depois acontece com dinheiro real em trânsito. O modo de falha é surdo —
o Asaas não segue redirect, 15 falhas interrompem a fila (seção 8.1) e reservas
pagas deixam de confirmar sem erro visível. Cadastrando desde já em
`https://app.aventix.com.br/api/webhooks/asaas`, a URL sobrevive às Etapas 1 e 2
sem ser tocada, porque `/api/*` nunca recebe prefixo de slug.

**Consequência assumida:** durante o go-live os dois hosts servem o mesmo app sem
redirect entre si, e o link do ManyChat aponta para `app.aventix.com.br/` (raiz),
que ainda serve a LP do Quadri Club. Muda uma vez, no ManyChat, quando a Etapa 1
de código for feita.

**Alternativa descartada:** fazer a Etapa 1 completa antes do go-live. Descartada
porque consome uma sessão de ~2h em deploy e reverificação de produção, a quatro
dias do prazo, para resolver um problema que um campo editável resolve — enquanto
o fluxo de venda tem um buraco visível ao cliente pagante.

**Reabrir quando:** primeira semana pós go-live, junto ou logo depois do CI/CD.

## 2026-08-19 — Standalone do Next tem consequências operacionais não mapeadas

O `output: 'standalone'` reduz drasticamente a imagem Docker copiando **só o que o código importa em runtime**. Descoberto na prática que isso implica três coisas: (a) os `.sql` das migrations não vão para a imagem e precisam ser copiados explicitamente no `Dockerfile`, no caminho que o container enxerga como `/app/drizzle`; (b) `node_modules/.bin/` não é preservado, então nenhum `npm run x` que dependa de binário funciona no container, independente de `dependency` ou `devDependency`; (c) pastas como `scripts/` também são descartadas. **Por que vale registrar:** nada disso está na documentação do Next, e só aparece quando se tenta rodar comando operacional dentro do container. As três vezes em que esbarramos — path da migration, `tsx` faltando, `scripts/` faltando — foram diagnosticadas como três problemas separados quando são o **mesmo** problema, e essa é a parte cara: cada um custou uma investigação própria. **Regra que fica:** qualquer operação de manutenção em produção que dependa de arquivo do repo tem que rodar **via código do Next** (importado pela app, portanto bundlado) ou via conteúdo **explicitamente copiado no Dockerfile** — nunca por `npm run` genérico. **Reabrir quando:** a próxima operação de manutenção precisar de arquivo fora do bundle e a tentação for resolver por `npm run`. Vai falhar pelo mesmo motivo.

## 2026-08-19 — Seed em produção por SQL manual, não por comando npm

O catálogo de produção foi semeado por SQL rodado direto no console do container do Postgres (`psql -c` isolado, statement por statement), não por `npm run db:seed`. **O que descobrimos ao tentar o caminho óbvio:** o standalone não copia `scripts/` para a imagem e descarta `node_modules/.bin/`, então `npm run db:seed` falha com `tsx: not found` e, mesmo com o `tsx` disponível, falharia de novo por `scripts/` inexistente. Mover o `tsx` para `dependencies` (commit `511b4d5`, feito na sessão anterior justamente para isto) **não resolveu nada** — o critério do standalone não é dev/prod, é "o runtime importa isto?", e `tsx` é comando de linha. **Alternativas descartadas:** (a) migrar `seed.ts` para JS puro, que dispensaria o `tsx` mas deixaria `scripts/` fora da imagem do mesmo jeito; (b) copiar `scripts/` para dentro do standalone no `Dockerfile`, factível mas resolve só este caso e engorda a imagem com código que não é da aplicação; (c) túnel SSH até o Postgres, **bloqueado** porque o hostname do banco é interno da rede Docker (`approvee_aventix-db`, herança do nome antigo do serviço) e não é alcançável por SSH clássico de fora. **O que fizemos:** `pg_dump --data-only --column-inserts` local, colado no console do container via `psql -f`, descoberta de que não persistiu (seção 19 do CLAUDE.md), e refeito com `psql -c` isolado. **O erro que custou mais tempo foi outro:** o `pg_dump` explicitou `-t settings -t resources -t experiences -t operating_hours` e **esqueceu `tenants`**. Sem a linha do tenant, as demais entram com `tenant_id = 1` órfão e `/api/experiences` responde `[]` **sem erro nenhum**, porque a query filtrada por tenant simplesmente não acha nada. Sintoma mudo, achado por eliminação depois de descartar cache, filtro e conexão errada. **Solução permanente:** rota `POST /api/admin/seed` protegida por sessão, chamando a função de seed do próprio código Next — o `drizzle-orm` já está bundlado, mesma lógica da migration-no-boot. Registrada como pós go-live. **Reabrir quando:** um tenant novo precisar ser semeado ou o template do Quadri Club for re-aplicado. Até lá o caminho manual, seguindo o protocolo da seção 19, funciona; a rota é conforto, não urgência.

## 2026-08-19 — Deploy manual pelo Easypanel, sem CI/CD, aceito para o MVP

Cada deploy é um clique em "Implantar" no painel do Easypanel, depois do `git push`. Não existe pipeline que rode testes, faça build e implante em cima de push na `main`. **Por quê:** CI/CD sério (Actions rodando testes, build e deploy condicional) é 2 a 4 dias de trabalho de infraestrutura com curva de aprendizado, e o go-live é 24/08. **O custo real de não fazer, escrito para não ser esquecido:** cada deploy carrega risco humano — esquecer de rodar a suíte antes do push, empurrar commit incompleto, ou testar uma mudança de documentação e clicar Implantar sem querer. Boa parte do protocolo de "só confia no artefato, nunca no relatório" que este projeto vem seguindo existe **para compensar essa falta de automação**, e é por isso que as verificações de produção desta sessão foram todas por consulta direta e `curl`, não por leitura de log. **Reabrir quando:** semana pós go-live. É onde CI/CD paga por si — elimina metade das verificações manuais e é pré-requisito confortável para o que vem depois (seed no boot, migration como passo separado do deploy).

## 2026-08-19 — Deploy inicial em produção com sandbox, não com credenciais de produção

O sistema foi para `https://aventix.com.br` apontando para o **sandbox** do Asaas, em vez de esperar as credenciais de produção do cliente. **Por quê:** essas credenciais dependem do Quadri Club aprovar a conta e cadastrar chave Pix, e nada indica quando destrava. Adiar o deploy até lá empilharia **todo** o risco técnico de produção — armadilhas do `$` no Easypanel, primeira migration em produção, path do `drizzle` no standalone, seed em container sem `scripts/` — num único momento futuro, sob pressão de prazo. Fazer agora expõe os problemas enquanto ainda há dias para resolvê-los. **Alternativa descartada:** esperar as credenciais. Descartada pelo motivo acima e porque o produto rodando em sandbox **no domínio real** já valida tudo exceto o dinheiro entrar. **Consequência assumida:** o QR gerado hoje é de sandbox, o nome no copia-e-cola é `NEOSOLUTI COMERCIO E SERV` e não `Quadri Club`, e o pagamento é fictício. Quando as chaves chegarem, são duas variáveis no Easypanel mais o cadastro do webhook de produção — **sem tocar em código**. **Confirmação empírica da tese:** o deploy revelou três problemas concretos que só existiriam em produção (path do `drizzle`, `tsx`/`scripts` descartados pelo standalone, e a armadilha do console web da seção 19). Se tivéssemos esperado, os três apareceriam juntos no dia em que o dinheiro precisasse entrar.

## 2026-08-19 — Console web do Easypanel não confirma COMMIT de SQL colado

Registrado como seção nova no CLAUDE.md (**19. Armadilhas de infraestrutura (Easypanel)**), não aqui, porque é regra operacional a seguir toda vez que alguém precisar rodar SQL manual em produção, não só o porquê de uma escolha já tomada. Resumo: `psql -f` com script colado no console web reportou `INSERT`/`COMMIT` de sucesso e nada persistiu fora daquela sessão; só `psql -c` isolado (uma statement por chamada) gravou de verdade. Ver a seção para o diagnóstico completo e o protocolo de verificação.

## 2026-08-17 — Teste que envolve data ancora no fuso da REGRA, não em UTC

**Lição de método, e é a segunda vez.** Um teste que mede tempo tem que usar o mesmo fuso que a regra de negócio usa para cortar. **Primeira ocorrência (03/08):** os casos de lead time montavam a grade em "hoje" e comparavam contra `Date.now()`, e passada certa hora nenhum candidato sobrevivia — resolvido com âncora absoluta. **Segunda (17/08):** o caso dos 18 anos exatos construía a data de nascimento com `new Date().toISOString()`, que é UTC, enquanto `createReservation` corta pela data de calendário de **São Paulo**; depois das 21h locais o UTC já virou o dia seguinte, a data saía um dia adiantada e o operador de 18 anos completos era recusado. **Sintoma comum às duas:** o teste passa de manhã e quebra à noite, e a suspeita cai no código de produção, que estava certo nas duas vezes. **Regra que fica:** se a regra corta por data de calendário em São Paulo, a fixture deriva de `todayLocalDate()`; se corta por instante, ancore num instante absoluto. `new Date().toISOString().slice(0,10)` num teste deste projeto é quase sempre bug. **De brinde, o mesmo erro apareceu fora do teste no mesmo dia:** o Asaas recusou uma baixa com "A data selecionada 18/08/2026 não pode ser posterior a data atual" porque mandamos a data em UTC — a borda com terceiro tem o mesmo cuidado.

## 2026-08-17 — Função única de processamento entre webhook e reconciliação

`lib/payments/process.ts` é chamado tanto por `POST /api/webhooks/asaas` quanto pelo job de 10 min, e a seção 8-B item 2 exige que seja "exatamente a mesma função — mesmo código, mesma idempotência". **Por quê, além da economia de linhas:** duas implementações divergem com o tempo, e a divergência se manifestaria como "o webhook confirma e a reconciliação não". Esse bug só apareceria quando a fila do webhook cai — que é exatamente o momento em que a reconciliação é a única coisa segurando o fluxo do dinheiro. Ou seja, o bug ficaria escondido no único cenário em que ele importa. **Alternativa descartada:** o job chamar o endpoint HTTP do webhook contra si mesmo, o que garantiria caminho idêntico. Descartada porque exigiria o token do webhook em posse do job e transformaria uma chamada de função em ida à rede, com o processo dependendo do próprio proxy estar de pé. **Consequência assumida:** `processCharge` não pode lançar por regra de negócio — devolve `outcome`, porque o webhook não pode responder 5xx (15 falhas interrompem a fila). Erro de infraestrutura sobe, porque aí repetir adianta.

## 2026-08-17 — Pix tardio tenta reconfirmar sob SAVEPOINT, em vez de consultar disponibilidade

Quando o pagamento chega depois de o hold expirar (seção 8.3), o código **tenta** `setReservationStatus('confirmed')` e deixa a exclusion constraint responder, dentro de uma transação aninhada (savepoint). **Por que não consultar disponibilidade antes:** um "checa e depois grava" tem janela de corrida — pode ver livre e perder a vaga entre as duas operações. A constraint é a única fonte sem essa janela. **Por que o savepoint é obrigatório:** a violação de exclusion **aborta a transação inteira** no Postgres. Sem ele, a vaga tomada desfaria também o `state='paid'` gravado logo antes, e o sistema **esqueceria que recebeu o dinheiro** — o pior desfecho possível deste fluxo, porque o dono nunca saberia que precisa estornar. **Alternativa descartada:** duas transações separadas (marca pago, depois tenta confirmar), que dispensaria savepoint. Descartada porque um crash entre as duas deixaria pagamento pago e reserva pendente para sempre, já que a idempotência faria a próxima passada sair por "já pago". **Exercitado contra dado real** (teste 32): a violação dispara de verdade, a reserva segue `expired` e o pagamento permanece `paid`.

## 2026-08-17 — Estorno pendente é estado derivado, não coluna nova

"Dinheiro entrou e a vaga não existe" é identificado por `reservations.status='expired' AND reservation_payments.state='paid'`, mais um log estruturado — **sem coluna** `refund_pending`. **Por quê:** os dois campos juntos já dizem exatamente isso, e a consulta é precisa. Uma coluna guardaria, com risco de divergir, o que o estado já expressa: bastaria um caminho de escrita esquecer de setá-la (ou de limpá-la quando o Pix tardio reconfirma) para o painel passar a mentir nas duas direções. **Alternativa descartada:** `reservations.refund_pending boolean`, que seria mais direto de consultar e de exibir. Descartada porque exigiria migration e criaria um segundo lugar para a mesma verdade — o projeto já centraliza estado financeiro derivado em `recalcReservationPayment` justamente para não ter isso. **Consequência:** a tela de saúde da integração (seção 8-B, ainda não construída) consulta o predicado, não uma coluna. **Reabrir se:** aparecer necessidade de anotar algo que o predicado não expressa — por exemplo, "o dono já estornou", que é informação nova e aí sim pede coluna.

## 2026-08-17 — CPF obrigatório no wizard, validado nas duas pontas

O passo 4 passou a coletar CPF do responsável, com validação de dígito verificador no front **e** em `createReservation`. **O que forçou:** medido contra o sandbox — `POST /v3/customers` aceita `cpfCnpj` null, mas `POST /v3/payments` recusa. CPF é opcional para cadastrar e obrigatório para cobrar. Sem o campo, cliente novo preenchia os seis passos, a cobrança falhava, a reserva expirava e o horário voltava para a grade. **Por que um módulo compartilhado (`lib/cpf.ts`) e não duas checagens:** o dígito verificador não admite "versão leve" como a do telefone (que tem uma checagem simples no front e a regra real em `lib/reservations.ts`, porque aquele módulo carrega Postgres e não pode ir para o cliente). Duas implementações do mesmo algoritmo divergiriam, e a divergência apareceria como "o formulário aceitou e o POST recusou". **Por que validar o dígito e não só o comprimento:** um dígito trocado só seria descoberto quando o Asaas recusasse a cobrança — com a reserva já criada e prestes a expirar, que é a falha mais cara do fluxo. **Onze dígitos repetidos são rejeitados explicitamente:** `111.111.111-11` e companhia **passam** na aritmética do checksum e são exatamente o que alguém digita para preencher qualquer coisa. **Sem migration:** `customers.cpf` já existia e a rota já aceitava o campo.

## 2026-08-17 — asaas_customer_id guardado, e persistido antes da cobrança

`customers.asaas_customer_id` (migration 0003, nullable, índice único parcial) guarda o id do cliente no provedor. **Por quê:** o Asaas **aceita cadastro duplicado** — criar o mesmo cliente duas vezes não dá erro, dá dois cadastros. Sem guardar o id, cada reserva criaria um cliente novo e a base do tenant encheria de repetidos, atrapalhando o dono no painel do Asaas e quebrando qualquer histórico por cliente lá. **A decisão fina foi o MOMENTO da gravação:** o id é persistido por um gancho (`onProviderCustomerCreated`) no instante em que o cliente passa a existir, **antes** de a cobrança ser tentada. **Alternativa descartada:** devolver o id junto do resultado de sucesso de `createPixCharge`, que é o desenho óbvio. Descartada porque a criação da cobrança pode falhar depois de o cliente já ter sido criado — e aí o id se perderia, deixando um cliente órfão no provedor **a cada retentativa**. **Medido acidentalmente:** foi exatamente o que aconteceu na primeira reserva de teste (a cobrança falhou por falta de CPF) e o `cus_...` ficou gravado, provando o gancho. **Índice único parcial** porque muitos clientes ainda não têm id (NULL não colide), mas um mesmo `cus_` nunca pode se vincular a dois clientes do Aventix.

## 2026-08-17 — Centavos para reais sem ponto flutuante

`lib/payments/money.ts` converte por manipulação de string sobre o inteiro (`padStart(3)` e fatiamento), não por `cents / 100`. **Por quê:** divisão em ponto flutuante é correta na maioria dos valores e erra em alguns, e o erro não aparece no número — aparece na **serialização**. O risco real não é "325.48999999" numa tela, é um centavo de diferença entre o que o banco diz que a reserva custa e o que o cliente foi cobrado, divergência que só seria notada na conciliação, depois de o dinheiro ter entrado. **Por que a forma canônica é string e não número:** string é a única representação que não pode perder o zero final — `32500` tem que virar `"325.00"`, nunca `"325"` (que o Asaas cobraria como R$ 325,00 por coincidência) nem `"32.5"`. **Casos que justificam cada decisão, todos no teste 17:** `32549→"325.49"` e `23249→"232.49"` (preços reais), `65098→"650.98"` (dois quadris), `32500→"325.00"` (zero final), `50→"0.50"` e `5→"0.05"` (abaixo de um real, onde a divisão erra o padding), `999999→"9999.99"`. **Mais o teste 18, de coerência:** para os preços do catálogo, `reais × 100` volta exatamente ao centavo original, e `JSON.stringify` do número reproduz a string canônica — que é o que o provedor recebe de fato. **Centavo fracionado lança** em vez de arredondar: arredondar esconderia o bug em quem produziu o valor.

## 2026-08-17 — Chave de API do Asaas sem expiração e sem permissão de saque

As chaves (sandbox e, quando gerada, produção) são criadas **sem data de expiração** e **sem permissão de saque**. **Sem expiração porque:** chave que vence em produção derruba o pagamento sem aviso e num horário que ninguém escolheu — o modo de falha é pior que o risco que a expiração mitiga. O Asaas já desabilita chave sem uso por 3 meses, e rotação se faz por suspeita de vazamento, não por calendário. **Sem permissão de saque porque:** o Aventix só precisa criar cobrança, consultar status e receber webhook. O dinheiro é do tenant e o sistema **nunca** é intermediário de recebíveis (seção 1) — sem essa permissão, uma chave vazada não move dinheiro da conta do cliente, que é a diferença entre um incidente e um prejuízo. **Alternativa descartada:** chave com expiração curta e rotação agendada, que é a recomendação genérica de segurança. Descartada porque exige um processo de rotação que não existe num projeto de um desenvolvedor, e a chave expirada silenciosamente é o cenário mais provável.

## 2026-08-17 — Sandbox e produção são contas separadas, com chaves que não se substituem

Desenvolvimento usa exclusivamente a chave de sandbox (`ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3`); a de produção só é gerada na Fase 4 e entra como variável de ambiente no Easypanel, nunca em arquivo. **Por que a chave de produção não serve para desenvolver:** no Asaas, ambiente é uma propriedade da CONTA, não um parâmetro da requisição — a chave de produção move dinheiro de verdade. Uma cobrança de teste ali gera Pix real na conta do Quadri Club, aparece na conciliação do cliente e, se paga, precisa de estorno manual com taxa que não volta (seção 8-C). O inverso também vale: id de sandbox não existe em produção. **Consequência operacional:** o webhook também é por conta, então a URL do ngrok cadastrada hoje é só do sandbox; produção precisa de cadastro próprio com token próprio. **Regra que fica:** nunca apontar `.env` local para produção "só para testar uma coisa".

## 2026-08-09 — Termo real fica em arquivo de código, sem CRUD nem editor no admin

O CLAUDE.md previa `/admin/termo/page.tsx`, `/api/termo/route.ts` e "termo" na lista de CRUDs da seção 7.2, com texto "versionado editável no admin". A implementação foi outra: `lib/terms/quadriciclo-v1.ts` exporta `TERM_VERSION` e `TERM_TEXT`, importados direto pelo componente cliente do formulário público — sem rota, sem tela de edição. **Por quê:** instrução explícita da tarefa ("NÃO crie UI de edição do termo, o texto vive no código"). **Justificativa que se sustenta independente da instrução:** o formulário público já é `'use client'`, buscar o termo por API seria uma volta ao servidor sem necessidade nenhuma (o texto não muda por requisição, muda por deploy); e um editor de termo no admin é a mesma categoria do form builder que a seção 11-B já proíbe — texto legal exposto a edição solta pelo dono, sem revisão, é risco maior que o ganho de não precisar de deploy para trocar uma vírgula. **Como versiona:** trocar o texto é criar `quadriciclo-v2.ts` com nova `TERM_VERSION`; o arquivo antigo nunca é editado, e a reserva antiga mantém `termo_version` apontando para ele. **CLAUDE.md atualizado nesta sessão** (seções 7.2, 10, 14) para refletir isso — o documento antigo estava descrevendo uma tela que nunca existiu. **Reabrir se:** o texto do termo precisar mudar com frequência maior que o ciclo de deploy, ou se entrar um segundo tenant com termo diferente do Quadri Club.

## 2026-08-09 — Contato de emergência entra em colunas nullable, mesmo com a tabela vazia localmente

`reservations` ganhou `emergency_contact_name` e `emergency_contact_phone` (migration 0002) como `text` nullable, não `NOT NULL`. **Por quê:** a tabela local tinha 0 linhas no momento da migration, o que tornaria `NOT NULL` seguro ali — mas não havia como confirmar o mesmo em produção, às vésperas do go-live (24/08), e o histórico do projeto já registrou (0001, 2026-08-04) o custo de assumir tabela vazia sem medir. **Alternativa descartada:** `NOT NULL` direto, aproveitando que local estava vazio. Descartada porque a migration roda igual em produção sem reverificação, e produção nunca migrou até agora — não há como garantir que continua vazia no dia do deploy desta migration. **Onde a obrigatoriedade mora:** na aplicação — zod em `POST /api/reservations` e validação em `createReservation` — nunca no banco. **Regra que fica, generalizando a decisão da 0001:** toda coluna nova que passa a ser obrigatória dali em diante, mas não tem como ter valor retroativo em linha existente, entra nullable; o banco nunca é o lugar de impor "obrigatório a partir de agora".

## 2026-08-09 — Telefone do contato de emergência reaproveita normalizePhone(), sem mensagem de erro diferenciada

O telefone do contato de emergência passa pela mesma função que normaliza e valida o telefone do cliente (`normalizePhone`: 10/11 dígitos, remoção condicional do 55 de país). **Por quê:** criar uma segunda validação de "telefone brasileiro válido" divergiria da primeira com o tempo, e o formato gravado (só dígitos) fica consistente com `customers.phone`. **Custo aceito:** `InvalidPhoneError` não diz DE QUEM é o telefone inválido — a mensagem é genérica, então um erro 400 do contato de emergência e um do cliente chegam com o mesmo formato. **Por que não incomoda hoje:** o wizard nunca deixa chegar ao servidor com o campo vazio ou curto demais (checagem local antes de habilitar o botão do passo 5); o caso só ocorre em POST direto. **Reabrir se:** o front precisar diferenciar os dois erros na tela.

## 2026-08-09 — Scroll-to-end do termo é estado local do passo, não do WizardState

A rolagem obrigatória até o fim do termo (`StepTerms`) vive em `useState` dentro do próprio componente, não em `WizardState`. **Por quê:** é o mesmo padrão de qualquer termo com rolagem obrigatória — sair da tela e voltar exige ler de novo; persistir no wizard obrigaria decidir se "já rolei uma vez" vale para sempre dentro da mesma sessão de preenchimento, pergunta sem resposta óbvia. **Consequência assumida:** se o checkbox 1 já estava marcado (persistido em `state.termoAccepted`) e o componente remonta (por exemplo, o cliente volta ao passo 4 e avança de novo), o checkbox nasce habilitado sem exigir nova rolagem — só um termo NUNCA aceito nasce bloqueado. **De brinde:** termo curto o bastante para caber sem rolagem já nasce liberado (a checagem roda uma vez na montagem), útil se o texto encolher no futuro.

## 2026-08-09 — Contato de emergência exposto no painel do admin, além do que a tarefa pediu

A tarefa original só pedia a exposição na resposta de `GET /api/admin/reservations/{id}`; o painel sobreposto (`reservation-panel.tsx`) ganhou uma seção própria mostrando nome e telefone. **Por quê:** o pedido veio com a razão "o admin precisa ver para acionar em emergência" — um campo que existe só na API, sem lugar na tela que o dono realmente usa em campo (celular, sábado, movimento), não cumpre essa razão. **Alternativa descartada:** parar na API e deixar a UI para uma tarefa futura. Descartada porque o custo marginal era baixo (o painel já tem o padrão `Section`/`Field` para exatamente este tipo de dado, ao lado de CPF e telefone do cliente) e deixar pela metade contradiria o motivo dado. **Consequência:** o comentário de dado sensível do componente (`>>> DADO SENSIVEL <<<`) foi atualizado para citar o contato de emergência ao lado de CPF e documento.

## 2026-08-04 — A reserva congela o que foi vendido, e a fonte do backfill é o period

`reservations` ganhou `duration_minutes` e `buffer_minutes` (migration 0001), e o calendário e o painel passaram a lê-los da reserva em vez do JOIN com `experiences`. **Por quê:** o preço já era congelado em `total_price_cents` e a vaga em `reservation_resources.period`, mas a duração exibida vinha do valor ATUAL da experiência. Editar a duração de uma trilha redesenhava retroativamente o tamanho dos blocos de reservas já vendidas: aumentar mostrava o dia mais cheio do que estava (o dono recusa cliente num horário livre), diminuir desenhava um vão que a grade oferecia e o POST recusava com 409. Não produzia overbooking, produzia tela mentindo. **O que tornou isso urgente:** até então mudar duração só era possível por psql; o CRUD de experiências é o que torna o caminho alcançável pelo dono, então a correção precisava vir antes dele. **Alternativa descartada:** ler `upper(period)`, que é congelado e não custaria coluna. Não resolve: o `period` guarda duração+buffer somados e não registra onde uma termina e a outra começa, então o fim SEM buffer que o cliente enxerga (seção 4.6) não é recuperável dele. **Fonte do backfill, que foi a decisão fina:** o `period` para o TOTAL (é o único registro por reserva do que foi realmente vendido) e a experiência atual para a DIVISÃO, usando o buffer e derivando a duração por diferença. O buffer é constante operacional e a duração é o produto que o CRUD vai editar, então se só a duração mudou desde a venda esse caminho acerta os dois campos; pelo caminho oposto erraria os dois. **Ramo degenerado tratado:** buffer atual maior que o período inteiro cairia em duração negativa e o CHECK derrubaria a migration inteira por causa de uma linha; cai para a experiência e um bloco `DO`/`RAISE WARNING` nomeia os ids. Os três ramos foram exercitados contra cenário construído, não por leitura. **Detalhe operacional:** os avisos saem no log do servidor Postgres, não no stdout do drizzle-kit.

## 2026-08-04 — Migration 0001 nova, editada à mão, sem recolapsar a 0000

A mudança entrou como `0001` e não reescrevendo a `0000` colapsada. **Por quê:** o migrator do Drizzle identifica o que já rodou pelo hash do CONTEÚDO do arquivo; reescrever a 0000 faria o banco local achar que ela nunca rodou e tentar `CREATE TABLE` sobre as 13 tabelas existentes. O colapso de 27/07 se justificou porque o histórico era churn de desenvolvimento com uma 0002 quebrada, o que não é o caso aqui. Produção vazia é o que torna a 0001 **barata** (roda em sequência, backfill no-op), não o que justifica recolapsar. **Editada à mão porque o drizzle-kit emite `ADD COLUMN NOT NULL`**, que aborta em tabela com linhas — exatamente a falha que matou a antiga 0002. Virou nullable → backfill → `SET NOT NULL`. **Por que isso é seguro:** o `db:generate` compara `schema.ts` com o snapshot em `meta/`, não com o SQL, e o estado final da versão editada é idêntico ao gerado; confirmado com "No schema changes" depois. **Precedente:** o `CREATE EXTENSION btree_gist` e a exclusion constraint já eram SQL manual dentro de migration gerada.

## 2026-08-04 — Sinal fica fora do CRUD de experiências, contrariando a seção 16

O CRUD só aceita `payment_mode = 'full'`; a tela não oferece sinal e a API recusa `deposit` com 422. **Isto conflita com o CLAUDE.md**, cuja seção 16 põe o sinal no MVP e cuja rev 6 inteira existe por causa dele. **Por quê assim mesmo:** o sinal depende da Fase 2 (Asaas), travada em pré-requisitos do cliente, e da decisão de negócio "lançar com integral ou com sinal?", ainda aberta. Construir a UI antes disso seria construir para um cenário que pode não existir. **Por que 422 e não aceitar calado:** gravar `payment_mode='deposit'` sem `deposit_percent` nem `deposit_fixed_cents` viola `experiences_deposit_mode_check` e o erro chegaria como 500 do driver. **Alternativa descartada:** implementar a UI de sinal já, para não divergir do documento. Descartada porque a decisão de negócio muda o desenho da tela (percentual x valor fixo, texto da política no termo) e refazer custa mais que adiar. **Ponto único a mexer quando reabrir:** `ACCEPTED_PAYMENT_MODES` em `lib/experiences.ts`. **Reabrir quando:** o Asaas entrar ou a decisão de negócio sair.

## 2026-08-04 — Formulário público na raiz, com estado 100% no cliente até o POST

O wizard vive em `app/(public)/page.tsx`, a raiz, e nada é gravado no banco até o passo 5. **Raiz e não `/agendar`:** a seção 14 já reservava `/(public)/page.tsx` para ele, e `aventix.com.br` é divulgado direto ao cliente final; `/agendar` obrigaria uma home a existir só para levar até lá. De quebra pagou a dívida do route group `(public)` e removeu o placeholder do create-next-app. **Estado no cliente:** quem abandona no meio não deixa cliente, reserva pendente nem vaga travada, e o hold de 15 min só começa a correr quando há intenção real de comprar — alguém pode levar dez minutos preenchendo participantes sem segurar um horário que talvez não compre. **Alternativa descartada:** criar a reserva mais cedo (por exemplo ao escolher o horário) para "garantir" a vaga durante o preenchimento. Descartada porque transformaria cada desistência em vaga travada por 15 minutos e encheria o banco de lixo num fluxo que ainda nem cobra. **Consequência assumida:** o horário pode ser tomado enquanto o cliente preenche, e por isso o 409 tem tratamento próprio na tela, devolvendo ao passo de horário em vez de mostrar erro genérico.

## 2026-08-04 — Só horários viáveis aparecem, porque o motor não informa quantos recursos sobram

O passo de horário do formulário público mostra apenas os horários que comportam o número de recursos pedido; horário insuficiente não aparece desabilitado com explicação, como o protótipo previa. **Por quê:** `AvailabilitySlot` é `{ startAt, label }` e a rota já filtra por `resourcesNeeded` — não existe o dado "quantos recursos livres neste horário", e escrever "só 1 livre" exigiria inventá-lo. **Alternativa descartada:** inferir com uma segunda chamada em `resourcesNeeded=1` e diferença entre as listas. Funcionaria hoje, com dois recursos, mas dobra requisições, só distingue o caso M=1 e apresenta inferência como se fosse dado; com três recursos passaria a mentir. **O que se fez para não perder a informação útil:** quando o dia abre e nenhum horário comporta N, a mensagem é "Nenhum horário com N quadriciclos livres neste dia. Tente com menos, ou escolha outro dia." **Reabrir quando:** o motor devolver `freeResources` por slot, que é a melhoria registrada.

## 2026-08-04 — Maioridade do condutor é regra que não existe no servidor

O formulário público barra condutor com menos de 18 anos, e essa checagem **não tem espelho em `createReservation` nem regra no CLAUDE.md**. Registrado como decisão porque é uma divergência deliberada, não um descuido. **Como foi descoberto:** o enunciado da tarefa afirmava que o servidor já validava tudo que o front espelha; ao conferir, três das quatro regras tinham espelho e essa não. **Medido, não deduzido:** `POST /api/reservations` com condutor de 13 anos respondeu **201**. **Consequência:** a validação do front é hoje a única barreira, e um POST direto cadastra menor como condutor. **Por que não foi corrigido na mesma tarefa:** a tarefa proibia alterar `createReservation`, e a regra não está no documento-fonte — acrescentá-la ao servidor seria inventar requisito de negócio. **O que decide o desfecho:** se conduzir quadriciclo exige CNH e CNH exige 18, a regra é real e o lugar dela é `createReservation` + seção 15, com o front voltando a ser conveniência. **Método que fica:** premissa recebida no enunciado sobre o que o código já faz é para conferir, não para acreditar.

## 2026-08-03 — Detalhe da reserva é módulo próprio, não mais uma função em lib/calendar.ts

`getReservationDetail` mora em `lib/reservation-detail.ts`, ao lado de `lib/calendar.ts` e não dentro dele. **Por quê:** os dois têm contratos incompatíveis. `calendar.ts` promete UMA query para o PERÍODO inteiro com o mínimo por reserva (seção 11.1); o detalhe é uma reserva completa, sob demanda. Se ele morasse lá, a primeira pessoa a precisar de "detalhe de várias reservas" o chamaria em laço, que é exatamente o N+1 que a 11.1 existe para proibir, e o arquivo passaria a ensinar o contrário do que seu próprio cabeçalho diz. **Alternativa descartada:** uma função a mais em `calendar.ts`, que era o lugar óbvio por proximidade temática. **Segundo motivo, de privacidade:** o detalhe é o único ponto do sistema que devolve CPF e número de documento juntos, e ter isso num arquivo separado permite que a regra de manuseio (corpo nunca URL, nunca log) fique no cabeçalho dele em vez de diluída num módulo que a agenda compartilhada também consulta. **Consequência assumida:** duas funções leem `reservations` com JOIN parecido, e uma coluna nova pode precisar entrar nas duas.

## 2026-08-03 — Detalhe e cancelamento são overlay sobre o calendário, não página própria

Clicar num bloco abre um painel sobreposto; a rota `/admin/reservas/[id]` da seção 14 continua não existindo. **Por quê:** o dono está olhando a agenda de um sábado cheio e a operação é "conferir e voltar" — navegar para outra página o faria perder a posição no dia e, depois de cancelar, voltar para uma grade recarregada em outro ponto. O overlay preserva o contexto, que é o valor da tela. **Alternativa descartada:** página própria, que é o que a árvore da seção 14 previa e o que dá link direto e botão voltar de graça. **O que fica pendente por causa disso:** não há como mandar "olha essa reserva" por mensagem. A página continua fazendo sentido depois, alimentada pela MESMA rota de detalhe, e a árvore da seção 14 foi atualizada para dizer que ela é o caminho de link direto, não o do dia a dia. **Reabrir quando:** aparecer necessidade real de compartilhar uma reserva por URL.

## 2026-08-03 — Cancelar exige digitar CANCELAR, e o 404 é o mesmo para três causas diferentes

Duas decisões de superfície na primeira tela de escrita do admin. **Confirmação digitada, e não um "tem certeza?":** o risco real não é o dono cancelar a reserva errada por engano de julgamento, é o toque acidental em campo, com o celular na mão, no meio do movimento. Um diálogo de sim/não é vencido pelo mesmo toque acidental que ele deveria barrar; digitar oito caracteres em maiúsculas exige uma segunda intenção. **Motivo de cancelamento não é pedido** — foi decisão do Vinicius, fora de escopo. **404 uniforme:** reserva inexistente, reserva de outro tenant e id fora do formato uuid respondem os três a mesma coisa. Um `403` no segundo caso confirmaria a existência do id a quem está sondando, e um `400` no terceiro distinguiria "formato errado" de "não existe", distinção sem uso para o consumidor. **Detalhe que obrigou a checagem de formato:** `WHERE id = 'abc'` numa coluna uuid não devolve zero linhas, o Postgres aborta com `22P02` — sem validar antes, um id digitado errado viraria 500.

## 2026-08-03 — Depois de cancelar, a grade volta do servidor, não é remendada no cliente

O painel chama `router.refresh()` em vez de remover o bloco da lista que o React já tem em memória. **Por quê:** a página é Server Component com `force-dynamic`, então o refresh re-executa a MESMA query única do período e a grade volta do banco, que é a fonte da verdade. Remover na mão exigiria reimplementar no cliente a regra "só reserva ativa aparece" — uma segunda cópia de um filtro que hoje vive no `WHERE` do SQL — e deixaria a tela divergir de qualquer outra mudança ocorrida no meio tempo: um hold que o cron expirou, um cancelamento feito de outro aparelho. **Alternativa descartada:** atualização otimista, que é instantânea e não custa ida ao servidor. Descartada porque o ganho é imperceptível numa ação que o dono acabou de confirmar digitando, e o custo é uma tela que pode mentir sobre a agenda. **Reabrir se:** o refresh ficar lento a ponto de ser sentido, o que dependeria de um período com muito mais movimento do que o Quadri Club tem.

## 2026-08-03 — Dívida de "não exercitado" se paga construindo o cenário, não relendo o código

O bloco multi-recurso não adjacente estava registrado como "lógica correta por leitura, não por observação", porque o catálogo tem dois recursos adjacentes e o caso era inalcançável. Em vez de reler `contiguousRuns` e declarar correto, o cenário foi CONSTRUÍDO: um terceiro recurso temporário mais um blackout no recurso do meio, o que fez o motor alocar 1 e 3. A grade desenhou dois blocos (`gridColumn` 2 e 4, com a 3 vazia entre eles) e os dois dispararam GET do mesmo id. Tudo removido depois, com o catálogo conferido. **Por que vale o incômodo:** "correto por leitura" é uma afirmação sobre o que se espera do código, não sobre o que ele faz, e este projeto já registrou (27/07) que justificativa não medida vira dívida porque a próxima pessoa a lê como fato. **O que continua não medido, e segue na lista:** os dois blocos não têm vínculo VISUAL entre si. **Método que fica:** quando uma dívida disser "não exercitado contra dado real", a pergunta é o que impede o dado real de existir por dez minutos, não se a leitura do código convence.

## 2026-08-03 — Teste de relógio se ancora em data fixa e o lead vira o delta

Os quatro casos de lead time montavam a grade em HOJE e comparavam contra `Date.now()`. Como o corte do motor (`agora + lead`) andava com o relógio contra um teto fixo de 23:30, passada certa hora nenhum candidato sobrevivia e o caso estourava: 10c a partir das 19:30, 10b e 10d às 21:30, 10a às 22:30. **O que ficou:** uma data ÂNCORA fixa e absoluta (15/06/2027) e o lead derivado dela, `lead = alvo − agora`, de modo que `corte = agora + (alvo − agora) = alvo`. O relógio cancela algebricamente; o resultado observado depende só da âncora. **Por que a âncora é absoluta e não `hoje + N dias`:** a grade depende do dia da semana, e uma data relativa muda de weekday conforme o dia da rodada. **Por que uma terça:** o seed só opera sábado e domingo, então numa terça a grade vem obrigatoriamente da `schedule_exception` do próprio teste; se o INSERT falhar, o dayState sai `closed_weekday` e o teste morre apontando a causa em vez de cair na grade do fim de semana e passar pelo motivo errado. **Por que alvos em HH:17:** fora da malha de 30 min, com 13 min de folga de cada lado, o que absorve o jitter entre a leitura do teste e a do motor e o arredondamento do lead para minuto inteiro. **Alternativa descartada:** pular o teste quando o cenário não fosse construível. Um teste que se auto-desliga passa a nunca rodar e vira falso-verde, pior que flaky. A âncora vencida falha com instrução de trocar a data. **Custo aceito:** o literal `180` sobrevive como diferença entre 10b e 10c (mesma âncora, 180 min a mais de lead, primeiro slot exatamente 3h depois), mas 10a e 10d perderam a metade ponta a ponta — na âncora, `0`, `60` e `NaN` cortam a mesma coisa, ou seja, nada, e a distinção só é observável no parse, por asserção direta sobre `getNumberSetting`. **Método que ficou:** o experimento que valida o conserto precisa primeiro reproduzir a falha na versão antiga; um relógio deslocado que não deixa o teste velho vermelho não prova nada sobre o novo.

## 2026-08-03 — A tela do admin chama a lib, não a própria rota HTTP

`/admin` é Server Component e chama `getCalendarReservations()` direto, embora a seção 11.1 diga que a tela lê de `GET /api/admin/calendar`. **Por quê:** o invariante que a 11.1 protege é "UMA consulta por render, o front nunca busca por reserva ou por recurso", e ele vale integralmente — é a mesma função e a mesma query única. O que se evita é um Server Component fazendo HTTP contra si mesmo e tendo que repassar o próprio cookie de sessão. **Precedente no projeto:** `/api/availability` é camada fina sobre `lib/availability.ts`, e o servidor chama a lib. **Consequência:** a rota existe e cumpre o contrato para consumidores externos ao processo (curl, futuro app, parceiro), não para a própria tela. **Reabrir se:** a tela virar client-side com navegação sem recarga, quando o fetch passa a ser o caminho natural.

## 2026-08-03 — Aritmética de data de calendário em UTC, não com date-fns

`lib/calendar.ts` faz `addDays`, `startOfWeek`, `startOfMonth` sobre `'YYYY-MM-DD'` ancorado em UTC, e os rótulos em português saem de `Intl` nativo. **Por quê:** as funções de calendário do date-fns operam no fuso LOCAL DO PROCESSO, e uma data de calendário não tem fuso — `'2026-08-05'` é a mesma quarta-feira em qualquer servidor. Misturar as duas noções faz o container em UTC e o notebook em São Paulo calcularem semanas diferentes para a mesma URL. **Segundo motivo, específico deste repo:** date-fns está no `node_modules` só transitivamente, via `date-fns-tz`; usá-lo seria depender de resolução acidental sem declarar a dependência. **Alternativa descartada:** `npm i date-fns` e usar `startOfWeek` com âncora ao meio-dia. Funciona para offsets brasileiros e quebra em UTC+13. **Onde o fuso continua entrando:** só na conversão data → instante, que é `localToUtc` em `lib/time.ts`, via date-fns-tz. **Precedente:** `weekdayOf` já usava getters UTC pelo mesmo motivo.

## 2026-08-03 — Filtro do calendário não redimensiona a régua do dia

A view de dia recebe duas listas: `reservations` (filtrada, o que é desenhado) e `axisReservations` (sem filtro, o que dimensiona o eixo vertical). **Por quê:** o eixo se estende para caber reserva fora do horário oficial, e se ele saísse da lista filtrada, desligar um chip encolheria a grade sob o dedo do dono. No caso extremo — dia sem grade cadastrada, cujo eixo só existia por causa das reservas — filtrar todas trocava a grade pela mensagem "o tenant não opera neste dia da semana", uma afirmação falsa produzida por um filtro de visualização. **Regra que fica:** filtrar esconde bloco, nunca mexe na régua nem nas colunas. **Como foi encontrado:** não por teste, por uma pergunta sobre o comportamento esperado dos chips.

## 2026-08-03 — Bloco multi-recurso é contíguo, e a divisória fica por cima

Na view de dia, uma reserva de N recursos vira um bloco por CORRIDA CONTÍGUA de colunas (`contiguousRuns`), não um bloco por recurso nem um bloco atravessando o intervalo inteiro. **Por quê:** reserva nos recursos 1 e 3 com o 2 livre, desenhada como bloco único do 1 ao 3, mentiria dizendo que o 2 está ocupado — o erro na direção oposta ao que se quer evitar. **Decisão de leitura junto:** as divisórias de coluna são desenhadas ACIMA dos blocos. Um bloco multi-recurso é uma peça contígua cuja marcação (borda colorida, nome, trilha) fica toda na primeira coluna, e sem a divisória a coluna seguinte parece VAZIA — a leitura errada exatamente onde o recurso está tomado. **Não exercitado contra dado real:** o catálogo tem 2 recursos adjacentes, então a não-adjacência é inalcançável hoje; a lógica está correta por leitura, não por observação. **Pendência que fica:** dois blocos da mesma reserva não têm vínculo visual entre si.

## 2026-08-01 — Commit órfão se recupera por cherry-pick, não se reescreve

O trabalho descartado pelo `rebase --abort` (globalSetup + testes de preço) foi recuperado com `git cherry-pick d037245`, depois de o `git reflog` mostrar o commit íntegro no object database. **Por quê:** um commit desreferenciado não é um commit perdido, e o Git guarda objetos soltos por semanas antes de coletá-los. **Alternativa descartada:** reescrever as três peças à mão a partir da descrição do que elas faziam, que era o plano inicial da sessão. Descartada porque produziria código *parecido* com o validado, não o validado: 554 linhas, incluindo comentários que registram medições (`docker compose down -v` seguido de `npm test`, contagem de registros semeados) que não teriam como ser reproduzidas de memória. **Se fosse diferente:** o repositório ficaria com uma segunda implementação de globalSetup, sutilmente distinta da que passou pelos testes, e a diferença só apareceria no dia em que ela quebrasse. **Método que ficou:** antes de reescrever qualquer coisa dada como perdida, rodar `git reflog` e `git cat-file -t` no hash. Custa dez segundos e decide entre recuperar e reconstruir.

## 2026-08-01 — Duas fontes de ancoragem de preço nos testes, e elas não se misturam

Os testes têm duas origens legítimas de valor esperado, e confundi-las é o erro a evitar. **Catálogo real** (`TEMPLATE_EXP`, de `lib/templates/quadriciclo.ts`): usado pelos testes de composição e preço, porque ali o que se verifica é que o servidor cobra o que o NEGÓCIO decidiu. **Fixture da suíte** (`DEPOSIT_PCT_FIXTURE`, `DEPOSIT_FIXED_FIXTURE`, de `tests/helpers/db.ts`): usado pelos testes do modo `deposit`, porque as duas experiências reais estão em `payment_mode: 'full'` e o modo `deposit` não teria como ser exercitado contra o catálogo. **Por que não unificar:** apontar os testes de `deposit` para o template exigiria pôr uma experiência `deposit` no catálogo real do Quadri Club só para satisfazer teste, contaminando o produto com dado de teste. **Por que não deixar literais:** eram doze repetições de 34900/17450, e dois deles significavam coisas diferentes (o preço de uma experiência e metade do preço da outra), coincidência numérica que escondia a semântica. **Regra que fica:** o teste faz a própria aritmética a partir do parâmetro (`round(total x percent/100)`, seção 4.6) e confronta com o que o app calculou por outro caminho. Ler o esperado do retorno do app seria circular; ler do banco também, porque o app leu a mesma linha.

## 2026-07-28 — Calendário nativo com CSS Grid puro, sem biblioteca

O calendário de operação é construído com CSS Grid, sem FullCalendar, react-big-calendar ou similar. **Por quê:** libs de calendário são desenhadas para o modelo Google Calendar (timeline vertical, um evento por recurso). O Aventix é uma grade tempo×recurso com reserva multi-recurso (uma reserva ocupa N quadris), buffer visível e estado de pagamento — casos que a lib trata como plugin secundário (resource view costuma ser feature paga) ou não trata. **Alternativa descartada:** FullCalendar com resource-timeline. Descartada por custo (premium), CSS próprio a sobrescrever no tema escuro, e ter que lutar contra o modelo dela para a reserva multi-recurso. **Como o MVP não tem** drag-and-drop, recorrência nem fusos (o difícil de um calendário), sobra layout + leitura de dados, que Grid faz melhor sozinho. date-fns (já no projeto) cobre a matemática de datas.

## 2026-07-28 — Views do calendário: eixo recurso, filtro por experiência, rolagem para escala

Três modos (dia/semana/mês), eixo primário = recurso. Filtro por experiência via chips é FILTRO (esconde o que não bate), não reagrupamento do eixo. **Escala:** quando os recursos não couberem, a grade rola horizontalmente (largura mínima por coluna), sem esconder recurso nem exigir configuração do dono. **Por quê filtro e não agrupar por trilha:** decisão do Vinicius; agrupar por trilha (coluna = experiência) resolveria muitos recursos mas esconde qual recurso está alocado — fica como possível v2. **Contrato de dados:** GET /api/admin/calendar devolve o período em UMA query (reservas ativas + recursos + cliente só-nome + estado de pagamento), granularidade acompanha a view (mês traz resumo). Registrado na seção 11.1 do CLAUDE.md. **Reabrir se:** um tenant real precisar de agrupamento por trilha por ter recursos demais.

## 2026-07-28 — Painel de detalhes/cancelamento separado da grade

O calendário foi fatiado em duas tarefas: primeiro a grade de visualização (leitura), depois o painel de detalhes + cancelamento (escrita). **Por quê:** a grade já é densa (três views, filtro, layout); o painel mexe em escrita (cancelar chama setReservationStatus, dispara e-mail na Fase 4, tem confirmação). Juntar viraria um prompt difícil de revisar. Mesmo princípio de fatiar que vem sendo usado.

## 2026-07-28 — Higiene de git: operação pela metade é limbo

Três categorias de problema de git apareceram nesta semana, todas com a mesma raiz — operação deixada pela metade no fim do expediente: (1) mensagens de commit que não batem com o conteúdo (commits montados às pressas — 8f14f98, ce3e4c6); (2) trabalho commitado mas não pushed, que "existe" na sessão mas some na seguinte; (3) rebase interativo iniciado e não terminado, que deixa o repositório num estado congelado e fez um `--abort` descartar correções já validadas (globalSetup + testes de preço), recuperadas depois porque parte estava no origin. **Convenções adotadas:** rodar `git show --stat` antes de escrever a mensagem do commit; se `git status` mencionar "rebasing", resolver (`--continue`/`--abort`) antes de qualquer outra coisa e nunca iniciar rebase sem terminar na mesma sessão; o que não foi pushed não está seguro — push ao fim de cada bloco de trabalho.

## 2026-07-28 — Auth: login unico encapsulado, pronto para escalar sem refazer

MVP tem um usuario (o dono), credencial em `.env`, sessao iron-session, hash bcrypt. **Por que nao construir multiusuario agora:** papeis/convites/revogacao sao semanas de trabalho para um lancamento de um usuario, com prazo apertado. **Como evitar refazer na escala:** toda auth passa por `lib/auth.ts`; `getCurrentUser()` e o ponto unico que a v2 reescreve para ler `admin_users` e retornar papel — consumidores nao mudam. **bcrypt e nao argon2:** argon2 e superior sob ataque de quebra em massa (vazamento de banco com muitas senhas), cenario que nao existe com um usuario; bcrypt tem instalacao mais simples e mais exemplos. Encapsulado, trocar para argon2 na escala e mudar uma funcao. **iron-session e nao sessao com estado no servidor:** sessao em tabela permite revogacao imediata (expulsar sessao/demitir), requisito real na escala mas inexistente com um usuario; iron-session guarda o estado no cookie e e a opcao de menor codigo. Encapsulado atras de `getCurrentUser()`, migrar para sessao com estado na v2 nao toca os consumidores. **Reabrir quando:** entrar o segundo usuario — ai `admin_users`, papeis e provavelmente sessao com estado (para revogacao) entram juntos.

**Correcao de premissa, medida na implementacao:** a justificativa original dizia que bcrypt evita "dependencia nativa problematica em Docker". Isso esta errado pela metade — `bcrypt` E um modulo nativo (o puro-JS e o `bcryptjs`). O que salva e outra coisa: `bcrypt@6` publica **prebuilds musl** (`prebuilds/linux-x64/bcrypt.musl.node` e arm64), entao o `node:22-alpine` do Dockerfile usa binario pronto e **nao precisa de toolchain de build**. A conclusao continua valendo, o motivo e outro. Se um dia o bcrypt parar de publicar prebuild musl, as saidas sao `bcryptjs` (uma linha, gracas ao encapsulamento) ou `apk add python3 make g++` no estagio de build.

## 2026-07-28 — Sessao sem revogacao: trocar SESSION_SECRET e a unica saida

O estado da sessao vive dentro do cookie (iron-session), nao no banco. **Consequencia operacional que precisa estar escrita:** nao existe "encerrar a sessao daquele dispositivo". Um cookie roubado vale ate expirar (8h). A unica forma de invalidar sessoes abertas e **trocar `SESSION_SECRET`**, o que derruba todas de uma vez. **Por que se aceita isso no MVP:** ha um unico usuario, e "derrubar todas as sessoes" e exatamente o que ele quereria fazer num incidente. **Por que 8h e nao 30 dias:** o teto de exposicao de um cookie roubado e a validade dele; 8h cobre um dia de operacao e limita o estrago. **Reabrir quando:** entrar o segundo usuario — demitir alguem exige revogacao seletiva, e ai a sessao vai para o banco.

## 2026-07-28 — Fail-fast de auth no boot (instrumentation), nao no import do modulo

`lib/auth.ts` valida ambiente de forma PREGUICOSA (na primeira leitura), e `instrumentation.ts` forca essa leitura no boot para o erro aparecer cedo. **Alternativa descartada:** validar no topo de `lib/auth.ts`, que e o fail-fast mais obvio. Ela quebra o `next build` dentro do Docker: o Easypanel injeta variaveis em **runtime**, nao no build (secao 2), entao `ADMIN_*` legitimamente nao existem durante o `npm run build` e a imagem nem sairia. **Segunda decisao junto:** o boot **avisa e segue**, nao mata o processo. O site publico de reservas nao depende de auth nenhuma; derrubar o container por causa de uma variavel do painel tiraria a venda do ar para consertar um problema que so afeta o dono. O log grita, o admin responde 500 no login, o resto funciona. **Se fosse diferente:** uma variavel esquecida num deploy de sexta derrubaria o site inteiro em vez de so o painel.

## 2026-07-28 — Cifroes do hash bcrypt precisam de escape no .env

`ADMIN_PASSWORD_HASH` vai no `.env` com `\` antes de cada `$` (`\$2b\$12\$...`). **Por que:** o carregador de ambiente do Next (`@next/env`) expande variaveis, e o hash bcrypt tem tres cifroes; sem escape, `$2b$12$GaW` e lido como variavel inexistente e some — o valor chega com **50 caracteres em vez de 60**. **MEDIDO nas cinco formas:** sem aspas, com aspas simples e com aspas duplas todas quebram; so o escape com `\` funciona (com ou sem aspas). **O que torna isso traicoeiro:** o `dotenv` puro que os scripts e os testes usam le certo MESMO SEM escape, entao `npm run auth:hash` e a suite nao acusam nada — o sintoma aparece so dentro do Next, e com cara de "senha errada", que manda o dono trocar a senha em vez de olhar o `.env`. **Defesa em tres camadas:** o script ja imprime a linha escapada, o `.env.example` documenta as cinco formas medidas, e `lib/auth.ts` valida o prefixo do hash no boot com mensagem que cita esta causa e o comprimento recebido.

## 2026-07-28 — MVP so Pix: price_cents e o preco Pix

O Quadri Club pratica preco por metodo (Pix cerca de 7% mais barato que cartao). Como o MVP so tem Pix, `price_cents` das experiencias = preco Pix (Montanha 32549, Fazenda 23249). O preco de cartao (34999 / 24999) nao e armazenado agora. **Alternativa descartada:** guardar preco por metodo ja, em coluna extra ou tabela de precos. Descartada porque adiciona modelagem para um metodo que nao existe no MVP. **Se fosse diferente:** ou o sistema carregaria uma dimensao morta, ou alguem semearia o preco de cartao por engano e todo cliente Pix pagaria 7% acima do anunciado, sem erro nenhum aparecendo. **Reabrir quando:** cartao entrar na v2. Ai preco por metodo vira necessario e a modelagem (coluna versus tabela) se decide junto.

## 2026-07-28 — Inversao da ordem Fase 2 / Fase 3: telas de admin antes do pagamento

Os pre-requisitos do Asaas (conta aprovada, chave Pix, API keys) atrasaram e travam a Fase 2 inteira. Em vez de esperar parado, a ordem foi invertida: construir agora as telas de ADMIN da Fase 3 que nao dependem de pagamento (auth, calendario nativo, CRUDs de catalogo, configuracoes, clientes sem a parte de faturas, agenda compartilhada), e deixar para depois a Fase 2 (PaymentProvider, webhook, reconciliacao) e o miolo do fluxo publico de compra (tela de pagamento Pix, criacao de cobranca no formulario). **Alternativa descartada:** esperar o Asaas antes de tocar a Fase 3. Descartada porque desperdica dias num cronograma apertado (go-live 24/08) e as telas de admin sao trabalho necessario de qualquer forma. **Bonus:** com o admin pronto, o cliente pode comecar a configurar o Quadri Club de verdade enquanto o Asaas nao chega, o que tambem antecipa a confirmacao dos valores que seguem PROVISORIOS no template. **Custo aceito:** Fase 2 e Fase 3 serao costuradas no fim em vez de sequenciais, com mais troca de contexto. **Reverter se:** o Asaas chegar antes de terminarmos as telas de admin, quando volta a fazer sentido fechar a Fase 2 primeiro.

## 2026-07-28 — server-only aliasado para stub vazio no Vitest

O Vitest resolve `server-only` para `tests/stubs/server-only.ts`, um modulo vazio. **Por quê:** o Vitest roda em Node puro e o pacote real lanca ali. O marcador existe para barrar import a partir de Client Component, conceito de build do Next que nao se aplica ao Vitest, entao neutraliza-lo em teste nao afrouxa nenhuma protecao real: ela continua valendo no build, com o pacote de verdade. **Alternativa descartada:** ativar a condicao de exportacao `react-server` na config do Vitest. Ela resolveria, mas e global: qualquer pacote com export `react-server` (React inclusive) passaria a resolver por outro caminho nos testes, afastando o ambiente de teste do de producao em vez de aproximar. **Se fosse diferente:** um bug de resolucao de modulo apareceria so em producao, ou pior, um teste passaria contra uma versao de biblioteca que o app nunca carrega.

## 2026-07-28 — Testes de integracao contra o Postgres real, com catalogo como pre-condicao

A suite nao mocka banco: roda contra o Postgres local, com o catalogo do seed como pre-condicao que ela nunca apaga, e zera so as tabelas de movimento. **Por quê:** o nucleo do Aventix E o banco. Exclusion constraint, `tstzrange` com limites `[)`, `FOR UPDATE`, advisory lock e transacao com rollback nao existem fora dele; testar contra mock provaria que o mock funciona. **Consequencias assumidas:** `fileParallelism: false` na config, porque os arquivos compartilham o mesmo banco e se apagariam entre si; `schedule_exceptions` e `blackouts` entram na limpeza, ja que o seed as deixa vazias e os testes criam linhas nelas; e a suite exige `npm run db:seed` rodado antes. **Alternativa descartada:** banco efemero por arquivo de teste (container ou schema por worker). Daria paralelismo e isolamento total, ao custo de subir infraestrutura por rodada; com uma suite de 2 segundos, nao se paga.

## 2026-07-28 — Cenario de teste montado por SQL cru, nao por createReservation

Os helpers inserem reservas e alocacoes direto por SQL (`occupy()`), em vez de chamar `createReservation`. **Por quê:** se o cenario fosse montado pela funcao de criacao, um bug nela derrubaria tambem os testes de disponibilidade, e a suite apontaria para o lugar errado. Montando por fora, cada grupo falha pelo proprio motivo. **Custo:** os helpers conhecem o schema e precisam acompanhar mudancas de coluna, o que o typecheck nao pega porque e SQL cru em template string.

## 2026-07-28 — server-only resolve dentro do Next e lança fora dele

`lib/tenant.ts` e `lib/availability.ts` declaram `import 'server-only'`. Comportamento MEDIDO em três contextos: dentro do Next (rotas, Server Components, `instrumentation.ts`) o import resolve normalmente; em processo Node cru (`tsx` avulso, Vitest) ele lança "This module cannot be imported from a Client Component module". A explicação provável é a condição de exportação `react-server`, que o Next aplica e o Node cru não; o mecanismo interno não foi aberto para conferência, só o comportamento. **Consequência prática:** `instrumentation.ts` usa import estático sem problema, `scripts/seed.ts` não pode importar `tenant.ts` (declara o tenant id localmente), e o Vitest precisa de tratamento explícito, ainda por decidir. **Alternativa descartada:** import dinâmico no `instrumentation.ts` como precaução. Ela não corrigia nada, porque nada quebrava, e o comentário que a justificava afirmava um perigo inexistente. **Lição de método registrada:** justificativa de código que não foi medida vira dívida, porque a próxima pessoa a lê como fato.

## 2026-07-28 — Seed reconcilia catálogo por nome e nunca apaga

`scripts/seed.ts` casa recursos e experiências por `(tenant_id, name)`, e faixas de horário pela tupla inteira `(weekday, opens, closes)`. **Por quê:** essas tabelas usam `id serial` e não têm chave natural no schema; o nome é o único identificador estável que o template oferece. **Consequência assumida:** renomear um item no template cria um NOVO registro em vez de renomear o antigo, e o antigo é reportado como órfão. É o comportamento seguro, porque o registro antigo pode ter reservas apontando para ele. **O que o seed nunca faz:** apagar. Nem movimento, que ele sequer toca, nem catálogo ausente do template. Sincronizar a grade removendo faixas antigas quebraria FK de reservas gravadas; desativar catálogo obsoleto é operação do admin, com `active = false`.

## 2026-07-28 — /lib é biblioteca, /scripts é executável

Seed e futuros utilitários de linha de comando vivem em `/scripts`, não em `/lib`. **Por quê:** um arquivo em `/lib` pode ser importado por qualquer caminho do app, e o seed chama `main()` ao ser carregado e escreve no banco; um import distraído dispararia escrita. **Alternativa descartada:** `lib/templates/seed.ts`, que ficaria colado ao template que ele aplica. **Custo aceito:** `/scripts` não estava na árvore da seção 14 do CLAUDE.md e foi acrescentado lá. A regra também decide onde entra o job de reconciliação da Fase 2: a lógica em `/lib` (testável, reusável), o entrypoint agendado fora dela.

## 2026-07-28 — Cron de hold via node-cron, não pg_cron

Expiração de hold roda com node-cron no processo Next (instrumentation.ts), não pg_cron. **Por quê:** pg_cron executa SQL dentro do Postgres e não consegue chamar setReservationStatus; SQL cru mexendo em status furaria a regra do FOR UPDATE (seção 4.6) e a proteção contra double-booking. **Alternativa descartada:** rota protegida chamada por agendador externo (Easypanel/serviço) — desacoplada e resistente a restart, mas adiciona infraestrutura e um segredo a gerenciar, sem ganho real num setup de container único. **Reabrir se:** escalar para múltiplos containers ou migrar para serverless, onde o cron in-process roda duplicado ou não roda.

## 2026-07-27 — CLAUDE.md é especificação, docs/ é estado e histórico

CLAUDE.md descreve como o sistema é, no presente, e é lido por inteiro toda sessão. Estado e histórico vão para `docs/`. **Alternativa descartada:** um `sessions.md` acumulando diário de sessões. Logs crescem sem limite, ninguém relê o meio deles e viram uma terceira fonte de verdade que diverge das outras. **Se fosse diferente:** o bloco "Revisão 4/5/5.1/6" no topo do CLAUDE.md é o exemplo vivo do fracasso — histórico dentro da especificação, com uma regra viva (a regra de marca) enterrada no meio.

## 2026-07-27 — Colapso das migrations numa 0000 única

Três migrations (0000, 0001, 0002) viraram uma só, já na forma final da rev 6. **Por quê:** produção nunca havia migrado (verificado: `drizzle.__drizzle_migrations` não existia), então o histórico de idas e vindas do desenvolvimento não tinha valor, e a 0002 tinha um `ADD COLUMN NOT NULL` sem default que abortaria em banco com linhas. **Alternativa descartada:** manter as três e usar `DEFAULT` + `DROP DEFAULT` na 0002. **Consequência:** essa janela fecha assim que produção rodar a primeira migration. Dali em diante, toda mudança é migration nova, nunca reescrita de migration passada.

## 2026-07-27 — Todo caminho de escrita de status passa por setReservationStatus

`setReservationStatus` faz `SELECT ... FOR UPDATE` na reserva antes de decidir. **Por quê:** o cron de expiração e o webhook de pagamento podem tocar a mesma reserva no mesmo instante (Pix caindo exatamente quando o hold vence). Sem a trava, os dois leem `pending_payment` e um sobrescreve o outro. **Consequência:** a garantia só existe enquanto ninguém escrever `UPDATE reservations SET status` fora da função. Um único desvio fura a proteção contra double-booking silenciosamente.

## 2026-07-27 — Sobreposição de período sempre em SQL, nunca em JavaScript

Toda comparação de intervalo usa o operador `&&` sobre `tstzrange`. **Por quê:** `tstzrange` usa limites `[)` — uma reserva que termina 11:45 não conflita com uma que começa 11:45. Reimplementar isso em JS abre espaço para um `<=` no lugar de `<`. **Se fosse diferente:** o motor divergiria da exclusion constraint, e o sintoma seria horários vendáveis sumindo da grade, ou o cliente escolhendo um slot que o POST recusa com 409.

## 2026-07-27 — O recheck da criação reutiliza getAvailability

`createReservation` chama `getAvailability` com o próprio `tx` em vez de ter lógica própria de disponibilidade. **Por quê:** duas implementações da mesma regra divergem com o tempo. **De brinde:** o recheck cobre lead time, blackouts, exceções de agenda e exclusividade de experiência sem duplicar nada.

## 2026-07-27 — Enums de pagamento são do domínio, não espelham o Asaas

`payment_state`, `payment_kind`, `payment_mode` e `reservation_payment_state` são vocabulário do Aventix. **Por quê:** três deles nem existem no Asaas (`kind`, `mode` e o agregado da reserva são conceitos nossos), e o Asaas distingue `RECEIVED` de `CONFIRMED` de um jeito que só importa no cartão. **Alternativa descartada:** copiar os status do Asaas. **Se fosse diferente:** a abstração `PaymentProvider` seria furada e o banco inteiro estaria "falando Asaas". A tradução mora num ponto único: `lib/payments/process.ts` (Fase 2).

## 2026-07-27 — schedule_exceptions cobre liberar e bloquear numa peça só

Uma tabela com booleano `closed` + CHECK, em vez de duas tabelas. **Por quê:** liberar feriado numa terça e bloquear recesso de fim de ano são a mesma operação — exceção à grade recorrente para uma data. **Se fosse diferente:** duas tabelas dobrariam o trabalho e criariam a chance de uma data estar liberada numa e bloqueada na outra. Distinta de `blackouts`, que é por recurso específico e intervalo de timestamp.

## 2026-07-27 — Exclusividade de experiência via advisory lock

`single_experience_per_slot` (configurável por tenant, ligado no Quadri Club) é garantido com `pg_advisory_xact_lock(tenant_id)` na criação. **Por quê:** a exclusion constraint enxerga conflito por recurso, não entre experiências diferentes — ela não consegue expressar essa regra. **Alternativa descartada:** uma segunda exclusion constraint. Não é expressável no modelo atual.

## 2026-07-27 — Acessores tipados para settings (booleano e numérico)

`getBooleanSetting` e `getNumberSetting` em vez de ler `settings.value` direto. **Por quê:** a coluna é `text`, então `"false"` é uma string — e em JS toda string não-vazia é verdadeira. Um `if (settings.single_experience_per_slot)` ligaria a exclusividade mesmo desligada, sem erro nenhum. O numérico protege do mesmo tipo de falha: `"60" + 30` é `"6030"`, e valor corrompido vira `NaN` silencioso.

## 2026-07-27 — Telefone normalizado é a chave de identificação do cliente

`normalizePhone` reduz a dígitos e remove `55` de país só quando o total é 12 ou 13. **Por quê:** `UNIQUE (tenant_id, phone)` só funciona se o mesmo número sempre virar a mesma string. **Detalhe que exigiu cuidado:** 55 também é DDD válido (Santa Maria/RS) — remover incondicionalmente quebraria esses números. A regra por comprimento é completa: nenhum número nacional brasileiro tem 12 ou 13 dígitos.

## 2026-07-27 — Cast ::int no SUM de pagamentos

`coalesce(sum(amount_cents), 0)::int`. **Por quê:** `SUM(integer)` retorna `bigint`, que o node-postgres entrega como string. Sem o cast, `"0" === 0` é falso e a classificação pularia `pending` para `partial`. **Se fosse diferente:** reserva sem nenhum pagamento apareceria como paga parcialmente, com o saldo exibido correto — número certo, rótulo mentindo.

## 2026-07-27 — Sinal limitado ao total, com piso de 1 centavo

Se `deposit >= total`, o sinal vira o total e não se cria linha de saldo. **Por quê:** `deposit_fixed_cents` maior que o preço geraria saldo zero ou negativo, e o `CHECK (amount_cents > 0)` derrubaria a venda por erro de configuração da experiência. O piso cobre o percentual que arredonda para zero.

## 2026-07-27 — Capacidade é a soma dos recursos alocados

Validação usa a soma real das `capacity` dos recursos alocados, não `capacity × resourcesNeeded`. **Por quê:** o schema permite capacidade diferente por recurso. Dá o mesmo resultado no caso uniforme do Quadri Club e continua correto se um dia houver um quadriciclo de capacidade diferente.

## 2026-07-27 — Datas saem de lib/ em ISO 8601

Toda função que devolve `timestamptz` para a API converte com `toISOString()`. **Por quê:** o schema usa `mode:'string'` e o driver devolve o texto cru do Postgres (espaço no lugar do `T`, offset sem minutos, microssegundos). O V8 tolera, outros motores devolvem `NaN`. **Se fosse diferente:** o contador de 15 minutos da tela de pagamento quebraria em alguns navegadores e funcionaria no seu.

## 2026-07-27 — server-only em lib/tenant.ts

Instalado o pacote `server-only` em vez de guarda em runtime. **Por quê:** o pacote falha no build, a guarda falhava só no carregamento. **Consequência conhecida:** qualquer processo Node puro que importe `lib/tenant.ts` (ou `lib/reservations.ts`, que o importa) quebra no import. Afeta o cron e o job de reconciliação se rodarem fora do Next — precisa de `node --conditions=react-server` ou mover `getTenantId()` para módulo sem a marca.

## 2026-07-27 — Deploy via Easypanel, não docker-compose manual

A VPS roda Easypanel, que gerencia Traefik, domínio e SSL. O `docker-compose.yml` de produção não existe; o `docker-compose.dev.yml` serve só para o Postgres local. **Descoberta operacional:** o Easypanel injeta sua própria variável `PORT` em runtime, sobrescrevendo o Dockerfile — as rotas de domínio devem apontar para a porta do log de boot, não para a do Dockerfile. Isso custou uma sessão de debug.

## 2026-07-27 — Split de pagamento fica fora do MVP

Repasse automático ao Aventurando via `walletId` do Asaas vai para a v2. **Por quê:** depende de o parceiro ter conta Asaas e fornecer o walletId — dependência externa que pode travar o go-live. O modelo atual (venda pelo parceiro com `?canal=aventurando`, comissão acertada por fora) já resolve o caso comercial. **Reabrir se:** o Aventurando exigir repasse automático como condição para vender.

## 2026-07-27 — Conversão de timezone em JS com date-fns-tz, não no Postgres

`lib/time.ts` usa `date-fns-tz` (base IANA) para converter America/Sao_Paulo ↔ UTC. **Alternativa descartada:** fazer tudo no Postgres com `AT TIME ZONE`, que seria zero dependência e usaria a mesma tzdata do banco. **Por quê assim:** a geração de candidatos da grade é aritmética de calendário e fica mais legível em JS; o SQL guarda o que é dele, que é sobreposição. **Consequência:** duas bases de tzdata no sistema (Node e Postgres). Os instantes trafegam como `timestamptz`, então uma divergência de regra de DST entre elas só apareceria numa data futura já convertida. **Reabrir se:** aparecer tenant fora de SP ou o Brasil voltar a ter horário de verão. `lib/time.ts` é o único arquivo a trocar.

## 2026-07-27 — A query de disponibilidade devolve índice, não timestamp

A query dos passos 2/2b usa `unnest(...) WITH ORDINALITY` e retorna a posição do candidato; o JS mapeia de volta para o `Date` que ele mesmo calculou. **Por quê:** o Drizzle sobrescreve o parser de `timestamptz` do node-postgres e entrega texto cru em `db.execute`. Reparsear esse texto para `Date` introduziria uma chance de divergir do instante original, e uma divergência de fuso é silenciosa. **Consequência:** o SQL decide quais candidatos passam, nunca o valor deles.

## 2026-07-27 — xmax = 0 distingue insert de update no upsert de cliente

`findOrCreateCustomer` devolve `created` lendo `(xmax = 0)` no mesmo `RETURNING`. **Alternativa descartada:** `SELECT` prévio dentro da transação. **Por quê:** o `SELECT` custa uma query a mais e abre janela entre leitura e escrita. Validado sob concorrência real: duas chamadas simultâneas com o mesmo telefone retornaram o mesmo id, uma com `created=true` e outra com `false`. **Limitação conhecida:** se a mesma transação chamar a função duas vezes para o mesmo telefone, a segunda reporta `created=false`, correto para a linha mas não para a transação.

## 2026-07-27 — Faturas do cliente vêm do banco local, não do Asaas ao vivo

A tela de cliente no admin mostra status de pagamento do banco local (mantido pelo webhook) e um link para a fatura no Asaas (`invoiceUrl` persistido na criação). **Por quê:** o webhook já mantém o status sincronizado; buscar ao vivo seria redundante e acoplaria a tela admin à disponibilidade do Asaas.

## 2026-08-18 — Migrations aplicadas no boot pelo `instrumentation.ts`

Três caminhos foram investigados para aplicar migrations no VPS, cujo Postgres não tem porta pública. Escolhido o **caminho 1: `instrumentation.ts` chama `migrate()` no boot**, com `COPY --from=builder /app/drizzle ./drizzle` no estágio runner do Dockerfile. **Alternativas descartadas: (2)** container efêmero na rede interna do Easypanel rodando `db:migrate` sem expor porta — funciona, mas exige passo manual a cada deploy com migration nova; **(3)** runner SQL cru sobre `pg` lendo os `.sql` + `_journal.json` — usa só o que já existe na imagem, mas exige replicar à mão a escrituração de `drizzle.__drizzle_migrations` (inclusive a coluna de hash) e vira dívida contra o próprio drizzle. **Por que o caminho 1 é viável apesar do standalone do Next descartar `drizzle-orm`:** `drizzle-orm/node-postgres/migrator` é código do app, então o Next o **bundla nos chunks** do servidor (medido: `node_modules/drizzle-orm` não existe na imagem final, e o migrator ainda assim roda). A única coisa que falta ao standalone são os `.sql` do disco, que a linha do Dockerfile passa a carregar. **Consequência assumida:** o boot em produção passou a depender de `DATABASE_URL` estar acessível no arranque, não só em runtime de request — antes só a primeira consulta descobriria o erro.

## 2026-08-18 — Falha de migration DERRUBA o processo, ao contrário dos outros fail-fast

`auth` e `Asaas` mal-configurados **avisam e seguem** (o site público de reservas não depende dos dois; tirar a venda do ar por causa de variável do painel seria pior). **Migration falhada, ao contrário, chama `process.exit(1)`.** **Por quê:** servir com schema incerto corrompe dado — uma reserva gravada num schema inconsistente é irrecuperável, enquanto um admin off por 10 minutos é reversível. O container não subir é o comportamento **desejado**: o deploy falha visivelmente e o Easypanel marca vermelho, em vez de aceitar venda sobre schema errado. Uso `process.exit(1)` e não `throw` para garantir a morte mesmo se algum caller futuro engolir a exceção de `register()`. Roda ANTES dos fail-fast e dos crons: se o schema não está garantido, validar env ou agendar timer não tem sentido.

## 2026-08-18 — Guarda de migration é promise memoizada, não boolean

O cron usa flag booleana no `globalThis` porque o `cron.schedule` é síncrono (marca e volta). Migration é **assíncrona**, então dois `register()` concorrentes passariam os dois pela checagem de um boolean antes de qualquer um marcar, disparando dois `migrate()` em paralelo. Medido no fonte do drizzle 0.45.2: **o migrator do pg não usa advisory lock** — abre transação, cria `drizzle.__drizzle_migrations`, aplica pendentes. Sem serialização externa, uma corrida rodaria o `CREATE SCHEMA IF NOT EXISTS` de uma ao mesmo tempo que a outra escreve a mesma linha, com efeito indeterminado. **Solução:** memoizar a **promise** — o segundo caller aguarda a mesma execução em vez de disparar outra. A checagem e a atribuição são síncronas (`if (!p) p = f()`), então não há janela de corrida no mesmo processo.

## 2026-08-18 — `tsx` vira `dependency`, não `devDependency`

O `db:seed` do Aventix é operação real de produção — dentro do container do Easypanel, popula o tenant do Quadri Club a partir do template de segmento. `tsx` como devDependency é descartado no runtime do standalone do Next (o `node_modules` da imagem final só tem o que é dependência de runtime), e o script quebra com "tsx: not found" mesmo com o `package.json` intacto. **Alternativa descartada:** pré-compilar `scripts/seed.ts` para JS puro no build. Descartada porque `seed.ts` importa de `/lib` e do template, arrastando a cadeia inteira para dentro do pipeline de build só para servir a um caminho de operação. **Trade-off assumido:** a imagem final cresce (`tsx` + dependências) para acomodar um binário que só roda em terminal manual — mas isso é o preço de tratar seed como operação de produção. Se apertar por tamanho no futuro, o caminho de saída é compilar os scripts de operação para JS no build, sem mexer no `tsx` do dev.

## 2026-08-24 — A lista de agendamentos linka o detalhe abrindo o painel por `?reserva=`, não uma página própria

A tela `/admin/agendamentos` precisa apontar cada reserva para o detalhe, mas **não existia endereço linkável para uma reserva**: o detalhe é um painel sobreposto no calendário, aberto por estado de cliente no clique, sem URL. Três caminhos foram postos na mesa. **Escolhido: abrir o painel existente por `/admin?...&reserva={id}`**, aditivo ao clique. **Alternativas descartadas: (1)** linkar só para o dia no calendário (`?view=day&date=`) e deixar o dono achar o bloco — mais simples e sem tocar o calendário, mas reserva cancelada/expirada não aparece na grade, então o link cairia num dia sem o bloco dela; **(2)** construir a página `/admin/reservas/[id]` que a seção 14 prevê "para link direto" — é o link mais limpo e cobre todos os status, mas é uma tela nova inteira, fora do escopo de uma tarefa definida como "a lista". **Por que a (opção escolhida) apesar de tocar `calendar.tsx`:** o painel já abre para os quatro status (inclusive cancelada/expirada), então reaproveitá-lo cobre o caso que a (1) perde, a um custo bem menor que a (2). **Requisitos que blindam o parâmetro como aditivo:** ausente renderiza a agenda idêntica ao de antes, sem tocar o banco; malformado/inexistente/de outro tenant é resolvido no **servidor** (`resolveOpenReservationId`) e não abre painel nem erro; fechar limpa o `reserva=` da URL para o refresh não reabrir. **Reabrir se:** a seção 14 for cumprida e `/admin/reservas/[id]` passar a existir — aí o link natural da lista é a página, e o `?reserva=` vira atalho redundante (ou é aposentado).

## 2026-08-28 — Percentual em basis points inteiro, não `numeric` nem float

Todo percentual do sistema (desconto do Pix, taxa da maquininha) é gravado como **basis point inteiro**: 7% = `700`, 1 bp = 0,01%. **Por quê:** o sistema inteiro guarda dinheiro como inteiro em centavos (seção 3), e percentual em ponto flutuante fura essa regra pela porta dos fundos. **Alternativa descartada: `numeric(5,2)`.** Ela é exata no banco, e por isso parecia a escolha óbvia — mas o node-postgres entrega `numeric` como **string**, para não perder precisão, e a partir daí cada consumidor decide sozinho como transformar aquilo em conta. O primeiro que escrevesse `Number(taxa) * cents / 100` reintroduziria exatamente o ponto flutuante binário que `lib/payments/money.ts` existe para impedir. **O que aconteceria se fosse diferente:** o erro não apareceria no número, apareceria na serialização — um centavo de diferença entre o que o banco diz que a reserva custa e o que o cliente foi cobrado, notado só na conciliação, depois do dinheiro ter entrado. É a mesma falha que motivou o `money.ts` a recusar `cents / 100`. **Custo assumido:** um `SELECT` cru mostra `700`, que dá para ler como 700%; a defesa é o nome da coluna (`discount_basis_points`), o CHECK de faixa e a tela, que sempre exibe percentual. **Granularidade:** 1 bp cobre taxa de adquirente do tipo 3,49%; adquirente que cotasse quatro casas decimais exigiria migration. **Reabrir se:** aparecer contrato com percentual de mais de duas casas.

## 2026-08-28 — Duas tabelas de configuração financeira, não uma

`payment_method_discounts` e `card_machine_rates` separadas, em vez de uma tabela genérica de percentuais por chave. **Por quê:** parecem a mesma forma ("percentual por chave, por tenant") e não são a mesma coisa. Desconto é **política de preço**, decidida pelo dono e aplicada na venda, visível ao cliente. Taxa é **fato do contrato** com a adquirente, aplicada no registro e congelada ali (seção 4-B.7), invisível ao cliente. Elas também chaveiam domínios diferentes: `payment_method` (`pix`, `card`, enum que já existia) contra uma modalidade nova (`debit`, `credit`, `credit_installment`). **Alternativa descartada:** tabela única com chave `text` polimórfica — perderia a garantia do enum — ou com colunas nuláveis e CHECK XOR, no estilo de `experiences_deposit_mode_check`. **O argumento decisivo:** a tabela de taxas vai precisar crescer (validade ou versão, porque taxa muda com o tempo enquanto o registro congela), e uma tabela compartilhada forçaria colunas nuláveis também no lado do desconto, que nunca vai precisar delas.

## 2026-08-28 — Ausência significa coisas diferentes nas duas tabelas, e por isso as APIs têm formas diferentes

**Desconto ausente vale 0%** (cliente paga o cheio); **taxa ausente vale `NULL`, jamais 0%**. **Por quê:** são as duas direções possíveis de errar, e elas não custam a mesma coisa. Configuração de desconto faltando faz o cliente pagar o valor cheio — a falha que não dá abatimento que ninguém autorizou. Taxa faltando, se virasse zero, produziria **líquido igual ao bruto**: número com aparência de certo, que só seria desmentido na conferência com o extrato, semanas depois. Por isso `getCardMachineRate` retorna `number | null`, para o compilador obrigar a decisão no ponto de uso, e **a Fase D deve recusar o registro** de recebimento cuja modalidade não tenha taxa. **Consequência de desenho:** desconto é **upsert por método** (sem create nem delete — "sem linha" e "0 bp" dizem o mesmo, e um 409 de "método já cadastrado" seria obstáculo sobre o que o dono entende como "mudar o desconto do Pix"); taxa é **POST/PUT/DELETE com 409 de duplicata**, seguindo o precedente de `data_ocupada` nas exceções de agenda. **Alternativa descartada:** upsert nas duas, por simetria. Descartada porque um upsert silencioso sobrescreveria um percentual de dinheiro já conferido com a adquirente sem o dono perceber.

## 2026-08-28 — O seed do desconto é insert-only, e é isso que cumpre a promessa da seção 4-B.6

`SEED_PIX_DISCOUNT_BASIS_POINTS = 700` é inserido por `seedTenant()` **apenas quando a linha não existe**, sem `else` que atualize. **Por quê:** tirar a configuração financeira de `settings` só resolve metade do problema — se o seed reconciliasse a tabela nova como reconcilia `settings`, o valor do dono voltaria ao do código no próximo seed, que é exatamente a falha que a seção 4-B.6 existe para evitar. **Precedente seguido:** a linha de `tenants`, cujo slug o seed insere e nunca corrige, pelo mesmo motivo (é endereço, não rótulo). **Onde mora:** `lib/seed.ts`, junto de `SEED_TENANT_ID` e `SEED_TENANT_SLUG`, e **não** no template — 7% é decisão comercial *deste tenant*, não fato do *segmento*; o próximo cliente de passeio de quadriciclo recebe o mesmo template e negocia o próprio desconto. **Provado em** `tests/s-config-financeira.test.ts`, caso S5.2: o desconto alterado para 5% sobrevive a `seedTenant()` rodado duas vezes. **`card_machine_rates` não é semeada de forma nenhuma:** os percentuais reais não chegaram, e taxa chutada vira número errado com aparência de certo.

## 2026-08-28 — O seed nunca roda em produção: migration aplicada não é dado semeado

Registrado como decisão porque **muda o procedimento de deploy**, não só o entendimento. O `instrumentation.ts` aplica **apenas migrations** (decisão de 18/08); semear é `scripts/seed.ts`, e o build standalone do Next **descarta `scripts/` da imagem**. Não existe caminho automático que aplique o template em produção. **Como isso se esconde:** configuração nova entra no template, funciona local, passa nos testes, sobe no deploy e não chega ao banco — sem erro e sem log, porque o código trata chave ausente **omitindo o bloco**, que é o comportamento correto. A defesa que impede a tela de quebrar é a mesma coisa que torna a falha silenciosa. **Custo medido:** `meeting_point_map_url` nunca foi semeada; o mapa subiu em 24/08 e **nunca apareceu em produção**, por quatro dias, descoberto por acaso em 28/08. **Regra que fica:** todo deploy que introduza setting ou tabela de configuração exige conferência por `SELECT` no banco de produção, na mesma janela do deploy. **Caminho definitivo:** a rota `POST /api/admin/seed`, protegida por sessão, chamando `seedTenant()` de dentro do Next — ela faz o seed viajar na imagem em vez de depender de alguém lembrar. Enquanto não existir, a conferência manual é a única rede.

## 2026-08-28 — Preços cheios confirmados, encerrando a hipótese aritmética

Trilha da Montanha **R$ 349,99** e Trilha da Fazenda **R$ 249,99**, ambos cheios; com o Pix a −7%, R$ 325,49 e R$ 232,49. **Por que estava em aberto:** a rev 7 registrou a Fazenda como "a confirmar", com um indício puramente aritmético — o cliente citou 232,49, e 249,99 − 7% dá 232,49 exatos, enquanto 249,00 daria 231,57. A confirmação bateu com o indício. **O que isso destrava:** a Fase A pode trocar os valores do template com os dois preços conhecidos, em vez de trocar um e adivinhar o outro. **O que continua sendo trabalho da Fase A:** hoje `experiences.price_cents` guarda o preço **já com desconto** (32549 e 23249), o inverso do que a seção 4-B manda, e o comentário do template proíbe textualmente a troca. Trocar os valores exige mudar o comentário junto e decidir o que acontece com o preço em produção no próximo seed, já que o seed **reconcilia preço** por nome.

## 2026-08-28 — O desconto incide sobre o TOTAL, e o wizard chama a mesma função do servidor

Na Fase A, `applyDiscount` é aplicada sobre `preço × recursos`, nunca sobre o preço unitário; e o catálogo público devolve o **valor cheio mais o percentual**, não um preço já descontado, para que a tela derive o que exibe pela mesma função. **Por quê:** as duas contas divergem em alguns preços. Com preço 33333 e 7%, unitário descontado vezes 2 dá 62000 e desconto sobre o total dá 61999. **O que aconteceria se fosse diferente:** com 34999 e 24999 os dois caminhos coincidem por acaso, então o erro nasceria mudo e só apareceria no dia em que o dono cadastrasse uma terceira trilha, como um centavo de diferença entre o que o wizard mostra e o que a cobrança traz. Ninguém liga uma coisa à outra; o cliente só vê que o valor "mudou" na hora de pagar. **Alternativa descartada:** a API mandar o preço unitário já descontado, que era mais simples e teria funcionado para o catálogo atual. **Consequência de desenho:** `PublicExperience.priceCents` mantém o significado da coluna homônima; campo com nome igual e sentido diferente é a classe de bug que este projeto mais paga. É também a confirmação de que deixar `lib/basis-points.ts` sem `server-only` na Fase 0 estava certo: ele nasceu para ser chamado dos dois lados. Fixado em `tests/t-preco-por-metodo.test.ts` (T2.4), com um fixture de preço 33333 que separa os dois caminhos.

## 2026-08-28 — Congelar o desconto aplicado em `reservations`, e não em `reservation_payments`

A migration 0007 acrescenta `full_price_cents` e `discount_basis_points` a `reservations`, ambas nuláveis e **sem backfill**. **Por quê:** sem elas, uma reserva de setembro com total 32549 não bate com o preço cheio (34999) nem com o preço-Pix de depois que o dono mudar o percentual, e ninguém consegue reconstruir de onde saiu o número. Com as duas, a linha se explica sozinha: `full - round(full * bp / 10000) = total`. **Por que em `reservations` e não na linha do pagamento**, apesar de a seção 4-B.7 falar em congelar no pagamento: lá o assunto é líquido recebido (bruto, modalidade, taxa da adquirente), que é o caso da maquininha na Fase D. Isto é o preço vendido, atributo da venda. **O argumento decisivo é a Fase B:** no modo `deposit` a mesma venda tem duas linhas de pagamento, e guardar o percentual em cada uma cria a possibilidade de discordarem sobre um número que é um só por definição. **Sem backfill de propósito:** o desconto vigente no passado não foi registrado em lugar nenhum, e inventar 700 para reservas antigas seria fabricar um fato.

## 2026-08-28 — Sinal de 50% com escrita travada e leitura livre

O CRUD de experiências aceita `deposit`, mas **não expõe o percentual**: grava `deposit_percent = 50` fixo (`DEPOSIT_PERCENT` em `lib/experiences.ts`), e o dono só responde "aceita sinal? sim/não". O cálculo em `createReservation` continua **lendo da coluna**. **Por quê:** a seção 4-B.2 fixou o sinal em 50% para o produto, enquanto as colunas são por experiência — a divergência que a rev 7 mandou a Fase B resolver. Separar escrita de leitura dá três coisas de uma vez: o `CHECK experiences_deposit_mode_check` satisfeito sem migration, uma fonte única para o cálculo, e uma linha gravada com outro percentual (por migration ou seed antigo) continuaria honrada em vez de silenciosamente recalculada. **Alternativas descartadas:** apagar as colunas (migration com perda de histórico e sem ganho) e expor o campo na tela (convidaria a mexer numa regra fechada, e cada experiência com percentual próprio é uma conta a mais para conferir com o extrato). **Reabrir se:** o percentual voltar a ser decisão por experiência; o ponto único a mudar é `DEPOSIT_PERCENT`.

## 2026-08-28 — O rótulo do bloco da agenda sai de `status` + `payment_state`

`STATUS_LABEL` mapeava `confirmed: 'Pago'`. Com o sinal vendável isso virou **afirmação falsa**, não omissão: reserva com metade paga é `confirmed`, e o bloco diria "Pago", em verde, na tela em que o guia bate o olho antes do passeio sem abrir reserva nenhuma. **Por isso a correção foi no rótulo do bloco, e não num campo a mais do painel de detalhe** — o painel ninguém abre em massa. O estado de exibição passou a ter três valores (`displayState`), com cor própria para saldo em aberto e o **valor em reais** no rótulo, porque é o número que o guia cobra. A derivação é **fail-safe**: o que não está `settled` conta como devendo. **Por quê assim:** as duas falhas não custam o mesmo — marcar como saldo uma reserva quitada é dez segundos de incômodo, marcar como "Pago" uma que deve é o passeio saindo sem cobrar. **Nota de processo:** o bug estava latente desde a Fase 2 (o próprio arquivo previa o marcador e dizia que entraria com ela) e só não acontecia porque `deposit` estava travado com 422. A Fase B destrava exatamente a condição que o alcança, então a agenda foi corrigida **antes** do destravamento, para nunca existir um instante em que `partial` fosse alcançável e a tela mentisse.

## 2026-08-28 — "Quem me deve" é filtro próprio em /admin/agendamentos, não um valor de status

A lista ganhou um checkbox "só quem tem saldo em aberto", separado do select de status. **Por quê:** "quem me deve" não é um `reservation_status` — é a combinação de `confirmed` com `partial`. Enfiá-lo na mesma lista misturaria duas dimensões num controle só e tornaria impossível pedir "confirmadas E com saldo", que é a pergunta da véspera do passeio. **Definição fixada:** saldo em aberto é `amount_paid_cents > 0 AND < total`, com status ativo. O `> 0` é parte da definição, não detalhe: reserva onde ninguém pagou nada não tem saldo, tem o preço inteiro em aberto, e já se anuncia como "Aguardando pagamento". **O `WHERE` e a condição do selo na tela precisam concordar exatamente** — divergiram na primeira versão desta sessão, e o efeito seria o filtro devolver linha sem selo, com o dono concluindo que a lista está quebrada.

## 2026-08-28 — O texto oficial do cliente vive em `settings.meeting_point`, e o título do bloco mudou

O texto publicado pelo Quadri Club (6 parágrafos: check-in, documento e idade mínima, regras, acidentes, remarcação) entrou em `settings.meeting_point` pelo template, substituindo o placeholder. O título da seção passou de "Ponto de encontro" para **"Informações importantes"** nas duas telas que a renderizam. **Por quê o título:** o bloco deixou de ser endereço, e o título antigo mentiria sobre o próprio conteúdo. O mapa continua logo abaixo, como ilustração dentro das informações. **Por que no template e não por `UPDATE` manual:** regra das duas casas (seção 19) — valor só no banco some no próximo seed. **`what_to_bring` fica vazio, não removido:** o texto já cobre o assunto, e duas redações do mesmo tema divergem na primeira atualização; a chave permanece no tipo e no template porque outro tenant do segmento pode usá-la. **Correção de premissa registrada junto:** a documentação vinha afirmando que este texto estava publicado desde 24/08. Não estava. O que subiu naquele dia foi o componente que renderiza texto longo com quebras preservadas; o conteúdo só entrou em 28/08.

## 2026-08-31 — A idempotência da cobrança de saldo tem três camadas, e a terceira é a que justifica a existência das outras duas

A Fase C foi definida por uma exigência só: apertar "Cobrar saldo" duas vezes não pode gerar duas cobranças. A solução tem **três camadas**, e a decisão registrada aqui é que **nenhuma delas substitui as outras**. **(1) Caminho rápido local:** a linha já tem `asaas_payment_id` e a cobrança existe, então só relê o QR. **(2) Trava de serialização:** `pg_try_advisory_xact_lock` chaveada na linha do pagamento, cobrindo os dois toques simultâneos que leem o id nulo antes de qualquer um gravar. **(3) Pergunta ao provedor pela `external_reference` antes de criar.** **Por que a terceira, se as duas primeiras já parecem resolver:** elas só existem dentro do nosso processo e do nosso banco. Nenhuma alcança o buraco em que o processo **morre** (deploy do Easypanel, container reiniciado, conexão caída) **depois** de o Asaas criar a cobrança e **antes** de gravarmos o id. Nesse estado a linha tem id nulo, a cobrança existe lá, e as camadas 1 e 2 concordam que "não há cobrança" — as duas erradas ao mesmo tempo, sem conflito entre si. Perguntar ao provedor pela referência externa, que é única e determinística (seção 4.6), é a única pergunta que atravessa a morte do processo. **É a duplicata mais perigosa das três** porque nasce de um deploy e não de um clique: ninguém a associa a uma ação, e ela aparece como o cliente tendo recebido dois QR. **Alternativas descartadas: (a)** confiar só no unique index de `asaas_payment_id` — não ajuda, porque duas criações produzem ids **diferentes** e os dois UPDATE passam; **(b)** chave de idempotência do provedor — o Asaas não oferece uma no fluxo de cobrança Pix; **(c)** claim por coluna nova ("criando desde") — exigiria migration e reintroduziria o problema de claim órfão depois de um crash, que é justamente o caso que se quer cobrir. **A camada 3 é FAIL-CLOSED:** se a pergunta não pode ser feita (rede, credencial), **não se cria**. Das duas falhas possíveis, "o dono tenta de novo em dez segundos" custa muito menos que "o cliente recebe dois QR e paga os dois", e estorno de Pix é manual, com taxa que não volta (seção 8-C). **Verificado no mundo real:** recriada a reserva com id nulo e a cobrança ainda viva no sandbox, o POST devolveu `origin=adopted`. **Reabrir se:** o Asaas passar a oferecer chave de idempotência no POST de cobrança — aí a camada 3 vira barata e a 2 pode ser reavaliada.

## 2026-08-31 — A trava vale para a RELEITURA do QR também, e o motivo é uma mensagem falsa, não uma duplicata

MEDIDO contra o sandbox: dois toques que caem **os dois** no caminho rápido (a cobrança já existe) disparam duas consultas concorrentes ao mesmo QR, e o Asaas responde `400 "Um erro desconhecido foi encontrado"` numa delas. **Nenhuma cobrança é duplicada** — o caminho rápido não cria nada. O estrago é inteiramente na **mensagem**: aquele 400 subia como `PaymentProviderApiError` e a rota o traduzia em **"o provedor recusou a cobrança"**, que é falso em dois pontos ao mesmo tempo — nada foi recusado, e a cobrança está lá, válida. E essa frase chega ao dono **em campo, com o cliente na frente**, que é exatamente o cenário em que ele reage refazendo uma cobrança que já existe. **Duas mudanças:** a trava passou a valer para o caminho rápido (invariante: **uma operação de saldo em voo por reserva, sempre**, criando ou relendo), e a falha de releitura ganhou tipo próprio, `BalanceQrUnavailableError` → `502 qr_indisponivel`, que diz que a cobrança **existe**, que nada foi duplicado, e devolve a `invoiceUrl` como saída imediata. **Alternativa descartada:** deixar como estava e só corrigir o texto do erro. Descartada porque o texto certo dependeria de adivinhar, no `catch`, se o 400 veio de criar ou de reler — informação que existe no ponto da chamada e se perde no caminho até a rota. **Por que registrar:** a mudança de desenho não veio de raciocínio, veio de rodar contra o provedor de verdade. Nenhum teste com provedor mockado teria produzido esse 400, porque ele é comportamento **do Asaas sob concorrência**, não do nosso código.

## 2026-08-31 — O teste de corrida foi verificado POR MUTAÇÃO, e é a única forma de um teste desses provar alguma coisa

O caso V1.2 (dois toques simultâneos criam uma cobrança só) passou na primeira execução. **Um teste de concorrência que passa de primeira não é evidência de nada**: ele passa igual quando a corrida não acontece, quando as duas chamadas se sucederam em vez de se sobrepor, ou quando a asserção não alcança a propriedade. Então a trava foi **removida de propósito** (o `pg_try_advisory_xact_lock` trocado por `SELECT true`) e o teste rodado de novo: falhou com `expected [...] to have a length of 1 but got 2`. Só depois disso a trava voltou. **A regra que fica: todo teste de corrida deste projeto precisa ser visto FALHANDO com a proteção desligada, antes de ser aceito como verde.** Sem esse passo, o que se tem é um teste que afirma a propriedade e um sistema que talvez não a tenha, e os dois combinam perfeitamente. **Vale também para o V1.2b** (o duplo toque na releitura), que usa o mesmo esquema de barreira. **Alternativa descartada:** confiar na barreira (`makeBarrier`) como prova de que houve sobreposição. Ela aproxima a largada, não garante o encontro — e é exatamente sobre o que não se pode assumir que a mutação responde.

## 2026-08-31 — `GET .../balance` e `POST .../balance/charge` são rotas separadas

A seção 7.2 descrevia **uma** rota, que devolveria o saldo "e, sob demanda, o QR Code Pix atual". A Fase C a partiu em duas: um `GET` que só lê e um `POST` que cria. **Por quê:** criar cobrança dentro de um GET põe uma operação de **dinheiro** atrás do verbo que o prefetch do Next, um retry de rede e o refresh do dono consideram seguro repetir. O "sob demanda" continua honrado — a demanda é o dono apertar o botão, não a tela abrir; o painel chama o GET a cada abertura de reserva com saldo. **Por que `/balance/charge` e não `/balance` com verbo diferente:** endereços distintos deixam óbvio, na aba de rede e no log, qual chamada foi leitura e qual foi cobrança. **Consequência de desenho:** o `chargeId` do provedor não sai no corpo de nenhuma das duas (mesma regra da rota pública de pagamento), e o GET devolve `hasCharge`, que é o que a tela precisa. **Alternativa descartada:** manter a rota única da especificação, por fidelidade ao texto. Descartada porque o texto foi escrito antes de a idempotência ser requisito, e a fidelidade custaria a propriedade que define a fase.

## 2026-08-31 — `deposit_policy_text` existe, tem texto, e nenhum componente a renderiza

Levantamento feito ao inventariar o Termo v1 para o Termo v2. A chave **existe** no tipo (`lib/tenant.ts`), **existe** no template e **tem valor gravado**, marcado `PROVISORIO — confirmar com o cliente` — redação que o cliente nunca aprovou. E **`grep` não a encontra em nenhum lugar de `app/`**: nada a renderiza. **Por que isto merece decisão registrada e não é só uma pendência:** a seção 10 vinha sendo lida como "falta o texto da política do sinal no termo", e isso está errado — **falta o código**. A gaveta cheia com texto não aprovado é justamente o que faz a lacuna parecer meio resolvida: quem for fazer o Termo v2 encontra uma setting preenchida e conclui que só precisa trocar a string. Precisa escrever a renderização condicional (`payment_mode='deposit'` → mostra a política), que não existe. **O inventário do v1, que dimensiona a mudança:** o termo atual fala de pagamento **uma vez**, e não é sobre a reserva — a §3 diz que o passeio pode ser interrompido "sem direito a reembolso" por má conduta (única ocorrência de "reembolso" no texto inteiro) e a §4 trata de danos ao equipamento. Sinal, não reembolso em cancelamento, no-show, saldo no dia e remarcação **não aparecem**. Logo o v2 é **adição de um bloco novo**, não revisão: nada no v1 contradiz a política da seção 4-C, e não há redação existente para renegociar com o cliente. **O que continua em aberto e é do cliente:** a redação aprovada, e a contradição entre documentos — o texto oficial em `settings.meeting_point` (tela de confirmação, **depois** de pagar) promete remarcação em 48h sem dizer como, enquanto o termo (**antes** de pagar) dirá que não há devolução.

## 2026-08-31 — As telas do admin foram vistas em navegador autenticado pela primeira vez

Dívida de verificação que o `ESTADO-ATUAL` arrastava desde 22/08: `/admin/*` está atrás do login, só existe o hash da senha, e por isso tudo que aquelas telas afirmavam estava provado por teste e por build, **nunca por olho**. Fechada nesta sessão gerando um cookie de sessão selado com `iron-session` a partir do `SESSION_SECRET` do `.env` **local** (script temporário, apagado depois), injetando-o no navegador e abrindo `/admin` contra o banco de desenvolvimento com uma reserva-fixture `confirmed` + `partial`. **O que só apareceu por causa disso:** o botão "Cobrar saldo (R$ 162,74)" renderizando com o valor certo, o QR real vindo do sandbox, e — não previsto — o **rótulo "SALDO R$ 162,74" no bloco da agenda**, que é a correção mais importante da Fase B e até aqui nunca tinha sido olhada. **Por que registrar o método:** a alternativa era pôr um hash de senha conhecido no `.env`, o que mexe em arquivo do dono e deixa rastro; selar o cookie usa o segredo que já está lá e não altera nada. **Consequência:** o teste concorrente foi rodado contra o Asaas **sandbox** de verdade (`ASAAS_BASE_URL` conferido antes), e é dali que veio o achado do 400. Ficou uma cobrança de teste no sandbox (`3aa77hmzw2yshk6r`). **A dívida NÃO está integralmente fechada:** as demais telas de admin (experiências, horários, bloqueios, exceções, financeiro, clientes) continuam sem verificação em navegador.

## 2026-08-31 — REVERSÃO da decisão de 28/08: taxa ausente REGISTRA com líquido nulo, em vez de recusar

A decisão de 28/08 ("Ausência significa coisas diferentes nas duas tabelas") mandava a Fase D **recusar** o registro de recebimento cuja modalidade não tivesse taxa cadastrada. **Revertido: o registro passa e grava `net_cents = NULL`.** Três razões, em ordem de força. **(1) A regra mais antiga é mais forte.** "Nunca deixe o saldo fora do sistema" existe desde a seção 1 e é estrutural; a recusa foi decisão de detalhe tomada quatro dias antes, sem considerar o conflito. Recusar **não impede o dinheiro de ter sido recebido** — o cliente já passou o cartão. Impede só o sistema de saber, e ainda deixa a reserva anunciando saldo em aberto de algo que foi pago, que é a "pendência invisível" que a seção 1 proíbe em voz alta. **(2) Recuperabilidade é assimétrica.** Permitir guarda bruto, modalidade e data, e o líquido se reconstitui depois com o extrato do dono. Recusar não guarda nada além da memória de quem estava lá. Uma falha recuperável com informação externa e uma irrecuperável não são equivalentes, e a decisão de 28/08 as tratou como se fossem. **(3) A regra se autossabotava.** O guia bloqueado em campo tem um caminho óbvio para se desbloquear: abrir `/admin/financeiro` e digitar um percentual chutado — o login é único (seção 13), ele tem acesso. Ou seja, a regra escrita para impedir que "taxa chutada vire número errado com aparência de certo" **produzia exatamente esse incentivo**. **O que NÃO mudou, e continua sendo o núcleo da decisão de 28/08:** `NULL` é "não sei" e `0` é "não teve taxa"; gravar zero aqui seria a mentira que faz o líquido parecer igual ao bruto. `getCardMachineRate` continua devolvendo `number | null` e o ponto de uso continua obrigado a decidir — só que agora a decisão é "registra sem líquido", não "recusa". **Condição obrigatória que acompanha a reversão:** `/admin/financeiro` exibe a contagem de registros sem líquido (`countReceiptsAwaitingNet`, com recorte por `card_machine_modality IS NOT NULL` para não confundir pagamento antigo com pendência). Sem ela, ter-se-ia trocado uma falha **visível** (o registro recusado na hora, na frente do dono) por uma **invisível** (o líquido que nunca chega) — o padrão que já mordeu este projeto três vezes. **Alternativa descartada:** manter a recusa e tornar a mensagem de erro acionável, com link para `/admin/financeiro`. Descartada porque é justamente o caminho que leva ao chute do item 3. **Preenchimento posterior é operação DELIBERADA**, com o percentual histórico; jamais recálculo automático, que a 4-B.7 proíbe. **Reabrir se:** aparecer uma fonte confiável da taxa histórica (extrato importado, API da adquirente) que permita preencher sem fabricar.

## 2026-08-31 — `amount_cents` da linha de saldo passa a valer o BRUTO RECEBIDO

O registro da maquininha aceita valor **editável** (o guia pode ter recebido diferente do saldo em aberto). `recalcReservationPayment` soma `amount_cents` das linhas `paid`, então a escolha decide o que a reserva afirma. **Decidido: o registro sobrescreve `amount_cents` com o bruto recebido.** **Por quê:** a linha, uma vez paga, significa "dinheiro que entrou", e é isso que o recalc soma. Mantendo o valor devido, um recebimento de R$ 100 sobre um saldo de R$ 162,74 levaria a reserva a `settled` — **afirmando ter recebido o que não recebeu**, que é o sistema mentindo sobre dinheiro. Com a sobrescrita, a reserva fica `partial`, o saldo restante continua visível no bloco da agenda (seção 11.1) e a leitura é honesta. **Alternativa descartada:** coluna adicional preservando o valor originalmente cobrado. Descartada porque o valor devido é **derivável** (`total` menos os outros pagamentos) e o caso de recebimento parcial na maquininha é raro — o normal é receber o saldo inteiro. Coluna que existe para um caso raro e derivável é peso permanente no schema. **Consequência assumida:** a linha deixa de registrar quanto foi originalmente cobrado. Fixado em `tests/w-maquininha.test.ts` (W2.2).

## 2026-08-31 — O `.env` escapado impede qualquer teste de exercitar sessão selada, e isso passou despercebido por quatro grupos

Descoberto ao escrever o grupo W, que é o **primeiro teste do projeto a exercitar uma sessão real** (o grupo F só testa `isProtectedPath`, função pura). O `.env` guarda `ADMIN_PASSWORD_HASH` como `\$2b\$12\$...` porque o carregador do **Next** expande `$` (seção 3). Os testes carregam o `.env` com **`dotenv` puro, que não expande**, então o valor chega com as contrabarras **literais**, com 63 caracteres em vez de 60. `getAuthConfig()` recusa por formato, `readSessionCookie` engole a exceção e devolve `null` — e **toda rota que dependa da sessão responde 401 sem que nada esteja errado com a sessão**. **Por que registrar:** o CLAUDE.md documentava as duas pontas dessa armadilha (Next expande, Easypanel não) e não a terceira, que é o ambiente de teste; e o sintoma aqui não é "senha errada", é uma rota autenticada respondendo 401 num teste, que se lê como bug da rota. **A correção mora no arquivo de teste** (desfaz o escape no `process.env` antes da primeira chamada, que é segura porque `getAuthConfig` é preguiçoso e memoizado), e **não** no `.env` nem em `lib/auth.ts`: mexer no `.env` quebraria o Next, e afrouxar a validação do hash apagaria o fail-fast que existe justamente para diagnosticar essa família de erro. **Consequência:** qualquer grupo futuro que teste rota autenticada precisa do mesmo preâmbulo. Se virarem três, vira helper em `tests/helpers/`.

## 2026-08-31 — `deposit_policy_text` fica como ponto de extensão não implementado; política que VINCULA mora no corpo do termo

Com o Termo v2, a política do sinal do Quadri Club (não devolução, no-show, remarcação em 48h) passou a viver no **corpo do termo, §5**. A chave `settings.deposit_policy_text`, que a rev 6 previa como origem daquele texto, ficou órfã: existe no tipo `SettingKey`, no template e no banco de produção, e **nenhum componente a renderiza**. **Decidido: documentar, não apagar.**

**A razão de a política morar no termo, e ela vale para qualquer texto que vincule o cliente:** termo é **registro jurídico versionado** — a reserva grava qual versão foi aceita (`reservations.termo_version`), e trocar o texto exige arquivo novo com versão nova. Setting é **editável no admin sem gerar versão nenhuma**. Uma política guardada em `settings` poderia ser alterada a qualquer momento e, a partir dali, uma reserva antiga apontando para a mesma `termo_version` passaria a exibir uma política que aquele cliente **nunca leu** — exatamente a falha que o versionamento por arquivo existe para impedir, reintroduzida pela porta dos fundos. Não é hipótese distante: foi o que quase aconteceu nesta mesma sessão, quando a redação do v2 chegou aplicada dentro do `quadriciclo-v1.ts` com a versão intacta.

**Por que a chave NÃO foi apagada:** ela vive no tipo **genérico** `SettingKey`, não no template do quadriciclo. Um tenant futuro pode precisar de um texto de política de sinal que varie **sem trocar de versão de termo** — tipicamente um texto informativo, exibido fora do termo, que não vincula. Apagar hoje é jogar fora um ponto de extensão para economizar uma linha, e recriar depois custa mudança de tipo mais migração de dado. **Alternativa descartada: remover a chave do `SettingKey`, do template e do banco.** Descartada por isso, e porque a remoção do banco seria a única parte irreversível de uma limpeza puramente cosmética. **Regra para quem implementar um dia:** decida ANTES se aquele texto vincula o cliente. Se vincular, o lugar dele é o termo, e esta chave não serve.

**O valor guardado fica como está, e o comentário do template passa a dizer três coisas** que sem elas fazem dele armadilha para quem o reaproveitar: que **não é renderizado**, que **nunca foi aprovado pelo cliente** (segue marcado `PROVISORIO`), e que descreve a operação do Quadri Club, não a de ninguém mais. `lib/tenant.ts` ganhou a mesma nota: a chave estava **nua** entre vizinhas todas comentadas, e essa ausência de explicação era o que fazia a órfã parecer chave em uso.

**Correção de premissa registrada junto:** cogitou-se que o texto guardado estivesse incompleto por não mencionar que o cliente pode antecipar o saldo por Pix de casa. **Esse caminho não existe** — ver a entrada seguinte.

## 2026-08-31 — O cliente NÃO tem como pagar o saldo sozinho, e isso já foi verificado duas vezes

Registrado porque a suposição contrária reapareceu duas vezes em 31/08 — uma na redação do Termo v2 (que prometia "posso antecipar o pagamento do saldo pelo próprio sistema") e outra ao revisar `deposit_policy_text`. As duas foram barradas, mas a terceira vez provavelmente passa se não estiver escrito.

**Quatro camadas independentes impedem esse caminho hoje:** (1) `DUE_PAYMENT`, em `lib/reservation-status.ts`, filtra `kind IN ('full','deposit')` e **nunca seleciona `balance`**; (2) `GET /api/reservations/{id}/payment` responde **409** fora de `pending_payment`, que é o estado de toda reserva com sinal pago (`confirmed` + `partial`, seção 4-B.3); (3) a tela `/reserva/[id]` **nem chama** aquela rota quando o status não é `pending_payment`, e o único texto sobre saldo diz *"direto com o guia, antes da saída"*; (4) a cobrança do saldo da Fase C vive em `/api/admin/reservations/{id}/balance/charge`, **atrás do proxy de sessão** — o cliente não alcança a rota.

**Consequência prática:** o texto guardado em `deposit_policy_text` ("o valor restante é pago no dia do passeio, direto com o guia") está **correto**, não incompleto. Os dois caminhos que a Fase C e a Fase D acrescentaram — QR do saldo gerado pelo dono e maquininha — acontecem **os dois presencialmente, com o guia**, então a descrição continua verdadeira sobre quem e onde; ela apenas não enumera as formas de pagamento, o que num texto de política é adequado. **Se o pagamento antecipado pelo cliente for construído**, três coisas mudam juntas e nenhuma sozinha: a query, a guarda da rota e a tela — e aí o termo ganha um v3 dizendo isso.

## 2026-08-31 — Termo v2 é arquivo novo, e uma frase da minuta foi removida por descrever comportamento inexistente

A redação da política de pagamento chegou **aplicada dentro de `quadriciclo-v1.ts`**, com `TERM_VERSION` intacta em `'2026-08-01'`. **Decidido: restaurar o v1 verbatim e criar `quadriciclo-v2.ts` com `TERM_VERSION = '2026-08-31'`.** **Por quê:** a reserva grava **só a versão**, nunca o corpo do termo. Publicar a edição faria a string `'2026-08-01'` — já gravada em toda reserva vendida até aqui — passar a resolver para um texto **diferente do que aquelas pessoas leram e aceitaram**, em silêncio, e o texto original passaria a existir apenas no histórico do git. Num documento cuja única função é provar o que alguém aceitou, isso anula o documento. **Alternativa descartada:** editar o v1 e trocar a `TERM_VERSION` no mesmo arquivo. Descartada porque a reserva antiga continuaria apontando para uma versão que o arquivo não serve mais, o que troca uma falha silenciosa por outra. **Seções 1 a 4 idênticas ao v1, byte a byte** (verificado por comparação, não por leitura); a antiga "5. CIÊNCIA" virou "6. CIÊNCIA" sem alteração de texto.

**Uma frase da minuta foi removida:** *"Também posso antecipar o pagamento do saldo pelo próprio sistema, a qualquer momento antes da data agendada."* Esse caminho **não existe** (ver a entrada sobre o assunto, mesma data). **O que aconteceria se ficasse:** um termo prometendo caminho de pagamento inexistente é pior que a omissão — o cliente procura, não acha, e conclui que o sistema comeu o dinheiro dele. É a mesma classe da contradição das 48h que a seção 4-C mandou resolver, criada por nós.

**Proteção que entrou junto, e o motivo dela:** quando o v2 passou a ser importado, o v1 **deixou de ter qualquer importador** — passou a existir só como registro. Arquivo sem importador é candidato natural a sumir numa limpeza, e sumir com ele é destruir a prova. Por isso `tests/x-termo.test.ts` fixa o **sha256 do texto do v1**. **Se aquele teste falhar, o conserto é desfazer a edição e criar um v3, JAMAIS atualizar o hash** — a falha significa que alguém editou um termo já aceito por clientes reais. Um comentário no arquivo não serviria: seria lido depois de já ter apagado.

## 2026-08-31 — Aviso que envelhece junto com a fase que o motivou vira instrução errada, e isso é bug de dinheiro

A faixa do topo de `/admin/financeiro` dizia *"Esta tela ainda não muda o preço da venda"* e *"Ligar o desconto ao preço é a próxima etapa do desenvolvimento"*. Era verdade na Fase 0 e virou **mentira** quando a Fase A entrou, em 28/08 — e a mesma tela se contradizia dois parágrafos abaixo, onde a seção de desconto dizia corretamente que o valor cadastrado é o preço cheio. **O dano é concreto:** o dono que acredita na faixa conclui que o valor do catálogo é o que o cliente paga e "conserta" baixando 349,99 para 325,49; o sistema então desconta 7% de novo e passa a cobrar **302,71**, sem erro, sem log, sem tela quebrada. Some do preço e aparece semanas depois, na conciliação. É exatamente o modo de falha que a faixa existia para impedir, **produzido pela faixa**.

**Decidido, além do conserto do texto: a conta do erro é CALCULADA, não escrita à mão.** Ela sai de `applyDiscount` sobre o percentual vigente, aplicada duas vezes. **Por quê:** um exemplo digitado envelhece junto com o percentual, que é precisamente a falha que se está consertando. Com o cálculo, a faixa se corrige sozinha se o desconto mudar.

**A regra geral, e é por isso que isto está registrado e não só commitado:** todo aviso de UI que descreve o **estado do desenvolvimento** ("ainda não", "próxima etapa") é uma dívida com data de vencimento, e o vencimento é o dia em que a fase citada entra. Quem concluir uma fase precisa procurar os avisos que ela desmente. **Aconteceu duas vezes na mesma semana:** aqui, e nos comentários de `deposit_policy_text` e `EXAMPLE_CENTS`, que sustentavam a mesma premissa velha. É a mesma classe da armadilha do seed — nada quebra, nada acusa, e alguém age sobre informação falsa.

## 2026-09-01 — O chargeback reverte o DINHEIRO e não a RESERVA, e a reversão é derivada

O cliente pode contestar a compra no cartão meses depois: o dinheiro sai da conta do tenant e **o passeio já aconteceu**. **Decidido: `reservations.status` NÃO muda.** Duas razões, as duas estruturais. **(1)** `cancelled` significa "não vai acontecer, vaga liberada", e `setReservationStatus` liberaria as linhas de `reservation_resources` — apagando o registro de que aquele recurso esteve ocupado num passeio que aconteceu. Um evento financeiro destruindo histórico operacional. **(2)** `status` governa a **vaga** e `payment_state` governa o **dinheiro**; a seção 5 já diz que são eixos independentes, e chargeback é puramente dinheiro. **O efeito sai todo de `recalcReservationPayment`**, que soma só as linhas `paid`: marcar a linha como `refunded` faz `amount_paid_cents` cair e `payment_state` regredir sozinho. **Nenhuma coluna nova**, mesmo precedente do estorno pendente da seção 8.3 ("o estado JÁ é derivável"). **A disputa ganha volta sozinha pelo mesmo caminho**, e essa é a propriedade que torna o desenho robusto: `processCharge` **converge** para o estado do provedor a cada leitura em vez de aplicar transições, então `refunded → paid` não precisa de código próprio. `tests/y-cartao.test.ts` (Y4.5) trava isso — se alguém transformar a função numa máquina de transições, aquele teste quebra, e é a hora de discutir de novo. **Visibilidade obrigatória:** a reserva continua idêntica a qualquer outra no calendário, então o painel de detalhe ganhou uma faixa vermelha que diz o valor revertido **e diz em voz alta que a reserva NÃO foi cancelada** — é a primeira pergunta de quem lê "pagamento revertido", e assumir que o sistema cancelou faria o dono não ligar para o cliente. Sem a faixa, o único rastro seria a palavra "estornado" em cinza no fim da lista de pagamentos, que ninguém lê sem estar procurando — e ninguém procura, porque nada indicou que houvesse o que procurar.

## 2026-09-01 — O chargeback era TRADUZIDO e DESCARTADO, e isso é pior que não estar implementado

Achado no levantamento da Fase E. `toPaymentState` sempre mapeou os seis status da família de estorno/chargeback (`REFUNDED`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`, `CHARGEBACK_REQUESTED`, `CHARGEBACK_DISPUTE`, `AWAITING_CHARGEBACK_REVERSAL`) para `'refunded'` — a tradução estava certa desde sempre. **Mas nada agia sobre ela:** `processCharge` só escrevia quando `charge.state === 'paid'`; a linha local estava `paid`, o passo de idempotência devolvia `already_paid`, e o evento ia embora **sem tocar no banco**. Um chargeback deixaria a linha `paid` e a reserva `confirmed`, com o dinheiro fora da conta. **Por que isto merece entrada própria:** o modo de falha não é "faltou implementar", é "**parece** implementado". Quem abrisse `toPaymentState` procurando saber se o caso estava coberto encontraria os seis status listados e concluiria que sim. É a mesma classe da armadilha do seed e da faixa do `/admin/financeiro`: nada quebra, nada acusa, e a evidência disponível aponta para a conclusão errada. **A correção põe o bloco de reversão ANTES da idempotência**, e `tests/y-cartao.test.ts` Y4.1 trava exatamente a regressão — **verificado por mutação**: removido o bloco, o teste volta a devolver `already_paid`, que é o comportamento antigo.

## 2026-09-01 — `AWAITING_CHARGEBACK_REVERSAL` é mapeado como `refunded`, e a imprecisão é deliberada

O nome do status diz o **contrário** do que o mapeamento afirma: ele significa que a disputa foi **ganha** e o dinheiro está voltando para o lojista. Traduzi-lo como `refunded` é dizer "o dinheiro está fora" enquanto ele está a caminho de volta. **Mantido assim porque as duas falhas não custam o mesmo.** Errar para `refunded` faz o dono cobrar de novo alguém que já pagou — constrangedor e **recuperável**, com uma conversa. Errar para `paid` faz o sistema afirmar ter dinheiro que ainda não voltou, e se a reversão não se completar o passeio saiu de graça, sem nada acusar. **A imprecisão é temporária por construção:** quando o dinheiro cair, o Asaas emite um status terminal e `processCharge` converge sozinho na próxima leitura. **Registrado porque alguém vai querer "consertar" isto** ao ler o nome do status — e consertar sem trazer o dado que falta (quanto tempo esse estado dura na prática, e se há evento próprio para o fim dele) troca uma falha recuperável por uma que não é. O comentário no `case` diz a mesma coisa, para quem chegar pelo código.

## 2026-09-01 — O CHECK de coerência do líquido era bicondicional e barrava o Asaas

A migration 0008 (Fase D) criou `(rate_basis_points_applied IS NULL) = (net_cents IS NULL) AND (rate IS NULL OR card_machine_modality IS NOT NULL)`. Nasceu **correto**: o único produtor de `net_cents` era a maquininha, onde nós aplicamos a taxa, e a bicondicional impedia líquido sem procedência. **A Fase E trouxe um segundo produtor e a regra passou a barrá-lo:** o provedor **informa** o líquido pronto (`netValue`), sem modalidade de maquininha e sem percentual aplicado por nós. Sob a regra antiga, gravar o líquido do Asaas obrigaria a **inventar** os outros dois — fabricar fato sobre dinheiro, exatamente o que a 4-B.7 proíbe. **Migration 0009 troca a bicondicional pela implicação** `rate IS NULL OR (net IS NOT NULL AND modality IS NOT NULL)`. Preserva integralmente o que a bicondicional protegia (percentual aplicado sem líquido continua impossível) e libera o caso novo. **A procedência continua legível sem coluna nova:** `card_machine_modality IS NULL` com `net_cents` cheio é líquido do provedor — e é por isso que `countReceiptsAwaitingNet` recorta por modalidade e não confunde os dois. **Isto resolve a tarefa TRANSVERSAL do líquido**, que atravessava as fases: o `netValue` já vinha no corpo do webhook, e passou a ser gravado congelado no mesmo UPDATE que marca o pagamento. `tests/y-cartao.test.ts` Y5.2 trava o congelamento (validado por mutação: reescrever o líquido a cada leitura quebra o teste) e Y5.4 trava que ninguém o calcula.

## 2026-09-01 — `charge_stage` existe para a TELA, e não pode decidir nada

O cartão tem estados intermediários que o Pix não tem — análise de risco, autorizado-sem-captura, captura recusada — e **todos colapsam em `payment_state='pending'`**. Esse colapso é o mapeamento **seguro para decidir** e **insuficiente para exibir**: sem distinção, a tela repetiria "aguardando pagamento" para quem acabou de digitar o cartão, e quem lê isso conclui que travou e paga de novo. Duas cobranças, e estorno de cartão é manual (seção 8-C). **Decidido: coluna `charge_stage` (enum próprio), escrita por `processCharge` na MESMA transação que o `state`** — os dois saem da mesma leitura do provedor, então não podem divergir. **Vocabulário nosso, não do Asaas:** `toChargeStage` fica em `lib/payments/asaas.ts`, ao lado de `toPaymentState`, mantendo a regra de que nenhuma palavra do provedor atravessa `provider.ts`. **>>> A coluna NÃO DECIDE NADA. <<<** Um `if (charge_stage === 'pago')` criaria uma segunda fonte da verdade sobre dinheiro, capaz de divergir da primeira — o comentário do enum no schema diz isso, e é a razão de a coluna ter nome diferente de `state` em vez de ser um refinamento dele. **Alternativa descartada:** guardar o status cru do Asaas num `text` e mapear na hora de exibir. Descartada porque faria `lib/reservation-status.ts` falar o vocabulário do provedor, que é exatamente o que `PaymentProvider` existe para impedir.

## 2026-09-01 — O hold de 15 min NÃO é estendido durante análise de risco (decisão de adiar)

A análise de risco do cartão pode passar de 15 minutos, e o hold continua correndo. Consequência: o cron expira a reserva e libera a vaga de alguém cujo cartão vai ser aprovado — caindo no **pagamento tardio** (seção 8.3), que já existe e já trata (tenta reconfirmar; vaga tomada → estorno pendente sinalizado). **Não é caminho novo, é o caminho de borda 4 sendo exercitado por um gatilho novo** — mas nunca aconteceu de verdade: no Pix o cliente paga em 15 min ou não paga, e no cartão isso deixa de ser borda. **Decidido: NÃO estender agora.** Estender exige mexer no cron, que tem duas barreiras deliberadas (seção 5, `tests/u-sinal.test.ts`), e **não sabemos a frequência real** — que é precisamente o número que os testes com gente real de outubro dão de graça. Otimizar às cegas aqui é mexer na proteção contra double-booking sem dado. **O que entrou no lugar:** a tela de "em análise" diz explicitamente que **a vaga está guardada** e mantém a contagem regressiva visível — sem isso, "em análise" é espera sem prazo, que é o que faz alguém desistir ou tentar outro caminho. **A observar nos testes reais, e está no ESTADO-ATUAL:** quantas análises passam de 15 min. Rotina → vira tarefa; raro → o caminho tardio já trabalha.

## 2026-09-01 — O texto de cartão recusado prometia Pix, e não havia Pix para oferecer

Achado **na verificação em navegador**, não em teste. A tela de pagamento não aprovado dizia *"Você pode tentar outro cartão **ou pagar por Pix** — nada foi cobrado"*. **Esse caminho não existe:** a linha de pagamento guarda o meio escolhido como snapshot da venda e não há tela que o altere; trocar de meio exigiria cancelar a cobrança e criar outra, que não foi construído. **É a mesma falha da frase que saiu do Termo v2 em 31/08** (a que prometia antecipar o saldo pelo sistema): texto que promete caminho inexistente é pior que a omissão, porque o cliente procura, não acha, e conclui que o sistema comeu o dinheiro dele. Corrigido para o que a tela realmente oferece — tentar de novo, com este ou outro cartão — mais o bloco de contato que já fica logo abaixo. **Registrado porque é a terceira vez que a verificação em navegador encontra o que build verde e teste não encontram** (as duas anteriores: o 400 do duplo toque na Fase C e a faixa obsoleta do Financeiro na Fase D). O padrão já não é coincidência: **teste prova comportamento, navegador prova o que a pessoa lê.**

## 2026-09-01 — A regra da mutação deixa de valer só para teste de corrida e passa a valer para regra de dinheiro

A regra de 31/08 dizia: "todo teste de **corrida** deste projeto precisa ser visto FALHANDO com a proteção desligada, antes de ser aceito como verde". **Ampliada: vale para todo teste que trave regra de dinheiro**, com ou sem concorrência. **O que motivou:** os 23 casos do grupo Y passaram na primeira execução, e nenhum deles é de corrida. Um teste que passa de primeira sobre uma implementação recém-escrita não distingue "a propriedade existe" de "a asserção não a alcança" — o mesmo problema do teste de concorrência, por um caminho diferente. **Sete mutações, e todas foram pegas:** remover o bloco de reversão (Y4.1 volta a `already_paid`, a regressão exata); cancelar a reserva no chargeback (Y4.2, Y4.5); reescrever o líquido a cada leitura (Y5.2); cartão caindo no `createPixCharge` (Y2.4, Y2.5); cartão+sinal rebaixando em silêncio (Y2.1, Y2.2); desconto do Pix aplicado ao cartão (6 casos); `CONFIRMED` deixando de ser "pago" (10 casos, a armadilha dos 32 dias). **O que a mutação comprou além de confiança:** ela mostra QUAIS casos guardam cada propriedade, e duas vezes revelou que um caso que eu supunha guardar uma regra guardava outra — Y4.2 não quebra ao remover o bloco de reversão, porque sem o bloco a reserva também fica `confirmed`; ele guarda a mutação oposta. Sem rodar as duas, os dois testes pareceriam redundantes e alguém apagaria um. **Custo assumido:** escrever a mutação, rodar, reverter e conferir que o arquivo voltou ao original. É caro e é menos caro que um teste verde que não testa nada sobre dinheiro.

## 2026-09-01 — O seed para de sobrescrever experiências, e a premissa que mudou é QUEM É O CLIENTE

`seedTenant()` reconciliava os nove campos de `experiences`: o dono editava preço, sinal ou idade mínima no `/admin/experiencias`, funcionava, e o próximo seed devolvia o valor do template — sem erro e sem log. **Decidido: o bloco vira INSERT-ONLY**, seguindo o padrão que `payment_method_discounts` já usava desde a Fase 0.

**Dois argumentos, e o segundo é o decisivo.**

**(1) Uma regra que reverte em silêncio é uma tela que mente.** Vale para qualquer campo com tela, e vale com força extra para regra de segurança: se o dono põe 6 na Trilha da Montanha por engano e o seed devolve 12, ele acredita que mudou. O erro visível (fica 6, e ele vê 6) custa menos que o invisível.

**(2) >>> O AVENTIX É VENDIDO PARA OUTRAS EMPRESAS, E ISSO MUDA O ENQUADRAMENTO INTEIRO. <<<** Se cada configuração depender do dev, o produto não escala — "proteger o cliente de si mesmo" na prática significa **o dev virar gargalo permanente de cada venda**. A responsabilidade por baixar uma idade mínima é do **DONO**, que é quem publica a regra (ela está no texto oficial dele, em `settings.meeting_point`) e quem responde por ela. **A mudança foi de premissa, não de opinião sobre segurança.** Quem ler isto daqui a seis meses precisa entender que não se reavaliou o risco de uma idade mínima errada: reavaliou-se de quem é a decisão.

**Consequência de produto, e é ela que reordena o backlog:** as telas de configuração deixaram de ser conveniência e viraram **requisito de produto**. O destino declarado é tela para termo, telefone, o que levar, quadriciclos, mapa, ponto de encontro e idade mínima — todos acabam insert-only.

**REVERSÃO EXPLÍCITA da decisão de 28/08.** Aquela dizia: *"a idade mínima é regra de SEGURANÇA publicada pelo cliente, então o template é a casa definitiva"*, e por isso `min_passenger_age` entrava na reconciliação e não só no INSERT. Estava coerente com a premissa da época (um cliente, dev acoplado) e passou a conflitar com o próprio CRUD, que já expunha `idadeMinimaGarupa` — as duas coisas foram construídas na mesma semana e se contradiziam sem que ninguém notasse. **Alternativa descartada: reconciliar SÓ `min_passenger_age` e deixar o resto insert-only.** Descartada porque tornaria o comportamento do seed **por campo** — ninguém segura isso na cabeça — e porque é justamente o campo onde a tela mentindo custa mais caro.

**>>> A LINHA É "TEM TELA", E ELA VAI ANDAR. <<<** `settings` (15 chaves) e `resources` continuam reconciliando **HOJE POR FALTA DE TELA, não por decisão de que devam**. Escrito assim de propósito: daqui a dois meses alguém leria "settings reconcilia" como princípio, e não é — é estado transitório. **A regra de ordem é inviolável: TELA PRIMEIRO, insert-only JUNTO com ela, item a item. Nunca antes.** Tirar a reconciliação de campo sem tela **piora** a situação: hoje um valor errado se conserta editando o template e rodando o seed, o que ao menos passa por revisão e fica no git; sem os dois, o único caminho vira psql em produção — que a seção 19 documenta como armadilha, com o console do Easypanel mentindo sobre `COMMIT`.

**O que substitui a rede que se perde.** A reconciliação era, de fato, uma rede: erro de digitação numa tela se consertava no próximo seed. Com insert-only o erro fica, e isso é o preço da autonomia. Em troca, `SeedReport.divergences` passa a listar o que o seed encontrou diferente e **não** corrigiu, nos dois blocos insert-only (experiências e desconto — este último divergia em silêncio desde a Fase 0). **É RELATO NEUTRO, NÃO ALARME, e a distinção é regra deste projeto:** depois da primeira edição do dono, divergência é o estado **normal e permanente** — é o que a autonomia significa —, e um aviso que dispara sempre não é aviso, é fundo (seção 8-B, a lição do reconciliador que gritava a cada 10 minutos sobre estado esperado). Sem `console.error`, sem "ATENÇÃO". O valor não é vigiar o dono: é ser o **diff** de quem for investigar por que produção não é o template, e é o que mantém o template útil como documentação em vez de ficção.

**Consequência para a futura `POST /api/admin/seed`:** ela passa de "conserta o que está errado" para "**cria o que falta**". Registrado aqui porque aquela rota está no backlog justamente por semear produção à mão já ter mordido três vezes, e alguém vai contar com ela como ferramenta de reparo. Em experiências e no desconto, ela não repara — cria o ausente e relata o resto.

**Nada a rodar em produção**, por duas razões independentes: o seed não roda lá (o boot só migra, e `scripts/` nem entra na imagem standalone), e insert-only é estritamente mais seguro que o comportamento anterior.

## 2026-09-01 — `comSinal` restaurava um valor inventado, e um teste passava por acidente de ordem

O helper `comSinal` (grupos U, V, W e Y) ligava o sinal numa experiência e, no `finally`, gravava `payment_mode = 'full'` **literal** — não o valor que havia antes. Casava com o template por coincidência, e parou de casar quando o template passou a declarar `'deposit'` (01/09). A divergência não aparecia porque o `seedTenant()` do grupo T reconciliava o catálogo de volta; **com experiências insert-only essa muleta some**, e o helper passaria a sujar o catálogo para o próximo arquivo da suíte. **Corrigido: lê os três campos antes e restaura exatamente o que leu.**

**O que isso descobriu:** `U3.2` ("experiência SEM sinal, cliente pedindo sinal: RECUSA") **passava por acidente de ordem de execução**. Ele afirmava testar uma experiência sem sinal e nunca estabelecia esse estado — dependia de um `comSinal` anterior ter deixado `'full'` para trás. Removida a coincidência, o teste caiu, corretamente. **Corrigido com um helper `semSinal` simétrico**, que declara a precondição em vez de assumi-la.

**A regra que fica é IRMÃ da regra da mutação (31/08), e vale escrever as duas juntas: nos dois casos o verde não prova o que afirma.** A mutação pega o teste que passa sem que a proteção exista; esta pega o teste que passa sem que o cenário exista. **Teste que depende do estado deixado por outro teste passa e não prova nada** — toda precondição se declara no próprio caso. **Toda precondição de catálogo se declara no próprio caso.** O sintoma aqui foi benigno — um teste verde sem lastro —, mas a mesma classe produz suíte que passa na máquina de quem escreveu e falha em banco limpo, que é exatamente onde este projeto não pode falhar (o `global-setup` existe para garantir o contrário).

**Verificado com banco ZERADO:** `docker compose down -v` seguido de `npm test` cria as 10 migrations, semeia 21 registros e passa 277/277. O caminho de tenant novo não depende de reconciliação — ele é o mesmo `if (!current) insert` de sempre, e é por isso que insert-only não podia quebrá-lo.

## 2026-09-01 — A área depois do pagamento é AUTONOMIA DO TENANT, e a mudança é de enquadramento

Com o faseamento de pagamento encerrado, a próxima área foi decidida: **autonomia do dono do tenant**. Não é uma lista de conveniências acumuladas; é consequência de uma mudança de enquadramento registrada no mesmo dia da reversão do seed.

**>>> O QUADRI CLUB É O PRIMEIRO CLIENTE, NÃO O CLIENTE. <<<** Num produto vendido para outras empresas, **"o dev configura" é o que impede vender o segundo**. Cada configuração que passa por edição de código, commit e deploy transforma o dev em gargalo permanente de cada venda — e isso não é um custo que cresce linearmente, é o que torna a venda seguinte inviável. **Telas de configuração deixaram de ser conveniência e viraram requisito de produto.**

**Quatro fases, e a ordem é executável, não arbitrária.** Dos sete itens levantados em `docs/LEVANTAMENTO-AUTONOMIA.md`, **cinco são a mesma peça técnica** (`settings`), então uma tela resolve quatro de uma vez:

- **AUT-1** — termo de aceite editável, com versionamento **imutável**. A mais complexa, por razão própria (entrada seguinte).
- **AUT-2** — `/admin/configuracoes`: telefone de suporte, o que levar, mapa, ponto de encontro, mais os rótulos e o nome do negócio.
- **AUT-3** — CRUD de recursos, última entidade do catálogo sem tela.
- **AUT-4** — idade mínima do garupa. **JÁ FECHADA** pela branch `feat/seed-nao-sobrescreve`, que é também infraestrutura das outras três.

**A regra de ordem é inviolável e atravessa as quatro: TELA PRIMEIRO, `insert-only` no seed JUNTO com ela, item a item. Nunca antes.** Tirar a reconciliação de um campo sem tela deixa o valor sem caminho de conserto que não seja psql em produção, que a seção 19 documenta como armadilha. É por isso que `settings` e `resources` ainda reconciliam: **por falta de tela, não por decisão de que devam.**

**Fora de escopo desta área, prioridade menor:** integração Asaas por tela e criação de tenant novo. **As duas dependem da Etapa 2** (`getTenantId()` real), e enfiá-las aqui esconderia essa dependência atrás de trabalho de UI.

## 2026-09-01 — AUT-1: a decisão de 09/08 sobre o termo foi REABERTA, e a restrição é versionamento

A decisão de 2026-08-09 — *"termo não tem CRUD nem editor no admin"* — **previa a própria condição de reabertura**: *"reabre se algum dia o texto precisar mudar sem deploy"*. **A condição se cumpriu**, pelo enquadramento da entrada anterior: com o Aventix vendido para outras empresas, o dev sendo o único caminho para editar um termo é exatamente o que impede o segundo cliente.

**>>> A RESTRIÇÃO É VERSIONAMENTO, NÃO CONFIANÇA. <<<** Registrado assim porque a leitura natural é "não deixamos o dono editar porque ele pode escrever besteira", e não é isso. `reservations.termo_version` grava **qual versão** o cliente aceitou, e **nunca o corpo**. Se a tela editar o texto de uma versão **existente**, toda reserva que já apontava para aquela string passa a resolver para um texto que aquelas pessoas **nunca leram** — e um documento cuja única função é provar o que alguém aceitou vira ficção. É a mesma falha que o versionamento por arquivo existe para impedir (decisões de 31/08 sobre o Termo v2 e sobre `deposit_policy_text`), entrando pela porta da tela.

**A regra que a implementação tem de honrar: cada publicação CRIA VERSÃO NOVA.** Editar versão publicada precisa ser **impossível**, não desaconselhado.

**O que isso implica, e é por isso que a AUT-1 é a mais cara das quatro:** o termo **sai de `lib/terms/` e vai para o banco**, em tabela própria; **v1 e v2 migram** para lá preservando byte a byte o que já foi aceito; a **imutabilidade é imposta pelo BANCO** (trigger ou permissão), não por disciplina de código nem por comentário pedindo para não editar — porque a disciplina de código é justamente o que a tela remove; e **`tests/x-termo.test.ts` precisa ser repensado**, já que ele fixa o sha256 do v1 **do arquivo** e, com o texto no banco, aquele hash deixa de ter o que proteger. A proteção equivalente passa a ser o teste de que uma versão publicada não pode ser alterada.

**Alternativa que será tentada e precisa ser recusada:** tela que edita o texto e "lembra" de bumpar a versão. Recusada porque põe a integridade do registro jurídico na mão de quem está com pressa, e porque a falha é **silenciosa** — nada quebra no dia da edição, e o problema só aparece quando alguém for provar o que um cliente aceitou.
