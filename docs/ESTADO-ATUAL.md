# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-31

## Enquadramento (leia antes de priorizar qualquer coisa)

**O sistema está em produção com todas as formas de pagamento do MVP prontas,
mas o link de agendamento ainda não foi divulgado.** Não há campanha em curso.
Tudo é **preparação para outubro**, quando sai o vídeo do **@grandecampinas** e
os leads caem de uma vez.

O risco não é chegar a tempo — é **chegar testado com gente real antes do pico**.

## PRÓXIMO PASSO — testes com clientes reais, e a lista de conferência antes do vídeo

O faseamento de pagamento **acabou**, menos a Fase E (cartão), que a rev 7 pôs
como condição de lançamento. Duas frentes, nesta ordem:

### 1. Antes de qualquer outra coisa: desativar a experiência TESTE

**Segue ATIVA em produção e aparece em `/api/experiences`**, ou seja, na LP
pública. É a pendência mais antiga em aberto e a única que o cliente final veria.
Caminho pelo admin (`/admin/experiencias` → `Desativar` → `Sim, desativar`), e a
conferência:

```bash
curl -s https://app.aventix.com.br/api/experiences | grep -i teste
```

### 2. Fase E — cartão via `invoiceUrl`

É o que falta para o lançamento que o cliente condicionou a "todas as formas de
pagamento" (seção 17). Duas armadilhas já documentadas e não resolvidas:
confirmar a reserva no evento **`PAYMENT_CONFIRMED`** e não no `PAYMENT_RECEIVED`
(que no crédito só chega ~32 dias depois), e o **chargeback** (seção 4-B.9), que
cria uma combinação de estados que a seção 5 ainda não prevê.

### Faseamento (CLAUDE.md seção 17)

| Fase | Estado |
|---|---|
| **Fase 0** — configuração financeira | **CONCLUÍDA** |
| **Fase A** — preço cheio + desconto do Pix | **CONCLUÍDA, em produção** |
| **Fase B** — sinal de 50% via Pix | **CONCLUÍDA, validada com dinheiro real** |
| **Fase C** — cobrança do saldo, idempotente | **CONCLUÍDA, em produção** |
| **Fase D** — registro da maquininha | **CONCLUÍDA, em produção**; falta o dado (percentuais) |
| **Fase E** — cartão via `invoiceUrl` + chargeback | **PRÓXIMA fase de código** |
| **Transversal** — líquido lido do Asaas | pendente |
| **Termo v2** | **CONCLUÍDO e em produção** |
| **Antes do vídeo** — testes com clientes reais | em andamento |

## Estado de produção

**Deploy feito nesta sessão.** Produção está em **`9b38512`** (`main` =
`origin/main`), saindo de `b629a11`. Entraram de uma vez: Fase C, Fase D,
Termo v2 e a correção da faixa do `/admin/financeiro`.

- **Migrations: 9 no disco, 9 aplicadas em local.** A 0008 (colunas da Fase D)
  roda no boot. **Confira o número absoluto em produção**, que é a única
  verificação que este deploy pede:
  `SELECT count(*) FROM drizzle.__drizzle_migrations;` deve dar **9**.
- **Este deploy NÃO cai na armadilha do seed** (seção 19): a 0008 só acrescenta
  colunas nuláveis, e não houve setting nova nem tabela de configuração nova.
  Não há `UPDATE` manual a fazer.
- **`card_machine_rates` está VAZIA**, e é o estado esperado: os percentuais
  reais não chegaram. Enquanto isso, todo registro de maquininha grava
  `net_cents = NULL` e aparece na contagem de `/admin/financeiro`.
- **Termo v2 vigente.** Reserva nova grava `termo_version = '2026-08-31'`; as
  antigas seguem apontando para o v1, com o texto do v1.
- **3 reservas da borda 9** (cobrança nunca criada) continuam em produção. O
  reconciliador ainda avisa sobre elas, e é o único sinal que existe.

## O que foi entregue nesta sessão

**Fase C — cobrança do saldo sob demanda, idempotente.** Sem migration. Três
camadas: caminho rápido local, `pg_try_advisory_xact_lock` na linha do pagamento,
e pergunta ao provedor pela `external_reference` antes de criar. A terceira cobre
o único buraco que trava local nenhuma alcança: o processo morrer entre o Asaas
criar e nós gravarmos o id. É **fail-closed**.

**Fase D — registro da maquininha.** Migration 0008 congela bruto, modalidade,
percentual e líquido, mais o rastro de quem declarou. Recusa o **caminho duplo**
(saldo já pago por Pix) e **cancela** a cobrança Pix viva, gravando antes e
cancelando depois.

**Termo v2** (`quadriciclo-v2.ts`, `TERM_VERSION '2026-08-31'`), com a §5 de
pagamento, cancelamento e remarcação.

**Correção da Fase A:** a faixa do `/admin/financeiro` dizia que o desconto não
estava ligado ao preço, e o dono que acreditasse nela baixaria 349,99 para
325,49, fazendo o sistema cobrar 302,71.

**`deposit_policy_text`** documentada como ponto de extensão não implementado.

## Três coisas desta sessão que valem como método, não como tarefa

