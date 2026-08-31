# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-31

## Enquadramento (leia antes de priorizar qualquer coisa)

**O sistema está em produção, mas o link de agendamento ainda não foi divulgado.**
Não há campanha em curso e nenhuma pendência abaixo está causando dano agora.
Tudo é **preparação para outubro**, quando sai o vídeo do **@grandecampinas** e
os leads caem de uma vez.

O risco não é chegar a tempo — é **chegar testado com gente real antes do pico**.

## PRÓXIMO PASSO — Termo v2 (bloqueado no cliente) e Fase D

A Fase C fechou. Os dois próximos itens não competem: um depende do cliente e o
outro depende de percentuais que também dependem do cliente.

### Termo v2 — o que falta NÃO é texto, é código

**Levantamento feito nesta sessão, e ele muda o tamanho da tarefa:**
`settings.deposit_policy_text` **existe** no tipo (`lib/tenant.ts`), **existe**
no template e **tem valor gravado** — marcado `PROVISORIO — confirmar com o
cliente`. E **nenhum componente a renderiza**: `grep` não a encontra em lugar
nenhum de `app/`. A seção 10 vinha sendo lida como "falta o texto"; **falta a
renderização condicional**, que não existe.

**O que o Termo v1 diz hoje sobre pagamento** (`lib/terms/quadriciclo-v1.ts`,
`TERM_VERSION = '2026-08-01'`):

- §3 — o passeio pode ser interrompido **"sem direito a reembolso"** por má
  conduta. **Única ocorrência de "reembolso" no texto inteiro.**
- §4 — responsabilidade por danos ao equipamento (resgate, reparo, peças).

**Não aparecem em lugar nenhum:** sinal, não reembolso em cancelamento pelo
cliente, no-show, saldo pago no dia, remarcação/48h, formas de pagamento.

**Portanto o v2 é ADIÇÃO de um bloco novo, não revisão.** Nada no v1 contradiz a
política da seção 4-C, então não há redação existente para renegociar. Provável
formato: §5 nova ("Pagamento, cancelamento e remarcação"), com a §5 atual virando
§6. **Reserva já vendida mantém o v1** (versão nova é arquivo novo), então o v2
protege dali para frente, nunca retroativamente.

**Bloqueado em duas coisas do cliente:** a redação aprovada, e a contradição
entre documentos — o texto oficial em `settings.meeting_point` (tela de
confirmação, **depois** de pagar) promete remarcação em 48h sem dizer como,
enquanto o termo (**antes** de pagar) dirá que não há devolução.

### Fase D — registro manual da maquininha

Bloqueada nos **percentuais reais por modalidade**, que o cliente não enviou. A
tabela e a tela já os aceitam; vazia é o estado honesto. Regra que já está
decidida e não pode ser afrouxada: **taxa ausente é `NULL`, jamais 0%**, e a
Fase D deve **recusar** o registro cuja modalidade não tenha taxa (seção 4-B.6).

### Faseamento (CLAUDE.md seção 17)

| Fase | Estado |
|---|---|
| **Fase 0** — configuração financeira | **CONCLUÍDA** |
| **Fase A** — preço cheio + desconto do Pix | **CONCLUÍDA, validada em produção** |
| **Fase B** — sinal de 50% via Pix | **CONCLUÍDA, validada em produção com dinheiro real** |
| **Fase C** — cobrança do saldo sob demanda, idempotente | **CONCLUÍDA em 31/08, verificada contra o sandbox** |
| **Fase D** — registro manual da maquininha | **bloqueada no cliente** (percentuais) |
| **Fase E** — cartão via `invoiceUrl` + chargeback | pendente |
| **Transversal** — líquido lido do Asaas | pendente |
| **Termo v2** | **bloqueado no cliente** (redação), e tem código a escrever |
| **Antes do vídeo** — testes com clientes reais | em andamento |

## O que foi entregue nesta sessão

**Fase C — cobrança do saldo sob demanda, idempotente.** Sem migration.

- `lib/payments/balance-charge.ts` — o núcleo, com **três camadas** de
  idempotência (seção 8-D do CLAUDE.md).
- `GET /api/admin/reservations/{id}/balance` (só lê, nunca cria) e
  `POST .../balance/charge` (o botão).
- `PaymentProvider` ganhou `findChargeByExternalReference`, com conferência
  defensiva da referência de volta.
- `app/(admin)/admin/_components/balance-charge.tsx` — botão, QR e copia-e-cola
  no painel de detalhe.
