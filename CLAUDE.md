# CLAUDE.md — Aventix · Plataforma de Agendamento de Experiências (aventix.com.br)

> Produto: **Aventix**. Cliente 1 (e único no MVP): **Quadri Club**.
> Documento-fonte do projeto. Leia por completo antes de escrever qualquer código.
> Se algo neste documento conflitar com uma sugestão sua, este documento vence.
> Escopo travado: implemente **apenas** o que está na seção MVP.
>
> **Revisão 7 (25/08/2026)** — **o modelo de pagamento foi redesenhado e o
> lançamento foi adiado.** O cliente viu o sistema apresentado e decidiu só
> lançar quando **todas as formas de pagamento** estiverem prontas — o combinado
> anterior era lançar só com Pix integral. Consequências:
> (a) **Seção 4-B (nova)** — preço cheio na experiência, **desconto configurável
> no Pix**, cartão sem acréscimo, sinal de 50% só no Pix, arredondamento,
> configuração financeira em **tabela própria** e **valores congelados** no
> registro do pagamento.
> (b) **Seção 4-C (nova)** — política de cancelamento, no-show e reagendamento.
> (c) **Seção 17 refeita** — faseamento novo (Fase 0 e A..E). Sistema pronto em
> **setembro**; uso real no **início de outubro**, quando sai o vídeo do
> influenciador @grandecampinas e todos os leads caem de uma vez.
> (d) O **go-live de 24/08 não aconteceu**, embora o sistema esteja em produção
> e o ciclo do dinheiro tenha sido validado com **dinheiro real** naquele dia.
>
> **Atualização de 28/08/2026 (dentro da rev 7, não é revisão nova):**
> (0) **Fases 0, A e B CONCLUÍDAS e validadas em produção com dinheiro real.** A
> experiência guarda o preço cheio, o Pix desconta 7%, e o sinal de 50% existe —
> com a combinação `confirmed` + `partial`, que a seção 5 não previa. O **texto
> oficial do cliente** entrou (seção 4.2); antes disso a tela sempre mostrou o
> placeholder, apesar de a documentação afirmar o contrário.
> (a) **Fase 0 CONCLUÍDA** — configuração financeira em tabela própria (migration
> 0006), com as três decisões de desenho da seção 4-B.6 (basis points, duas
> tabelas, ausência assimétrica) valendo para as Fases A..E.
> (b) **Preços cheios confirmados** pelo cliente: Montanha R$ 349,99, Fazenda
> R$ 249,99 (seção 4-B.1).
> (c) **Armadilha nova e grave na seção 19** — o seed **nunca roda em produção**;
> migration aplicada não é dado semeado. Custou quatro dias com o mapa invisível.
>
> **Atualização de 31/08/2026 (dentro da rev 7, não é revisão nova):**
> (0) **Fase D CONCLUÍDA** — migration 0008 congela bruto, modalidade, percentual
> e líquido na linha do pagamento, mais o rastro de quem declarou. **A regra de
> "recusar registro sem taxa" foi REVERTIDA** (seção 4-B.6): recusar não impede
> o dinheiro de ter sido recebido, só impede o sistema de saber.
> (a) **Fase C CONCLUÍDA e verificada contra o Asaas sandbox.** Cobrança do saldo
> sob demanda, idempotente por construção — **seção 8-D nova** com as três
> camadas. **Não exigiu migration.**
> (b) O **reconciliador parou de gritar** sobre `balance` sem cobrança (estado
> esperado); `deposit`/`full` sem id **continuam avisando**, porque são a borda 9
> e há 3 reservas assim em produção.
> (c) **Medido e incorporado ao desenho:** duas leituras concorrentes do mesmo QR
> fazem o Asaas responder 400. Nada era duplicado, mas a mensagem dizia "o
> provedor recusou a cobrança" — falso, e lido pelo dono com o cliente na frente.
> (d) **Termo v2 publicado** (`quadriciclo-v2.ts`, `TERM_VERSION '2026-08-31'`):
> a §5 nova traz pagamento, não devolução, no-show e remarcação em 48h pelo
> WhatsApp, encerrando a lacuna ativa da seção 10 e a contradição da seção 4-C.
> (e) **`deposit_policy_text` fica como ponto de extensão não implementado**, e
> a política que **vincula** o cliente mora no corpo do termo — porque termo é
> versionado e setting é editável sem gerar versão (seção 10).
>
> **Atualização de 01/09/2026, parte 2 (área nova de trabalho):**
> (0) **O faseamento de pagamento acabou, e a área seguinte é AUTONOMIA DO
> TENANT** (seção 17). O enquadramento mudou: o Quadri Club é o **primeiro**
> cliente, não **o** cliente.
> (a) **O seed deixou de reconciliar `experiences`** (insert-only), e passou a
> **relatar** o que não corrige. Isso fecha a AUT-4 e é infraestrutura das
> outras três. `settings` e `resources` seguem reconciliando **por falta de
> tela**, não por princípio — seção 19.
> (b) **A decisão de 09/08 sobre o termo foi REABERTA** (AUT-1): editor no
> admin, com a restrição de versionamento imutável da seção 10.
>
> **Atualização de 01/09/2026 (dentro da rev 7, não é revisão nova):**
> (0) **Fase E CONCLUÍDA — o faseamento de pagamento da rev 7 ACABOU.** Cartão de
> crédito pela `invoiceUrl` (4-B.8), estados de análise de risco e chargeback
> (4-B.9). Migration 0009. **Ainda em branch, não deployado.**
> (a) **Achado que definiu a fase:** os seis status de estorno/chargeback já eram
> traduzidos por `toPaymentState` e **descartados sem tocar no banco** — pior que
> não implementado, porque *parecia* implementado a quem lesse a tradução.
> (b) **Chargeback NÃO muda `reservations.status`.** A reversão é derivada de
> `recalcReservationPayment`, sem coluna nova, e a disputa ganha volta sozinha
> porque `processCharge` converge para o provedor em vez de aplicar transições.
> (c) **O CHECK do líquido da Fase D barrava o próprio Asaas** (era bicondicional
> e exigia modalidade de maquininha). A 0009 troca pela implicação, e isso
> encerrou a tarefa transversal do líquido.
> (d) **`charge_stage` (enum novo) é vocabulário de EXIBIÇÃO e não decide nada** —
> os cinco estados intermediários do cartão colapsam em `pending`.
> (e) **O hold de 15 min NÃO foi estendido** para análise de risco: falta o dado
> de frequência real, que outubro dá. Está na lista de observação.
>
> **Revisão 6** — pagamento com sinal + robustez da integração Asaas:
> (a) **Pagamento parcial (sinal)** configurável por experiência: cliente paga um percentual/valor no ato e o saldo é cobrado presencialmente no dia. Motivação real: parceiro Aventurando (compra coletiva do mesmo segmento e ticket) reportou abandono no checkout por receio de golpe ao pagar o valor integral.
> (b) **Nova tabela `reservation_payments`** (uma reserva → N pagamentos). Os campos de pagamento saem de `reservations`.
> (c) **Regras de robustez do webhook Asaas** (seção 8), derivadas da documentação oficial: HTTP 200 exato, sem redirect, resposta rápida com processamento assíncrono, validação tolerante, cobrança órfã ignorada.
> (d) **Job de reconciliação** (seção 8-B) como rede de segurança contra fila de webhook interrompida.
> (e) **Pré-requisitos operacionais do Asaas** (seção 18) — dependem do cliente, não do código.
>
> **Revisão 5.1** — seção 11-B: seed como template de segmento; form builder proibido.
> **Revisão 5** — nome e domínio: Aventix / aventix.com.br. Regra de marca: "Aventix" é a plataforma (repo, admin, infra); a UI pública exibe a marca do **tenant** (`settings.business_name`), nunca "Aventix" no lugar da marca do cliente.
> **Revisão 4** — modelagem genérica (resources/experiences/reservation_resources, capacity, tenant_id, price_mode, labels em settings); calendário nativo; agenda compartilhada por link secreto; campo `channel`.

---

## 1. Contexto do projeto

**Aventix** é um sistema de agendamento online de **experiências que alugam recursos por horário**. O cliente final escolhe uma experiência, quantos recursos quer, um horário, informa os participantes, **aceita o termo de responsabilidade** e paga via **Pix** — integral ou **sinal**, conforme configuração. A reserva confirma automaticamente quando o pagamento devido cai; cliente e agendamento ficam cadastrados. O dono opera por um painel com **calendário nativo**, cobra saldos pendentes no dia e pode compartilhar a agenda (somente leitura) com parceiros por link secreto.

**Modelo de negócio:** software vendido pela Neosoluti por assinatura. O dinheiro das reservas flui direto para a conta **do tenant** no Asaas. O sistema **nunca** toca no dinheiro, nunca é intermediário de recebíveis.

### Regras físicas do negócio (tenant Quadri Club)

- **2 recursos** (quadriciclos), fungíveis. `capacity = 2` (1 piloto + 1 garupa).
- **2 experiências**, com durações e preços diferentes. **Preço por recurso** (`price_mode = per_resource`).
- O cliente **escolhe quantos recursos** alugar (1 até o nº de recursos ativos). Preço = `preço × nº de recursos`.
- **2 operadores podem alugar 1 recurso e revezar.** Logo, nº de recursos é escolha do cliente, nunca derivado do nº de operadores.
- Composição (validada no servidor): `nº de operadores >= nº de recursos`; `nº de participantes <= capacity × nº de recursos`.
- **Operador exige documento** (config: exigido = sim, label = "CNH"). Documento físico conferido no dia.
- **Termo de aceite digital** antes de agendar (seção 10).
- **Buffer** entre reservas no mesmo recurso, configurável por experiência.
- **Exclusividade de experiência por horário (configurável por tenant):** quando ativada (`settings.single_experience_per_slot=true`), o tenant não permite duas **experiências diferentes** com períodos sobrepostos — só uma trilha "rodando" por vez. A **mesma** experiência pode ter reservas sobrepostas, limitada apenas pela disponibilidade de recursos (quadris). Desligada (default do produto), vale só a disponibilidade por recurso. O **Quadri Club opera com ela ligada**.

### Regra de pagamento (rev 7 — o detalhe todo está na seção 4-B)

> **A rev 7 substituiu o desenho de preço e de formas de pagamento.** O que vale
> hoje: a experiência cadastra o **valor cheio**, o **Pix tem desconto**
> configurável por tenant, o cartão paga o cheio **sem acréscimo**, e o sinal é
> **50% fixo, só no Pix**. Nada disso é opcional para quem for implementar —
> leia a **seção 4-B** antes de tocar em preço, cobrança ou checkout.

Cada experiência tem um **modo de pagamento** configurável, que define o que é
**oferecido** ao cliente:

- **`full`** — cliente paga 100% no ato para confirmar. Padrão.
- **`deposit`** — cliente pode pagar um **sinal** no ato; o **saldo** é cobrado presencialmente no dia do passeio.

Regras invioláveis do modo `deposit`:
- A reserva **confirma com o sinal pago**. O saldo em aberto **não** bloqueia a reserva nem libera a vaga.
- O saldo tem **duas formas de quitação**: cobrança online no dia (QR Code/fatura Asaas) ou **registro de recebimento por fora** (maquininha/dinheiro), via `receiveInCash`.
- **Nunca** deixe o saldo fora do sistema. Mesmo recebido por fora, ele é registrado — o dono não pode ter reserva com pendência invisível.
- Sinal é, por padrão, **não reembolsável** em cancelamento pelo cliente (política do tenant, configurável em settings como texto do termo). Estorno é **manual** no MVP (seção 8-C).

---

## 2. Stack

- **Runtime:** Node.js 22 LTS + TypeScript. **Framework:** Next.js 16 (App Router, Turbopack default) — público, admin e API no mesmo repo.
- **Banco:** PostgreSQL (Docker no VPS). Requer `btree_gist`. **ORM:** Drizzle, migrations versionadas.
- **Pagamento:** **Asaas**, **Pix e cartão de crédito**. Conta do tenant. Atrás de `PaymentProvider`. O cartão paga na **fatura hospedada do provedor** (`invoiceUrl`), nunca por formulário nosso — seção 4-B.8.
- **Termo:** aceite digital próprio. Sem plataforma de assinatura externa.
- **Notificações:** **e-mail via Resend no MVP.** WhatsApp (Evolution) pós go-live.
- **Calendário:** **nativo**. Google Calendar = espelho opcional pós go-live.
- **Deploy:** VPS Hostinger (4GB) gerenciado via **Easypanel** — build a partir do `Dockerfile` do repo (`docker-compose.dev.yml` serve só para desenvolvimento local; não há compose em produção). Easypanel administra Traefik, domínio e SSL automaticamente. Postgres como serviço isolado, sem porta pública. **O Easypanel injeta sua própria variável `PORT` em runtime, sobrescrevendo o Dockerfile** — as rotas de domínio devem apontar para a porta real do log de boot, não para o valor fixado no Dockerfile.

### Fonte da verdade

O **Postgres é a única fonte da verdade** sobre disponibilidade e sobre o estado financeiro da reserva. O Asaas é a fonte da verdade sobre o **status de cada cobrança** — por isso o webhook nunca é acreditado sozinho: sempre reconsulte a API (seção 8).

---

## 2-B. Topologia de URL

> **Revisão de 23/08 (branch `feat/tenant-slug`, experimental).** A Etapa 1 foi
> feita, e feita **diferente** do que esta seção previa. O texto abaixo substitui
> a versão que mandava usar pasta literal `quadriclub`; o porquê da mudança está
> em `docs/DECISOES.md`.

**Estado final pretendido:**

| Host | Serve |
|---|---|
| `aventix.com.br` | site comercial do Aventix (ainda não existe) |
| `app.aventix.com.br` | a plataforma |

**Endereços na plataforma:**

- `app.aventix.com.br/` — **LOGIN da plataforma** (307 para `/admin/login`).
  A raiz **não pertence a tenant nenhum** e **nunca** redireciona para
  agendamento: mandar a raiz para a LP de um cliente específico é o mesmo erro
  escondido atrás de um redirect, e só apareceria no dia do segundo cliente.
- `app.aventix.com.br/agendamento/{slug}` — LP pública do tenant. Slug do
  Quadri Club: `quadriclub`.
- `app.aventix.com.br/reserva/{id}` — QR + polling. **Fica na raiz, fora do
  slug**, e é deliberado: o uuid já é credencial única e global, o endereço não
  é divulgado (o cliente chega por `router.replace` vindo do wizard), e movê-lo
  não compraria nada além de risco.
- `app.aventix.com.br/admin` — painel.
- `app.aventix.com.br/api/*` — API. **Não recebe prefixo de slug**, em nenhuma
  etapa. Tenant se resolve por corpo/sessão, nunca por segmento de URL aqui.

**Etapa 1 — FEITA em 23/08 (metade estrutural).** A LP vive em
`app/(public)/agendamento/[slug]/page.tsx`, `tenants` ganhou coluna `slug`
(migration 0004, `NOT NULL UNIQUE`), e a página **resolve o tenant no banco**:
`findTenantBySlug()` + `notFound()` para slug desconhecido.

`[slug]` dinâmico, **não** pasta literal. O argumento antigo a favor da pasta
literal — "slug desconhecido responde 404 de graça; `[slug]` sem guarda serviria
o Quadri Club para qualquer coisa" — está certo **na segunda metade**, e é a
guarda que o resolve. Com ela, `[slug]` dá o mesmo 404 e ainda entrega o que a
pasta literal não entrega: o slug deixa de ser **decorativo** e passa a resolver
o tenant de verdade, que é o ponto da etapa.

**Etapa 2 — NÃO FEITA. É onde mora o risco.** `getTenantId()` (`lib/tenant.ts`)
continua devolvendo `1` fixo, e é ele que governa **todas** as consultas de
negócio. Com um tenant só, URL e sistema concordam. Com dois, divergem em
silêncio: `/agendamento/{slug-do-cliente-2}` renderiza a página certa e serve,
por baixo, o catálogo, os horários e as reservas do Quadri Club — sem exceção,
sem log, sem nada quebrado na tela.

A Etapa 2 é: `getTenantId()` resolvendo o tenant da requisição, e os fluxos **sem
requisição** ganhando caminho próprio — `lib/jobs/expire-holds.ts` (cron de 1 min)
é o único que chama `getTenantId()` sem HTTP e precisa passar a iterar tenants.
(`reconcile-payments.ts` não usa tenant; os dois scripts de seed declaram o id
localmente.)

**Barreira enquanto a Etapa 2 não vem:**
`lib/tenant-slug.ts` → `assertResolvedTenantIsCurrent()` **lança** se a URL
resolver um tenant diferente do que `getTenantId()` devolve, e a LP se recusa a
renderizar. Provado em `tests/o-barreira-multi-tenant.test.ts`.
**Poder APAGAR essa função é o critério de conclusão da Etapa 2** — enquanto ela
precisar existir, a Etapa 2 não terminou.

**Regras invioláveis desta topologia:**

1. **Nenhum redirect é permanente.** `permanent: false` (307). Um 308 fica
   cacheado no navegador praticamente para sempre e sequestra o endereço quando
   o site comercial nascer. Vale para o redirect da raiz: use `redirect()`
   (emite 307), **nunca** `permanentRedirect()`.
2. **O redirect de host do apex exclui `/api/`** (`source: '/:path((?!api/).*)'`).
   O Asaas não segue redirect — ver seção 8.1. Relaxar esse regex derruba a fila
   do webhook. (Esse redirect **ainda não existe**; é pós go-live.)
3. **O redirect de host mora em `next.config.ts`, não em `proxy.ts`.** O
   `proxy.ts` é a barreira de autenticação (seção 13) e seu `matcher` fica
   escopado em `/admin` e `/api/admin`; alargá-lo por motivo de roteamento
   mistura duas responsabilidades e põe o login em risco por uma mudança de URL.
4. **A URL de produção do webhook é `https://app.aventix.com.br/api/webhooks/asaas`**,
   exata, sem barra final. Substitui a URL antiga no apex.
