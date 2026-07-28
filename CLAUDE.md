# CLAUDE.md — Aventix · Plataforma de Agendamento de Experiências (aventix.com.br)

> Produto: **Aventix**. Cliente 1 (e único no MVP): **Quadri Club / Terra Trilha**.
> Documento-fonte do projeto. Leia por completo antes de escrever qualquer código.
> Se algo neste documento conflitar com uma sugestão sua, este documento vence.
> Escopo travado: implemente **apenas** o que está na seção MVP.
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

### Regra de pagamento (rev 6)

Cada experiência tem um **modo de pagamento** configurável:

- **`full`** — cliente paga 100% no ato para confirmar. Padrão.
- **`deposit`** — cliente paga um **sinal** (percentual ou valor fixo) no ato; o **saldo** é cobrado presencialmente no dia do passeio.

Regras invioláveis do modo `deposit`:
- A reserva **confirma com o sinal pago**. O saldo em aberto **não** bloqueia a reserva nem libera a vaga.
- O saldo tem **duas formas de quitação**: cobrança online no dia (QR Code/fatura Asaas) ou **registro de recebimento por fora** (maquininha/dinheiro), via `receiveInCash`.
- **Nunca** deixe o saldo fora do sistema. Mesmo recebido por fora, ele é registrado — o dono não pode ter reserva com pendência invisível.
- Sinal é, por padrão, **não reembolsável** em cancelamento pelo cliente (política do tenant, configurável em settings como texto do termo). Estorno é **manual** no MVP (seção 8-C).

---

## 2. Stack

- **Runtime:** Node.js 22 LTS + TypeScript. **Framework:** Next.js 16 (App Router, Turbopack default) — público, admin e API no mesmo repo.
- **Banco:** PostgreSQL (Docker no VPS). Requer `btree_gist`. **ORM:** Drizzle, migrations versionadas.
- **Pagamento:** **Asaas**, **somente Pix no MVP** (cartão pós go-live). Conta do tenant. Atrás de `PaymentProvider`.
- **Termo:** aceite digital próprio. Sem plataforma de assinatura externa.
- **Notificações:** **e-mail via Resend no MVP.** WhatsApp (Evolution) pós go-live.
- **Calendário:** **nativo**. Google Calendar = espelho opcional pós go-live.
- **Deploy:** VPS Hostinger (4GB) gerenciado via **Easypanel** — build a partir do `Dockerfile` do repo (`docker-compose.dev.yml` serve só para desenvolvimento local; não há compose em produção). Easypanel administra Traefik, domínio e SSL automaticamente. Postgres como serviço isolado, sem porta pública. **O Easypanel injeta sua própria variável `PORT` em runtime, sobrescrevendo o Dockerfile** — as rotas de domínio devem apontar para a porta real do log de boot, não para o valor fixado no Dockerfile.

### Fonte da verdade

O **Postgres é a única fonte da verdade** sobre disponibilidade e sobre o estado financeiro da reserva. O Asaas é a fonte da verdade sobre o **status de cada cobrança** — por isso o webhook nunca é acreditado sozinho: sempre reconsulte a API (seção 8).

---

## 3. Convenções

- **Timezone:** `America/Sao_Paulo` fixo. `timestamptz` (UTC) no banco; conversão só na grade e na exibição.
- **Serialização de datas:** o schema usa `timestamp mode:'string'`, então o driver devolve o **texto cru do Postgres** (`2026-07-27 23:09:14.518994-03`): espaço no lugar do `T`, offset sem minutos, microssegundos. Toda função de `lib/` que devolva `timestamptz` para a camada de API converte para **ISO 8601** (`new Date(v).toISOString()`). O V8 tolera o formato cru, outros motores devolvem `NaN` — o sintoma aparece só no navegador do cliente. Colunas `date` (`birthdate`, `due_date`) já saem como `YYYY-MM-DD` e **não** passam por `new Date()`.
- **Dinheiro:** inteiro em centavos. Nunca float. Nunca calcule preço no cliente.
- **Multi-tenant-ready:** `tenant_id NOT NULL DEFAULT 1` em toda tabela de negócio; toda query filtra por tenant.
- **Labels/textos de UI** sempre de `settings`, nunca hardcode.
- **Segredos** em `.env`. **IDs** de negócio: UUID. **Código em inglês, UI em português.**
- Entregue blocos de código completos, não diffs.

