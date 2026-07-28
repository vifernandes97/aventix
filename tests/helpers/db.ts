// Helpers de isolamento da suite (CLAUDE.md secao 11-B: o catalogo vem do seed).
//
// REGRA DE ISOLAMENTO: o CATALOGO (tenant, settings, resources, experiences,
// operating_hours) e PRE-CONDICAO — os testes assumem `npm run db:seed` rodado e
// nunca o apagam. As tabelas de MOVIMENTO sao zeradas antes de cada teste.
//
// `schedule_exceptions` e `blackouts` tambem entram na limpeza: o seed as deixa
// VAZIAS, entao zera-las restaura exatamente o estado semeado. Sem isso, uma
// excecao criada pelo teste 7 mudaria a grade vista pelo teste 9.
//
// RELOGIO: nenhum teste mocka o tempo do Node. O sistema usa now() do BANCO de
// proposito (decisao registrada em docs/DECISOES.md), entao lead time e
// expiracao se testam MANIPULANDO DADOS: hold_expires_at no passado, start_at
// explicito.

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { invalidateSettingsCache } from '@/lib/tenant';
import { localToUtc } from '@/lib/time';

export const TENANT_ID = 1;

/** Experiencias do seed (lib/templates/quadriciclo.ts). */
export const EXP_CURTA = 1; // 60 min + 15 buffer, R$ 120,00
export const EXP_LONGA = 2; // 90 min + 15 buffer, R$ 180,00

/** Experiencias criadas pela propria suite, para cobrir o modo 'deposit'. */
export const EXP_DEPOSIT_PCT = 900; // 34900c, deposit_percent 50
export const EXP_DEPOSIT_FIXED = 901; // 17450c, deposit_fixed_cents 99900 (> total)

const MOVEMENT_TABLES = [
  'reservation_payments',
  'participants',
  'reservation_resources',
  'reservations',
  'customers',
  // vazias no seed; zerar restaura o estado semeado
  'blackouts',
  'schedule_exceptions',
];

/** Zera as tabelas de movimento. Chamar em beforeEach. Nunca toca no catalogo. */
export async function wipeMovement(): Promise<void> {
  for (const table of MOVEMENT_TABLES) {
    await db.execute(sql.raw(`DELETE FROM ${table}`));
  }
  invalidateSettingsCache();
}

/**
 * Falha alto e cedo se o catalogo nao estiver semeado, em vez de deixar 18
 * testes falharem com mensagens confusas.
 */
export async function assertCatalogSeeded(): Promise<void> {
  const [row] = (
    await db.execute<{ resources: number; experiences: number; hours: number; settings: number }>(sql`
      SELECT (SELECT count(*)::int FROM resources WHERE active) resources,
             (SELECT count(*)::int FROM experiences WHERE id IN (${EXP_CURTA}, ${EXP_LONGA})) experiences,
             (SELECT count(*)::int FROM operating_hours) hours,
             (SELECT count(*)::int FROM settings) settings
    `)
  ).rows;

  if (row.resources < 2 || row.experiences < 2 || row.hours < 2 || row.settings < 1) {
    throw new Error(
      `Catalogo nao semeado (resources=${row.resources} experiences=${row.experiences} ` +
        `hours=${row.hours} settings=${row.settings}). Rode: npm run db:seed`,
    );
  }
}

/** Data futura ('YYYY-MM-DD') com o weekday pedido. 0=domingo .. 6=sabado. */
export function futureDate(weekday: number, minDaysAhead = 14): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Sabado e domingo tem grade 08:00-18:00 no seed; terca nao tem nenhuma. */
export const nextSaturday = () => futureDate(6);
export const nextSunday = () => futureDate(0);
export const nextTuesday = () => futureDate(2);

let customerSeq = 0;

/** Cria um cliente direto no banco (para montar cenario sem passar pelo dominio). */
export async function insertCustomer(name = 'Cliente Teste'): Promise<string> {
  customerSeq += 1;
  const phone = `1190000${String(customerSeq).padStart(4, '0')}`;
  const [row] = (
    await db.execute<{ id: string }>(sql`
      INSERT INTO customers (tenant_id, name, phone)
      VALUES (${TENANT_ID}, ${name}, ${phone})
      RETURNING id::text
    `)
  ).rows;
  return row.id;
}

let reservationSeq = 0;

/**
 * Ocupa um recurso com uma reserva ATIVA, por SQL cru.
 *
 * Monta cenario sem passar por createReservation de proposito: assim o teste de
 * disponibilidade nao depende da criacao estar correta, e vice-versa.
 */
export async function occupy(params: {
  date: string;
  /** 'HH:MM' local de Sao Paulo */
  startLocal: string;
  /** duracao + buffer, em minutos: e o que vai no period */
  minutes: number;
  resourceId: number;
  experienceId?: number;
  status?: 'pending_payment' | 'confirmed';
  customerId?: string;
  holdExpiresAt?: 'past' | null;
}): Promise<string> {
  const {
    date,
    startLocal,
    minutes,
    resourceId,
    experienceId = EXP_CURTA,
    status = 'confirmed',
    holdExpiresAt = null,
  } = params;

  const customerId = params.customerId ?? (await insertCustomer());
  reservationSeq += 1;
  const id = `00000000-0000-4000-8000-${String(reservationSeq).padStart(12, '0')}`;
  const startUtc = localToUtc(date, startLocal).toISOString();

  await db.execute(sql`
    INSERT INTO reservations
      (id, tenant_id, customer_id, experience_id, resources_needed, total_price_cents,
       start_at, payment_mode, termo_version, termo_accepted_at, status, hold_expires_at)
    VALUES
      (${id}, ${TENANT_ID}, ${customerId}, ${experienceId}, 1, 10000,
       ${startUtc}::timestamptz, 'full'::payment_mode, 'v1', now(),
       ${status}::reservation_status,
       ${holdExpiresAt === 'past' ? sql`now() - interval '1 minute'` : sql`NULL`})
  `);

  await db.execute(sql`
    INSERT INTO reservation_resources (reservation_id, resource_id, period, status)
    VALUES (${id}, ${resourceId},
            tstzrange(${startUtc}::timestamptz,
                      ${startUtc}::timestamptz + make_interval(mins => ${minutes})),
            ${status}::reservation_status)
  `);

  return id;
}

