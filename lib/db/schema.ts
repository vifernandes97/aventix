// Aventix — schema de dados (CLAUDE.md secao 4).
// Modelagem generica multi-tenant-ready; tenant fixo 1 no MVP.
//
// NOTA sobre a trava anti-overbooking (secao 4.4 / 4.6):
// A exclusion constraint `EXCLUDE USING gist (resource_id WITH =, period WITH &&)`
// em `reservation_resources` e a extensao `btree_gist` NAO sao representaveis no
// DSL do Drizzle (0.45) nem geradas pelo drizzle-kit. Elas sao adicionadas via SQL
// customizado na migration (CREATE EXTENSION + ALTER TABLE ADD CONSTRAINT). Ver a
// migration gerada em /drizzle. Isso e esperado pelo CLAUDE.md ("adicione via SQL
// customizado na migration").

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  index,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// -- tstzrange: Postgres nao tem tipo nativo no Drizzle. period = [start, start+dur+buffer).
const tstzrange = customType<{ data: string }>({
  dataType() {
    return 'tstzrange';
  },
});

// helper: timestamptz (UTC no banco; conversao so nas bordas — secao 3).
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

// -- 4.1 enums --------------------------------------------------------------

export const reservationStatus = pgEnum('reservation_status', [
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
]);

export const paymentMethod = pgEnum('payment_method', ['pix', 'card']); // 'card' reservado pos go-live

export const participantRole = pgEnum('participant_role', ['operator', 'passenger']); // UI: Condutor / Garupa

export const priceMode = pgEnum('price_mode', ['per_resource']); // 'per_person' NAO implementar

// rev 6 — pagamento com sinal (secao 4.1)

// Como a experiencia e vendida: 100% no ato, ou sinal agora + saldo no dia.
export const paymentMode = pgEnum('payment_mode', ['full', 'deposit']);

// Papel de cada cobranca dentro da reserva.
// full = pagamento unico | deposit = sinal | balance = saldo cobrado no dia.
export const paymentKind = pgEnum('payment_kind', ['full', 'deposit', 'balance']);

// Estado de UMA cobranca (reservation_payments.state).
export const paymentState = pgEnum('payment_state', ['pending', 'paid', 'cancelled', 'refunded']);

// Estado financeiro AGREGADO da reserva (derivado de reservation_payments —
// nunca escrito na mao; so via recalcReservationPayment, secao 4.6).
export const reservationPaymentState = pgEnum('reservation_payment_state', [
  'pending',
  'partial',
  'settled',
]);

// -- 4.2 tenant e configuracao ---------------------------------------------

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(), // "Quadri Club"
  // Segmento da URL publica: /agendamento/{slug} (secao 2-B).
  //
  // UNIQUE porque e ENDERECO, nao rotulo: dois tenants com o mesmo slug fazem a
  // LP de um servir o outro, e o banco e o unico lugar que consegue garantir
  // isso sob concorrencia. NOT NULL porque tenant sem slug e tenant sem LP —
  // um estado que nao existe no produto.
  //
  // >>> A URL JA RESOLVE POR SLUG; getTenantId() AINDA NAO. <<<
  // Ver o comentario de Etapa 2 em lib/tenant.ts e a barreira em
  // tests/o-barreira-multi-tenant.test.ts antes de inserir um segundo tenant.
  slug: text('slug').notNull().unique(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// Key-value por tenant. tenant_id faz parte da PK (sem default no SQL da secao 4.2).
export const settings = pgTable(
  'settings',
  {
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// -- 4.3 catalogo -----------------------------------------------------------

export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(), // "Quad 1"
    capacity: integer('capacity').notNull().default(2), // pessoas por recurso
    active: boolean('active').notNull().default(true),
  },
  (t) => [check('resources_capacity_check', sql`${t.capacity} >= 1`)],
);

export const experiences = pgTable(
  'experiences',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull().default(15),
    priceMode: priceMode('price_mode').notNull().default('per_resource'),
    priceCents: integer('price_cents').notNull(), // por recurso

    // rev 6: modo de pagamento por experiencia (secao 4.3).
    // Valor do sinal e SEMPRE calculado no servidor (secao 4.6):
    // deposit = round(total * deposit_percent/100) ou deposit_fixed_cents.
    paymentMode: paymentMode('payment_mode').notNull().default('full'),
    depositPercent: integer('deposit_percent'), // usado se payment_mode='deposit'
    depositFixedCents: integer('deposit_fixed_cents'), // alternativa ao percentual

    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check('experiences_duration_check', sql`${t.durationMinutes} > 0`),
    check('experiences_buffer_check', sql`${t.bufferMinutes} >= 0`),
    check('experiences_price_check', sql`${t.priceCents} >= 0`),
    check('experiences_deposit_percent_check', sql`${t.depositPercent} BETWEEN 1 AND 99`),
    check('experiences_deposit_fixed_check', sql`${t.depositFixedCents} > 0`),
    // modo 'deposit' exige EXATAMENTE um dos dois (percentual XOR fixo)
    check(
      'experiences_deposit_mode_check',
      sql`${t.paymentMode} = 'full' OR (${t.depositPercent} IS NOT NULL) <> (${t.depositFixedCents} IS NOT NULL)`,
    ),
  ],
);