---

## 4. Modelo de dados

### 4.1 Extensão e enums

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM ('pending_payment','confirmed','cancelled','expired');
CREATE TYPE payment_method AS ENUM ('pix','card');              -- 'card' pos go-live
CREATE TYPE participant_role AS ENUM ('operator','passenger');
CREATE TYPE price_mode AS ENUM ('per_resource');                -- 'per_person' e futuro
CREATE TYPE payment_mode AS ENUM ('full','deposit');            -- rev 6
CREATE TYPE payment_kind AS ENUM ('full','deposit','balance');  -- rev 6: papel de cada cobranca
CREATE TYPE payment_state AS ENUM ('pending','paid','cancelled','refunded');       -- por cobranca
CREATE TYPE reservation_payment_state AS ENUM ('pending','partial','settled');     -- agregado da reserva
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
-- business_name, reply_to_email, deposit_policy_text
--  single_experience_per_slot ("true"/"false", default "false"),
--  min_lead_minutes (inteiro >= 0 como string, default "60") — antecedencia minima para reservar
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

  -- rev 6: estado financeiro agregado (os pagamentos vivem em reservation_payments)
  payment_mode payment_mode NOT NULL,    -- snapshot de como foi vendido
  amount_paid_cents int NOT NULL DEFAULT 0,
  payment_state reservation_payment_state NOT NULL DEFAULT 'pending',

  termo_version text NOT NULL,
  termo_accepted_at timestamptz NOT NULL,
  termo_accepted_ip text,
  termo_accepted_user_agent text,

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
  created_at timestamptz NOT NULL DEFAULT now()
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
- **`resources_needed` é escolha do cliente**; teto = recursos ativos (validação no app, não em CHECK).
- **Preço e valor do sinal são calculados no servidor.** `deposit = round(total × deposit_percent/100)` ou `deposit_fixed_cents`; `balance = total − deposit`. Nunca confie em valor vindo do cliente.
- **`external_reference` é único e determinístico** (`"{uuid}:{kind}"`). É o que permite reconciliar mesmo se o `asaas_payment_id` se perder.
- Find-or-create de `customers` por `(tenant_id, phone)`.
- **Experiência gratuita não é suportada no MVP.** `price_cents = 0` produz `total = 0`, e a cobrança violaria `CHECK (amount_cents > 0)` na criação (erro 500); em `recalcReservationPayment` a reserva ficaria `pending` para sempre. O CRUD de experiências (Fase 3) deve recusar preço zero. O `CHECK (price_cents >= 0)` do schema fica como está — apertar para `> 0` exigiria migration e não se justifica antes do go-live.
> **Regra de arquitetura inviolável:** a garantia do `FOR UPDATE` (trava de linha contra corrida entre cron e webhook) só existe enquanto **todo caminho de escrita de status passar por `setReservationStatus`**. Um `UPDATE reservations SET status` direto em qualquer outro lugar fura a trava e quebra a proteção contra double-booking silenciosamente. Nunca atualize `reservations.status` ou `reservation_resources.status` fora dessa função.

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

**`GET /api/experiences`** → inclui `paymentMode`, `priceCents` e, quando `deposit`, `depositCents` e `balanceCents` **já calculados no servidor** para exibir no checkout.

**`GET /api/termo`** → texto + `version`.

**`POST /api/reservations`** — cria cliente, reserva, alocações, participantes e pagamentos. Corpo igual à rev 5, sem campo de pagamento (o modo vem da experiência).
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

