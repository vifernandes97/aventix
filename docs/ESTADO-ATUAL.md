# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-25

## Onde estamos

**O go-live NÃO aconteceu, e isso é decisão, não atraso.** Em 25/08, depois de
ver o sistema apresentado, o cliente voltou atrás do combinado (lançar só com Pix
integral) e pediu para **lançar somente com todas as formas de pagamento
prontas**.

**Prazo novo: sistema pronto em setembro; uso real no início de outubro**, quando
sai o vídeo do influenciador **@grandecampinas**. Os leads do vídeo caem na
plataforma **de uma vez** — é o primeiro volume real que o sistema vai ver, e é
por isso que o marco deixou de ser data e virou evento.

**O sistema está EM PRODUÇÃO e funcionando.** Em 24/08 o **ciclo do dinheiro foi
validado com dinheiro real**: cobrança criada, paga pelo app do banco, webhook
entregue, sistema confirmou sozinho. Produção está deployada, com **chave de
produção do Asaas**, e o **banco de produção está limpo** (sem lixo de teste).

O que falta **não é estabilidade — é escopo de pagamento** (CLAUDE.md seção 4-B).

> **Não verificado nesta sessão:** o commit exato em produção, quais migrations
> ela já aplicou e a configuração corrente do webhook. Não tenho acesso ao
> Easypanel nem ao painel do Asaas, então isto é o que foi **relatado**, não
> observado. Conferir antes da Fase 0.

## PRÓXIMO PASSO — Fase 0: configuração financeira

Tabela **própria** (fora de `settings`), com desconto do Pix por tenant e taxas
da maquininha por modalidade. É o alicerce das fases A..E.

**Por que não em `settings`:** `seedTenant()` sobrescreve toda linha cujo valor
divirja do template, então o 7% configurado pelo dono sumiria no próximo seed,
sem erro e sem log (CLAUDE.md seções 4-B.6 e 19).

A tabela pode ser construída **sem** os percentuais da maquininha, que ainda não
chegaram — o que não pode é registrar pagamento com taxa chutada.

### Faseamento acordado (CLAUDE.md seção 17)

| Fase | O que entra |
|---|---|
| **Fase 0** | Configuração financeira: tabela própria, desconto Pix, taxas por modalidade |
| **Fase A** | Preço por método + Pix integral com desconto |
| **Fase B** | Sinal de 50% via Pix (`confirmed` + `partial`) |
| **Fase C** | Cobrança do saldo sob demanda, **idempotente** |
| **Fase D** | Registro manual da maquininha, com líquido e taxa congelados |
| **Fase E** | Cartão via `invoiceUrl` + chargeback |
| **Transversal** | Líquido lido do Asaas em toda reserva |
| **Termo v2** | Em paralelo: política de cancelamento + regra de remarcação |
| **Antes do vídeo** | Testes com clientes reais |

## O que mudou no modelo de pagamento (leia a seção 4-B antes de codar)

- Experiência cadastra o **valor cheio**; **Pix tem desconto** configurável por
  tenant (7%); **cartão paga o cheio, sem acréscimo**. Não existe taxa somada ao
  cliente.
- **Sinal é 50% fixo, só no Pix**, e o desconto incide **também** sobre ele.
- **Sinal pago → `confirmed` + `partial`.** Manter `pending_payment` faria o cron
  de hold liberar a vaga de quem já pagou metade.
- **Arredondamento:** entrada para cima, saldo é sempre `total − pago`.
- **Valores congelados** no registro do pagamento (bruto, modalidade, percentual,
  líquido). Taxa muda; registro de dinheiro não.
- **Cartão via `invoiceUrl`**, nunca formulário próprio (PCI; o Asaas não tem
  tokenização client-side).
- **Chargeback** é lacuna conhecida, tratada na Fase E.

## Pronto

**Fases 0–2 (numeração antiga)**: schema, tenant e settings, motor de
disponibilidade, criação transacional, cron de hold, seed como template de
segmento, `PaymentProvider`/Asaas Pix, `reservation_payments`, webhook com as
oito regras da seção 8, job de reconciliação.

**Fase 3 (antiga), tarefas 1 a 8**: auth + `proxy.ts`; calendário nativo em uma
query; painel sobreposto de detalhe e cancelamento; CRUD de experiências;
formulário público de 6 passos; termo com rolagem obrigatória e contato de
emergência; tela de status com polling; CRUDs operacionais de agenda. A 9ª
(agenda compartilhada `/agenda/[token]`) é corte acordado.

**Entregue e agora registrado** (parte já documentada em 24/08, consolidada aqui):

- **`/admin/agendamentos`** — lista consultável de reservas com busca por nome ou
  telefone, filtros de status e período, somente leitura (`a7336fb`).