5. **O slug é ENDEREÇO, não rótulo.** `UNIQUE` no banco, e o seed **nunca** o
   reescreve — só insere quando o tenant não existe. Renomear slug é migration,
   não seed. A casa canônica é `SEED_TENANT_SLUG` em `lib/seed.ts`, junto de
   `SEED_TENANT_ID` e `SEED_TENANT_NAME`; **não** vai no template, que é dado de
   *segmento* e precisa ser reutilizável pelo próximo cliente do mesmo ramo.

---

## 3. Convenções

- **Timezone:** `America/Sao_Paulo` fixo. `timestamptz` (UTC) no banco; conversão só na grade e na exibição.
- **Serialização de datas:** o schema usa `timestamp mode:'string'`, então o driver devolve o **texto cru do Postgres** (`2026-07-27 23:09:14.518994-03`): espaço no lugar do `T`, offset sem minutos, microssegundos. Toda função de `lib/` que devolva `timestamptz` para a camada de API converte para **ISO 8601** (`new Date(v).toISOString()`). O V8 tolera o formato cru, outros motores devolvem `NaN` — o sintoma aparece só no navegador do cliente. Colunas `date` (`birthdate`, `due_date`) já saem como `YYYY-MM-DD` e **não** passam por `new Date()`.
- **Dinheiro:** inteiro em centavos. Nunca float. Nunca calcule preço no cliente. A conversão para a unidade do provedor de pagamento (reais com decimal) passa **só** por `lib/payments/money.ts`, que faz manipulação de string sobre o inteiro — `cents / 100` erra em alguns valores e o erro aparece na serialização, virando um centavo de diferença entre o que o banco diz e o que o cliente paga.
- **Valores com `$` no `.env`:** o `@next/env` aplica expansão de variáveis, e valores contendo `$` chegam **vazios ou truncados** dentro do Next. Aspas simples **não** protegem — só o escape `\$` funciona. Afeta `ADMIN_PASSWORD_HASH` (bcrypt) e `ASAAS_API_KEY` (chaves Asaas começam com `$aact_`). O sintoma é sempre "autenticação inválida", nunca "variável mal formatada" — por isso todo módulo que lê chave crítica tem **fail-fast no boot** distinguindo "ausente" de "presente mas vazia". Medido: `dotenv` puro (scripts, testes) lê certo mesmo sem escape, o que faz o problema aparecer **só dentro do Next**. **A regra NÃO se estende ao Easypanel:** o editor de variáveis do painel passa o valor literalmente ao container, então escapar lá grava a contrabarra DENTRO do valor e quebra a autenticação — armadilha medida em 21/08, detalhada na seção 19. Detalhe do hash bcrypt na seção 13.
- **Multi-tenant-ready:** `tenant_id NOT NULL DEFAULT 1` em toda tabela de negócio; toda query filtra por tenant.
- **Labels/textos de UI** sempre de `settings`, nunca hardcode.
- **Segredos** em `.env`. **IDs** de negócio: UUID. **Código em inglês, UI em português.**
- **Testes (`npm test`, Vitest em `/tests`):** rodam contra o Postgres local de verdade, não contra mock. O **catálogo semeado** (`npm run db:seed`) é pré-condição e nunca é apagado; as tabelas de **movimento** são zeradas antes de cada teste e ao fim da suíte. **Nunca mocke o relógio do Node** (`vi.useFakeTimers` é proibido): o sistema usa `now()` do banco de propósito, então lead time e expiração se testam manipulando dados (`hold_expires_at` no passado, `start_at` explícito). Setting alterada em teste exige `invalidateSettingsCache()` e restauração no teardown, por causa do TTL de 60s.
- Entregue blocos de código completos, não diffs.

---

## 4. Modelo de dados

### 4.1 Extensão e enums

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM ('pending_payment','confirmed','cancelled','expired');
CREATE TYPE payment_method AS ENUM ('pix','card');              -- 'card' entrou na Fase E
CREATE TYPE participant_role AS ENUM ('operator','passenger');
CREATE TYPE price_mode AS ENUM ('per_resource');                -- 'per_person' e futuro
CREATE TYPE payment_mode AS ENUM ('full','deposit');            -- rev 6
CREATE TYPE payment_kind AS ENUM ('full','deposit','balance');  -- rev 6: papel de cada cobranca
CREATE TYPE payment_state AS ENUM ('pending','paid','cancelled','refunded');       -- por cobranca
CREATE TYPE reservation_payment_state AS ENUM ('pending','partial','settled');     -- agregado da reserva

-- rev 7 / Fase E: ESTAGIO da cobranca no provedor. VOCABULARIO DE EXIBICAO.
-- >>> NAO DECIDE NADA. <<< Quem governa dinheiro e payment_state. Isto existe
-- porque os cinco estados intermediarios do CARTAO (analise de risco,
-- autorizado-sem-captura, captura recusada) colapsam todos em 'pending' — o que
-- e o mapeamento seguro para DECIDIR e insuficiente para EXIBIR. Ver 4-B.9.
CREATE TYPE charge_stage AS ENUM
  ('aguardando','em_analise','recusado','pago','estornado','cancelado');