**`GET /api/reservations/{id}/status`** → `{ status, paymentState, amountPaidCents, balanceCents }`
- `GET /api/admin/customers` — clientes + histórico de agendamentos, com **status de pagamento** por reserva (lido do banco local, mantido pelo webhook) e **link para a fatura no Asaas** (`invoiceUrl` persistido na criação da cobrança). Sem chamada ao Asaas em tempo real.

**`POST /api/webhooks/asaas`** → seção 8.

### 7.2 Admin (sessão)

- CRUD: `experiences` (incl. `payment_mode`, `deposit_percent`/`deposit_fixed_cents`), `resources`, `operating_hours`, `blackouts`, `settings`, termo, `shared_calendar_links`.
- `GET /api/admin/reservations?date=` — agenda do dia com participantes, documentos, recursos, channel **e saldo em aberto**.
- `GET /api/admin/calendar?from=&to=` — calendário nativo.
- `GET /api/admin/customers` — clientes + histórico.
- **`GET /api/admin/reservations/{id}/balance`** — retorna o saldo pendente e, sob demanda, o **QR Code Pix atual** da cobrança de saldo (buscado no Asaas **na hora**, nunca cacheado — QR expira).
- **`POST /api/admin/reservations/{id}/balance/receive-in-cash`** — chama `receiveInCash` no Asaas, marca `state='paid'`, `received_in_cash=true`, recalcula a reserva. Body: `{ paymentDate, value, notifyCustomer:false }`.
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
2. Lê `event` + `payment.id`. Eventos relevantes no MVP (Pix): **`PAYMENT_RECEIVED`** (pago) e **`PAYMENT_OVERDUE`** (vencido, usado só para sinalizar saldo em aberto).
3. **Reconsulta `GET /v3/payments/{id}`** — nunca decida pelo payload.
4. Localiza `reservation_payments` por `asaas_payment_id` (fallback: `external_reference`). Não achou → log + `200`.
5. Já `paid` → `200`, nada a fazer (idempotência).
6. Pago: numa transação, `state='paid'`, `paid_at`, e `recalcReservationPayment(reservationId)`. Se o pagamento é `full`/`deposit` e a reserva está `pending_payment` com vagas livres → `setReservationStatus('confirmed')`.
7. Enfileira efeitos (e-mail de confirmação/quitação). Responde `200`.

### 8.3 Pagamento tardio (hold vencido)

Igual às revisões anteriores: tenta reativar as alocações; vagas livres → re-confirma; colisão → mantém `expired`, marca o pagamento como pago, **sinaliza o dono para estorno manual**.

### 8-B. Job de reconciliação (rede de segurança — OBRIGATÓRIO)

A fila de webhook pode ser interrompida (15 falhas) e ficar horas sem entregar nada, com dinheiro entrando e o sistema sem saber. Rotina a cada **10 minutos**:

1. Seleciona `reservation_payments` com `state='pending'` e cobrança criada há mais de 5 min, cuja reserva ainda não está `cancelled`.
2. Consulta a API do Asaas (por `externalReference` ou por id) e aplica **exatamente a mesma função de processamento** do webhook (mesmo código, mesma idempotência).
3. Loga divergências.

Também exponha em `/admin` um indicador de saúde da integração (último webhook recebido, pendências reconciliadas). Se a fila cair, o dono vê antes do cliente reclamar. Reativação da fila é feita no painel do Asaas ou via API (`interrupted: false`).

### 8-C. Estorno (manual no MVP)

- Pix aceita estorno **integral ou vários parciais**, somando no máximo o valor recebido.
- **As taxas não voltam**: tentar estornar 100% logo após o recebimento pode retornar `400` por saldo insuficiente na conta do tenant.
- Portanto: **estorno é operação manual do dono** no painel do Asaas. O Aventix apenas registra o cancelamento e sinaliza "estorno pendente" na reserva. Estorno automático é pós go-live.

---

## 9. Notificações (MVP: e-mail via Resend)