- Reconciliador parou de poluir o log.

### As três camadas, e por que a terceira existe

1. **Caminho rápido local** — a linha já tem `asaas_payment_id`: só relê o QR.
2. **Trava de serialização** — `pg_try_advisory_xact_lock` na linha do pagamento,
   **não bloqueante**: o segundo toque volta na hora com 409.
3. **Pergunta ao provedor** pela `external_reference` antes de criar.

**A terceira existe porque as duas primeiras vivem inteiramente dentro do nosso
processo e do nosso banco.** Nenhuma alcança o buraco em que o processo **morre**
(deploy, container reiniciado, conexão caída) **depois** de o Asaas criar a
cobrança e **antes** de gravarmos o id: ali a linha tem id nulo, a cobrança
existe lá, e as camadas 1 e 2 concordam que "não há cobrança" — as duas erradas
ao mesmo tempo, sem conflito entre si que denuncie o erro. **É a duplicata mais
perigosa das três, porque nasce de um deploy e não de um clique.** A camada 3 é
**fail-closed**: não dando para perguntar, não se cria.

Verificada no mundo real: recriada a reserva com id nulo e a cobrança ainda viva
no sandbox, o POST devolveu **`origin=adopted`**.

### O achado do 400 em leitura concorrente

**MEDIDO contra o sandbox, e mudou o desenho.** Dois toques que caem **os dois**
no caminho rápido disparam duas consultas concorrentes ao mesmo QR, e o Asaas
responde `400 "Um erro desconhecido foi encontrado"` numa delas.

**Nada era duplicado.** O estrago era inteiramente na **mensagem**: aquele 400
subia como recusa e a tela dizia **"o provedor recusou a cobrança"** — falso em
dois pontos ao mesmo tempo, e chegando ao dono **em campo, com o cliente na
frente**, que é exatamente o cenário em que ele reage refazendo uma cobrança que
já existe.

Consertos: a trava passou a valer para o caminho rápido (invariante: **uma
operação de saldo em voo por reserva, sempre**), e a falha de releitura ganhou
tipo próprio, `BalanceQrUnavailableError` → `502 qr_indisponivel`, que diz que a
cobrança **existe**, que nada foi duplicado, e oferece a `invoiceUrl`.

**Nenhum teste com provedor mockado teria produzido esse 400:** ele é
comportamento do Asaas sob concorrência, não do nosso código.

### O teste de corrida foi verificado POR MUTAÇÃO

O caso V1.2 passou na primeira execução, e **isso não é evidência de nada**: um
teste de concorrência passa igual quando a corrida não acontece. A trava foi
**removida de propósito** e o teste rodado de novo — falhou com
`expected [...] to have a length of 1 but got 2`. Só então a trava voltou.

**Regra que fica: todo teste de corrida deste projeto precisa ser visto FALHANDO
com a proteção desligada antes de ser aceito como verde.** Sem esse passo, o que
se tem é um teste que afirma a propriedade e um sistema que talvez não a tenha, e
os dois combinam perfeitamente.

## >>> AS TELAS DO ADMIN FORAM VISTAS EM NAVEGADOR AUTENTICADO <<<

**Lacuna que este documento arrastava desde 22/08, fechada em parte.** `/admin/*`
está atrás do login e só existe o hash da senha, então tudo ali era provado por
teste e por build, **nunca por olho**.

Método: cookie de sessão selado com `iron-session` a partir do `SESSION_SECRET`
do `.env` **local** (script temporário, apagado), injetado no navegador, contra o
banco de desenvolvimento com uma reserva-fixture `confirmed` + `partial`.

O que só apareceu por causa disso:

- o botão **"Cobrar saldo (R$ 162,74)"** com o valor certo;
- o **QR real** vindo do sandbox, e o achado do 400 acima;
- **não previsto:** o rótulo **"SALDO R$ 162,74" no bloco da agenda**, que é a
  correção mais importante da Fase B e nunca tinha sido olhada.

**A dívida NÃO está integralmente fechada:** experiências, horários, bloqueios,
exceções, financeiro e clientes continuam sem verificação em navegador.

## Estado de produção

- Commit em produção: **`b629a11`**. **`main` local está 2 commits à frente**
  (`4feae41` da Fase C + o commit de docs desta sessão) e **a Fase C ainda não
  foi deployada.**
- **Fase C não exige migration nem setting nova**, então o deploy dela **não cai
  na armadilha do seed** (seção 19). É o primeiro deploy em várias sessões que
  não precisa de conferência por `SELECT`.
