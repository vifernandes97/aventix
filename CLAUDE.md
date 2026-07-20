# CLAUDE.md — Aventix · Plataforma de Agendamento de Experiências (aventix.com.br)

> Produto: **Aventix**. Cliente 1 (e único no MVP): **Quadri Club / Terra Trilha**.

> Documento-fonte do projeto. Leia por completo antes de escrever qualquer código.
> Se algo neste documento conflitar com uma sugestão sua, este documento vence.
> Escopo travado: implemente **apenas** o que está na seção MVP. O que está em pós go-live / v2 **não** deve ser construído agora, mesmo que pareça fácil.
>
> **Revisão 5.1** — nova seção 11-B: o seed do MVP deve ser escrito como **template de segmento** (formato que o futuro onboarding self-service reusará); form builder proibido. Sem outras mudanças funcionais.
>
> **Revisão 5** — o produto ganhou nome e domínio: **Aventix / aventix.com.br**. Sem mudanças funcionais desde a rev 4. Regra de marca: "Aventix" é o nome da plataforma (repo, admin, infra, e-mails transacionais de sistema); a UI pública de reserva exibe a marca do **tenant** (`settings.business_name` = "Quadri Club"), nunca "Aventix" hardcoded no lugar da marca do cliente.
>
> **Revisão 4** — mudanças desde a rev 3:
> (a) **Modelagem genérica** ("build for one, design for many"): o domínio deixa de ser quadriciclo e vira reserva de recursos. `quads`→`resources`, `tour_types`→`experiences`, `reservation_quads`→`reservation_resources`, papéis `condutor/garupa`→`operator/passenger`. Labels de UI e textos operacionais viram configuração (settings). `tenant_id` em todas as tabelas (fixo em 1 no MVP). `capacity` por recurso. `price_mode` na experiência (só `per_resource` implementado).
> (b) **Calendário nativo** como visão principal do admin. Google Calendar sai do MVP (vira espelho opcional pós go-live).
> (c) **Agenda compartilhável por link secreto** (somente leitura, sem dados pessoais) para parceiros — caso real: Aventurando (compra coletiva) consulta a agenda do Quadri Club para vender.
> (d) Campo **`channel`** na reserva para medir origem (ex.: `?canal=aventurando` no formulário público).
>
> **A UI do MVP continua 100% Quadri Club** (fala "Quadriciclo", "Condutor", "CNH") — esses textos vêm de settings, não de hardcode. O escopo funcional não cresceu: mudou a modelagem, não o produto.

---

## 1. Contexto do projeto

**Aventix** (aventix.com.br) é um sistema de agendamento online de **experiências que alugam recursos por horário**. O cliente 1 (e único no MVP) é o **Quadri Club / Terra Trilha**: passeios de quadriciclo. O cliente final escolhe uma experiência, quantos recursos quer (1 ou 2 quadris), um horário, informa os participantes, **aceita o termo de responsabilidade** (scroll-to-end) e paga via **Pix**. A reserva confirma automaticamente quando o Pix cai; cliente e agendamento ficam cadastrados. O dono opera tudo por um painel com **calendário nativo** e pode compartilhar a agenda (somente leitura) com parceiros por link secreto.

**Modelo de negócio:** software vendido pela Neosoluti por assinatura. O dinheiro dos passeios flui direto do cliente final para a conta **do tenant** (Quadri Club) no Asaas. O sistema **nunca** toca no dinheiro.

**Visão de produto (não construir agora):** o mesmo motor serve locações (bikes, caiaques, equipamentos), espaços por horário (quadras, estúdios, salas) e outras experiências de recurso fungível. Por isso a modelagem é genérica e multi-tenant-ready desde a primeira migration — mas o MVP entrega um único tenant, com a experiência do Quadri Club.

### Regras físicas do negócio (tenant Quadri Club)