- **Termo reforçado** → cliente, após o aceite.
- **Reserva confirmada** → cliente + dono. No modo `deposit`, o comprovante **destaca o saldo a pagar no dia** e a forma (com o guia, antes da saída).
- **Lembrete pré-passeio** (24h e 2h antes) → repete o saldo em aberto e o lembrete do documento físico.
- **Saldo quitado** → recibo ao cliente.
- **Cancelamento pelo dono** → cliente.

Comprovante inclui ponto de encontro e o que levar (de `settings`). Falha de e-mail nunca derruba a reserva.

---

## 10. Termo de aceite digital

Inalterado: exibe o termo completo; botão ativa só após **rolar até o fim**; captura dados do form + IP + timestamp + user agent + `version`; grava em `reservations.termo_*`; e-mail reforçando; texto versionado editável no admin. **Adição da rev 6:** quando a experiência for `deposit`, o termo deve conter a política do sinal (`settings.deposit_policy_text`), incluindo se é reembolsável. Validade: MP 2.200-2/2001 e Lei 14.063/2020 (texto a validar com o jurídico).

---

## 11. Calendário nativo + agenda compartilhada

### 11.1 Calendário do admin
Visão do dia com uma coluna por recurso ativo, blocos com cliente/experiência/status, buffers visíveis, seletor de data e faixa semanal com contagem. **Rev 6:** blocos com saldo em aberto recebem marcador visual (ex. "Saldo R$175"), e o detalhe da reserva traz os botões **Cobrar saldo** (QR na hora) e **Recebi por fora**. Essa tela é usada **no celular, em campo** — priorize legibilidade e toque.

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

Um único login (o dono). Cookie httpOnly assinado, credencial em `.env`. Middleware protege `/admin/*` e `/api/admin/*`. **Next 16:** o arquivo chama-se `proxy.ts` (export `proxy`, runtime Node) — `middleware.ts` está deprecado. Sem provider externo.

---

## 14. Estrutura de pastas