**1. Verificação em navegador encontra o que teste não encontra.** Duas vezes.
Na Fase C, o duplo toque no caminho rápido fazia o Asaas responder 400 e a tela
dizer *"o provedor recusou a cobrança"* — falso, com o cliente na frente. Na
Fase D, a faixa obsoleta do Financeiro. **Nenhum dos dois apareceria em teste com
provedor mockado nem em build verde.**

**2. Teste de corrida só prova algo depois de falhar por mutação.** O caso do
duplo toque (V1.2) e o do congelamento (W4.3) foram validados desligando a
proteção e vendo o teste quebrar. **Regra do projeto agora:** todo teste de
corrida precisa ser visto falhando antes de ser aceito como verde.

**3. Documento que envelhece junto com a fase que o motivou vira instrução
errada.** Aconteceu com a faixa do Financeiro e quase aconteceu com o termo. É a
mesma classe da armadilha do seed: nada quebra, nada acusa, e alguém age sobre
uma informação falsa.

## Pendências que NÃO podem se perder

**1. A experiência TESTE segue ATIVA em produção.** Ver o Próximo Passo.

**2. Termo v2 está em produção sem confirmação de aprovação do cliente.**
Perguntei duas vezes se o texto voltou aprovado pelo Quadri Club e não houve
resposta. É documento com valor legal, e a política (seção 4-C) foi decidida por
mensagem, não por escrito dele. **Se não estiver aprovado, é a pendência mais
séria da lista.**

**3. Cancelar reserva não cancela a cobrança de saldo no Asaas.** O cliente
cancelado ainda consegue pagar. Era teórico até a Fase C; agora aquela cobrança
existe de verdade. A Fase D trouxe o primeiro chamador real de `cancelCharge`,
então a costura está a um passo. Registrado para o Orbi.

**4. Percentuais da maquininha** não enviados pelo cliente.

## Dívidas conhecidas

**Verificação**
- Telas do admin conferidas em navegador autenticado: **agenda, painel de
  detalhe e financeiro**. Continuam sem conferência: experiências, horários,
  bloqueios, exceções, clientes e agendamentos.
- O método está estabelecido: cookie de sessão selado com `iron-session` a partir
  do `SESSION_SECRET` local, script temporário, apagado depois.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- Transversal do líquido lido do Asaas não implementada.
- `findChargeByExternalReference` filtra a referência de volta por segurança; o
  filtro do Asaas **não foi medido isoladamente**, e a conferência defensiva é o
  que garante o resultado.
- Na adoção de cobrança órfã, o `invoiceUrl` fica `null` (o `ChargeSnapshot` não
  o carrega). Sem impacto conhecido.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- Etapa 2 não feita: `getTenantId()` devolve 1 fixo, com
  `assertResolvedTenantIsCurrent()` impedindo divergência silenciosa.
- Critério de conclusão: poder apagar aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Ambiente de teste**
- O `.env` guarda o hash escapado (`\$`) para o Next, e o `dotenv` puro dos testes
  não expande. Qualquer grupo que teste rota autenticada precisa desfazer o
  escape no `process.env` antes da primeira chamada, como faz o grupo W. Se
  virarem três, vira helper em `tests/helpers/`.

**Gerais**
- Sem CI/CD; deploy é clique manual no Easypanel.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- 3 avisos de Edge Runtime no build, conhecidos e estáveis.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo torna isto mais
  relevante do que era**.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
  **Agora existe precedente pronto**: a Fase C resolveu o mesmo problema com
  advisory lock e chave natural determinística. Reavaliar antes do vídeo.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais mergeadas, podem ser apagadas: `feat/maquininha`,
  `feat/tenant-slug`, `feat/idade-e-mapa`, `feat/config-financeira`,
  `feat/preco-por-metodo`, `feat/sinal-50`, `feat/texto-informacoes`.

## Testes

`npm test`: **24 arquivos, 254 casos, todos passando**.

- Grupo **V** (`v-cobranca-saldo.test.ts`, 24 casos) — Fase C. Os testes de V1
  não verificam "respondeu 200": contam **quantas vezes o provedor foi mandado
  criar**. V1.2 validado por mutação.
- Grupo **W** (`w-maquininha.test.ts`, 24 casos) — Fase D. W4.1 trava a coluna e
  **W4.3 trava o caminho de leitura**, que é onde o risco real mora; validado por
  mutação (leitor recalculando devolve 14100 em vez de 14250).
- Grupo **X** (`x-termo.test.ts`, 9 casos) — versionamento do termo, com o
  **sha256 do v1 fixado**. Se X1.1 falhar, o conserto é desfazer a edição e criar
  um v3, **nunca** atualizar o hash.

## Banco local

Container `aventix-db-dev` no ar. **9 migrations no disco, 9 aplicadas**
(`npm run db:generate` responde "No schema changes"). `reservations` vazia e
`card_machine_rates` vazia: as fixtures da verificação em navegador foram
apagadas ao final.

**`payment_mode` local está em `full`** nas duas trilhas, diferente de produção,
onde está `deposit`. Para exercitar sinal ou saldo localmente, ligue e desligue à
mão, como faz o helper `comSinal` dos grupos U, V e W.