- **2 recursos** (quadriciclos), fungíveis: qualquer um serve qualquer experiência. `capacity = 2` (1 piloto + 1 garupa).
- **2 experiências** (tipos de passeio), com durações e preços diferentes. **Preço por recurso** (`price_mode = per_resource`).
- O cliente **escolhe quantos recursos** alugar (1 até o nº de recursos ativos). Preço = `preço da experiência × nº de recursos`.
- **2 operadores podem alugar 1 único recurso e revezar** (dirigir em turnos). Logo, nº de recursos é **escolha do cliente**, nunca derivado do nº de operadores.
- Regras de composição (validadas no servidor):
  - `nº de operadores >= nº de recursos` (cada recurso alugado precisa de ao menos um habilitado a operar);
  - `nº de participantes <= capacity × nº de recursos`.
- **Operador exige documento** (config do tenant: exigido = sim, label = "CNH"). Nº do documento coletado no checkout; documento físico conferido no dia.
- **Termo de aceite digital** antes de agendar (seção 10). Sem assinatura externa/ICP-Brasil.
- **Buffer** entre reservas no mesmo recurso, configurável por experiência (reabastecer, checar, briefing).

---

## 2. Stack

- **Runtime:** Node.js 22 LTS + TypeScript, ponta a ponta.
- **Framework:** Next.js 16 (App Router, Turbopack default). Front público, painel admin e API no mesmo repo.
- **Banco:** PostgreSQL (self-hosted no VPS, Docker). Requer `btree_gist`.
- **ORM:** Drizzle ORM. Migrations versionadas.
- **Pagamento:** **Asaas, somente Pix no MVP** (cartão pós go-live). Conta do tenant. Atrás de `PaymentProvider`.
- **Termo:** aceite digital próprio (scroll-to-end + captura + e-mail). Sem plataforma externa.
- **Notificações:** **e-mail via Resend no MVP.** WhatsApp (Evolution) pós go-live.
- **Calendário:** **nativo** (visão do admin lida do Postgres). Google Calendar = espelho opcional pós go-live.
- **Deploy:** VPS Hostinger (4GB) gerenciado via **Easypanel** — build a partir do `Dockerfile` do repo (não `docker-compose.yml` em produção; esse arquivo serve só para desenvolvimento local). Easypanel administra Traefik, domínio e SSL (Let's Encrypt) automaticamente. Postgres como serviço isolado do Easypanel, sem porta pública — mesmo padrão já usado por n8n/Evolution na mesma VPS.

> **Nota de deploy (Easypanel):** o Easypanel injeta sua própria variável `PORT` em runtime, que sobrescreve o `PORT=3000` do Dockerfile. O container roda de fato na porta que o Easypanel decidir (hoje: 80) — as rotas de domínio no Easypanel devem apontar para a porta real do log de boot do serviço, não para o valor fixado no Dockerfile.

### Fonte da verdade

O **Postgres é a única fonte da verdade** sobre disponibilidade. Qualquer calendário (nativo, compartilhado, espelhos futuros) é **visão**. Nunca deixe uma visão decidir se um horário está livre.

---

## 3. Convenções

- **Timezone:** `America/Sao_Paulo` fixo. `timestamptz` (UTC) no banco; conversão só na geração da grade e na exibição. `process.env.TZ='America/Sao_Paulo'`, date-fns-tz nas fronteiras.
- **Dinheiro:** inteiro em centavos. Nunca float.
- **Multi-tenant-ready:** toda tabela de negócio tem `tenant_id NOT NULL DEFAULT 1`. Toda query filtra por tenant (encapsule no data layer). No MVP existe só o tenant 1; **não** construa onboarding/gestão de tenants.
- **Labels/textos de UI** (nome do recurso, papéis, documento, ponto de encontro, o que levar): sempre de `settings`, nunca hardcode.
- **Segredos** em `.env` (nunca commitado). **IDs** de negócio: UUID. **Código em inglês, UI em português.**
- **Nunca** roteie dinheiro por conta que não seja a do tenant.
- Entregue blocos de código completos, não diffs.

---

## 4. Modelo de dados

### 4.1 Extensão e enums

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM ('pending_payment','confirmed','cancelled','expired');
CREATE TYPE payment_method AS ENUM ('pix','card');           -- 'card' reservado pos go-live
CREATE TYPE participant_role AS ENUM ('operator','passenger'); -- UI: Condutor / Garupa (labels em settings)
CREATE TYPE price_mode AS ENUM ('per_resource');              -- 'per_person' e futuro, NAO implementar
```

### 4.2 Tenant e configuração

```sql
CREATE TABLE tenants (
  id serial PRIMARY KEY,
  name text NOT NULL,                    -- "Quadri Club"
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Key-value por tenant. Chaves do MVP:
--  resource_label ("Quadriciclo"), resource_label_plural ("Quadriciclos"),
--  operator_label ("Condutor"), passenger_label ("Garupa"),
--  operator_document_required ("true"), operator_document_label ("CNH"),
--  meeting_point, what_to_bring, business_name, reply_to_email
CREATE TABLE settings (
  tenant_id int NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
```

### 4.3 Catálogo

```sql
-- Antes: quads. Recurso fisico reservavel.
CREATE TABLE resources (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name text NOT NULL,                    -- "Quad 1"
  capacity int NOT NULL DEFAULT 2 CHECK (capacity >= 1),  -- pessoas por recurso
  active boolean NOT NULL DEFAULT true
);

-- Antes: tour_types. Produto/experiencia vendida.
CREATE TABLE experiences (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  name text NOT NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes int NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  price_mode price_mode NOT NULL DEFAULT 'per_resource',
  price_cents int NOT NULL CHECK (price_cents >= 0),   -- por recurso
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE operating_hours (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=domingo
  opens time NOT NULL,
  closes time NOT NULL,
  CHECK (closes > opens)
);

CREATE TABLE blackouts (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  resource_id int REFERENCES resources(id),  -- NULL = todos os recursos
  period tstzrange NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.4 Cliente, reserva, alocação e participantes

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
  UNIQUE (tenant_id, phone)              -- find-or-create por telefone dentro do tenant
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  experience_id int NOT NULL REFERENCES experiences(id),

  resources_needed int NOT NULL CHECK (resources_needed >= 1), -- ESCOLHA do cliente; teto = nº de recursos ativos (validado no app)
  total_price_cents int NOT NULL,        -- experiences.price_cents * resources_needed (servidor)
  start_at timestamptz NOT NULL,

  channel text,                          -- origem da venda: NULL = direto; ex. 'aventurando' (via ?canal= no form)

  termo_version text NOT NULL,
  termo_accepted_at timestamptz NOT NULL,
  termo_accepted_ip text,
  termo_accepted_user_agent text,

  status reservation_status NOT NULL DEFAULT 'pending_payment',
  hold_expires_at timestamptz,

  payment_method payment_method NOT NULL DEFAULT 'pix',
  payment_id text,
  external_reference text,               -- = reservations.id, enviado ao Asaas

  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

CREATE UNIQUE INDEX idx_reservations_payment ON reservations (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_reservations_status_hold ON reservations (status, hold_expires_at);
CREATE INDEX idx_reservations_start ON reservations (tenant_id, start_at);
CREATE INDEX idx_reservations_customer ON reservations (customer_id);

-- Antes: reservation_quads. A trava anti-overbooking vive AQUI.
-- period = [start_at, start_at + duration + buffer). status ESPELHA reservations.status.
CREATE TABLE reservation_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  resource_id int NOT NULL REFERENCES resources(id),
  period tstzrange NOT NULL,
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
  role participant_role NOT NULL,        -- operator | passenger
  document_number text                   -- exigido p/ operator se settings.operator_document_required (validacao no servidor, nao em CHECK)
);
```

### 4.5 Agenda compartilhada (parceiros)

```sql
-- Link secreto de leitura da agenda (caso Aventurando).
CREATE TABLE shared_calendar_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id int NOT NULL DEFAULT 1 REFERENCES tenants(id),
  label text NOT NULL,                   -- "Aventurando"
  token text NOT NULL UNIQUE,            -- longo, nao-adivinhavel (nanoid >= 32 chars)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
```

### 4.6 Invariantes do modelo (LEIA)

- **`reservation_resources.status` atualiza SEMPRE junto com `reservations.status`, na mesma transação.** Centralize em `setReservationStatus(id, status)`. Denormalização exigida pelo `WHERE` da exclusion constraint.
- **`period` inclui o buffer:** `tstzrange(start_at, start_at + (duration+buffer) min)`. Fim exibido = `start_at + duration`.
- **`resources_needed` é escolha do cliente**, teto = nº de recursos ativos do tenant (validação no app; não engesse em CHECK).
- **Exclusion constraint** = defesa real contra double-booking, por recurso. Reserva de N recursos insere N linhas; qualquer colisão = rollback total.
- `total_price_cents` calculado **no servidor**. Documento de operador validado **no servidor** conforme settings.
- Find-or-create de `customers` por `(tenant_id, phone)`.
- `idx_reservations_payment` único = idempotência do webhook no banco.

---

## 5. Máquina de estados da reserva

Idêntica à rev 3 (aplica-se à reserva inteira; N recursos só confirmam juntos):

```
create → [pending_payment] (hold 15min)
  pagamento aprovado (webhook, hold valido, vagas livres) → [confirmed]
  hold vence sem pagar (cron) → [expired]
  dono cancela → [cancelled]
[confirmed] → dono cancela → [cancelled] (libera vagas; estorno manual; e-mail)
[expired] + Pix tardio → vagas livres? re-confirma : mantem expired + FLAG estorno manual
```

Transição de criação: find-or-create customer → insere reservation (termo + channel) + N reservation_resources (pending) + participants, tudo numa transação → cria cobrança Pix no Asaas (`externalReference = reservation.id`, expiração = hold) → e-mail reforçando o termo.

---

## 6. Motor de disponibilidade

Dado `experienceId`, `date` e `resourcesNeeded`:

1. Grade candidata: `operating_hours` do weekday, granularidade 30 min (`SLOT_GRANULARITY_MINUTES=30`), descarta `T + duration > closes`, descarta passado + `MIN_LEAD_MINUTES` (60).
2. Um candidato está disponível se **nº de recursos ativos livres** em `[T, T + duration + buffer)` (sem reserva ativa sobreposta, sem blackout do recurso ou global) **>= resourcesNeeded**.

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

3. O formulário pergunta **nº de recursos ANTES** de exibir a grade.
4. Na criação (`POST /reservations`), dentro da transação: reexecuta a checagem, aloca os primeiros `resourcesNeeded` recursos livres, 1 linha em `reservation_resources` cada. Menos livres que o pedido, ou colisão na constraint → rollback → `409`.

---

## 7. Contrato de API

### 7.1 Público

**`GET /api/availability?experienceId={id}&date={YYYY-MM-DD}&resourcesNeeded={n}`**
→ `{ "slots": [ { "startAt": "...", "label": "08:00" } ] }`

**`GET /api/termo`** → versão vigente do termo (texto + version).

**`POST /api/reservations`**
```json
{
  "experienceId": 1,
  "startAt": "2026-08-15T08:00:00-03:00",
  "resourcesNeeded": 1,
  "channel": "aventurando",
  "customer": { "name": "...", "phone": "+55...", "email": "...", "cpf": "...", "birthdate": "..." },
  "participants": [
    { "name": "...", "birthdate": "...", "role": "operator", "documentNumber": "..." },
    { "name": "...", "birthdate": "...", "role": "operator", "documentNumber": "..." }
  ],
  "termo": { "version": "2026-07-01", "acceptedAt": "..." }
}
```
Validações (servidor): termo aceito (`422`); operadores com documento se settings exigir (`422`); `operadores >= resourcesNeeded`; `participantes <= capacity_total_alocada`; `1 <= resourcesNeeded <= recursos ativos`; disponibilidade (`409`). Preço no servidor. IP/user-agent do termo capturados da requisição. `channel` vem de `?canal=` na página (querystring propagada ao POST); valor livre, sanitizado.

Resposta `201`: `{ reservationId, status, holdExpiresAt, payment: { method: "pix", qrCodeBase64, copyPaste, expiresAt } }`

**`GET /api/reservations/{id}/status`** → `{ status }`
**`POST /api/webhooks/asaas`** → seção 8.

**`GET /agenda/{token}`** (página) e **`GET /api/shared/{token}/agenda?from={date}&to={date}`** (dados) — agenda compartilhada, seção 11.

### 7.2 Admin (protegido por sessão)

- CRUD: `experiences`, `resources`, `operating_hours`, `blackouts`, `settings` (labels/textos), termo (versão vigente).
- `GET /api/admin/reservations?date=` — dia com participantes, documentos, recursos, channel.
- `GET /api/admin/calendar?from=&to=` — dados do calendário nativo (seção 11).
- `GET /api/admin/customers` — clientes + histórico.
- `POST /api/admin/reservations/{id}/cancel` — cancela, libera vagas, e-mail (estorno manual).
- CRUD `shared_calendar_links` (criar, revogar, regenerar token).

---

## 8. Webhook de pagamento (Asaas, Pix-only, idempotência)

Igual à rev 3: valida `asaas-access-token` (`401` se inválido); só `PAYMENT_RECEIVED`; **nunca confia no payload** — consulta `GET /v3/payments/{id}` e lê `externalReference`; idempotência por `payment_id` (índice único) e por estado; pago com hold válido → `setReservationStatus('confirmed')` + efeitos (e-mail; calendário nativo não precisa de efeito, é visão do banco); pago tardio → tenta reativar; colisão → mantém `expired` + flag estorno manual; responde `200`.

**Abstração `PaymentProvider`** (`createPixCharge`, `getPayment`, `verifyWebhook`); cartão (pós go-live) adiciona `createCardCharge` + `PAYMENT_CONFIRMED`.

---

## 9. Notificações (MVP: e-mail via Resend)

- **Termo reforçado** → cliente, após o aceite.
- **Reserva confirmada** → cliente (comprovante) + dono.
- **Lembrete pré-passeio** → cliente, 24h e 2h antes (cron).
- **Cancelamento pelo dono** → cliente.

Comprovante: experiência, data/hora (America/Sao_Paulo), duração, ponto de encontro (settings), o que levar (settings), lembrete do documento físico (label de settings). Falha de e-mail não derruba reserva (log + retry). WhatsApp = pós go-live.

---

## 10. Termo de aceite digital

Igual à rev 3: exibir termo completo; botão ativa só após **rolar até o fim**; captura dados do form + IP + timestamp + user agent + versão; grava em `reservations.termo_*`; e-mail reforçando os termos; texto versionado, editável no admin. Validade: MP 2.200-2/2001 e Lei 14.063/2020 (texto a validar com o jurídico).

---

## 11. Calendário nativo + agenda compartilhada

### 11.1 Calendário do admin (visão principal do painel)

- **Visão do dia**: uma coluna por recurso ativo ("Quad 1", "Quad 2" — labels de settings/nome do recurso), blocos de reserva com cliente, experiência, status (pending/confirmed) e buffers visíveis. Lida direto do Postgres (`/api/admin/calendar`).
- **Navegação**: seletor de data + mini visão da semana com contagem de reservas por dia.
- **Fora do MVP**: arrastar-e-soltar, visão mensal completa, recorrências.

### 11.2 Agenda compartilhada por link secreto (caso Aventurando)

- Página pública `agenda/{token}`: **mesma visão de calendário, somente leitura, SEM dados pessoais** — mostra apenas ocupado/livre por recurso e horário (e a experiência, opcionalmente). Nunca exibir nome, telefone, documento ou e-mail de cliente (LGPD).
- Token opaco (nanoid ≥ 32 chars), `noindex`, sem listagem, rate-limit leve.
- Admin gerencia os links: criar com label ("Aventurando"), revogar (mata o link), regenerar.
- **Nível 1 apenas**: o parceiro humano consulta e vende; a reserva entra pelo formulário público (com `?canal=aventurando`) ou pelo dono. **API autenticada para parceiro criar reserva = pós go-live.**

### 11.3 Google Calendar

**Fora do MVP.** Pós go-live como espelho opcional (efeito colateral da confirmação). O schema não reserva mais colunas para isso; quando entrar, adiciona-se tabela própria de espelhamento.

---

## 11-B. Seeds como templates de segmento

O seed do banco do MVP (tenant Quadri Club) deve ser escrito **no formato de template de segmento**: um JSON versionado em `/lib/templates/quadriciclo.ts` contendo `segment`, `settings` (labels, documento, textos operacionais), `resources` de exemplo, `experiences` de exemplo e as `onboarding_questions` do segmento (perguntas na língua do negócio → campos genéricos). O seed do MVP é simplesmente "aplicar o template quadriciclo ao tenant 1" com os valores reais do Quadri Club.

Racional: no futuro, o onboarding self-service de novos tenants será um wizard que escolhe um template e responde as perguntas (rafting, escuna, trilha guiada, kart, locações, quadras). Escrever o seed já nesse formato valida o conceito com custo ~zero. **Não construir no MVP:** o wizard de onboarding, outros templates além do quadriciclo, `price_mode per_person`, ou qualquer form builder (proibido; segmento que não couber em template ganha um template novo, nunca um construtor exposto ao usuário).

O formulário público **deriva da configuração** (regra já vigente): se o tenant tem 1 recurso, o passo de quantidade some; se `operator_document_required=false`, o campo de documento some. Nenhuma tela pode assumir o segmento.

---

## 12. Expiração de hold (cron)

A cada 1 minuto, via `setReservationStatus` (reserva + alocações na mesma transação): `pending_payment` com `hold_expires_at < now()` → `expired`. `pg_cron` (preferido) ou node-cron.

---

## 13. Autenticação do admin

Um único login (o dono). Cookie httpOnly assinado, credencial em `.env`. Middleware protege `/admin/*` e `/api/admin/*`. **Next 16:** o arquivo chama-se `proxy.ts` (export `proxy`, runtime Node) — `middleware.ts` está deprecado. Sem provider externo.

---

## 14. Estrutura de pastas

```
/app
  /(public)
    /page.tsx                         # experiencia → nº de recursos → horário → participantes+doc → TERMO (scroll) → Pix  (labels de settings; captura ?canal=)
    /reserva/[id]/page.tsx            # QR + polling
    /agenda/[token]/page.tsx          # agenda compartilhada somente-leitura (sem dados pessoais)
  /(admin)
    /admin/login/page.tsx
    /admin/page.tsx                   # CALENDARIO NATIVO (dia por recurso + navegacao semanal)
    /admin/clientes/page.tsx
    /admin/experiencias/page.tsx
    /admin/recursos/page.tsx
    /admin/horarios/page.tsx
    /admin/bloqueios/page.tsx
    /admin/termo/page.tsx
    /admin/configuracoes/page.tsx     # settings: labels, ponto de encontro, o que levar
    /admin/compartilhar/page.tsx      # links de agenda compartilhada (criar/revogar)
  /api
    /availability/route.ts
    /termo/route.ts
    /reservations/route.ts
    /reservations/[id]/status/route.ts
    /webhooks/asaas/route.ts
    /shared/[token]/agenda/route.ts
    /admin/...                        # experiences, resources, operating-hours, blackouts, settings, termo, reservations, calendar, customers, shared-links
/lib
  /db/schema.ts
  /db/client.ts
  /tenant.ts                          # helper: tenant atual (fixo 1 no MVP) + settings cacheadas
  /reservations.ts                    # find-or-create customer, criacao transacional, setReservationStatus
  /availability.ts
  /payments.ts                        # PaymentProvider (Asaas Pix)
  /notifications.ts                   # Resend
  /auth.ts
  /time.ts
/drizzle
/proxy.ts
docker-compose.yml
Dockerfile
.env.example
```

## 15. Casos de borda que DEVEM ser tratados

1. **Corrida no último recurso** → constraint deixa um passar; outro `409`.
2. **Reserva de N recursos com N-1 livres** → colisão em uma alocação = rollback total → `409`.
3. **Grade desatualizada** → recheck no POST → `409`.
4. **Pix tardio** → seção 8.
5. **Webhook duplicado** → idempotência.
6. **Sync reserva/alocação** → só via `setReservationStatus`.
7. **Termo sem scroll completo** → botão desabilitado no front; servidor revalida version+acceptedAt.
8. **Cliente recorrente** → find-or-create por (tenant, phone).
9. **Experiência não cabe no expediente** → candidato descartado.
10. **Link compartilhado revogado** → `agenda/{token}` responde 404 neutro; nunca vaza se o token existiu.
11. **Dados pessoais na agenda compartilhada** → proibido; só ocupado/livre.
12. **Falha de e-mail pós-confirmação** → log + retry, nunca rollback.
13. **Timezone** → America/Sao_Paulo nas bordas; UTC no banco.
14. **`channel` malicioso** → sanitizar (tamanho, charset); é rótulo, não lógica.

---

## 16. Escopo

### MVP (construir agora)

- Modelagem genérica multi-tenant-ready (tenant fixo 1): resources (capacity), experiences (price_mode per_resource), settings com labels/textos do Quadri Club.
- Reserva de 1..N recursos (escolha do cliente; N = recursos ativos); revezamento de operadores permitido; validações de composição.
- Motor de disponibilidade por `resourcesNeeded`; buffer; anti-overbooking por exclusion constraint.
- Máquina de estados com hold 15min + Pix tardio.
- Horários recorrentes + blackouts.
- **Pix via Asaas** (conta do tenant), webhook idempotente, `PaymentProvider`.
- Coleta de documento dos operadores (config: CNH).
- **Termo de aceite digital** (scroll-to-end + captura + e-mail de reforço; versionado).
- **Cadastro de cliente** + histórico no admin; campo **channel** na reserva.
- Formulário público ponta a ponta (labels de settings; `?canal=`).
- **Calendário nativo** no admin (dia por recurso + navegação semanal) como tela principal.
- **Agenda compartilhada por link secreto** (somente leitura, sem dados pessoais; criar/revogar no admin) — parceiro Aventurando.
- Admin: experiências, recursos, horários, blackouts, settings, termo, clientes, cancelar-e-liberar.
- Notificações por e-mail (Resend).
- Timezone America/Sao_Paulo.

### Pós go-live / v2 (NÃO construir agora)

- **Cartão de crédito** (Asaas; parcelas/antecipação).
- **WhatsApp** (Evolution + n8n).
- **Google Calendar** (espelho opcional).
- **API de parceiro** (Aventurando nível 2: disponibilidade autenticada + criação de reserva com origem; comissão/voucher).
- **Wizard de onboarding self-service por template de segmento** (escolhe segmento → perguntas na língua do negócio → tenant configurado) + novos templates (rafting, escuna, trilha guiada, kart, locações, quadras).
- `price_mode per_person`, capacidade por sessão, agenda de guias/instrutores (famílias rafting/tirolesa/etc.).
- Reagendamento self-service; estorno automático; cupom; fila de espera; preço sazonal.
- Onboarding de tenants, white-label, multi-idioma, relatórios avançados por canal.

---

## 17. Ordem de implementação

1. **Fase 0 — Fundação:** Git/GitHub, Next+TS, Drizzle, Docker, deploy VPS, CLAUDE.md no repo. Marco: rota no ar.
2. **Fase 1 — Núcleo:** schema genérico (11 tabelas) + constraint + `setReservationStatus` + tenant/settings helper + find-or-create + disponibilidade por resourcesNeeded + criação transacional + cron. Marco: reserva de 1 e de 2 recursos trava as vagas certas via API, com cliente cadastrado.
3. **Fase 2 — Pagamento:** Asaas Pix + webhook + idempotência + tardio. Marco: Pix de teste confirma sozinho.
4. **Fase 3 — Interfaces + termo:** formulário público (labels/`?canal=`), termo scroll-to-end, tela QR/polling, admin com **calendário nativo**, clientes, CRUDs (incl. settings), **links compartilhados**, cancelar-e-liberar. Marco: reserva ponta a ponta (incl. 2 recursos e revezamento) + agenda compartilhada acessível por token.
5. **Fase 4 — Integrações + go-live:** e-mails Resend + timezone + bordas + hardening + checklist de produção. Marco: **GO-LIVE 24/08**.

Pós go-live: cartão, WhatsApp, Google Calendar, API de parceiro, SLA.