```
/app
  /(public)
    /page.tsx                         # experiencia → nº recursos → horario → participantes+doc → TERMO → pagamento (sinal ou integral)
    /reserva/[id]/page.tsx            # QR + polling
    /agenda/[token]/page.tsx          # agenda compartilhada (sem dados pessoais nem financeiros)
  /(admin)
    /admin/login/page.tsx
    /admin/page.tsx                   # CALENDARIO NATIVO (+ marcador de saldo em aberto)
    /admin/reservas/[id]/page.tsx     # detalhe + Cobrar saldo / Recebi por fora
    /admin/clientes/page.tsx
    /admin/experiencias/page.tsx      # incl. modo de pagamento e sinal
    /admin/recursos/page.tsx
    /admin/horarios/page.tsx
    /admin/bloqueios/page.tsx
    /admin/termo/page.tsx
    /admin/configuracoes/page.tsx
    /admin/compartilhar/page.tsx
    /admin/integracao/page.tsx        # saude do webhook / reconciliacao
  /api
    /availability/route.ts
    /experiences/route.ts
    /termo/route.ts
    /reservations/route.ts
    /reservations/[id]/status/route.ts
    /webhooks/asaas/route.ts          # SEM redirect; responde 200 rapido
    /shared/[token]/agenda/route.ts
    /admin/...                        # + reservations/[id]/balance, balance/receive-in-cash, integration/health
/lib
  /db/schema.ts
  /db/client.ts
  /tenant.ts                          # tenant atual + settings cacheadas (SERVER-ONLY)
  /reservations.ts                    # find-or-create, criacao transacional, setReservationStatus, recalcReservationPayment
  /availability.ts                    # motor de disponibilidade (SERVER-ONLY)
  /jobs/expire-holds.ts               # expiracao de hold (secao 12); vizinho do reconcile na Fase 2
  /templates/types.ts                 # forma de um template de segmento
  /templates/quadriciclo.ts           # o template do Quadri Club (secao 11-B)
  /payments/provider.ts               # interface PaymentProvider
  /payments/asaas.ts                  # criar cobranca, QR, consultar, receiveInCash, remover, verify webhook
  /payments/process.ts                # FUNCAO UNICA usada pelo webhook E pela reconciliacao
  /payments/reconcile.ts              # job de 10 min
  /notifications.ts                   # Resend (assincrono)
  /auth.ts
  /time.ts
/scripts
  /seed.ts                            # aplica o template ao tenant (npm run db:seed)
/tests                                # integracao contra o Postgres local (Vitest)
/drizzle
/instrumentation.ts                   # agenda o cron de hold no boot (secao 12)
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

---

## 16. Escopo

### MVP (construir agora)

- Modelagem genérica multi-tenant-ready (tenant fixo 1); settings com labels do Quadri Club.
- Reserva de 1..N recursos (escolha do cliente); revezamento de operadores.
- Motor de disponibilidade por `resourcesNeeded`; buffer; anti-overbooking.
- Máquina de estados com hold 15min e pagamento tardio.
- Horários recorrentes + blackouts.
- **Pagamento Pix via Asaas**: modo **integral** e modo **sinal** (percentual ou fixo, por experiência).
- **`reservation_payments`** (sinal + saldo), com `recalcReservationPayment`.
- **Cobrança do saldo no dia**: QR na hora + **`receiveInCash`** para recebimento por fora.
- **Webhook robusto** (200 exato, sem redirect, assíncrono, tolerante, órfã ignorada) + **job de reconciliação**.
- Coleta de documento dos operadores.
- Termo de aceite digital (com política de sinal quando aplicável).
- Cadastro de cliente + histórico; campo `channel`.
- Formulário público ponta a ponta.
- **Calendário nativo** no admin (com marcador de saldo) + detalhe de reserva com ações de cobrança.
- **Agenda compartilhada por link secreto** (sem dados pessoais nem financeiros).
- Notificações por e-mail (Resend).
- Timezone fixo.
- **Exclusividade de experiência por horário**, configurável por tenant (`single_experience_per_slot`): bloqueia experiências diferentes sobrepostas; mesma experiência segue limitada por recurso. Quadri Club: ligado.
- **Faturas do cliente no admin:** histórico de agendamentos do cliente com status de pagamento (banco local) e link para a fatura no Asaas.

### Pós go-live / v2 (NÃO construir agora)

- **Cartão de crédito** (Asaas). ATENÇÃO ao implementar: confirmar a reserva no evento **`PAYMENT_CONFIRMED`** (pago, saldo ainda não liberado) e **não** no `PAYMENT_RECEIVED`, que no crédito só chega ~32 dias depois. Tratar parcelamento (taxa cresce por parcela) e antecipação.
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
5. **Fase 4 — Integrações + go-live:** e-mails Resend (assíncronos) + timezone + bordas + hardening + saúde da integração + checklist de produção. Marco: **GO-LIVE 24/08**.

---

## 18. Pré-requisitos operacionais do Asaas (dependem do cliente)

Sem estes itens o desenvolvimento da Fase 2 trava. Cobrar do Terra Trilha **antes** da Fase 2:

1. **Conta Asaas 100% aprovada, com prova de vida concluída** (a criação de chave Pix só habilita depois disso).
2. **Chave Pix cadastrada na conta.** Sem chave, o Asaas usa chave temporária de instituição parceira e o QR só é pagável até 23:59 do mesmo dia — além do risco de conversão: o nome exibido no app do banco do pagador precisa ser o do Quadri Club, senão agrava o receio de golpe que o sinal quer resolver.
3. **API key de produção e de sandbox** disponíveis para o `.env`.
4. **Webhook criado com token secreto próprio**, URL exata sem redirect, e e-mail de alerta configurado para avisar interrupção de fila.
5. **Régua de cobrança/notificações do Asaas ajustada**: desligar as notificações automáticas na cobrança de **saldo**, para o cliente não receber avisos de cobrança de algo que será pago presencialmente.
6. **Decisão de negócio registrada:** percentual do sinal, se é reembolsável, e o que fazer se o cliente não pagar o saldo no dia.