export const operatingHours = pgTable(
  'operating_hours',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    weekday: integer('weekday').notNull(), // 0=domingo
    opens: time('opens').notNull(),
    closes: time('closes').notNull(),
  },
  (t) => [
    check('operating_hours_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('operating_hours_range_check', sql`${t.closes} > ${t.opens}`),
  ],
);

export const blackouts = pgTable('blackouts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .default(1)
    .references(() => tenants.id),
  resourceId: integer('resource_id').references(() => resources.id), // NULL = todos os recursos
  period: tstzrange('period').notNull(),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// Excecoes a grade recorrente para uma data especifica. Cobre liberar
// (feriado em dia de semana: closed=false + horario) e bloquear (recesso:
// closed=true) numa unica peca. Precedencia sobre operating_hours (secao 6).
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    date: date('date').notNull(),
    opens: time('opens'), // NULL se closed=true
    closes: time('closes'), // NULL se closed=true
    closed: boolean('closed').notNull().default(false),
    reason: text('reason'), // "Recesso de fim de ano", "Feriado - abre"
  },
  (t) => [
    unique('schedule_exceptions_tenant_date_unique').on(t.tenantId, t.date),
    check(
      'schedule_exceptions_closed_check',
      sql`${t.closed} = true OR (${t.opens} IS NOT NULL AND ${t.closes} IS NOT NULL AND ${t.closes} > ${t.opens})`,
    ),
  ],
);

// -- 4.4 cliente, reserva, alocacao e participantes -------------------------

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    cpf: text('cpf'),
    birthdate: date('birthdate'),

    // Id do cliente no provedor de pagamento (cus_...). NULLABLE: cliente
    // anterior a esta coluna nao tem, e cliente novo so ganha o id quando a
    // primeira cobranca dele e criada. E gravado UMA vez e reutilizado —
    // o Asaas PERMITE cadastro duplicado, entao sem guardar o id cada reserva
    // criaria um cliente novo la.
    asaasCustomerId: text('asaas_customer_id'),

    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('customers_tenant_phone_unique').on(t.tenantId, t.phone), // find-or-create por telefone
    // Parcial: muitos clientes ainda sem id no provedor (NULL nao colide), mas
    // um mesmo cus_... nunca pode se vincular a dois clientes do Aventix.
    uniqueIndex('idx_customers_asaas')
      .on(t.asaasCustomerId)
      .where(sql`${t.asaasCustomerId} IS NOT NULL`),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    experienceId: integer('experience_id')
      .notNull()
      .references(() => experiences.id),

    resourcesNeeded: integer('resources_needed').notNull(), // escolha do cliente; teto validado no app
    totalPriceCents: integer('total_price_cents').notNull(), // price_cents * resources_needed (servidor)
    startAt: tstz('start_at').notNull(),

    // SNAPSHOT de como foi vendido, junto com total_price_cents e payment_mode:
    // os tres congelam na venda e NUNCA acompanham edicao do catalogo.
    //
    // POR QUE EXISTEM: sem eles, o calendario e o painel liam duracao e buffer do
    // JOIN com experiences, ou seja, do valor ATUAL. Editar a duracao de uma
    // trilha redesenhava retroativamente o tamanho dos blocos de reservas ja
    // vendidas — bloco de 09:00-13:00 sobre uma vaga que na verdade libera 10:45.
    // A vaga em si (reservation_resources.period) sempre foi congelada, entao o
    // defeito nunca produziu overbooking: produzia tela mentindo, nas duas
    // direcoes (dono recusando cliente num horario livre, ou grade oferecendo um
    // vao que o POST recusa com 409).
    //
    // Quem le duracao da EXPERIENCIA continua certo em availability.ts e no
    // calculo do period em createReservation: reserva NOVA usa a duracao vigente.
    durationMinutes: integer('duration_minutes').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull(),

    channel: text('channel'), // origem da venda: NULL = direto; ex. 'aventurando'

    // Contato de emergencia, capturado no passo 5 do formulario publico
    // (junto ao termo). Nullable de proposito: reserva anterior a esta
    // funcionalidade nao tem o dado e nao ha como retroagir (mesma licao da
    // migration 0001 sobre NOT NULL em tabela ja povoada). A obrigatoriedade
    // para reserva NOVA vive na camada de aplicacao (rota + createReservation),
    // nao aqui.
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),

    // rev 6: estado financeiro AGREGADO. As cobrancas em si vivem em
    // reservation_payments; estes dois campos sao DERIVADOS e so podem ser
    // escritos por recalcReservationPayment, na mesma transacao (secao 4.6).
    paymentMode: paymentMode('payment_mode').notNull(), // snapshot de como foi vendido; sem default
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    paymentState: reservationPaymentState('payment_state').notNull().default('pending'),

    termoVersion: text('termo_version').notNull(),
    termoAcceptedAt: tstz('termo_accepted_at').notNull(),
    termoAcceptedIp: text('termo_accepted_ip'),
    termoAcceptedUserAgent: text('termo_accepted_user_agent'),

    status: reservationStatus('status').notNull().default('pending_payment'),
    holdExpiresAt: tstz('hold_expires_at'),

    createdAt: tstz('created_at').notNull().defaultNow(),
    confirmedAt: tstz('confirmed_at'),
    cancelledAt: tstz('cancelled_at'),
  },
  (t) => [
    check('reservations_resources_needed_check', sql`${t.resourcesNeeded} >= 1`),
    // Espelham os CHECKs de experiences: o snapshot nao pode ser menos rigoroso
    // que a origem de onde ele foi copiado.
    check('reservations_duration_minutes_check', sql`${t.durationMinutes} > 0`),
    check('reservations_buffer_minutes_check', sql`${t.bufferMinutes} >= 0`),
    index('idx_reservations_status_hold').on(t.status, t.holdExpiresAt),
    index('idx_reservations_start').on(t.tenantId, t.startAt),
    index('idx_reservations_customer').on(t.customerId),
  ],
);