/** Contagens das tabelas de movimento, para provar rollback total. */
export async function movementCounts() {
  const [row] = (
    await db.execute<Record<string, number>>(sql`
      SELECT (SELECT count(*)::int FROM reservations) reservations,
             (SELECT count(*)::int FROM reservation_resources) reservation_resources,
             (SELECT count(*)::int FROM reservation_payments) reservation_payments,
             (SELECT count(*)::int FROM participants) participants,
             (SELECT count(*)::int FROM customers) customers
    `)
  ).rows;
  return row;
}

// -- settings ---------------------------------------------------------------

/**
 * Sobrescreve uma setting e invalida o cache EXPLICITAMENTE.
 *
 * Sem a invalidacao, o TTL de 60s de lib/tenant.ts serviria o valor antigo e o
 * teste passaria (ou falharia) pelo motivo errado.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO settings (tenant_id, key, value) VALUES (${TENANT_ID}, ${key}, ${value})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value
  `);
  invalidateSettingsCache();
}

/** Le o valor atual, para o teste restaurar no teardown. */
export async function getSettingRaw(key: string): Promise<string | null> {
  const { rows } = await db.execute<{ value: string }>(
    sql`SELECT value FROM settings WHERE tenant_id = ${TENANT_ID} AND key = ${key}`,
  );
  return rows[0]?.value ?? null;
}

/** Restaura (ou remove) uma setting e invalida o cache. */
export async function restoreSetting(key: string, previous: string | null): Promise<void> {
  if (previous === null) {
    await db.execute(sql`DELETE FROM settings WHERE tenant_id = ${TENANT_ID} AND key = ${key}`);
  } else {
    await setSetting(key, previous);
    return;
  }
  invalidateSettingsCache();
}

// -- experiencias de teste (modo deposit) -----------------------------------

/**
 * Cria as experiencias de teste do grupo E. O seed so tem experiencias 'full',
 * e o modo 'deposit' precisa ser coberto.
 *
 * Faz DELETE antes do INSERT: se uma rodada anterior morreu no meio, a proxima
 * se cura sozinha em vez de acumular lixo.
 */
export async function ensureDepositExperiences(): Promise<void> {
  await removeDepositExperiences();
  await db.execute(sql`
    INSERT INTO experiences
      (id, tenant_id, name, duration_minutes, buffer_minutes, price_mode, price_cents,
       payment_mode, deposit_percent, deposit_fixed_cents, active)
    VALUES
      (${EXP_DEPOSIT_PCT}, ${TENANT_ID}, 'TESTE deposit percentual', 60, 15,
       'per_resource'::price_mode, 34900, 'deposit'::payment_mode, 50, NULL, true),
      (${EXP_DEPOSIT_FIXED}, ${TENANT_ID}, 'TESTE deposit fixo maior que o total', 60, 15,
       'per_resource'::price_mode, 17450, 'deposit'::payment_mode, NULL, 99900, true)
  `);
}

/** Remove SO as experiencias que a suite criou. Nunca toca nas do seed. */
export async function removeDepositExperiences(): Promise<void> {
  await db.execute(
    sql`DELETE FROM experiences WHERE id IN (${EXP_DEPOSIT_PCT}, ${EXP_DEPOSIT_FIXED})`,
  );
}

// -- entrada padrao de createReservation ------------------------------------

export function reservationInput(params: {
  experienceId: number;
  startAt: string;
  resourcesNeeded: number;
  phone?: string;
  operators?: number;
  passengers?: number;
  withDocuments?: boolean;
}) {
  const {
    experienceId,
    startAt,
    resourcesNeeded,
    phone = '(19) 99999-8888',
    operators = resourcesNeeded,
    passengers = 0,
    withDocuments = true,
  } = params;

  return {
    experienceId,
    startAt,
    resourcesNeeded,
    customer: { name: 'Cliente Teste', phone },
    participants: [
      ...Array.from({ length: operators }, (_, i) => ({
        name: `Condutor ${i + 1}`,
        role: 'operator' as const,
        documentNumber: withDocuments ? `1234567890${i}` : null,
      })),
      ...Array.from({ length: passengers }, (_, i) => ({
        name: `Garupa ${i + 1}`,
        role: 'passenger' as const,
      })),
    ],
    termo: { version: 'v1', acceptedAt: new Date().toISOString() },
  };
}

/**
 * Barreira: faz N chamadas largarem juntas.
 *
 * Promise.all so garante que as promises foram CRIADAS em sequencia; a primeira
 * ja pode ter ido ao banco antes de a segunda comecar. A barreira segura as duas
 * ate ambas estarem prontas, aproximando a largada de verdade.
 */
export function makeBarrier(n: number): () => Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = 0;

  return async () => {
    arrived += 1;
    if (arrived === n) release();
    await gate;
  };
}