- **Sidebar no desktop, navbar preservada no mobile** — estado recolhido/expandido
  em cookie lido no servidor, sem flash; página ativa segue por prop
  (PR #2, `401e3d5` na `main`; `81f503b` era o commit da branch).
- **Etapa 1 da topologia de URL, COMPLETA** — LP em `/agendamento/[slug]` com
  **resolução real do tenant por slug** no banco (`findTenantBySlug` +
  `notFound()`), e a **raiz do app virou login** (307 para `/admin/login`).
- **Idade mínima do garupa por experiência** — 6 na Fazenda, 12 na Montanha,
  contada na **data do passeio**, validada no servidor e espelhada no wizard.
- **Mapa em iframe** na tela de confirmação (com link de fallback) e o **texto
  oficial do cliente** renderizado com quebras preservadas.
- **Toggle de mostrar/ocultar senha** no login (PR #3, `f0e62e0`).

## Migrations

- **Seis no disco**: `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`, `0004_tenant_slug`,
  `0005_min_passenger_age`.
- **Local**: as seis aplicadas (`drizzle.__drizzle_migrations` com 6 linhas).
- **Produção**: relatada como deployada; **o número exato de migrations aplicadas
  não foi verificado nesta sessão** (sem acesso ao painel). Conferir.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- **A 0001, a 0004 e a 0005 estão editadas à mão** e precisam continuar assim se
  regeradas — na 0005 o que se perde é o **backfill**, silenciosamente.

## Verificação obrigatória do backfill da 0005

Só faz sentido se a 0005 já subiu para produção (não confirmado):

```sql
SELECT id, name, min_passenger_age FROM experiences;
```

Esperado: `Trilha da Fazenda | 6` e `Trilha da Montanha | 12`. O backfill casa
por **nome**; se o nome divergir, as duas ficam com `0`, que significa **sem
idade mínima** — a migration passa, o boot passa, e o sistema aceita criança de
qualquer idade sem nada acusar erro.

## Testes

`npm test`: **18 arquivos, 144 casos, todos passando**.

Grupo **R** (`tests/r-idade-garupa.test.ts`, 9 casos) cobre a idade do garupa e o
mapa. O caso **R4** é o que trava o "conserto" errado: ele afirma que a criança
tem um ano a menos **hoje** e mesmo assim aceita a reserva, então alinhar as duas
regras de idade na data da reserva o quebra com mensagem que aponta para a regra.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e reconciliado com o template.
**15 settings**, com **apenas `support_whatsapp` vazia** — o número já chegou
(+55 19 99901-5663) e precisa entrar **no template e no banco**, pela regra das
duas casas. Há 6 reservas de demonstração do `db:seed:demo` (movimento, zerado
por `npm test`).

## Deploy

`origin/main` = `main` local = **`6d51c0c`**. Produção relatada como deployada,
com chave de produção do Asaas e banco limpo. Deploy segue manual (clique em
Implantar no Easypanel); sem CI/CD.

## Pendências e dívidas conhecidas

**Bloqueiam a Fase 0 / Fase D (dependem do cliente)**
- **Percentuais reais da maquininha por modalidade** (débito, crédito à vista,
  crédito parcelado): **não enviados**. Não inventar — taxa chutada vira número
  com aparência de certo e o erro só aparece na conferência com o extrato.
- **Preço cheio da Trilha da Fazenda**: 249,99 ou 249,00? O indício aritmético é
  forte (249,99 − 7% = 232,49 exatos, o valor citado pelo cliente), mas é indício.

**Do redesenho de 25/08**
- **`experiences.deposit_percent` / `deposit_fixed_cents` divergem da regra
  nova.** As colunas são **por experiência**; a regra fixa o sinal em **50%**.
  Não resolvido em código — a Fase B decide se somem, viram default ou passam a
  ser ignoradas. Até lá, vale a seção 4-B.
- **Contradição no texto oficial**: promete reagendamento com 48h de antecedência
  mas não diz **como**. Como nunca há devolução, a cláusula só faz sentido como
  direito de **remarcar**, e o texto precisa dizer que é pelo WhatsApp. Entra no
  Termo v2.
- **Chargeback** não tem estado na máquina de estados (seção 5). Reserva
  `confirmed`, realizada, com pagamento revertido é combinação que hoje não
  existe. Fase E.
- **A tela do CRUD de experiências precisa mostrar cheio e com desconto.** Com o
  valor cheio cadastrado, o dono digita 349,99 achando que é o que recebe.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- **Etapa 2 não feita.** `getTenantId()` devolve 1 fixo. A barreira
  `assertResolvedTenantIsCurrent()` impede divergência em silêncio.
- Critério de conclusão: poder **apagar** aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Verificação que não foi feita**
- **Estado real de produção** (commit, migrations, webhook) não conferido nesta
  sessão.
- **As telas do admin nunca foram renderizadas em navegador autenticado** —
  calendário, agendamentos, experiências, CRUDs e a sidebar nova. `/admin/*` está
  atrás do login e só existe o hash da senha.
- O passo 4 do wizard (onde a mensagem de idade aparece) não foi exercitado em
  navegador; a regra foi provada por teste de integração.

**Fluxo de venda**
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- Termo sem checagem de versão vigente no servidor; o termo **não** menciona a
  idade mínima do garupa.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor —
  **vale reavaliar antes do vídeo**, que é justamente um evento de pico.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `receiveInCash` não implementado (vira Fase D, agora com líquido e taxa).

**Dívida técnica registrada de propósito**
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`
  (22/08). O adiamento do lançamento abriu janela para pagar essa dívida.

**Gerais**
- Sem CI/CD; deploy é clique manual.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá: 3 avisos no build.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo de outubro torna
  isto mais relevante do que era**.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais já mergeadas, podem ser apagadas: `feat/tenant-slug`,
  `feat/idade-e-mapa`, `feat/admin-sidebar`.

## Prazo

**Setembro**: sistema pronto (Fases 0 e A..E). **Início de outubro**: uso real,
com o vídeo do @grandecampinas. O risco mudou de natureza — não é mais "chegar a
tempo", é **chegar testado com gente real antes do pico**.
