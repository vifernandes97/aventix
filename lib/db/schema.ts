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

// -- 4.2 tenant e configuracao ---------------------------------------------

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(), // "Quadri Club"
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
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check('experiences_duration_check', sql`${t.durationMinutes} > 0`),
    check('experiences_buffer_check', sql`${t.bufferMinutes} >= 0`),
    check('experiences_price_check', sql`${t.priceCents} >= 0`),
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
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('customers_tenant_phone_unique').on(t.tenantId, t.phone)], // find-or-create por telefone
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

    channel: text('channel'), // origem da venda: NULL = direto; ex. 'aventurando'

    termoVersion: text('termo_version').notNull(),
    termoAcceptedAt: tstz('termo_accepted_at').notNull(),
    termoAcceptedIp: text('termo_accepted_ip'),
    termoAcceptedUserAgent: text('termo_accepted_user_agent'),

    status: reservationStatus('status').notNull().default('pending_payment'),
    holdExpiresAt: tstz('hold_expires_at'),

    paymentMethod: paymentMethod('payment_method').notNull().default('pix'),
    paymentId: text('payment_id'),
    externalReference: text('external_reference'), // = reservations.id, enviado ao Asaas

    createdAt: tstz('created_at').notNull().defaultNow(),
    confirmedAt: tstz('confirmed_at'),
    cancelledAt: tstz('cancelled_at'),
  },
  (t) => [
    check('reservations_resources_needed_check', sql`${t.resourcesNeeded} >= 1`),
    // idempotencia do webhook no banco (secao 4.6)
    uniqueIndex('idx_reservations_payment')
      .on(t.paymentId)
      .where(sql`${t.paymentId} IS NOT NULL`),
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

// -- 4.5 agenda compartilhada (parceiros) -----------------------------------

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