- `experiences`: Montanha e Fazenda em `payment_mode = 'deposit'`,
  `deposit_percent = 50`, `price_cents` 34999 e 24999.
- `payment_method_discounts`: `pix | 700`.
- **3 reservas da borda 9** (cobrança nunca criada) seguem em produção. O
  reconciliador continua avisando sobre elas, e é o único sinal que existe.

## Pendências que NÃO podem se perder

**1. A experiência TESTE continua ATIVA em produção.** Passo do CRUD entregue
nesta sessão (`/admin/experiencias` → `Desativar` → `Sim, desativar`), mas **não
há confirmação de que foi executado**. Enquanto estiver ativa ela aparece em
`/api/experiences`, ou seja, na LP pública. Conferir com:
`curl -s https://app.aventix.com.br/api/experiences | grep -i teste`

**2. Deploy da Fase C não feito.** O botão "Cobrar saldo" não existe em produção.

**3. Duplicação de título na tela de confirmação.** O `<h2>` "Informações
importantes" repete a primeira linha do texto do cliente. **Decisão pendente:**
omitir o `<h2>` ou pedir ao cliente para tirar a primeira linha.

**4. A tela de confirmação com o texto novo ainda não foi vista em produção.** A
verificação continua sendo local.

**5. Cobrança de teste viva no sandbox** do Asaas (`3aa77hmzw2yshk6r`),
inofensiva. Cancelar se incomodar.

## Dívidas conhecidas

**Dependem do cliente**
- Percentuais reais da maquininha por modalidade (bloqueiam a Fase D).
- Redação aprovada do Termo v2 e a contradição das 48h.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- Etapa 2 não feita: `getTenantId()` devolve 1 fixo, com
  `assertResolvedTenantIsCurrent()` impedindo divergência silenciosa.
- Critério de conclusão: poder apagar aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `receiveInCash` não implementado (Fase D).
- `findChargeByExternalReference` usa `GET /payments?externalReference=` e
  **filtra a referência de volta** por segurança. O filtro do Asaas **não foi
  medido isoladamente**: o comportamento observado (adoção correta) é consistente
  com ele funcionando, mas a conferência defensiva é o que garante o resultado.

**Dívida técnica registrada de propósito**
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`.
- Na adoção de cobrança órfã (camada 3), o `invoiceUrl` fica `null` — o
  `ChargeSnapshot` não o carrega. Sem impacto conhecido; o QR vem normalmente.

**Gerais**
- Sem CI/CD; deploy é clique manual no Easypanel.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá: **3 avisos no
  build**, reconfirmados nesta sessão; nenhum novo.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo torna isto mais
  relevante do que era**.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
  **Agora existe precedente pronto:** a Fase C resolveu o mesmo problema com
  advisory lock + chave natural determinística. **Reavaliar antes do vídeo.**
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais já mergeadas, podem ser apagadas: `feat/tenant-slug`,
  `feat/idade-e-mapa`, `feat/config-financeira`, `feat/preco-por-metodo`,
  `feat/sinal-50`, `feat/texto-informacoes`.

## Testes

`npm test`: **22 arquivos, 221 casos, todos passando**.

- Grupo **V** (`v-cobranca-saldo.test.ts`, 22 casos) — a Fase C. Os testes de V1
  não verificam "respondeu 200": contam **quantas vezes o provedor foi mandado
  criar**, que é o único número que importa. **V1.2 foi validado por mutação.**
- Grupo **U** (`u-sinal.test.ts`, 14 casos): a divisão 16275/16274, e U1/U4.2
  travando as barreiras que impedem o cron de expirar reserva já paga.
- Grupo **T** (`t-preco-por-metodo.test.ts`, 13 casos): T2.4 com fixture 33333
  separando "desconto sobre o total" de "unitário descontado × 2".

## Banco local

Container `aventix-db-dev` no ar. **8 migrations no disco, 8 aplicadas**
(`npm run db:generate` responde "No schema changes"). A divergência "7/7" que a
sessão anterior registrou como dúvida está **resolvida**: eram 8, e o "7" era o
número da última (`0007`).

Catálogo semeado e reconciliado com o template. **`payment_mode` local está em
`full`** nas duas trilhas — diferente de produção, onde está `deposit`. Para
exercitar o sinal localmente, ligue e desligue à mão, como faz o helper `comSinal`
dos grupos U e V. A reserva-fixture usada na verificação em navegador foi
**apagada** ao final; `reservations` local está vazia.