// A trava anti-overbooking vive AQUI (exclusion constraint adicionada via SQL na migration).
// period = [start_at, start_at + duration + buffer). status ESPELHA reservations.status.
export const reservationResources = pgTable('reservation_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  resourceId: integer('resource_id')
    .notNull()
    .references(() => resources.id),
  period: tstzrange('period').notNull(),
  status: reservationStatus('status').notNull(),
});

export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  birthdate: date('birthdate'),
  role: participantRole('role').notNull(), // operator | passenger
  documentNumber: text('document_number'), // exigido p/ operator conforme settings (validacao no servidor)
});

// -- 4.5 pagamentos da reserva (rev 6) --------------------------------------
//
// Uma reserva tem 1 pagamento (modo 'full') ou 2 (modo 'deposit': sinal + saldo).
// O 'balance' tem ciclo proprio e NUNCA afeta reservations.status (secao 5.3):
// a reserva confirma com o sinal pago; saldo em aberto nao bloqueia nem libera vaga.
export const reservationPayments = pgTable(
  'reservation_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    kind: paymentKind('kind').notNull(), // full | deposit | balance
    amountCents: integer('amount_cents').notNull(), // calculado no servidor (secao 4.6)
    method: paymentMethod('method').notNull().default('pix'),
    state: paymentState('state').notNull().default('pending'),

    asaasPaymentId: text('asaas_payment_id'), // id da cobranca no Asaas (pay_...)
    // Link da fatura no provedor, persistido na CRIACAO da cobranca (secao 7.1:
    // a tela de clientes linka para ela sem chamar o Asaas ao vivo).
    asaasInvoiceUrl: text('asaas_invoice_url'),
    // "{reservation_id}:{kind}" — unico e deterministico. E o que permite
    // reconciliar mesmo se o asaas_payment_id se perder (secao 4.6 / 8-B).
    externalReference: text('external_reference').notNull(),
    dueDate: date('due_date').notNull(),
    paidAt: tstz('paid_at'),
    receivedInCash: boolean('received_in_cash').notNull().default(false), // maquininha/dinheiro
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('reservation_payments_amount_check', sql`${t.amountCents} > 0`),
    // idempotencia do webhook no banco (secao 8.2)
    uniqueIndex('idx_rp_asaas')
      .on(t.asaasPaymentId)
      .where(sql`${t.asaasPaymentId} IS NOT NULL`),
    uniqueIndex('idx_rp_extref').on(t.externalReference),
    index('idx_rp_reservation').on(t.reservationId),
    // varredura do job de reconciliacao a cada 10 min (secao 8-B)
    index('idx_rp_open')
      .on(t.state, t.dueDate)
      .where(sql`${t.state} = 'pending'`),
  ],
);

// -- agenda compartilhada (parceiros — secao 11.2) --------------------------

export const sharedCalendarLinks = pgTable('shared_calendar_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id')
    .notNull()
    .default(1)
    .references(() => tenants.id),
  label: text('label').notNull(), // "Aventurando"
  token: text('token').notNull().unique(), // nanoid >= 32 chars
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
  revokedAt: tstz('revoked_at'),
});