```

### 4.2 Tenant e configuração

```sql
CREATE TABLE tenants (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Chaves do MVP: resource_label, resource_label_plural, operator_label, passenger_label,
-- operator_document_required, operator_document_label, meeting_point, what_to_bring,
-- business_name, reply_to_email, support_whatsapp, deposit_policy_text
--  support_whatsapp: so digitos com DDI ('5511999998888'), para o link wa.me.
--  VAZIO e estado valido: a UI OMITE o bloco de contato, nunca renderiza rotulo
--  sem valor. Canal principal porque o tenant vende por ManyChat (secao 9).
--  single_experience_per_slot ("true"/"false", default "false"),
--  min_lead_minutes (inteiro >= 0 como string, default "60") — antecedencia minima para reservar
--  meeting_point: o TEXTO OFICIAL do tenant, MULTILINHA. No Quadri Club sao 6
--  paragrafos (check-in, documento e idade, regras, acidentes, remarcacao). A
--  tela intitula o bloco "Informacoes importantes", nao "Ponto de encontro": ele
--  deixou de ser endereco. AS QUEBRAS DE LINHA SAO CONTEUDO e precisam
--  sobreviver do template ao banco a tela (`whitespace-pre-line`); colapsa-las
--  vira parede de texto que ninguem le, sem erro nenhum aparecendo.
--  what_to_bring: VAZIO no Quadri Club de proposito — o texto acima ja cobre o
--  assunto, e duas redacoes do mesmo tema divergem na primeira atualizacao. A
--  chave FICA no tipo e no template: outro tenant do segmento pode usa-la, e a
--  tela omite o bloco (rotulo sem valor e pior que secao ausente).
--  meeting_point_map_url: URL de EMBED do mapa do ponto de encontro. SO A URL,
--  NUNCA HTML: settings e dado renderizado como TEXTO, e guardar marcacao
--  obrigaria a injeta-la crua na pagina (XSS). O <iframe> e montado no
--  componente, e a URL passa por lista de permissao http(s) (lib/maps.ts) antes
--  de virar src. VAZIO e estado valido: a tela omite o bloco do mapa.
CREATE TABLE settings (
  tenant_id int NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
```

### 4.3 Catálogo

```sql
CREATE TABLE resources (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name text NOT NULL,
  capacity int NOT NULL DEFAULT 2 CHECK (capacity >= 1),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE experiences (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name text NOT NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes int NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  price_mode price_mode NOT NULL DEFAULT 'per_resource',
  price_cents int NOT NULL CHECK (price_cents >= 0),

  -- rev 6: modo de pagamento por experiencia
  payment_mode payment_mode NOT NULL DEFAULT 'full',
  deposit_percent int CHECK (deposit_percent BETWEEN 1 AND 99),  -- usado se payment_mode='deposit'
  deposit_fixed_cents int CHECK (deposit_fixed_cents > 0),       -- alternativa ao percentual

  -- Idade minima do GARUPA, em anos completos NA DATA DO PASSEIO (secao 4.6).
  -- 0 = sem idade minima. POR EXPERIENCIA, nunca constante: Quadri Club opera
  -- com 6 na Trilha da Fazenda e 12 na Trilha da Montanha.
  min_passenger_age int NOT NULL DEFAULT 0 CHECK (min_passenger_age BETWEEN 0 AND 120),
  CHECK (
    payment_mode = 'full'
    OR (deposit_percent IS NOT NULL) <> (deposit_fixed_cents IS NOT NULL)  -- exatamente um dos dois
  ),

  active boolean NOT NULL DEFAULT true
);

CREATE TABLE operating_hours (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=domingo
  opens time NOT NULL,
  closes time NOT NULL,
  CHECK (closes > opens)
);

CREATE TABLE blackouts (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  resource_id int REFERENCES resources(id),   -- NULL = todos
  period tstzrange NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.4 Cliente, reserva, alocação, participantes

```sql
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  cpf text,
  birthdate date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  experience_id int NOT NULL REFERENCES experiences(id),

  resources_needed int NOT NULL CHECK (resources_needed >= 1),
  total_price_cents int NOT NULL,
  start_at timestamptz NOT NULL,
  channel text,                          -- origem: NULL=direto; ex. 'aventurando'

  -- SNAPSHOT da venda, junto com total_price_cents e payment_mode.
  -- Congelam na criacao e NUNCA acompanham edicao posterior da experiencia.
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes int NOT NULL CHECK (buffer_minutes >= 0),

  -- rev 6: estado financeiro agregado (os pagamentos vivem em reservation_payments)
  payment_mode payment_mode NOT NULL,    -- snapshot de como foi vendido
  amount_paid_cents int NOT NULL DEFAULT 0,
  payment_state reservation_payment_state NOT NULL DEFAULT 'pending',

  termo_version text NOT NULL,
  termo_accepted_at timestamptz NOT NULL,
  termo_accepted_ip text,
  termo_accepted_user_agent text,

  -- Quem acionar em caso de necessidade durante o passeio (passo 5 do
  -- formulario publico, junto ao termo). NULLABLE de proposito (migration 0002):
  -- reserva anterior a esta funcionalidade nao tem o dado e nao ha como
  -- retroagir. Obrigatorio para reserva NOVA na aplicacao (rota + createReservation),
  -- nunca no banco -- mesma regra que NAO deu NOT NULL a duration_minutes/buffer_minutes
  -- quando a 0001 entrou.
  emergency_contact_name text,
  emergency_contact_phone text,

  status reservation_status NOT NULL DEFAULT 'pending_payment',
  hold_expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX idx_reservations_status_hold ON reservations (status, hold_expires_at);
CREATE INDEX idx_reservations_start ON reservations (tenant_id, start_at);
CREATE INDEX idx_reservations_customer ON reservations (customer_id);

-- Trava anti-overbooking. status ESPELHA reservations.status.
CREATE TABLE reservation_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  resource_id int NOT NULL REFERENCES resources(id),
  period tstzrange NOT NULL,               -- [start_at, start_at + duration + buffer)
  status reservation_status NOT NULL,
  EXCLUDE USING gist (
    resource_id WITH =,
    period WITH &&
  ) WHERE (status IN ('pending_payment','confirmed'))
);

CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  name text NOT NULL,
  birthdate date,
  role participant_role NOT NULL,
  document_number text                     -- exigido p/ operator conforme settings (validado no servidor)
);
```

### 4.5 Pagamentos da reserva (NOVO na rev 6)

Uma reserva tem **1 pagamento** (modo `full`) ou **2** (modo `deposit`: sinal + saldo).

```sql
CREATE TABLE reservation_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,

  kind payment_kind NOT NULL,              -- full | deposit | balance
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  method payment_method NOT NULL DEFAULT 'pix',
  state payment_state NOT NULL DEFAULT 'pending',

  asaas_payment_id text,                   -- id da cobranca no Asaas (pay_...)
  external_reference text NOT NULL,        -- "{reservation_id}:{kind}"  -> enviado ao Asaas
  due_date date NOT NULL,
  paid_at timestamptz,
  received_in_cash boolean NOT NULL DEFAULT false,  -- quitado por fora (maquininha/dinheiro)

  -- Fase D (migration 0008): registro da maquininha, CONGELADO (secao 4-B.7).
  card_machine_modality card_machine_modality,
  rate_basis_points_applied int,
  net_cents int,
  registered_by text,
  registered_at timestamptz,

  -- Fase E (migration 0009): estagio no provedor, para a TELA (secao 4-B.9).
  charge_stage charge_stage,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- >>> ERA BICONDICIONAL ATE A FASE E, E A BICONDICIONAL BARRAVA O ASAAS. <<<
  -- A regra da 0008 era `(rate IS NULL) = (net IS NULL)`: gravar liquido
  -- OBRIGAVA a gravar percentual e modalidade. Nasceu certa, porque o unico
  -- produtor de net_cents era a maquininha. O provedor INFORMA o liquido pronto
  -- (netValue) sem nenhum dos dois, entao a regra antiga obrigaria a INVENTA-los.
  -- A implicacao preserva o que ela protegia e libera o caso novo.
  CHECK (rate_basis_points_applied IS NULL
         OR (net_cents IS NOT NULL AND card_machine_modality IS NOT NULL))
);

CREATE UNIQUE INDEX idx_rp_asaas ON reservation_payments (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;
CREATE UNIQUE INDEX idx_rp_extref ON reservation_payments (external_reference);
CREATE INDEX idx_rp_reservation ON reservation_payments (reservation_id);
CREATE INDEX idx_rp_open ON reservation_payments (state, due_date) WHERE state = 'pending';
```

### 4.6 Invariantes do modelo (LEIA)

- **`reservation_resources.status` atualiza SEMPRE junto com `reservations.status`, na mesma transação.** Centralize em `setReservationStatus(id, status)`. É a denormalização exigida pelo `WHERE` da exclusion constraint.
- **`reservations.amount_paid_cents` e `payment_state` são derivados de `reservation_payments`** e recalculados na mesma transação em que um pagamento muda de estado. Centralize em `recalcReservationPayment(reservationId)`:
  - soma dos pagamentos `paid` → `amount_paid_cents`;
  - `0` → `pending`; `> 0 e < total` → `partial`; `>= total` → `settled`.
- **`period` inclui o buffer.** Fim exibido ao cliente = `start_at + duration`.
- **A reserva congela o que foi vendido.** `total_price_cents`, `payment_mode`, `duration_minutes` e `buffer_minutes` são gravados na criação a partir da experiência e **nunca** são relidos dela depois. Toda leitura de duração ou buffer de uma reserva existente (calendário, painel, e-mail, recibo) sai de `reservations`, **jamais de um JOIN com `experiences`** — ler do JOIN faz uma edição de catálogo redesenhar retroativamente reserva já vendida. A vaga ocupada (`reservation_resources.period`) já era congelada, então o erro não produz overbooking: produz tela mentindo, nas duas direções. Quem lê da experiência **atual** e está certo assim: `lib/availability.ts` e o cálculo do `period` em `createReservation`, porque reserva **nova** usa a duração vigente.
- **`resources_needed` é escolha do cliente**; teto = recursos ativos (validação no app, não em CHECK).
- **Preço e valor do sinal são calculados no servidor.** `deposit = round(total × deposit_percent/100)` ou `deposit_fixed_cents`; `balance = total − deposit`. Nunca confie em valor vindo do cliente.
- **>>> AS DUAS REGRAS DE IDADE USAM BASES DE DATA DIFERENTES, DE PROPÓSITO. <<<** O **condutor** precisa de 18 anos na **data do agendamento** (habilitação legal/CNH; regra simples escolhida em 17/08). O **garupa** precisa de `experiences.min_passenger_age` na **data do passeio** (`start_at`), porque é segurança operacional e a criança que completa a idade entre reservar e viajar pode ir. Ler os dois lado a lado sugere descuido; **não alinhe um ao outro** — alinhar em `start_at` passaria a aceitar condutor que faz 18 no intervalo, o que é mudança de comportamento em regra legal e pede decisão própria (`docs/DECISOES.md`, 2026-08-24). Ambas as regras são **fail-closed**: sem `birthdate` o participante é recusado, nunca ignorado. A idade sai de `ageOnDate()` (`lib/time.ts`), aritmética de calendário pura — construir `Date` aqui reintroduz a armadilha de UTC de 17/08.
- **`external_reference` é único e determinístico** (`"{uuid}:{kind}"`). É o que permite reconciliar mesmo se o `asaas_payment_id` se perder.
- Find-or-create de `customers` por `(tenant_id, phone)`.
- **Experiência gratuita não é suportada no MVP.** `price_cents = 0` produz `total = 0`, e a cobrança violaria `CHECK (amount_cents > 0)` na criação (erro 500); em `recalcReservationPayment` a reserva ficaria `pending` para sempre. O CRUD de experiências (Fase 3) deve recusar preço zero. O `CHECK (price_cents >= 0)` do schema fica como está — apertar para `> 0` exigiria migration e não se justifica antes do go-live.
> **Regra de arquitetura inviolável:** a garantia do `FOR UPDATE` (trava de linha contra corrida entre cron e webhook) só existe enquanto **todo caminho de escrita de status passar por `setReservationStatus`**. Um `UPDATE reservations SET status` direto em qualquer outro lugar fura a trava e quebra a proteção contra double-booking silenciosamente. Nunca atualize `reservations.status` ou `reservation_resources.status` fora dessa função.

---

## 4-B. Modelo de pagamento (rev 7 — 25/08/2026)

> Substitui o desenho anterior de preço e formas de pagamento. Vale sobre
> qualquer texto conflitante em outra seção.

### 4-B.1 Preço: o cheio é o cadastrado; o Pix é que é mais barato

A experiência cadastra o **valor cheio**. O desconto do Pix é **configurável por
tenant** (7% no Quadri Club) e o cartão paga o cheio.

- **Trilha da Montanha:** R$ 349,99 cheio → Pix (−7%) R$ 325,49.
- **Trilha da Fazenda:** R$ 249,99 cheio → Pix (−7%) R$ 232,49.

**Confirmados pelo cliente em 28/08.** Antes disso a Fazenda era hipótese
sustentada por aritmética (249,99 − 7% = 232,49 exatos, enquanto 249,00 daria
231,57), e a confirmação bateu com o indício.

**>>> NÃO EXISTE TAXA SOMADA AO CLIENTE. <<<** O cartão **não** fica mais caro;
o Pix fica mais barato. A diferença é a mesma, mas a leitura na tela não é: um
acréscimo no cartão é percebido como punição e derruba conversão, além de
esbarrar na expectativa (e na leitura corrente do CDC) de que o preço anunciado é
o preço a pagar. Quem for implementar **nunca** deve calcular "cheio + taxa".

### 4-B.2 As três formas de pagar

Exemplo com a Trilha da Montanha (cheio R$ 349,99, desconto Pix 7%):

| Forma | Cobrado agora | No dia | Total pago |
|---|---|---|---|
| Pix integral (−7%) | R$ 325,49 | — | R$ 325,49 |
| Pix sinal 50% (−7%) | R$ 162,75 | R$ 162,74 | R$ 325,49 |
| Cartão integral | R$ 349,99 | — | R$ 349,99 |

Regras que a tabela não mostra e que são invioláveis:

- **O sinal é 50% fixo.** Não é configurável por experiência.
- **Sinal existe SOMENTE no Pix.** Não há sinal no cartão. A combinação é
  **recusada no servidor** (`422`) antes de qualquer escrita, nunca rebaixada
  para integral em silêncio — rebaixar cobraria agora o dobro do que a tela
  mostrou. No wizard ela sequer é representável: a escolha é **um valor só**
  (`pix_full | pix_deposit | card`), e não duas dimensões que podem se combinar
  errado.
- **O cartão paga o cheio porque NÃO TEM linha de desconto**, jamais por
  acréscimo. `getDiscountBasisPoints('card')` devolve `0` e o cliente paga
  `full_price_cents`. Não existe campo de acréscimo em lugar nenhum do schema.
- **O desconto do Pix incide TAMBÉM sobre o sinal**: o sinal é 50% de **325,49**
  (o valor já com desconto), nunca 50% de 349,99. Calcular sobre o cheio faria o
  cliente do sinal pagar mais que o do Pix integral, punindo justamente quem
  aceitou pagar antes.

> **A divergência com o schema foi RESOLVIDA na Fase B, separando escrita de
> leitura.** As colunas `deposit_percent` / `deposit_fixed_cents` (seção 4.3)
> continuam existindo e continuam sendo por experiência, mas o **CRUD não as
> expõe**: ele grava `deposit_percent = 50` fixo, e o dono só decide se a
> experiência aceita sinal. O **cálculo continua LENDO da coluna**, então há uma
> fonte só e uma linha gravada com outro percentual seguiria honrada em vez de
> silenciosamente recalculada. Apagar as colunas seria migration com perda de
> histórico, sem ganho.

### 4-B.3 Reserva com sinal pago: `confirmed` + `partial`

Reserva cujo **sinal** foi pago fica `status='confirmed'` com
`payment_state='partial'`.

**Por que não `pending_payment`:** a vaga **está garantida** e o recurso está
alocado — o saldo é pendência **financeira**, não reserva incompleta. Manter
`pending_payment` seria ativamente errado: o **cron de hold** (seção 12) expiraria
a reserva e **liberaria a vaga de quem já pagou metade**. O cliente perderia o
passeio por causa de uma classificação interna, tendo dinheiro nosso na conta.

### 4-B.4 Regra de modelagem: oferecido vs. cobrado

- **`experiences.payment_mode`** é atributo da **EXPERIÊNCIA** e define o que é
  **OFERECIDO** ao cliente.
- **O método escolhido no wizard** define o que é **COBRADO**.
- **`reservations.payment_mode`** (coluna **já existe**) guarda o modo
  **EFETIVO** daquela reserva.

Confundir os três produz o erro clássico de ler a experiência para saber como uma
reserva foi paga — e a reserva congela o que foi vendido (seção 4.6).

### 4-B.5 Arredondamento — regra inviolável

349,99 / 2 = **174,995**. Alguém fica com o centavo, e a única saída é decidir
quem, por construção.

- **A entrada arredonda para CIMA.**
- **O saldo é sempre `total − já pago`**, nunca "metade" calculada de novo.

Assim `entrada + saldo` fecha com o total **por construção, jamais por
coincidência**. Calcular as duas metades independentemente produz um par que
fecha na maioria dos valores e falha em alguns — e a falha aparece como um
centavo de diferença entre o que o sistema diz e o que o cliente pagou, no
extrato, semanas depois.

### 4-B.6 Configuração financeira: tabela PRÓPRIA, nunca em `settings`

**>>> NÃO PONHA ISTO EM `settings`. <<<** `seedTenant()` **sobrescreve** toda
linha de `settings` cujo valor divirja do template (armadilha das duas casas,
seção 19). O dono configuraria 7%, funcionaria por semanas, e o valor **sumiria**
no dia em que alguém rodasse o seed — sem erro e sem log, com o preço voltando
sozinho ao do template.

A tabela própria também separa **o que a Neosoluti define** do **que o dono
edita**, que hoje estão misturados em `settings`.

O que ela configura:

1. **Desconto por método** — Pix e cartão.
2. **Taxas da maquininha POR MODALIDADE** — débito, crédito à vista, crédito
   parcelado. **Tabela, não campo único:** a taxa muda com a modalidade, e um
   campo só produziria número errado com **aparência de certo**, que é pior que
   número obviamente errado.

#### O DDL (migration 0006, **implementado** em 28/08)

```sql
CREATE TYPE card_machine_modality AS ENUM ('debit','credit','credit_installment');

-- Desconto por metodo: afeta o PRECO QUE O CLIENTE PAGA.
CREATE TABLE payment_method_discounts (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  method payment_method NOT NULL,
  discount_basis_points int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, method),
  -- teto EXCLUSIVO: 100% zeraria o preco, e experiencia gratuita nao e
  -- suportada (secao 4.6) — a cobranca violaria CHECK (amount_cents > 0).
  CHECK (discount_basis_points >= 0 AND discount_basis_points < 10000)
);

-- Taxa da maquininha por modalidade: afeta QUANTO O TENANT RECEBE.
CREATE TABLE card_machine_rates (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  modality card_machine_modality NOT NULL,
  rate_basis_points int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, modality),
  -- teto INCLUSIVO, diferente do desconto: taxa de 100% e absurda mas nao
  -- quebra nada (liquido zero). O teto barra digito extra, nao julga contrato.
  CHECK (rate_basis_points >= 0 AND rate_basis_points <= 10000)
);
```

#### Três decisões de desenho que valem para as Fases A..E

**1. Percentual em BASIS POINTS inteiro (7% = 700), nunca `numeric` nem float.**
`numeric` é exato no banco, mas o node-postgres o entrega como **string**, e a
partir daí cada consumidor decide sozinho como transformar aquilo em conta. O
primeiro que escrever `Number(taxa) * cents / 100` reintroduz exatamente o ponto
flutuante binário que `lib/payments/money.ts` existe para impedir — e reintroduz
**invisivelmente**, porque o erro não aparece no número, aparece na serialização.
Com basis point a conta inteira fica em inteiros: `Math.round(cents * bp / 10000)`.
Custo assumido: um `SELECT` cru mostra `700`, que dá para ler como 700%; a defesa
é o nome da coluna, o CHECK e a tela, que sempre exibe percentual.

**2. Duas tabelas, não uma.** Desconto é **política de preço**, decidida pelo dono
e aplicada na venda. Taxa é **fato do contrato** com a adquirente, aplicado no
registro e congelado ali (4-B.7) — e é a que vai precisar crescer (validade ou
versão). Unificá-las exigiria chave `text` polimórfica (perdendo a garantia do
enum) ou colunas nuláveis com CHECK XOR no estilo de
`experiences_deposit_mode_check`.

**3. >>> AUSÊNCIA SIGNIFICA COISAS DIFERENTES NAS DUAS, E ISSO NÃO É DETALHE. <<<**
- **Desconto ausente = 0%** — o cliente paga o cheio. É *fail-safe*: entre as duas
  falhas possíveis, escolhe a que não dá abatimento que ninguém autorizou.
- **Taxa ausente = `NULL`, JAMAIS 0%.** Uma taxa zero é mentira que faz o líquido
  parecer igual ao bruto — número com aparência de certo, desmentido só na
  conferência com o extrato, semanas depois. O tipo de retorno de
  `getCardMachineRate` é `| null` exatamente para o compilador obrigar essa
  decisão no ponto de uso.

  **>>> O QUE A FASE D FAZ COM O `NULL` MUDOU EM 31/08. <<<** A rev 7 mandava
  **recusar** o registro. Foi revertido: a Fase D **REGISTRA**, gravando
  `net_cents = NULL`. **Por quê:** recusar não impede o dinheiro de ter sido
  recebido — impede só o sistema de saber, e isso viola a regra mais antiga e
  mais forte da seção 1, *"nunca deixe o saldo fora do sistema"*. Recusar também
  cria o incentivo para o guia, bloqueado em campo, abrir `/admin/financeiro` e
  **digitar um percentual chutado** (o login é único), produzindo exatamente o
  número errado com aparência de certo que a regra queria impedir. O que **não**
  mudou: **nunca gravar 0**. `NULL` é "não sei"; `0` é "não teve taxa".

  A permissão vem com **condição obrigatória**: `/admin/financeiro` exibe a
  contagem de registros sem líquido (`countReceiptsAwaitingNet`). Sem ela, teria
  se trocado uma falha visível por uma invisível. Preencher depois é operação
  **deliberada**, com o percentual histórico do extrato — nunca recálculo
  automático, que a 4-B.7 proíbe.

É essa assimetria que justifica as duas APIs terem formas diferentes: desconto é
**upsert por método** (sem create nem delete, porque "sem linha" e "0 bp" dizem o
mesmo); taxa é **POST/PUT/DELETE com 409 de duplicata**, que também impede
sobrescrever em silêncio um percentual já conferido com a adquirente.

**A aritmética vive em `lib/basis-points.ts`, módulo PURO. As Fases A..E REUSAM,
não reimplementam.** Ele já cobre desconto, taxa, a divisão parte/resto sempre por
subtração (a garantia da 4-B.5) e a conversão texto ↔ bp sem passar por float.
Uma segunda implementação "só para exibir" é como as duas metades divergem.

### 4-B.7 Valor líquido — regra inviolável

**Taxa muda com o tempo; registro de dinheiro NÃO pode mudar junto.**

No momento do registro, gravar **congelados na linha do pagamento**: valor
**bruto**, **modalidade**, **percentual aplicado** e **valor líquido**. Depois
disso o sistema só **LÊ**, nunca recalcula. A configuração vale para o **próximo**
registro, jamais para os anteriores.

**O que acontece sem isso:** em setembro registra R$ 150 a 5% e mostra R$ 142,50.
Em novembro a operadora reajusta para 6%, o dono atualiza a tela, e **a reserva
de setembro passa a mostrar R$ 141,00**. O passado muda sozinho e a conferência
com o extrato quebra — sem nada acusar erro.

**Para pagamentos que passam pelo Asaas, o líquido é LIDO do Asaas** (eles
informam na consulta da cobrança), não calculado. **Só a maquininha exige
cálculo**, porque acontece fora do provedor.

**IMPLEMENTADO na Fase E, e isto encerra a tarefa TRANSVERSAL do líquido.** O
`netValue` já vinha no corpo do webhook e na consulta; `processCharge` o grava no
**mesmo UPDATE** que marca o pagamento como pago, e **nenhum leitor recalcula**.
Grava **só quando o provedor informa**: sobrescrever um líquido conhecido com
`null` é perda de informação, a mesma distinção entre `NULL` e `0` da 4-B.6 um
nível acima.

**>>> `net_cents` TEM DUAS PROCEDÊNCIAS, E A MODALIDADE É QUE AS SEPARA. <<<**
Com `card_machine_modality` preenchida é maquininha, e o líquido foi
**calculado** por nós. Com ela nula, o líquido foi **lido** do provedor. É por
isso que `countReceiptsAwaitingNet` recorta por modalidade — sem esse recorte,
pagamento do Asaas apareceria como pendência da Fase D.

**IMPLEMENTADO na Fase D** (migration 0008), em `reservation_payments`:
`card_machine_modality`, `rate_basis_points_applied`, `net_cents`, mais o rastro
(`registered_by`, `registered_at`). Todas nuláveis, sem backfill. A escrita é
`lib/payments/receive-in-cash.ts`; **nenhum leitor recalcula**, e
`tests/w-maquininha.test.ts` (W4.1 e W4.3) trava isso pelos dois lados — a
coluna e o caminho de leitura.

**O RASTRO é obrigatório e sai da SESSÃO, nunca do corpo da requisição.** Este é
o único ponto do sistema em que alguém **declara** ter recebido dinheiro sem
prova externa: não há webhook, não há confirmação de terceiro. Sem `quem` e
`quando`, uma divergência de dinheiro entre o dev e o cliente não tem como ser
reconstituída.

### 4-B.8 Cartão: via `invoiceUrl` do Asaas, nunca formulário próprio

**IMPLEMENTADO na Fase E.** O cliente é **redirecionado para a fatura do Asaas** e
digita o cartão lá. **Não existe formulário de cartão dentro do wizard.**

**Método PRÓPRIO no provedor (`createCardCharge`), não `billingType` parametrizado.**
O que separa os dois não é o meio, é o **retorno**: `createPixCharge` busca o QR
numa chamada obrigatória logo após criar, e `PixCharge` exige `qrCodeBase64` e
`copyPaste` não-nulos. Cobrança de cartão não tem QR Pix — aquela busca falharia,
ou pior, devolveria algo que a tela renderizaria como um QR que nenhum banco lê.
`CardCharge.invoiceUrl` é **`string`, não nulável**, diferente de `PixCharge`: no
Pix a fatura é conveniência, no cartão ela **é** o caminho de pagamento, e tipá-la
assim obriga a falhar alto em vez de entregar um botão que leva a lugar nenhum.
**MEDIDO contra o sandbox em 01/09:** o Asaas aceita `billingType: CREDIT_CARD`
sem dados de cartão e devolve `invoiceUrl`.

**Por quê:** a documentação de PCI-DSS do Asaas diz que, na integração via API,
"os dados passam pelo back-end da sua aplicação" e "sua infraestrutura permanece
no escopo". E o Asaas **não oferece tokenização client-side** — não existe
componente JS deles que capture o cartão no navegador e devolva só um token. Ou o
cliente digita numa página do Asaas, ou **o número do cartão passa pelo nosso
servidor**, com o escopo de conformidade que isso arrasta para um projeto de dev
solo.

**Alternativa descartada — Asaas Checkout:** traz objeto próprio, família própria
de eventos de webhook e expiração própria. Seriam **dois sistemas de pagamento
convivendo**. A `invoiceUrl` reaproveita os eventos `PAYMENT_*` que já funcionam
e já estão testados (seção 8).

### 4-B.9 Chargeback — estado que ainda NÃO existe

Com cartão, o cliente pode **contestar a compra meses depois**: o dinheiro sai da
conta do tenant e **o passeio já aconteceu**. O sistema passa a poder ter reserva
`confirmed`, realizada, **com pagamento revertido** — combinação que hoje não
existe na máquina de estados (seção 5).

**RESOLVIDO na Fase E, e a resposta é que o estado novo NÃO EXISTE.**

**>>> `reservations.status` NÃO MUDA NUM CHARGEBACK. <<<** Duas razões, as duas
estruturais:

1. `cancelled` significa "não vai acontecer, vaga liberada", e
   `setReservationStatus` liberaria as linhas de `reservation_resources` —
   apagando o registro de que aquele recurso esteve ocupado num passeio que
   **aconteceu**. Evento financeiro destruindo histórico operacional.
2. `status` governa a **vaga** e `payment_state` governa o **dinheiro** (seção 5,
   eixos independentes). Chargeback é puramente dinheiro.

O efeito sai todo de `recalcReservationPayment`, que soma só as linhas `paid`:
a linha vira `refunded`, `amount_paid_cents` cai e `payment_state` regride
sozinho. **Nenhuma coluna nova** — mesmo precedente do estorno pendente da
seção 8.3 ("o estado JÁ é derivável"). **`paid_at` e `net_cents` FICAM**: o
dinheiro entrou de verdade naquela data, e apagá-la reescreveria a história para
caber no presente.

**A disputa ganha volta sozinha, pelo mesmo caminho.** `processCharge`
**converge** para o estado do provedor a cada leitura em vez de aplicar
transições, então `refunded → paid` não precisa de código próprio. É a
propriedade que torna o desenho robusto, e `tests/y-cartao.test.ts` (Y4.5) a
trava: transformar a função numa máquina de transições quebra aquele teste.

**Visibilidade é obrigatória, porque a reserva continua idêntica às outras no
calendário.** `/admin` exibe faixa vermelha no painel de detalhe com o valor
revertido e dizendo **em voz alta que a reserva NÃO foi cancelada** — é a
primeira pergunta de quem lê "pagamento revertido", e a resposta errada faria o
dono não ligar para o cliente. O predicado é derivável, sem coluna:
`reservation_payments.state = 'refunded'`.

**`AWAITING_CHARGEBACK_REVERSAL` é mapeado como `refunded`, e a imprecisão é
deliberada:** o nome diz que a disputa foi ganha e o dinheiro está voltando.
Errar para `refunded` faz o dono cobrar de novo alguém que já pagou
(recuperável); errar para `paid` faz o sistema afirmar ter dinheiro que não
voltou. **Não "conserte" sem trazer o dado que falta** — quanto esse estado dura
e se há evento próprio para o fim dele.

---

## 4-C. Política de cancelamento e reagendamento (decidida com o cliente em 25/08)

- **Cancelamento pelo cliente com sinal pago: NÃO devolve.** Sem escalonamento
  por antecedência.
- **No-show:** **não** devolve o sinal e **não** cobra o saldo restante.
- **Estorno:** **manual**, pelo painel do Asaas. **Sem botão no sistema**
  (seção 8-C).
- **Reagendamento:** por **WhatsApp**, manual com o Quadri Club. **Não é
  feature.**

**O que isso simplifica**, e é a razão de estar escrito: não existe devolução
parcial, não existe janela de tempo influenciando valor, não existe cálculo de
retenção. Qualquer proposta futura que reintroduza um desses três está mudando a
política, não "melhorando" a implementação.

**>>> CONTRADIÇÃO A RESOLVER NO TEXTO OFICIAL <<<** O texto publicado pelo cliente
promete **reagendamento com 48h de antecedência**, mas **não diz como**. Como
nunca há devolução, a cláusula das 48h só faz sentido se der direito a
**REMARCAR**. O texto precisa dizer que a remarcação é **pelo WhatsApp** — senão
o cliente procura no sistema um botão que não existe, não acha, e conclui que
perdeu o dinheiro. Entra na revisão do termo (Termo v2, seção 17).

---

## 5. Máquina de estados

Quando `single_experience_per_slot` do tenant estiver ativo, a criação, **dentro da mesma transação**, toma um `pg_advisory_xact_lock(tenant_id)` antes de checar/alocar e recusa (`409`) se já houver reserva ativa de **outra** experiência com período sobreposto. (Advisory lock = cadeado nomeado do Postgres, pedido e solto pela aplicação, que serializa uma seção crítica por uma chave — aqui, o tenant — sem travar tabela. Ele fecha a corrida que o exclusion constraint por recurso não cobre, porque aquele constraint não enxerga conflito **entre experiências**.)

### 5.1 Reserva

```
create → [pending_payment]  (hold 15min; cria cobranca(s) no Asaas)
   pagamento devido aprovado (webhook/reconciliacao) → [confirmed]
   hold vence sem pagar (cron)                       → [expired]
   dono cancela                                      → [cancelled]
[confirmed] → dono cancela → [cancelled]  (libera vagas; cancela cobranca de saldo pendente; estorno manual)
[expired] + pagamento tardio → vagas livres? re-confirma : mantem expired + FLAG estorno manual
```

**"Pagamento devido"** = o `full` (modo full) ou o `deposit` (modo deposit). O `balance` **nunca** afeta `reservations.status`.

**>>> `status` E `payment_state` SÃO EIXOS INDEPENDENTES. <<<** Desde a Fase B
existe a combinação `confirmed` + `partial` (seção 4-B.3): a **vaga** está
garantida e o **dinheiro** não está completo. `status` governa a vaga,
`payment_state` governa o dinheiro, e nenhum dos dois se deriva do outro. Duas
consequências que já morderam:

- **O cron não pode tocar nela**, e não toca, por duas barreiras independentes:
  o `SELECT` de `lib/jobs/expire-holds.ts` filtra `pending_payment`, e
  `ALLOWED_TRANSITIONS` recusa `confirmed → expired`. Alargar qualquer uma
  liberaria a vaga de quem já pagou metade, com o dinheiro na conta do tenant.
  `tests/u-sinal.test.ts` (U1 e U4.2) existe só para travar as duas.
- **Nenhuma tela pode dizer só "confirmada".** Ver a regra na seção 11.1.
- **A Fase E acrescentou a combinação `confirmed` + dinheiro REVERTIDO** (seção
  4-B.9): reserva confirmada, passeio possivelmente já realizado, pagamento
  estornado ou contestado. Continua sendo `status` × `payment_state`, sem estado
  novo — e é justamente por os dois eixos serem independentes que o chargeback
  não precisou de um.

### 5.2 Criação (transação única)

1. find-or-create `customers`.
2. Insere `reservations` (com `payment_mode` snapshot, termo, channel), `resources_needed` linhas em `reservation_resources` (pending) e `participants`.
3. Insere as linhas de `reservation_payments`:
   - modo `full`: 1 linha `kind='full'`, `due_date = hoje`.
   - modo `deposit`: 1 linha `kind='deposit'` (`due_date = hoje`) + 1 linha `kind='balance'` (`due_date = data do passeio`).
4. `hold_expires_at = now() + 15min`.
5. **Fora da transação**, cria as cobranças no Asaas e grava os `asaas_payment_id`. Se a criação da cobrança falhar, a reserva é marcada `expired` e a vaga liberada (não deixe reserva pendurada sem cobrança).

### 5.3 Saldo (modo deposit)

O `balance` tem ciclo próprio, independente do status da reserva:
- `pending` → `paid` (cliente pagou online no dia, via webhook) ou
- `pending` → `paid` com `received_in_cash = true` (dono registrou recebimento por fora) ou
- `pending` → `cancelled` (reserva cancelada; cobrança removida no Asaas).

---

## 6. Motor de disponibilidade

Dado `experienceId`, `date` e `resourcesNeeded`:

1. **Grade do dia — `schedule_exceptions` tem precedência sobre `operating_hours`:**
   - Consulte `schedule_exceptions` para `(tenant, date)`. Se existir linha:
     - `closed = true` → dia sem grade; zero slots (recesso, feriado fechado).
     - `closed = false` → usa `opens`/`closes` da exceção, **ignorando** o `operating_hours` do weekday. É isto que permite abrir num dia da semana em que o tenant normalmente não opera (feriado numa terça).
   - Se **não** existir exceção → usa `operating_hours` do weekday (pode haver mais de uma faixa por dia; considere todas).
   - Sobre o horário resultante: granularidade 30 min (`SLOT_GRANULARITY_MINUTES`, constante de código), descarta `T + duration > closes` (o buffer pode extrapolar o fechamento; a duração não), descarta `T` anterior a `now() + antecedência mínima`.
   - **Antecedência mínima é configurável por tenant:** `settings.min_lead_minutes` — inteiro em minutos, armazenado como string, default `"60"`. É o tempo de preparo que o tenant precisa entre a venda e a saída. `"0"` significa aceitar reserva até a hora do passeio. A leitura passa por acessor numérico tipado em `lib/tenant.ts`, com fallback ao default se a chave estiver ausente, vazia, negativa ou não-numérica — nunca `Number()` solto sobre o valor cru.
   - `blackouts` continuam aplicando por cima (passo 2), inclusive sobre dias abertos por exceção.

```sql
SELECT r.id
FROM resources r
WHERE r.tenant_id = $tenant AND r.active
  AND NOT EXISTS (
    SELECT 1 FROM reservation_resources rr
    WHERE rr.resource_id = r.id
      AND rr.status IN ('pending_payment','confirmed')
      AND rr.period && tstzrange($start, $start + make_interval(mins => $totalMinutes))
  )
  AND NOT EXISTS (
    SELECT 1 FROM blackouts bl
    WHERE bl.tenant_id = $tenant
      AND (bl.resource_id = r.id OR bl.resource_id IS NULL)
      AND bl.period && tstzrange($start, $start + make_interval(mins => $totalMinutes))
  )
ORDER BY r.id;
```

3. O formulário pergunta **nº de recursos ANTES** da grade.
4. Na criação, reexecuta a checagem dentro da transação e aloca; menos livres que o pedido ou colisão na constraint → rollback → `409`. Se `single_experience_per_slot` ativo: toma `pg_advisory_xact_lock(tenant_id)` no início da transação e reexecuta também a checagem 2b; conflito de experiência → rollback → `409`.

---

## 7. Contrato de API

### 7.1 Público

**`GET /api/availability?experienceId=&date=&resourcesNeeded=`** → `{ slots: [{ startAt, label }], dayState }`
`dayState` ∈ `'open' | 'closed_exception' | 'closed_weekday'`. Distingue "o tenant não opera nesse dia" (fechado por grade semanal), "fechado por exceção" (recesso/feriado) e "opera, mas sem horários livres" — três situações que colapsariam numa lista vazia indistinguível e produziriam a mensagem errada na tela.

**`GET /api/experiences`** → inclui `paymentMode`, `priceCents` e, quando `deposit`, `depositCents` e `balanceCents` **já calculados no servidor** para exibir no checkout. Inclui também **`minPassengerAge`**: sem ele o wizard não teria como avisar sobre idade antes do pagamento, e a recusa só apareceria no POST, depois dos seis passos preenchidos.

**Termo:** não existe `GET /api/termo`. O texto e a versão vigente (`TERM_VERSION`, `TERM_TEXT`) vivem em `lib/terms/quadriciclo-v2.ts` e entram no bundle do cliente por import direto — o formulário é `'use client'`, então buscar por API seria uma volta ao servidor sem necessidade. Versão nova = arquivo novo (`quadriciclo-v2.ts`); a reserva antiga mantém o registro do que aceitou, gravando só a versão (`termo_version`), nunca o texto.

**`POST /api/reservations`** — cria cliente, reserva, alocações, participantes e pagamentos. Corpo igual à rev 5, sem campo de pagamento (o modo vem da experiência), **mais `emergencyContact: { name, phone }`** (obrigatório — passo 5 do formulário público, seção 10). `createReservation` valida presença de `termo.version`/`acceptedAt`, mas **não** que a versão seja a vigente — divida registrada em `docs/ESTADO-ATUAL.md`. Garupa abaixo de `experiences.min_passenger_age` na data do passeio responde **422**, com a idade exigida na mensagem e **sem ecoar nome ou data de nascimento** (corpo de erro pode ir para log).
Resposta `201`:
```json
{
  "reservationId": "uuid",
  "status": "pending_payment",
  "holdExpiresAt": "...",
  "paymentMode": "deposit",
  "totalCents": 34900,
  "dueNowCents": 17450,
  "balanceCents": 17450,
  "payment": { "method": "pix", "qrCodeBase64": "...", "copyPaste": "...", "expiresAt": "..." }
}
```
No modo `deposit`, a tela **deve** deixar explícito: "Você paga agora R$X e o restante (R$Y) no dia, direto com o guia."

**`GET /api/reservations/{id}/status`** — alvo do polling da tela `/reserva/[id]`. →
```json
{
  "status": "pending_payment", "paymentMode": "full", "paymentState": "pending",
  "amountPaidCents": 0, "balanceCents": 32549,
  "holdExpiresAt": "...", "serverNow": "...",
  "experienceName": "Trilha da Montanha", "startAt": "...", "durationMinutes": 90
}
```
**PUBLICA: o uuid da URL e a unica credencial**, e ele circula por WhatsApp e
print. O payload NAO carrega nome, telefone, e-mail, CPF, participante, documento
nem contato de emergencia — a garantia e a query estreita de
`lib/reservation-status.ts`, que nao BUSCA esses campos em vez de busca-los e
filtrar. **`Cache-Control: no-store` em toda resposta, inclusive 404 e 500**:
resposta cacheada faz o polling devolver "pendente" para sempre.
**NAO consulta o Asaas** — a reconciliacao de 10 min ja e a rede de seguranca.
`serverNow` existe porque o relogio do celular do cliente pode estar errado: a
tela calcula o tempo restante pela diferenca entre os dois campos, nunca por
`Date.now()` local. **`paymentMode` e o UNICO campo que autoriza a tela a falar
em saldo** — numa reserva `full` nao paga o `balanceCents` vale o preco inteiro,
e derivar "restante no dia" dele mentiria para o cliente.
**`chargeStage` e SO EXIBICAO** (`aguardando|em_analise|recusado|pago|estornado|
cancelado`; `null` antes do primeiro reporte do provedor). Existe porque os cinco
estados intermediarios do CARTAO colapsam em `paymentState='pending'`, e sem ele a
tela repetiria "aguardando pagamento" para quem ACABOU de digitar o cartao — que
conclui que travou e paga de novo. **Nao decide nada.**

**`GET /api/reservations/{id}/payment`** → **uniao por `method`**:
`{ method:'pix', qrCodeBase64, copyPaste, expiresAt, dueNowCents }` ou
`{ method:'card', invoiceUrl, dueNowCents }`.
No Pix o QR e **atual**, buscado no provedor na hora, **nunca cacheado nem
persistido** (ele expira). No cartao a fatura **nao expira** e ja esta persistida
desde a criacao, entao esse caminho **nao chama o provedor**. Uma chamada por carga da pagina, nunca no polling. `409` quando a
reserva nao esta mais aguardando pagamento, com `code: 'sem_cobranca'` no caso de
reserva pendente cuja cobranca falhou (borda 9). O `chargeId` do provedor **nao
sai** no corpo. Mesmas regras de 404 e de dado sensivel.
- `GET /api/admin/customers` — clientes + histórico de agendamentos, com **status de pagamento** por reserva (lido do banco local, mantido pelo webhook) e **link para a fatura no Asaas** (`invoiceUrl` persistido na criação da cobrança). Sem chamada ao Asaas em tempo real.

**`POST /api/webhooks/asaas`** → seção 8.

### 7.2 Admin (sessão)

- CRUD: `experiences`, `resources`, `operating_hours`, `blackouts`, `settings`, `shared_calendar_links`. **Termo NÃO tem CRUD nem editor no admin** (decisão de 2026-08-09): o texto vive em `lib/terms/` (seção 10 e 14), versionado por arquivo novo. **>>> ESSA DECISÃO FOI REABERTA EM 01/09. <<<** Ela mesma previa a condição — *"reabre se algum dia o texto precisar mudar sem deploy"* — e a condição se cumpriu: o Aventix é vendido para outras empresas, e o dev sendo o único caminho para editar o termo é o que impede vender o segundo cliente. É a **AUT-1**, a mais complexa das quatro fases de autonomia; a restrição inviolável está na seção 10.
- **`GET|POST /api/admin/experiences` e `PATCH /api/admin/experiences/{id}`** — catálogo do dono. Lista ativas **e** inativas (a tela esmaece, nunca esconde: o dono precisa enxergar a trilha sazonal para reativá-la). **Não existe DELETE**: reservas referenciam a experiência, então desativar é `PATCH { ativo: false }`, reversível. Corpo semanticamente inválido responde **422** (`400` fica só para JSON malformado). Preço zero é recusado (seção 4.6). Editar duração, buffer ou preço não afeta reserva já vendida — os três são congelados na reserva (seção 4.6), e é isso que permite o CRUD não ter trava nenhuma.
  **Idade mínima do garupa entra no CRUD** (`idadeMinimaGarupa`, inteiro 0..120; `0` = sem mínimo): é regra de segurança publicada pelo tenant, e escondê-la do dono faria a próxima trilha nascer sem regra em silêncio. Ausente no POST vira `0`, para não quebrar chamador existente.
  **Sinal no CRUD, com o percentual TRAVADO (Fase B):** `payment_mode` aceita `full` e `deposit`. O dono responde "aceita sinal? sim/não"; ele **nunca digita o percentual**, porque a seção 4-B.2 fixou o sinal em 50% para o produto. O servidor grava `deposit_percent = 50` e `deposit_fixed_cents = NULL` (`depositColumns` em `lib/experiences.ts`), que é o que `experiences_deposit_mode_check` exige — gravar `deposit` com os dois nulos viraria 500. **Escrita travada, leitura livre:** `createReservation` continua lendo o percentual da COLUNA, então o cálculo tem uma fonte só e uma linha gravada com outro percentual seguiria honrada. Se o sinal voltar a ser por experiência, o ponto único a mudar é `DEPOSIT_PERCENT`.
- `GET /api/admin/reservations?date=` — agenda do dia com participantes, documentos, recursos, channel **e saldo em aberto**.
- **`GET /api/admin/reservations/{id}`** — detalhe de UMA reserva para o painel: reserva, experiência, recursos alocados, cliente completo, participantes com documento, **contato de emergência** e as linhas de `reservation_payments`. **Uma query** (os conjuntos um-para-muitos saem em subconsultas agregadas, nunca em JOINs que se multiplicam). **Regra de dado sensível, válida para toda rota que trafegue CPF, número de documento ou contato de emergência:** eles saem no **corpo**, nunca em query string, URL ou log — nem em erro, nem em depuração; se a rota ganhar log de requisição, os campos são redigidos antes. Reserva inexistente, **de outro tenant** e id malformado respondem os três `404` — `403` no segundo caso confirmaria a existência do id a quem sonda, e um id fora do formato uuid aborta a query com `22P02` em vez de devolver zero linhas. `emergencyContact` vem `null` em reserva anterior à migration 0002 (coluna nullable).
- **`GET|POST /api/admin/schedule-exceptions`, `PUT|DELETE /{id}`** — excecoes de
  agenda. **PUT, nao PATCH:** os campos sao interdependentes (`closed=false` exige
  `opens`/`closes` com `closes > opens`, o CHECK `schedule_exceptions_closed_check`),
  e um patch parcial aceitaria corpo plausivel que o banco recusa com 500. Data
  duplicada responde **409** com `code: 'data_ocupada'`, nao 422: o corpo esta
  certo e o que conflita e o estado, entao a tela oferece editar a existente em vez
  de acusar de invalida uma data digitada corretamente. Data no passado e recusada
  (nao muda nada, e aceitar em silencio faz o dono crer que resolveu algo).
- **`GET|POST /api/admin/operating-hours`, `PUT|DELETE /{id}`** — grade semanal.
  **RECUSA FAIXAS SOBREPOSTAS** no mesmo weekday, com **409** e o `conflict` no
  corpo para a tela dizer QUAL faixa atrapalha. Faixas que apenas **encostam**
  (08:00-12:00 e 12:00-18:00) convivem — e o caso manha/tarde. A deduplicacao de
  candidatos em `lib/availability.ts` permanece: as duas juntas sao defesa em
  profundidade, e tirar aquela deixaria dado vindo de seed sem rede.
- **`GET|POST /api/admin/blackouts`, `PUT|DELETE /{id}`** — bloqueios pontuais.
  `recursoId: null` = todos os recursos. **O horario trafega LOCAL do tenant**
  (`'AAAA-MM-DDTHH:MM'`, sem fuso) e sufixo de fuso e **recusado**: `'...T14:00Z'`
  nasceria as 11h de Brasilia sem erro nenhum aparecendo. `fim <= inicio` responde
  422 — `tstzrange` invertido produz range VAZIO, que o banco aceita e que nunca
  bloqueia nada. Recurso inexistente ou de outro tenant e 422 (e campo do corpo),
  nao 404.

> **DELETE existe nos tres acima, e NAO existe em `experiences`.** O criterio e a
> referencia: `reservations.experience_id` aponta para `experiences`, e nada aponta
> para as tres tabelas de grade. **Apagar grade nunca cancela reserva ja vendida** —
> a vaga vive em `reservation_resources.period`, congelada na venda (secao 4.6), e a
> grade governa apenas o que ainda PODE SER VENDIDO. **A tela e obrigada a dizer
> isso em voz alta**, no topo e dentro da confirmacao de exclusao: sem o aviso o dono
> apaga o sabado achando que cancelou os passeios de sabado.

- **`GET /api/admin/financial-config`** — desconto por método **e** taxas da
  maquininha, numa resposta só (a tela mostra as duas juntas; separar em dois GET
  só criaria a chance de desenhar metade da configuração).
- **`PUT /api/admin/financial-config/discounts/{method}`** — **upsert** pela chave
  natural `(tenant, método)`. Não há POST nem DELETE: o conjunto de métodos é
  fechado pelo enum, e "sem linha" e "0 bp" dizem a mesma coisa. Método fora do
  enum é **404** (é segmento de URL, logo endereço inexistente), não 422.
- **`GET|POST /api/admin/financial-config/card-machine-rates`, `PUT|DELETE /{id}`**
  — modalidade **duplicada é 409** com `code: 'modalidade_ocupada'` e o `conflict`
  no corpo, nunca upsert silencioso: sobrescrever sem avisar um percentual já
  conferido com a adquirente é justamente o que não pode acontecer com dinheiro.
  Percentual fora de faixa é 422 (ver os CHECKs em 4-B.6). **Lista vazia é o
  estado esperado** enquanto os percentuais reais não chegarem.
- `GET /api/admin/calendar?from=&to=` — calendário nativo.
- `GET /api/admin/customers` — clientes + histórico.
- **Cobrança do saldo — DUAS rotas, e a divisão é regra, não estilo:**
  - **`GET /api/admin/reservations/{id}/balance`** — **só lê.** Saldo, estado,
    `hasCharge`, e o **QR atual** quando a cobrança já existe (buscado no Asaas
    **na hora**, nunca cacheado — QR expira). **Nunca cria.**
  - **`POST /api/admin/reservations/{id}/balance/charge`** — cria ou reaproveita
    a cobrança. É o botão.

  Criar cobrança num GET poria operação de **dinheiro** atrás do verbo que
  prefetch, retry de rede e refresh consideram seguro repetir. O "sob demanda"
  da rota de leitura é honrado pelo POST: a demanda é o dono apertar o botão,
  não a tela abrir.

  **>>> APERTAR DUAS VEZES NÃO PODE GERAR DUAS COBRANÇAS. <<<** A regra vive em
  `lib/payments/balance-charge.ts`, em **três camadas** (seção 8-D). A rota só
  traduz erro tipado em HTTP e **não reimplementa regra nenhuma** — duas cópias
  da mesma regra divergem, e a que diverge sobre dinheiro cobra errado.
  Respostas: `200` (com `origin` ∈ `created|reused|adopted`), `404` (inexistente,
  outro tenant, id malformado, reserva `full`), `409` (`saldo_quitado`,
  `reserva_inativa`, `sinal_pendente`, `cobranca_em_andamento`), `422`
  (`provedor_recusou`, **com o detalhe** — o dono precisa saber o que consertar),
  `502` (`provedor_indisponivel`, `qr_indisponivel`).
  O `chargeId` do provedor **não sai no corpo** de nenhuma das duas.
- **`POST /api/admin/reservations/{id}/balance/receive-in-cash`** — registra o
  saldo recebido na maquininha. Body: `{ valorBrutoCentavos, modalidade }`.
  Marca `state='paid'`, `received_in_cash=true`, grava os quatro valores
  congelados (4-B.7) e recalcula a reserva. **O declarante vem da SESSÃO**, nunca
  do corpo: rastro que o cliente da requisição escolhe não é rastro.
  `409 saldo_ja_liquidado` é o **caminho duplo** (o cliente pagou por Pix mais
  cedo); `404` cobre inexistente/outro tenant/id malformado/reserva `full`.

  **>>> NÃO chama `receiveInCash` no Asaas. <<<** O dinheiro **nunca passou pelo
  provedor**, então não há cobrança a baixar lá. O que a rota faz é **CANCELAR**
  a cobrança Pix do saldo, se a Fase C tiver gerado uma: sem isso o cliente paga
  de novo em casa achando que ainda deve, e o webhook — encontrando a linha já
  `paid` — responderia `200` sem registrar nada, com o dinheiro entrando na
  conta do tenant **sem aparecer no sistema**.

  **A ordem é deliberada: grava primeiro, cancela depois.** Cancelar antes e
  falhar na escrita deixaria o cliente sem como pagar online um saldo que o
  sistema ainda considera em aberto. Gravar antes e falhar no cancelamento deixa
  o dinheiro corretamente registrado e uma cobrança a cancelar à mão — e a tela
  é obrigada a avisar (`providerCharge: 'falhou'`).
- `POST /api/admin/reservations/{id}/cancel` — cancela reserva, libera vagas, **remove no Asaas a cobrança de saldo pendente**, marca pagamentos `cancelled`, e-mail ao cliente. Estorno do sinal é manual (seção 8-C).

---

## 8. Integração Asaas — webhook e robustez

> Esta seção existe porque a maioria das falhas de integração de pagamento não é de lógica, é de transporte. Siga ao pé da letra.

### 8.1 Regras invioláveis do endpoint de webhook

1. **Responda exatamente `HTTP 200`.** O Asaas trata apenas 200 como sucesso; 201, 204, 3xx, 4xx e 5xx são falha.
2. **A URL cadastrada não pode redirecionar.** O Asaas não segue redirect (308 = falha). Cadastre a URL **exata** (sem barra final, já em HTTPS) e desative qualquer redirect do Next/proxy nesse caminho. Teste em sandbox antes de produção.
3. **Responda rápido (< 10s) e processe depois.** O Asaas corta em ~10s (Read Timed Out). No handler: validar → gravar estado → responder 200. E-mail, calendário e qualquer efeito colateral vão para processamento **assíncrono** (fila simples/`after()`/job), nunca dentro da requisição.
4. **Idempotência obrigatória.** Entrega é *at least once*: o mesmo evento chega mais de uma vez. Deduplique pelo `id` do evento e pelo estado (se já está `paid`, responde 200 e não faz nada).
5. **Validação tolerante do payload.** O Asaas adiciona atributos novos sem aviso; schema estrito derruba a fila. Valide só os campos que você usa e **ignore desconhecidos** (nada de `.strict()`).
6. **Cobrança órfã é normal — ignore em silêncio.** Qualquer entrada de dinheiro na conta do tenant gera evento, inclusive Pix pessoal e transferências que não têm nada a ver com o Aventix. Se não achar `reservation_payments` pelo `asaas_payment_id`/`externalReference`: **loga e responde 200**. Nunca lance erro.
7. **Nunca retorne 5xx por falha de regra de negócio.** 15 falhas consecutivas **interrompem a fila** do webhook; os eventos ficam retidos e são descartados após 14 dias. Erro de negócio → loga, responde 200, resolve pela reconciliação.
8. **Autenticação:** valide o header `asaas-access-token` com um **token secreto próprio do webhook** (nunca a API key). Token inválido → `401`.

### 8.2 Fluxo do handler

1. Valida o token. Inválido → `401`.
2. Lê `event` + `payment.id`. **A lista de eventos tratados é FILTRO DE RUÍDO, não decisão:** `processCharge` nunca olha o nome do evento, recebe o id e reconsulta. Um evento fora da lista custa uma linha de log; um de dentro custa uma consulta ao provedor.
   - **Pix:** `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`.
   - **Cartão:** `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_APPROVED_BY_RISK_ANALYSIS`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS`, `PAYMENT_AUTHORIZED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`. Nenhum confirma reserva; entram pelo `charge_stage`.
   - **Estorno e chargeback:** `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`.

   **>>> NO CARTÃO É O `PAYMENT_CONFIRMED` QUE CONFIRMA A RESERVA. <<<** Ele significa "pago, dinheiro ainda não disponível"; o `PAYMENT_RECEIVED` do crédito só chega **~32 dias depois**, e esperar por ele deixaria a vaga do cliente valendo daqui a um mês. Não há código especial: `toPaymentState` mapeia `CONFIRMED` para `paid`, e o `RECEIVED` posterior sai por `already_paid`.

   **A lista só vale se os eventos estiverem MARCADOS no painel do Asaas.** Evento não assinado não chega, e não há erro nem log — simplesmente não acontece.
3. **Reconsulta `GET /v3/payments/{id}`** — nunca decida pelo payload.
4. Localiza `reservation_payments` por `asaas_payment_id` (fallback: `external_reference`). Não achou → log + `200`.
5. **Provedor reporta `refunded` e a linha local está `paid`** (estorno ou chargeback): numa transação, `state='refunded'` e `recalcReservationPayment`. **`reservations.status` NÃO muda** (seção 4-B.9). Este teste vem **ANTES** da idempotência do passo seguinte — sem isso a linha `paid` sairia por `already_paid` e o chargeback seria descartado em silêncio.
6. Já `paid` e o provedor concorda → `200`, nada a fazer (idempotência).
7. Pago: numa transação, `state='paid'`, `paid_at`, `charge_stage`, o **líquido lido do provedor** (4-B.7), e `recalcReservationPayment(reservationId)`. Se o pagamento é `full`/`deposit` e a reserva está `pending_payment` com vagas livres → `setReservationStatus('confirmed')`.
8. Enfileira efeitos (e-mail de confirmação/quitação). Responde `200`.

### 8.3 Pagamento tardio (hold vencido)

Igual às revisões anteriores: tenta reativar as alocações; vagas livres → re-confirma; colisão → mantém `expired`, marca o pagamento como pago, **sinaliza o dono para estorno manual**.

### 8-B. Job de reconciliação (rede de segurança — OBRIGATÓRIO)

A fila de webhook pode ser interrompida (15 falhas) e ficar horas sem entregar nada, com dinheiro entrando e o sistema sem saber. Rotina a cada **10 minutos**:

1. Seleciona `reservation_payments` com `state='pending'` e cobrança criada há mais de 5 min, cuja reserva ainda não está `cancelled`.
2. Consulta a API do Asaas (por `externalReference` ou por id) e aplica **exatamente a mesma função de processamento** do webhook (mesmo código, mesma idempotência).
3. Loga divergências.

Também exponha em `/admin` um indicador de saúde da integração (último webhook recebido, pendências reconciliadas). Se a fila cair, o dono vê antes do cliente reclamar. Reativação da fila é feita no painel do Asaas ou via API (`interrupted: false`).

**>>> PAGAMENTO SEM `asaas_payment_id`: DUAS CAUSAS, e só UMA é anomalia. <<<**

O job avisava em log toda linha `pending` sem id no provedor. Isso nasceu certo,
quando a única causa possível era a **borda 9** (a criação da cobrança falhou
depois da transação). A Fase B criou uma segunda causa, **rotineira**: a linha
`kind='balance'` é criada junto da reserva, mas a cobrança do saldo só nasce
quando o dono a pede. Sem distinguir as duas, **toda reserva com sinal produzia
um aviso a cada 10 minutos, para sempre** (medido: 7 linhas por ciclo com 4
reservas de teste). O filtro por `kind` entrou na Fase C.

**O filtro é por `kind`, NUNCA por "sem id".** Silenciar por ausência de id
apagaria junto o único sinal que existe das reservas da borda 9 — há **3 em
produção** hoje.

| `kind` sem id | Significado | O job deve |
|---|---|---|
| `balance` | o saldo ainda não foi cobrado — **estado esperado** | **ignorar em silêncio** |
| `deposit`, `full` | a cobrança do pagamento devido **falhou** (borda 9) | **avisar** |

**Nunca silencie `deposit` nem `full`.** Eles significam reserva que nasceu sem
QR, e o cliente não tem como pagar.

**O silêncio do `balance` é permanente, não foi um remendo até a Fase C.** Mesmo
depois dela, `balance` sem id continua sendo "o dono ainda não cobrou", que é o
estado normal da véspera. O que volta a ser assunto do job é `balance` **com**
id, aí sim consultado como qualquer outra cobrança.

**Por que isto é regra e não ajuste cosmético:** ruído constante faz parar de ler
o log, e este projeto já pegou falha surda três vezes olhando log. Um aviso que
dispara sempre não é aviso, é fundo.

### 8-C. Estorno (manual no MVP)

- Pix aceita estorno **integral ou vários parciais**, somando no máximo o valor recebido.
- **As taxas não voltam**: tentar estornar 100% logo após o recebimento pode retornar `400` por saldo insuficiente na conta do tenant.
- Portanto: **estorno é operação manual do dono** no painel do Asaas. O Aventix apenas registra o cancelamento e sinaliza "estorno pendente" na reserva. Estorno automático é pós go-live.

### 8-D. Idempotência da cobrança de saldo (Fase C)

O saldo é cobrado por um **botão que o dono aperta no celular, em campo, com o
cliente esperando**. O duplo toque não é hipótese de laboratório: é o caso
normal de um botão que demora um segundo numa tela de celular sob sol. Duas
cobranças significam cliente podendo pagar duas vezes, e estorno de Pix é
**manual** (seção 8-C), com taxa que não volta.

**Três camadas, e nenhuma é redundante:**

1. **Caminho rápido local** — a linha já tem `asaas_payment_id`? Então a cobrança
   existe: só relê o QR. Cobre o caso comum.
2. **Trava de serialização** — `pg_try_advisory_xact_lock` chaveada na **linha do
   pagamento**. Cobre os dois toques **simultâneos**, em que ambos leem o id nulo
   antes de qualquer um gravar. É `try_`, **não bloqueante**: o segundo volta na
   hora com `409`, porque do outro lado está um dono que vai apertar de novo de
   qualquer jeito, e uma fila de conexões só adiaria o mesmo resultado.
3. **Pergunta ao provedor** pela `external_reference` antes de criar. **Cobre o
   único buraco que trava local nenhuma alcança:** o processo morrer (deploy,
   container reiniciado, conexão caída) **depois** de o Asaas criar a cobrança e
   **antes** de gravarmos o id. Nesse estado a linha está com id nulo e a cobrança
   existe lá; sem esta camada a próxima tentativa criaria a segunda — e essa é a
   duplicata mais difícil de perceber, porque nasce de um deploy e não de um
   clique. **É FAIL-CLOSED: se a pergunta não pode ser feita, NÃO se cria.** Das
   duas falhas possíveis, "o dono tenta de novo em dez segundos" custa muito menos
   que "o cliente recebe dois QR e paga os dois".

**A trava vale para o caminho rápido também, e isso foi MEDIDO.** Dois toques
caindo os dois na releitura disparam duas consultas concorrentes do mesmo QR, e o
Asaas responde `400` numa delas. **Nada é duplicado** — mas sem tratamento aquilo
subia como recusa do provedor, e a tela dizia *"o provedor recusou a cobrança"*:
falso nos dois pontos ao mesmo tempo, e lido pelo dono com o cliente na frente.
Por isso a invariante é **uma operação de saldo em voo por reserva, sempre**,
criando ou relendo; e a falha de releitura tem tipo próprio
(`BalanceQrUnavailableError` → `502 qr_indisponivel`), que diz que a cobrança
**existe**, que nada foi duplicado, e oferece a `invoiceUrl`.

**A trava não colide com o `pg_advisory_xact_lock(tenant_id)` de
`createReservation`**, e a garantia é do Postgres: a forma de dois inteiros e a
de um bigint ocupam espaços distintos. A trava é tomada num **ponto único**
(`withBalanceLock`) — duas cópias divergiriam sobre o espaço de nomes, e travas
em espaços diferentes não se veem, produzindo proteção que parece existir e não
existe.

> **`balance-charge.ts` segura a trava durante a chamada ao provedor, e o
> cabeçalho de `charge.ts` proíbe isso. A diferença é deliberada.** Aquela
> proibição protege o caminho **público** de venda, onde a transação segura o
> advisory lock **do tenant** e pode esgotar o pool sob carga. Aqui a trava é
> chaveada **na linha do pagamento**, então bloqueia exatamente e somente os
> outros toques no mesmo botão; e o chamador é o admin de login único. O QR é
> buscado **depois do commit** para não ser mais uma chamada sob a trava.
---

## 9. Notificações (e-mail via Resend — CORTADO do go-live)

> **ESTADO EM 23/08/2026: nada disto existe.** Sem Resend, sem
> `lib/notifications.ts`, sem dependencia de e-mail no `package.json`. Cortado do
> go-live em 21/08 (`docs/DECISOES.md`) e previsto para a primeira semana depois.
>
> **Consequencia que governa outra tela:** a tela `confirmed` de `/reserva/[id]` e
> a **UNICA** confirmacao que o cliente recebe. Por isso ela nao e um visto verde:
> carrega data por extenso, horario com o fuso nomeado, duracao, ponto de encontro,
> o que levar e contato, e pede para o cliente printar. Quem for construir o e-mail
> depois nao pode simplificar aquela tela por achar que o e-mail a substitui — ela
> continua sendo o que sobrevive a refresh e volta pelo link.

**ENQUADRAMENTO (28/08): isto é preparação, não lacuna ativa.** O sistema está em
produção, mas **ninguém tem o link de agendamento** — não existe cliente real e
ninguém está pagando. Não há hoje um cliente que pague e fique sem e-mail. O
e-mail é item da lista de conferência **antes de abrir em outubro**, não incidente
em curso.

A lista abaixo e a especificacao de quando o e-mail existir:

- **Termo reforçado** → cliente, após o aceite.
- **Reserva confirmada** → cliente + dono. No modo `deposit`, o comprovante **destaca o saldo a pagar no dia** e a forma (com o guia, antes da saída).
- **Lembrete pré-passeio** (24h e 2h antes) → repete o saldo em aberto e o lembrete do documento físico.
- **Saldo quitado** → recibo ao cliente.
- **Cancelamento pelo dono** → cliente.

Comprovante inclui ponto de encontro e o que levar (de `settings`). Falha de e-mail nunca derruba a reserva.

---

## 10. Termo de aceite digital

Exibe o termo completo numa caixa de rolagem (320px); botão de aceite só habilita após **rolar até o fim** (`scrollTop + clientHeight >= scrollHeight`, tolerância de 20px; termo curto o bastante para caber sem rolar já nasce liberado); captura dados do form + IP + timestamp + user agent + `version`; grava em `reservations.termo_*`. **Texto versionado por ARQUIVO, não editável no admin:** a versão vigente é `lib/terms/quadriciclo-v2.ts` (`TERM_VERSION = '2026-08-31'`); `quadriciclo-v1.ts` **permanece no repositório para sempre** e não é importado por nada — é o registro das reservas que o aceitaram. Trocar o texto é criar arquivo novo com nova `TERM_VERSION`, **nunca editar o existente**: a reserva grava só a versão, então editar faria uma string já gravada resolver para um texto que aquelas pessoas não leram. `tests/x-termo.test.ts` trava isso com o **sha256 do v1 fixado** — se aquele teste falhar, o conserto é desfazer a edição e criar um v3, jamais atualizar o hash. Editor de termo no admin **estava** fora do MVP pela mesma lógica do form builder proibido (seção 11-B). **Reaberto em 01/09 como AUT-1** — ver abaixo.

> ### >>> AUT-1: o termo vai virar editável, e a restrição é VERSIONAMENTO, não confiança <<<
>
> **O problema não é o dono escrever besteira.** É que `reservations.termo_version`
> grava **qual versão** o cliente aceitou, e nunca o corpo. Se a tela editar o
> texto de uma versão **existente**, toda reserva que já apontava para aquela
> string passa a resolver para um texto que aquelas pessoas **nunca leram** — e o
> registro jurídico, cuja única função é provar o que alguém aceitou, vira ficção.
> É a mesma falha que o versionamento por arquivo existe para impedir, entrando
> pela porta da tela.
>
> **A regra que a implementação tem de honrar: cada publicação CRIA VERSÃO NOVA.**
> Editar versão publicada é impossível, não desaconselhado.
>
> **O que isso implica, e é por isso que a AUT-1 é a mais cara das quatro:**
> - o termo **sai de `lib/terms/` e vai para o banco** (tabela própria);
> - as versões **v1 e v2 migram** para lá, preservando byte a byte o que já foi
>   aceito;
> - a **imutabilidade é imposta pelo BANCO**, não por disciplina de código —
>   trigger ou permissão, não um comentário pedindo para não editar;
> - **`tests/x-termo.test.ts` precisa ser repensado.** Ele fixa hoje o sha256 do
>   v1 **do arquivo**; com o texto no banco, aquele hash deixa de ter o que
>   proteger, e a proteção equivalente passa a ser o teste de que uma versão
>   publicada não pode ser alterada.

**A política do sinal do Quadri Club vive no CORPO do termo (v2, §5), não em `settings`.** A §5 cobre pagamento (integral ou sinal de 50%), não devolução em cancelamento, no-show e remarcação em 48h pelo WhatsApp. Isto encerra a lacuna que a rev 6 abriu e que ficou ativa desde a Fase B.

> **>>> POR QUE A POLÍTICA MORA NO TERMO E NÃO NUMA SETTING <<<**
>
> A rev 6 previa que a política do sinal viesse de `settings.deposit_policy_text`,
> renderizada condicionalmente quando a experiência fosse `deposit`. **Nunca foi
> implementado, e o Termo v2 resolveu o problema por outro caminho** — que é o
> caminho certo, pela razão abaixo.
>
> **Termo é registro jurídico VERSIONADO; setting é EDITÁVEL sem gerar versão.**
> A reserva grava qual versão do termo foi aceita. Uma política que morasse em
> `settings` poderia ser editada no admin a qualquer momento **sem produzir
> versão nova** — e então uma reserva antiga, apontando para a mesma
> `termo_version`, passaria a exibir uma política que aquele cliente nunca leu.
> É exatamente a falha que o versionamento por arquivo existe para impedir,
> reintroduzida pela porta dos fundos. **Para o que VINCULA o cliente, o corpo
> do termo é o único lugar correto.**
>
> **A chave NÃO foi apagada, e isso é deliberado.** `deposit_policy_text` vive
> no tipo **genérico** `SettingKey`, não no template do quadriciclo: é ponto de
> extensão para um tenant cuja política de sinal precise variar sem trocar de
> versão de termo — por exemplo, um valor apenas informativo, exibido fora do
> termo. **Permanece NÃO IMPLEMENTADA e não renderizada por componente nenhum.**
> Apagar hoje seria jogar fora o ponto de extensão para economizar uma linha, e
> recriar depois custa mudança de tipo. Quem for implementá-la um dia precisa
> decidir antes se aquele texto **vincula** — se vincular, o lugar dele é o
> termo, não a setting.
>
> Validade: MP 2.200-2/2001 e Lei 14.063/2020 (texto a validar com o jurídico).

---

## 11. Calendário nativo + agenda compartilhada

### 11.1 Calendário do admin
Visão do dia com uma coluna por recurso ativo, blocos com cliente/experiência/status, buffers visíveis, seletor de data e faixa semanal com contagem. O detalhe da reserva traz os botões **Cobrar saldo** (QR na hora, Fase C) e **Recebi por fora** (Fase D). Essa tela é usada **no celular, em campo** — priorize legibilidade e toque.

**>>> O RÓTULO DO BLOCO SAI DE `status` + `payment_state`, NUNCA SÓ DE `status`. <<<**
Até a Fase B o mapa era `confirmed: 'Pago'`. Isso virou **afirmação falsa** no
instante em que o sinal ficou vendável: reserva com metade paga é `confirmed`, e
o bloco diria "Pago", em verde, na tela em que o guia bate o olho antes do
passeio sem abrir reserva nenhuma. Ele leva a pessoa e ninguém cobra o resto.

O estado de exibição tem **três** valores (`displayState`, em
`app/(admin)/admin/_components/shared.ts`): aguardando, **saldo em aberto** e
pago. O de saldo tem cor própria e carrega o **valor** ("Saldo R$ 162,74") — um
número em reais é o que o guia cobra; "saldo em aberto" ele leria como pendência
burocrática. A derivação é **fail-safe**: o que não está `settled` conta como
devendo, porque marcar como saldo uma reserva quitada custa dez segundos e o
contrário custa o passeio.

**A mesma regra vale para `/admin/agendamentos`** (selo "Falta R$ X" ao lado do
status, não no lugar dele) e para a tela de status do cliente. **Tela que
esqueça é regressão**, não detalhe visual.

**Detalhe e cancelamento são um painel sobreposto, não uma página.** Clicar num bloco abre um overlay sobre o calendário, que fecha por X, clique fora e Esc — o dono está olhando a agenda do dia e precisa continuar exatamente onde estava depois de cancelar. O clique carrega o **id da reserva**, nunca o do recurso: uma reserva multi-recurso vira um bloco por corrida contígua de colunas, então recursos não adjacentes produzem blocos separados, e todos abrem a mesma reserva. O detalhe é buscado **sob demanda, no clique** — isso não fere a regra da query única abaixo, que governa o render do período. Cancelar exige digitar `CANCELAR` (exato, maiúsculas) e não pede motivo. O painel tem uma **segunda porta de entrada, aditiva ao clique**: `/admin?...&reserva={id}` abre-o já na carga (usada pelo link de `/admin/agendamentos`). O servidor valida a existência do id no tenant antes de mandar abrir — id ausente, malformado, inexistente ou de outro tenant renderiza a agenda normal, sem painel e sem erro; fechar o painel limpa o `reserva=` da URL para o refresh não reabrir.

**Dados — uma query por render:** a tela lê de `GET /api/admin/calendar?from=&to=`, que devolve, para o período, todas as reservas ativas com recursos alocados, cliente (só nome), experiência e estado de pagamento — em UMA consulta. O front posiciona; nunca busca por reserva ou por recurso separadamente. A granularidade do payload acompanha a view: dia/semana trazem o detalhe de render (nome, trilha, buffer, pago/aguardando); mês traz só resumo (horário + trilha + status).

### 11.2 Agenda compartilhada (parceiro, ex. Aventurando)
Página pública `agenda/{token}`, **somente leitura**, exibindo apenas ocupado/livre por recurso e horário. **Nunca** exibir nome, telefone, documento, e-mail **ou informação financeira**. Token opaco (nanoid ≥ 32), `noindex`, rate-limit, revogável no admin. Nível 1 apenas; API autenticada de parceiro é pós go-live.

### 11.3 Google Calendar
Fora do MVP; espelho opcional pós go-live.

---

## 11-B. Seeds como templates de segmento

O seed do MVP deve ser escrito **no formato de template de segmento**: `/lib/templates/quadriciclo.ts` com `segment`, `settings`, `resources`, `experiences` (incl. `payment_mode`) e `onboarding_questions`. O seed = aplicar o template ao tenant 1 com os valores reais do Quadri Club.

**Não construir no MVP:** wizard de onboarding, outros templates, `price_mode per_person`, e **form builder (proibido)** — segmento que não couber ganha template novo, nunca construtor exposto ao usuário. O formulário público **deriva da configuração**: 1 recurso → passo de quantidade some; documento não exigido → campo some; `payment_mode='full'` → nenhuma menção a sinal.

---

## 12. Expiração de hold

Reservas `pending_payment` com `hold_expires_at` vencido são expiradas para liberar os recursos. A expiração passa **obrigatoriamente** por `setReservationStatus` (regra da seção 4.6) — nunca por `UPDATE` direto.

**Mecanismo: `node-cron` no processo Next**, registrado uma única vez em `instrumentation.ts`, disparando a cada minuto. NÃO usar `pg_cron`: ele executa SQL dentro do Postgres e não consegue chamar `setReservationStatus`, e um `UPDATE` cru furaria a sincronização `reservations`/`reservation_resources` sob `FOR UPDATE` que protege contra double-booking.

A lógica de expiração vive em `lib/` (função testável, reusável pelo job de reconciliação da Fase 2); `instrumentation.ts` apenas agenda. Idempotente: um tick que não encontra holds vencidos é no-op. Trade-off aceito: um restart do container pode pular um tick — o próximo o cobre, e um hold expirando 1-2 min atrasado não causa dano.
---

## 13. Autenticação do admin

Um único login (o dono). Sem provider externo.

**Fronteira única: `lib/auth.ts`.** Consumidores (`proxy.ts`, rotas `/api/admin`, telas de admin) chamam `getCurrentUser()` / `getUserFromRequest()` / `verifyCredentials()` / `createSession()` / `destroySession()` / `isProtectedPath()` e **nunca leem cookie ou `.env` direto**. Mesmo padrão de `getTenantId()`.

**MVP:** usuário único, credencial em `.env` — `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (bcrypt custo 12), `SESSION_SECRET` (≥ 32 chars). Sessão via **iron-session**: cookie `aventix_admin_session`, httpOnly, assinado e cifrado, `sameSite=lax`, `secure` em produção, validade 8h. Senha comparada **exclusivamente** por `bcrypt.compare`, nunca `===`; `bcrypt.compare` roda mesmo com e-mail errado, para não vazar por tempo de resposta qual e-mail é o do dono. Hash gerado por `npm run auth:hash -- "senha"`; **a senha em texto nunca entra no `.env` nem no repo**.

**Escala (v2):** `getCurrentUser()` passa a ler a tabela `admin_users` e retornar papel; **só a implementação de `lib/auth.ts` muda, não os consumidores**.

**`proxy.ts`** (Next 16: export `proxy`, runtime Node; `middleware.ts` está deprecado) protege `/admin/*` e `/api/admin/*` — tela sem sessão redireciona para `/admin/login`, API responde `401`. **LIBERA** `/admin/login` e `/api/admin/login` (sem isso, logar é impossível), **`/api/webhooks/*`** (o webhook é chamado pelo Asaas, que não tem sessão — 401 ali significa pagamento não confirmado e fila interrompida, seção 8.1) e todas as rotas públicas. O `matcher` escopa só em `/admin` e `/api/admin`; `isProtectedPath` repete a regra como segunda barreira.

**Armadilha do `$` no ambiente:** o hash bcrypt contém três `$` e o carregador de ambiente do Next expande variáveis. **Escape cada cifrão com `\`** (`ADMIN_PASSWORD_HASH=\$2b\$12\$...`) — medido: aspas simples e duplas **não** protegem, e o `dotenv` puro dos scripts lê certo mesmo sem escape, então o erro só aparece dentro do Next, com cara de "senha errada".

**A expansão não é exclusiva do arquivo `.env`.** Medido: uma variável exportada no ambiente do processo, com os 60 caracteres confirmados em Node puro, chega ao `lib/auth.ts` com **52** dentro do Next; com os cifrões escapados, o login passa.

**>>> MAS O EASYPANEL É O CASO OPOSTO, E CONFUNDIR OS DOIS DERRUBOU PRODUÇÃO EM 21/08. <<<** O editor de variáveis do painel **não** expande e **não** escapa: ele entrega o valor literal ao container. Hash escapado lá vira um hash com contrabarra dentro, de 63 caracteres, e o fail-fast do boot acusa comprimento errado. A regra completa, com sintoma e diagnóstico, está na **seção 19** — leia antes de mexer em variável de ambiente em produção.

**Fail-fast:** `instrumentation.ts` valida a configuração no boot do servidor e loga o que falta. Avisa e segue, não derruba o processo: o site público de reservas não depende de auth, e tirar a venda do ar por causa de variável do painel seria trocar um problema por outro pior. A validação é preguiçosa em `lib/auth.ts` (não no import) porque o Easypanel injeta env em runtime, e validar no import quebraria o `next build` dentro do Docker.

---

## 14. Estrutura de pastas

> **>>> `[NAO CONSTRUIDO]` MARCA O QUE ESTA PREVISTO E NAO EXISTE. <<<**
>
> Esta seção é lida como **inventário** — por mim e por quem escrever qualquer
> coisa a partir dela. Descrever software que não existe produz especificação
> sobre software imaginário, e isso já custou tempo real três vezes em cinco
> dias: a frase do Termo v2 prometendo antecipar o saldo, o levantamento da
> `deposit_policy_text` supondo que faltava só a string, e a tela de cartão
> recusado oferecendo um Pix que não existe.
>
> **A intenção do desenho fica** — ela vale, e apagá-la perderia o porquê. O que
> muda é que "existe" e "está previsto" deixam de ser indistinguíveis.
>
> Auditado item a item contra o repositório em 01/09/2026.

```
/app
  /(public)
    /page.tsx                         # RAIZ = login da plataforma (307 -> /admin/login). NAO pertence a tenant, NAO leva a agendamento
    /agendamento/[slug]/page.tsx      # LP do tenant: experiencia → nº recursos → horario → participantes+doc → TERMO → pagamento
    /reserva/[id]/page.tsx            # QR + polling. FICA NA RAIZ, fora do slug (secao 2-B)
    /_components/meeting-point-map.tsx # iframe do mapa + link de fallback; some se a setting estiver vazia
    /agenda/[token]/page.tsx          # [NAO CONSTRUIDO] agenda compartilhada (secao 11.2).
                                      # A TABELA shared_calendar_links existe no schema e NAO
                                      # TEM UM UNICO CONSUMIDOR: ninguem a le, ninguem a
                                      # escreve. A feature inteira esta por fazer
  /(admin)
    /admin/login/page.tsx
    /admin/page.tsx                   # CALENDARIO NATIVO (+ marcador de saldo em aberto). Abre o painel por ?reserva=id (aditivo ao clique)
    /admin/agendamentos/page.tsx      # lista consultavel de reservas: busca nome/telefone (ILIKE), filtros status/periodo; SOMENTE LEITURA; NAO exibe CPF/documento/contato
    /admin/_components/               # grade do calendario (dia/semana/mes) + painel de detalhe/cancelamento + balance-charge (botao Cobrar saldo) + admin-nav; `_` = pasta privada, nao vira rota
    /admin/reservas/[id]/page.tsx     # [NAO CONSTRUIDO] detalhe como PAGINA, para link direto.
                                      # O painel sobreposto (11.1) cobre o uso do dia a dia, e e
                                      # por isso que a ausencia nunca doeu
    /admin/clientes/page.tsx          # [NAO CONSTRUIDO] o dono NAO TEM lista de clientes nem
                                      # historico. GET /api/admin/customers tambem nao existe
    /admin/experiencias/page.tsx      # incl. modo de pagamento e sinal
    /admin/recursos/page.tsx          # [NAO CONSTRUIDO] ultima entidade do catalogo sem CRUD.
                                      # lib/resources.ts so tem listActiveResources(); o dono
                                      # nao consegue somar um quadriciclo nem tirar um de
                                      # circulacao
    /admin/excecoes/page.tsx          # excecoes de agenda; mostra o contraste "hoje x com a excecao"
    /admin/horarios/page.tsx          # grade semanal; avisa que apagar faixa NAO cancela reserva
    /admin/bloqueios/page.tsx
    /admin/financeiro/page.tsx        # desconto por metodo + taxas da maquininha (secao 4-B.6)
    /admin/configuracoes/page.tsx     # [NAO CONSTRUIDO] e com ela nenhuma das 15 chaves de
                                      # `settings` e editavel pelo dono: mudar qualquer uma
                                      # exige psql em producao (que o seed desfaz) ou deploy
                                      # do template
    /admin/compartilhar/page.tsx      # [NAO CONSTRUIDO] ver /agenda/[token] acima
    /admin/integracao/page.tsx        # [NAO CONSTRUIDO] saude do webhook / reconciliacao
                                      # (secao 8-B). Sem ela, fila de webhook parada so aparece
                                      # pela reclamacao do cliente
  /api
    /availability/route.ts
    /experiences/route.ts             # catalogo PUBLICO: so ativas, sem `active` nem buffer_minutes
    /reservations/route.ts
    /reservations/[id]/status/route.ts # PUBLICA; so banco, no-store, sem dado pessoal (secao 7.1)
    /reservations/[id]/payment/route.ts # PUBLICA; QR atual do provedor, nunca cacheado
    /health/route.ts                  # ping do banco; e o que o Easypanel consulta (secao 19)
    /webhooks/asaas/route.ts          # SEM redirect; responde 200 rapido (401 por token e a UNICA excecao)
    /shared/[token]/agenda/route.ts   # [NAO CONSTRUIDO] ver /agenda/[token] acima
    /admin/schedule-exceptions/       # + [id] (PUT/DELETE) e validation.ts de borda
    /admin/operating-hours/           # idem; recusa faixas sobrepostas (409)
    /admin/blackouts/                 # idem; horario LOCAL do tenant, sem fuso
    /admin/financial-config/          # + discounts/[method] e card-machine-rates(/[id])
    /admin/reservations/[id]/balance/  # GET so LE (nunca cria) + charge/ (POST, o botao)
                                      # + receive-in-cash/ (POST, maquininha — Fase D)
    /admin/calendar/route.ts          # calendario nativo (secao 11.1)
    /admin/experiences/                # + [id] (PATCH). NAO tem DELETE (secao 7.2)
    /admin/reservations/[id]/          # detalhe + cancel/
    /admin/login|logout/route.ts
    /admin/integration/health          # [NAO CONSTRUIDO] par da tela /admin/integracao
/lib
  /db/schema.ts
  /db/client.ts
  /tenant.ts                          # tenant atual + settings cacheadas (SERVER-ONLY). getTenantId() = 1 FIXO (Etapa 2 pendente)
  /tenant-slug.ts                     # resolve o tenant pelo slug da URL + barreira da Etapa 2 (SERVER-ONLY). APAGAR quando a Etapa 2 entrar
  /reservations.ts                    # find-or-create, criacao transacional, setReservationStatus, recalcReservationPayment
  /availability.ts                    # motor de disponibilidade (SERVER-ONLY)
  /calendar.ts                        # leitura do calendario do admin (secao 11.1) — SERVER-ONLY, so leitura
  /reservation-detail.ts              # detalhe de UMA reserva (secao 11.1) — SERVER-ONLY; unico ponto que devolve CPF + documento + contato de emergencia
  /reservation-status.ts              # estado PUBLICO da reserva (secao 7.1) — SERVER-ONLY; query estreita, NAO reusa reservation-detail
  /reservation-list.ts                # busca/listagem de reservas p/ /admin/agendamentos (SERVER-ONLY); query NAO busca CPF/documento/contato; tambem resolve o ?reserva= do calendario
  /experiences.ts                     # CRUD de experiencias + catalogo publico (secoes 7.1 e 7.2) — SERVER-ONLY
  /resources.ts                       # leitura de recursos com capacity (secao 4.3) — SERVER-ONLY.
                                      # SO listActiveResources(): o [NAO CONSTRUIDO] CRUD de
                                      # recursos e para morar aqui quando existir
  /schedule-exceptions.ts             # CRUD de excecoes (secao 6) — SERVER-ONLY; TEM delete
  /operating-hours.ts                 # CRUD da grade semanal (secao 6) — SERVER-ONLY; recusa sobreposicao
  /blackouts.ts                       # CRUD de bloqueios (secao 6) — SERVER-ONLY; horario local -> UTC na borda
  /financial-config.ts                # configuracao financeira (secao 4-B.6) — SERVER-ONLY
  /basis-points.ts                    # percentual em bp: desconto, taxa, parte/resto — modulo PURO.
                                      # As Fases A..E REUSAM daqui, nunca reimplementam
  /cpf.ts                             # validacao/normalizacao de CPF — modulo PURO, unico algoritmo, usado pelo servidor E pelo wizard
  /maps.ts                            # URL de embed do mapa: lista de permissao http(s) — modulo PURO (secao 4.2)
  /terms/quadriciclo-v1.ts            # NAO IMPORTADO por nada. Fica para sempre: e o registro
                                      # das reservas que o aceitaram. Protegido por sha256 em
                                      # tests/x-termo.test.ts
  /terms/quadriciclo-v2.ts            # VIGENTE (secao 10). Versao nova = arquivo novo, nunca
                                      # edita o antigo
  /jobs/expire-holds.ts               # expiracao de hold (secao 12)
  /jobs/reconcile-payments.ts         # job de 10 min (secao 8-B); vizinho do expire-holds, mesmo padrao
  /templates/types.ts                 # forma de um template de segmento
  /templates/quadriciclo.ts           # o template do Quadri Club (secao 11-B)
  /payments/provider.ts               # interface PaymentProvider + erros tipados (config/auth/rede/API)
  /payments/asaas.ts                  # UNICO arquivo que fala "asaas": cobranca, QR, consultar, cancelar, token do webhook
  /payments/money.ts                  # centavos -> reais SEM ponto flutuante; travessia unica para o provedor
  /payments/charge.ts                 # cria a cobranca da reserva FORA da transacao (secao 5.2 passo 5)
  /payments/receive-in-cash.ts        # registro manual da maquininha (Fase D) — SERVER-ONLY.
                                      # Congela bruto/modalidade/percentual/liquido (4-B.7),
                                      # grava o RASTRO e cancela a cobranca Pix do saldo
  /payments/balance-charge.ts         # cobranca do SALDO sob demanda (secao 8-D) — SERVER-ONLY.
                                      # Tres camadas de idempotencia; withBalanceLock e o
                                      # PONTO UNICO onde a trava e tomada
  /payments/process.ts                # FUNCAO UNICA usada pelo webhook E pela reconciliacao.
                                      # O ramo de REVERSAO (estorno/chargeback) vem ANTES da
                                      # idempotencia, de proposito — secao 4-B.9
  /notifications.ts                   # [NAO CONSTRUIDO] Resend (assincrono). Cortado do
                                      # go-live em 21/08; a tela `confirmed` de /reserva/[id] e
                                      # a UNICA confirmacao que o cliente recebe (secao 9)
  /auth.ts
  /time.ts
/scripts
  /seed.ts                            # aplica o template ao tenant (npm run db:seed)
  /hash-password.ts                   # gera o hash bcrypt do admin (npm run auth:hash)
  /seed-demo-reservations.ts          # movimento FALSO p/ ver o admin (npm run db:seed:demo) — NUNCA em producao
/tests                                # integracao contra o Postgres local (Vitest).
                                      # Grupo Y = cartao e chargeback (Fase E)
/drizzle
/instrumentation.ts                   # fail-fast de auth e de pagamento + agenda os crons de hold (1 min) e reconciliacao (10 min)
/proxy.ts                             # NAO pode redirecionar /api/webhooks/*
docker-compose.dev.yml                # SO Postgres local; producao e Easypanel (secao 2)
Dockerfile
vitest.config.ts
.env.example
```

**`/lib` e biblioteca, `/scripts` e executavel.** Modulo em `/lib` pode ser importado por qualquer caminho do app sem efeito colateral; arquivo em `/scripts` roda ao ser carregado e escreve no banco. Um seed dentro de `/lib` viraria escrita acidental no primeiro import distraido.

**Marcador `server-only`:** `tenant.ts` e `availability.ts` declaram `import 'server-only'`. Consequencia medida: dentro do Next (rotas, Server Components, `instrumentation.ts`) o import resolve normal; em **processo Node cru** (script `tsx`, Vitest) ele **lanca**. Por isso `scripts/seed.ts` nao importa `tenant.ts` e declara o tenant id localmente.

---

## 15. Casos de borda que DEVEM ser tratados

1. **Corrida no último recurso** → exclusion constraint; perdedor recebe `409`.
2. **Reserva de N recursos com N-1 livres** → rollback total → `409`.
3. **Grade desatualizada** → recheck no POST → `409`.
4. **Pagamento tardio** → seção 8.3.
5. **Webhook duplicado** → idempotência por evento e por estado.
6. **Webhook de cobrança órfã** (Pix pessoal do dono) → log + `200`, nunca erro.
7. **Fila de webhook interrompida** → reconciliação (8-B) cobre; admin mostra saúde.
8. **Campo novo no payload do Asaas** → validação tolerante, ignora desconhecidos.
9. **Falha ao criar cobrança no Asaas** após a transação → reserva vira `expired`, vaga liberada, cliente avisado.
10. **Saldo não pago no dia** → passeio é decisão do dono (regra de negócio, não do software); sistema mantém saldo `pending` e sinaliza.
11. **Saldo pago por fora** → `receiveInCash`; reserva nunca fica com pendência invisível.
12. **Cancelamento com sinal pago** → cobrança de saldo removida, sinal marcado para estorno manual, política do termo aplicada.
13. **Estorno integral recusado (400)** por taxa/saldo → tratar e orientar o dono; não travar o cancelamento.
14. **Sync reserva/alocação** → só via `setReservationStatus`.
15. **Sync reserva/pagamentos** → só via `recalcReservationPayment`.
16. **Termo sem scroll completo** → botão desabilitado; servidor revalida.
17. **Cliente recorrente** → find-or-create por (tenant, phone).
18. **Timezone** → `America/Sao_Paulo` nas bordas; UTC no banco.
19. **Duas experiências diferentes sobrepostas (tenant com `single_experience_per_slot`)** → bloqueado na disponibilidade (passo 2b) + recheck na criação sob `pg_advisory_xact_lock(tenant_id)`; a segunda experiência sobreposta é recusada (`409`). Mesma experiência não é afetada. Tenant sem o flag: comportamento inalterado.
20. **Garupa abaixo da idade mínima da experiência** → `422` antes de qualquer escrita, com a idade exigida na mensagem; o wizard espelha a checagem para o cliente errar antes de pagar. Sem `birthdate` também é recusa (fail-closed). A conta é na **data do passeio**, então quem completa a idade no intervalo é aceito.
21. **Setting de mapa vazia, ausente ou malformada** → a tela **omite o bloco inteiro**, sem erro. URL com esquema não-http(s) é tratada como ausente (`lib/maps.ts`): guardar URL em vez de HTML fecha a porta larga do XSS, e a lista de permissão fecha a estreita (`javascript:` no `src`).

---

## 16. Escopo

### MVP (construir agora)

- Modelagem genérica multi-tenant-ready (tenant fixo 1); settings com labels do Quadri Club.
- Reserva de 1..N recursos (escolha do cliente); revezamento de operadores.
- Motor de disponibilidade por `resourcesNeeded`; buffer; anti-overbooking.
- Máquina de estados com hold 15min e pagamento tardio.
- Horários recorrentes + blackouts + exceções de agenda, com CRUD no admin (seção 7.2).
- **Pagamento via Asaas**: **Pix** (integral e sinal) e **cartão de crédito**
  (integral, pela `invoiceUrl`, com chargeback tratado). **REDESENHADO na rev 7 (seção 4-B):** preço cheio na experiência, desconto do Pix configurável por tenant, cartão sem acréscimo, sinal de **50% fixo só no Pix**, configuração financeira em tabela própria e valores congelados no registro.
- **`reservation_payments`** (sinal + saldo), com `recalcReservationPayment`.
- **Cobrança do saldo no dia**: QR na hora + **`receiveInCash`** para recebimento por fora.
- **Webhook robusto** (200 exato, sem redirect, assíncrono, tolerante, órfã ignorada) + **job de reconciliação**.
- Coleta de documento dos operadores.
- Termo de aceite digital (com política de sinal quando aplicável).
- **Idade mínima do garupa por experiência**, validada no servidor e espelhada no wizard, contada na data do passeio.
- **Mapa do ponto de encontro** na tela de confirmação (iframe + link de fallback), a partir de `settings.meeting_point_map_url`.
- Cadastro de cliente + histórico; campo `channel`.
- Formulário público ponta a ponta.
- **Calendário nativo** no admin (com marcador de saldo) + detalhe de reserva com ações de cobrança.
- **Lista consultável de reservas** no admin (`/admin/agendamentos`): busca por nome ou telefone, filtro por status e período, somente leitura, sem CPF/documento/contato na listagem.
- **Agenda compartilhada por link secreto** (sem dados pessoais nem financeiros).
- ~~Notificações por e-mail (Resend).~~ **CORTADO do go-live em 21/08** (seção 9 e `docs/DECISOES.md`); primeira semana pós go-live.
- Timezone fixo.
- **Exclusividade de experiência por horário**, configurável por tenant (`single_experience_per_slot`): bloqueia experiências diferentes sobrepostas; mesma experiência segue limitada por recurso. Quadri Club: ligado.
- **Faturas do cliente no admin:** histórico de agendamentos do cliente com status de pagamento (banco local) e link para a fatura no Asaas.

### Pós go-live / v2 (NÃO construir agora)

- ~~**Cartão de crédito** (Asaas)~~ — **CONCLUÍDO na Fase E** (seções 4-B.8 e
  4-B.9). Continua **fora do escopo**: **parcelamento** (a taxa cresce por
  parcela) e **antecipação de recebíveis**. Hoje a cobrança é sempre à vista, e o
  líquido vem lido do provedor, então parcelar não exigiria conta nova — exigiria
  decidir quem paga a diferença, que é decisão de negócio.
- **Asaas Tap** (celular do guia como maquininha) como caminho oficial do saldo, com baixa automática.
- **WhatsApp** (Evolution + n8n).
- **Google Calendar** (espelho opcional).
- **API de parceiro** (Aventurando nível 2: disponibilidade autenticada + criação de reserva; comissão/voucher).
- Estorno automático; reagendamento self-service; cupom; fila de espera; preço sazonal.
- Wizard de onboarding self-service por template + novos templates; `price_mode per_person`.
- Multi-tenant completo, white-label, multi-idioma.
- **Split de pagamento (Asaas):** repasse automático a parceiro (ex.: Aventurando) por percentual ou valor fixo via `walletId`, com liga/desliga por tenant. Depende de o parceiro ter conta Asaas e fornecer o walletId; estorno com split exige conciliação entre contas.
- **Botão de suporte por WhatsApp** no formulário de agendamento (link `wa.me`, número vindo de settings). [Distinto da automação WhatsApp via Evolution, também v2.]
- **Dashboard com relatórios** e **permissões de múltiplos usuários** (hoje o admin é login único do dono — seção 13).

---

## 17. Ordem de implementação

1. **Fase 0 — Fundação:** Git/GitHub, Next+TS, Drizzle, Docker, deploy no VPS, CLAUDE.md no repo. Marco: rota no ar.
2. **Fase 1 — Núcleo:** schema (13 tabelas) + constraint + `setReservationStatus` + tenant/settings + find-or-create + disponibilidade + criação transacional + cron. Marco: reserva de 1 e 2 recursos trava as vagas certas, com cliente cadastrado.
3. **Fase 2 — Pagamento:** `PaymentProvider`/Asaas Pix + `reservation_payments` + modo integral e sinal + webhook robusto + reconciliação + pagamento tardio. Marco: Pix de teste confirma sozinho, e uma reserva com sinal fica `partial` com saldo em aberto.
4. **Fase 3 — Interfaces + termo:** formulário público (com sinal explícito), termo scroll-to-end, tela QR/polling, admin com calendário nativo, detalhe com **Cobrar saldo**/**Recebi por fora**, CRUDs, links compartilhados, cancelar-e-liberar. Marco: reserva ponta a ponta + saldo quitado pelos dois caminhos.
5. **Fase 4 — Integrações:** timezone + bordas + hardening + saúde da integração + checklist de produção. Marco original era o **go-live de 24/08**, que **não aconteceu** — ver abaixo. O sistema foi para produção e o ciclo do dinheiro foi validado com dinheiro real em 24/08.

### Faseamento da rev 7 (acordado em 25/08) — é este que vale agora

O lançamento foi adiado: o cliente só quer lançar com **todas as formas de
pagamento** prontas. **Sistema pronto em setembro; uso real no início de
outubro**, quando sai o vídeo do influenciador **@grandecampinas** e os leads
caem **de uma vez** — o primeiro volume real que o sistema vai ver.

| Fase | O que entra |
|---|---|
| **Fase 0** | ~~**Configuração financeira**: tabela própria (fora de `settings`), desconto do Pix por tenant, taxas da maquininha por modalidade (seção 4-B.6).~~ **CONCLUÍDA em 28/08** — migration 0006, `lib/basis-points.ts`, `lib/financial-config.ts`, `/admin/financeiro`. |
| **Fase A** | ~~**Preço por método** + **Pix integral com desconto** (seção 4-B.1 e 4-B.2).~~ **CONCLUÍDA em 28/08** — migration 0007 (`full_price_cents`, `discount_basis_points`), desconto aplicado sobre o TOTAL, wizard e servidor pela mesma `applyDiscount`. |
| **Fase B** | ~~**Sinal de 50% via Pix** (seção 4-B.2, 4-B.3 e 4-B.5), incluindo `confirmed` + `partial`.~~ **CONCLUÍDA em 28/08** — sem migration; passo de escolha no wizard, `deposit` destravado no CRUD, e as três telas mostrando a pendência. |
| **Fase C** | ~~**Cobrança do saldo sob demanda**, **idempotente** — apertar duas vezes não pode gerar duas cobranças.~~ **CONCLUÍDA em 31/08** — sem migration; três camadas de idempotência (seção 8-D), `GET`/`POST` separados, e o reconciliador parou de poluir o log. |
| **Fase D** | ~~**Registro manual da maquininha**, com **líquido e taxa congelados** (seção 4-B.7).~~ **CONCLUÍDA em 31/08** — migration 0008, botão "Recebi na maquininha" no painel, taxa ausente passa a REGISTRAR com líquido `NULL` (reversão registrada em 4-B.6). |
| **Fase E** | ~~**Cartão via `invoiceUrl`** (seção 4-B.8) + **chargeback** (seção 4-B.9).~~ **CONCLUÍDA em 01/09** — migration 0009 (`charge_stage` + CHECK do líquido relaxado), `createCardCharge`, terceira opção no wizard, telas de análise de risco, e o chargeback que **antes era traduzido e descartado**. |
| **Transversal** | ~~**Líquido lido do Asaas**~~ **CONCLUÍDA junto da Fase E**: o `netValue` já vinha no corpo do webhook e passou a ser gravado congelado no mesmo UPDATE que marca o pagamento. |
| **Termo v2** | Em **paralelo**: inclui a política de cancelamento e resolve a contradição das 48h (seção 4-C). |
| **Antes do vídeo** | **Testes com clientes reais.** O vídeo é evento de volume; descobrir problema com ele no ar é caro. |

### Autonomia do tenant — a área que vem DEPOIS do pagamento (01/09/2026)

**>>> O ENQUADRAMENTO MUDOU: o Quadri Club é o PRIMEIRO cliente, não O cliente. <<<**
Num produto vendido para outras empresas, **"o dev configura" é o que impede
vender o segundo**. Telas de configuração deixaram de ser conveniência e viraram
**requisito de produto**.

Ordem executável. Cinco dos sete itens levantados são a **mesma peça técnica**
(`settings`), então uma tela resolve quatro de uma vez:

| Fase | O que entra |
|---|---|
| **AUT-1** | **Termo de aceite editável, com versionamento IMUTÁVEL.** A mais complexa; a restrição está na seção 10 |
| **AUT-2** | **`/admin/configuracoes`**: telefone de suporte, o que levar, mapa e ponto de encontro (mais os rótulos e o nome do negócio, que são a mesma tela) |
| **AUT-3** | **CRUD de recursos** (os quadriciclos) — última entidade do catálogo sem tela |
| **AUT-4** | ~~**Idade mínima do garupa.**~~ **FECHADA** pelo seed insert-only |

**Regra de ordem, inviolável e transversal às quatro:**

> **TELA PRIMEIRO, `insert-only` no seed JUNTO com ela, item a item. Nunca antes.**

Tirar a reconciliação de um campo **sem tela** deixa o valor sem caminho de
conserto que não seja psql em produção (seção 19). É por isso que `settings` e
`resources` ainda reconciliam: **por falta de tela, não por decisão de que
devam.**

**Fora de escopo desta área, prioridade menor:** integração Asaas por tela e
criação de tenant novo — as duas dependem da **Etapa 2** (`getTenantId()` real,
seção 2-B).

---

## 18. Pré-requisitos operacionais do Asaas (dependem do cliente)

Sem estes itens o desenvolvimento trava. Cobrar do **Quadri Club** antes da fase que depende de cada um:

1. **Conta Asaas 100% aprovada, com prova de vida concluída** (a criação de chave Pix só habilita depois disso).
2. **Chave Pix cadastrada na conta.** Sem chave, o Asaas usa chave temporária de instituição parceira e o QR só é pagável até 23:59 do mesmo dia — além do risco de conversão: o nome exibido no app do banco do pagador precisa ser o do Quadri Club, senão agrava o receio de golpe que o sinal quer resolver.
3. **API key de produção e de sandbox** disponíveis para o `.env`.
4. **Webhook criado com token secreto próprio**, URL exata sem redirect, e e-mail de alerta configurado para avisar interrupção de fila.
5. **Régua de cobrança/notificações do Asaas ajustada**: desligar as notificações automáticas na cobrança de **saldo**, para o cliente não receber avisos de cobrança de algo que será pago presencialmente.
6. **Decisão de negócio registrada:** percentual do sinal, se é reembolsável, e o que fazer se o cliente não pagar o saldo no dia.

### Aprendido na integração (medido em 17/08/2026)

**CPF é obrigatório para cobrar.** `POST /v3/customers` aceita `cpfCnpj` null, mas `POST /v3/payments` recusa: *"Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente"*. Opcional no cadastro, obrigatório na venda. Por isso o wizard coleta CPF no passo 4, com validação de dígito verificador no front e no servidor (`lib/cpf.ts`, algoritmo único compartilhado). Sem isso o fluxo público ficava quebrado para cliente novo: ele preenchia tudo, a cobrança falhava, a reserva expirava e o horário voltava — sem ele entender por quê.

**O Asaas permite cliente duplicado.** Criar o cliente duas vezes não dá erro: dá dois cadastros. Por isso `customers.asaas_customer_id` é gravado e reutilizado, e gravado **no instante em que o cliente passa a existir**, antes de a cobrança ser tentada — senão cada falha de cobrança deixaria um cliente órfão a mais na conta do tenant.

**O Asaas opera no fuso de Brasília.** Data que ele informa (`paymentDate`) e data que ele aceita (`dueDate`, `paymentDate` de baixa) já são locais. Mandar data em UTC depois das 21h faz o dia virar: medido, `receiveInCash` recusou com *"A data selecionada 18/08/2026 não pode ser posterior a data atual"* quando em São Paulo ainda era 17.

### Credenciais e chaves (estado em 17/08/2026)
- **Asaas sandbox:** chave gerada, nome "aventix", sem expiração, sem permissão de saque. Salva em `ASAAS_API_KEY` no `.env` local. `ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3`.
- **Asaas produção:** ainda NÃO gerada. Gerar no painel do Asaas quando a Fase 4 (deploy) começar. Mesmas configurações: sem expiração, sem permissão de saque. Entrar no Easypanel como variável de ambiente, não em arquivo.
- **Chave SSH do VPS:** ainda NÃO configurada. Login atual é por senha de root (guardada com o dev). Configurar chave SSH é tarefa do hardening da Fase 4.

---

## 19. Armadilhas de infraestrutura (Easypanel)

### >>> O SEED NUNCA RODA EM PRODUÇÃO. MIGRATION APLICADA NÃO É DADO SEMEADO. <<< (descoberto em 28/08/2026)

**Leia esta antes das outras.** Não é "mais uma armadilha": é a que escondeu um
bug por **quatro dias**, e ela dispara em toda configuração nova.

**O mecanismo.** O `instrumentation.ts` do boot aplica **apenas migrations**
(decisão de 18/08). Semear é `lib/seed.ts`, chamado por `scripts/seed.ts` — e o
**build standalone do Next descarta `scripts/` da imagem**. Não existe nenhum
caminho automático que aplique o template em produção.

**Por que passa despercebido.** Toda configuração nova entra no template,
funciona no ambiente local, passa nos testes, sobe no deploy e **não chega ao
banco de produção** — sem erro, sem log e sem tela quebrada, porque o código
trata chave ausente **omitindo o bloco**, que é o comportamento *correto*
(seções 4.2 e 15, caso 21). Ou seja: a defesa que impede a tela de quebrar é a
mesma coisa que faz a falha ser silenciosa.

**O sintoma real, medido.** `meeting_point_map_url` foi escrita no template e
**nunca foi semeada em produção**. O mapa do ponto de encontro subiu no deploy de
24/08 e **nunca apareceu para cliente nenhum**. Ficou assim por quatro dias e só
foi descoberto em 28/08 **por acaso**, conferindo outra coisa. Ninguém procurava
por ele porque a tela renderizava perfeitamente — sem o mapa.

**REGRA QUE FICA:** todo deploy que introduza **setting nova** ou **tabela de
configuração** exige conferência por `SELECT` **no banco de produção**, na mesma
janela do deploy. Não confie no build verde, não confie na migration aplicada,
não confie no teste passando — nenhum dos três toca dado semeado.

```sql
SELECT key, value FROM settings ORDER BY key;
SELECT * FROM payment_method_discounts;
SELECT * FROM card_machine_rates;
```

**MEDIDO EM 28/08: uma única sessão exigiu QUATRO `UPDATE` manuais em
produção** — os dois preços cheios (Fase A), o `payment_mode` das experiências
(Fase B), o `meeting_point` com o texto oficial e o `what_to_bring` vazio. Nenhum
deles acusaria falha se fosse esquecido:

| Esquecer | O que acontece | Como apareceria |
|---|---|---|
| preços | cobra 7% a menos, em toda venda | só na conciliação |
| `payment_mode` | o passo de sinal não existe no wizard | ninguém percebe |
| `meeting_point` | a tela mostra o placeholder antigo | parece funcionando |
| `what_to_bring` | rótulo "O que levar" com texto velho junto do novo | parece funcionando |

**Os dois últimos são os que se esquece**, porque são conteúdo e não têm sintoma
técnico. O `what_to_bring` é o pior de todos: é um `UPDATE` que grava **string
vazia**, e "não fiz nada" é indistinguível de "não precisava fazer nada".

**CAMINHO DEFINITIVO, e ele DEIXOU DE SER CONVENIÊNCIA:** a rota
`POST /api/admin/seed`, protegida por sessão, chamando `seedTenant()` do próprio
código Next (já registrada mais abaixo nesta seção). Ela elimina a classe inteira
de falha, porque o seed passa a viajar dentro da imagem em vez de depender de
alguém lembrar de rodar SQL à mão. Com quatro ocorrências numa sessão só, o custo
de não a ter passou o custo de construí-la. Enquanto ela não existir, **a
conferência por `SELECT` é obrigatória e é a única rede**.

**Conferir CONTEÚDO exige mais que contar linhas.** Para texto multilinha, o
número de caracteres não prova nada: o console pode entregar o texto inteiro com
os `\n` colapsados, e aí o tamanho confere e a tela vira parede de texto. Conte
as quebras junto:

```sql
SELECT key, length(value) AS chars,
       length(value) - length(replace(value, chr(10), '')) AS quebras
FROM settings WHERE tenant_id = 1 AND key IN ('meeting_point','what_to_bring');
```

### O console web (bash e PostgreSQL Client) mente sobre COMMIT em SQL colado (medido em 19/08/2026)

**Nunca cole um script SQL multi-statement no console web do Easypanel esperando que ele persista.** Medido ao semear o catálogo de produção pela primeira vez: um arquivo criado com `cat > /tmp/seed.sql << EOF` e executado com `psql -f` reportou 19 `INSERT 0 1` e `COMMIT` — sucesso aparente completo. Um `SELECT count(*)` rodado **na mesma sessão do console**, logo em seguida, confirmou as linhas. Mas conexões novas depois disso (`psql -c` a partir de um bash recém-aberto) viram as tabelas **vazias**. Só sobreviveu o `INSERT` do tenant, que por acaso tinha sido feito à parte, como statement isolada via `psql -c`.

**Diagnóstico:** o console web (tanto o `bash` quanto o `PostgreSQL Client` embutido) processa a colagem de um jeito que quebra a semântica de transação — a sessão morre antes do `COMMIT` persistir de verdade, mas as mensagens de sucesso (`INSERT 0 1`, `COMMIT`) são reais **dentro daquela sessão fantasma**. O `SELECT` seguinte, rodado na mesma sessão, ainda enxergava os dados — o que reforça a ilusão de que funcionou. Rollback silencioso, só visível de fora.

**A prova:** um `INSERT` de teste rodado como `psql -c "INSERT ..."` isolado (conexão nova por chamada, autocommit implícito, sem `BEGIN`/`COMMIT` explícito) persistiu na hora e ficou visível para outras conexões e para a aplicação via HTTP. Repetir o mesmo `INSERT` com o mesmo id falhou por `duplicate key` — prova de que a primeira vez gravou de verdade.

**Regra para qualquer SQL manual em produção via console do Easypanel:**
1. Cria o arquivo com `cat > /tmp/x.sql << 'EOF' ... EOF`.
2. Executa com `psql -U aventix -d aventix -f /tmp/x.sql`.
3. **Imediatamente depois**, verifica numa conexão NOVA — comando `psql -c` separado, nunca continuação da mesma sessão: `psql -U aventix -d aventix -c "SELECT count(*) FROM ..."`.
4. Conexão nova mostra os dados → persistiu, segue o jogo.
5. Conexão nova mostra zero → o `psql -f` colado enganou. Cai para o padrão seguro: `psql -c` **linha a linha, uma statement por comando**, autocommit implícito. Verboso, mas garantido.

**Caminho permanente (pós go-live, não agora):** uma rota `POST /api/admin/seed`, protegida por sessão, chamando a função de seed do próprio código Next — mesma lógica da migration-no-boot (seção 12), o `drizzle-orm` já bundlado. Elimina de vez a necessidade de SQL manual em produção. Registrar como tarefa pós go-live.

**O escape `\$` vale para o `.env` local e NÃO vale para o Easypanel (medido em 21/08/2026).**

Esta é a inversão que derrubou produção: os dois fail-fast do boot dispararam
porque `ADMIN_PASSWORD_HASH` e `ASAAS_API_KEY` chegaram ao container com a
**contrabarra literal dentro do valor**. A regra correta tem dois lados opostos,
e generalizar um para o outro quebra nas duas direções:

| Onde | Comportamento | O que escrever |
|---|---|---|
| Arquivo `.env` local | O carregador do Next (`@next/env`) **expande** `$`, inclusive dentro de aspas simples. Só o escape protege. | `ADMIN_PASSWORD_HASH=\$2b\$12\$...` |
| Editor de variáveis do Easypanel | **Não expande e não escapa.** O painel passa o valor literalmente ao container. | `ADMIN_PASSWORD_HASH=$2b$12$...` (cru, sem contrabarra) |

Afeta as duas chaves cujo valor começa ou contém `$`: o hash bcrypt do admin
(três cifrões) e a chave do Asaas (`$aact_...`).

**Sintoma quando erra:** o fail-fast do boot acusa **comprimento errado**, nunca
"variável mal formatada". O bcrypt tem 60 caracteres e chega com **63** — uma
contrabarra por cifrão do hash; a chave do Asaas "não começa com `$aact_`",
porque começa com `\`.

**Diagnóstico, no console do container:**

```
printf '%s' "$ADMIN_PASSWORD_HASH" | cut -c1-4
```

Se vier contrabarra, é isto. Não é senha errada, não é variável ausente.

**Armadilha adicional do painel:** alguns editores do Easypanel **reescrevem
sozinhos** um valor iniciado por `$` para `\$` ao salvar. Depois de salvar,
**REABRA o campo e confira antes de fechar o modal** — o valor que você digitou
não é necessariamente o que ficou gravado.

**Custo real, e por que ele é surdo:** com isso quebrado, o painel admin não
autentica e nenhuma reserva se completa em produção — mas **o site público
continua no ar vendendo**. Do ponto de vista do cliente não há erro nenhum: ele
preenche, paga, e a cobrança não é criada. A falha só aparece quando alguém tenta
entrar no admin, ou quando o dinheiro não chega.

**Settings e recursos têm duas casas, e a definitiva é o template (descoberto em 21/08/2026).**

> **>>> ISTO VALE PARA `settings` E `resources`. NÃO VALE MAIS PARA
> `experiences`. <<<** Desde 01/09 o bloco de experiências é **insert-only** —
> ver o quadro logo abaixo.

`seedTenant()` **sobrescreve** toda linha de `settings` cujo valor divirja de
`lib/templates/quadriciclo.ts` (`lib/seed.ts`: se existe e difere, faz UPDATE), e
faz o mesmo com `capacity` e `active` de `resources`. Um valor digitado direto no
Postgres de produção sobrevive aos deploys — o boot só roda `migrate`, não
semeia —, mas **some no dia em que alguém rodar o seed**, inclusive pela futura
rota `POST /api/admin/seed`. Sem erro, sem log, e ninguém vai associar o sumiço
ao seed que rodou por outro motivo.

**Regra:** ao semear uma setting à mão em produção, escreva **também** no
template. O banco é onde o valor passa a valer agora; o template é onde ele
sobrevive. Descoberto ao adicionar `support_whatsapp`, que nasceu vazia
justamente porque o número ainda não existe.

#### O que o seed reconcilia e o que ele NÃO toca

| Bloco | Comportamento | Por quê |
|---|---|---|
| `tenants` (nome, **slug**) | **insert-only** | slug é endereço público; renomear é migration |
| `settings` (15 chaves) | **reconcilia** | **não tem tela** — ver a regra de ordem abaixo |
| `resources` (capacity, active) | **reconcilia** | **não tem tela** |
| `experiences` (9 campos) | **insert-only** desde 01/09 | tem tela (`/admin/experiencias`) |
| `operating_hours` | insert-only de fato | a faixa inteira é a identidade |
| `payment_method_discounts` | insert-only | tem tela (`/admin/financeiro`) |
| `card_machine_rates` | não semeia | taxa chutada é número errado com cara de certo |
| órfãos | só relata | pode ter reserva apontando |

**>>> `settings` e `resources` reconciliam HOJE POR FALTA DE TELA, e não por
decisão de que devam. <<<** O **destino de todos eles é insert-only**. A regra de
ordem é inviolável:

> **TELA PRIMEIRO, insert-only JUNTO com ela, item a item. Nunca antes.**

Tirar a reconciliação de um campo **sem tela** piora a situação em vez de
melhorar: hoje um valor errado se conserta editando o template e rodando o seed,
o que ao menos passa por revisão e fica no git. Sem reconciliação e sem tela, o
único caminho vira **psql em produção** — que esta mesma seção documenta como
armadilha, com o console do Easypanel mentindo sobre `COMMIT`.

**O seed RELATA o que não corrige.** Todo bloco insert-only compara com o
template e, na divergência, imprime uma linha em `DIVERGEM DO TEMPLATE`. É
**relato neutro, não alarme** — depois da primeira edição do dono, divergência é
o estado normal e permanente, e aviso que dispara sempre vira fundo (a regra da
seção 8-B). O valor dele é ser o **diff** de quem for investigar por que produção
não é o template.

**Consequência para a futura `POST /api/admin/seed`:** ela deixa de ser
ferramenta de **reparo** e passa a ser de **criação**. "Rodar o seed para
consertar" só funciona no que ainda reconcilia; em experiências e no desconto,
o seed cria o que falta e relata o resto. Isto precisa estar claro **antes** de
alguém contar com aquela rota para desfazer um erro.

**Domínio novo no mesmo serviço herda `https://` no destino interno, quebra com 500.**
Ao adicionar um host extra na aba Domains de um serviço já existente, o campo de
destino interno (`http://<container>:<porta>/`) às vezes vem preenchido como
`https://`. O container Next só fala HTTP puro na porta interna — não tem TLS
configurado ali, TLS é coisa do Traefik na borda. Com `https://` no destino, o
Traefik tenta handshake TLS contra um servidor que não entende, e devolve `500`
de upstream, fácil de confundir com falha do Let's Encrypt (que nesse caso emitiu
normal). Sintoma: `/api/health` no domínio novo responde `500` mesmo com
certificado válido e app saudável no domínio antigo. **Conserto:** editar a linha
do domínio novo e trocar `https://` por `http://` no campo de destino interno.
**Regra que fica:** ao adicionar QUALQUER domínio novo a um serviço existente
(próximo tenant, por exemplo), conferir esse campo contra as linhas que já
funcionam antes de testar — não assumir que o padrão do formulário replica o que
já está configurado.
