// GRUPO Q — lista consultavel de agendamentos (tela /admin/agendamentos) e a
// abertura do painel de detalhe por URL (?reserva=) no calendario.
//
// Cobre lib/reservation-list.ts. Os testes chamam a LIB direto (a tela e um
// Server Component que le a lib, sem HTTP contra si mesmo), no mesmo estilo dos
// demais testes de leitura da suite.
//
// >>> O TESTE DE PRIVACIDADE E O MAIS IMPORTANTE DO ARQUIVO <<<
// A lista mostra VARIOS clientes de uma vez — um print dela nao pode vazar dado
// sensivel de todo mundo. O teste 82 procura os VALORES reais (CPF, documento,
// contato de emergencia) dentro do resultado serializado, em vez de conferir uma
// lista de chaves: campo novo carregando dado sensivel passaria batido numa
// checagem de chaves, e nao passa nesta.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { createReservation } from '@/lib/reservations';
import {
  RESERVATION_LIST_LIMIT,
  type ReservationStatus,
  resolveOpenReservationId,
  searchReservations,
} from '@/lib/reservation-list';
import { localToUtc } from '@/lib/time';

import {
  EXP,
  TENANT_ID,
  VALID_CPF,
  assertCatalogSeeded,
  insertFixtureTenant,
  nextSaturday,
  nextSunday,
  removeFixtureTenant,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();
const SUN = nextSunday();

/** Tenant inventado por este arquivo para exercitar o isolamento. */
const OTHER_TENANT_ID = 88;

let phoneSeq = 0;

/**
 * Insere UMA reserva por SQL cru, controlando nome, telefone, status, instante e
 * tenant. Nao cria reservation_resources: a listagem nao os le, e sem eles fico
 * livre para sobrepor horarios sem esbarrar na exclusion constraint.
 */
async function seedReservation(opts: {
  name: string;
  status: ReservationStatus;
  /** ISO 8601 (instante). Use localToUtc(date, 'HH:MM').toISOString(). */
  startAtUtc: string;
  phone?: string;
  experienceId?: number;
  tenantId?: number;
  totalCents?: number;
}): Promise<string> {
  const tenantId = opts.tenantId ?? TENANT_ID;
  phoneSeq += 1;
  const phone = opts.phone ?? `1195550${String(phoneSeq).padStart(4, '0')}`;

  const [customer] = (
    await db.execute<{ id: string }>(sql`
      INSERT INTO customers (tenant_id, name, phone)
      VALUES (${tenantId}, ${opts.name}, ${phone})
      RETURNING id::text
    `)
  ).rows;

  const [reservation] = (
    await db.execute<{ id: string }>(sql`
      INSERT INTO reservations
        (tenant_id, customer_id, experience_id, resources_needed, total_price_cents,
         start_at, duration_minutes, buffer_minutes, payment_mode,
         termo_version, termo_accepted_at, status)
      VALUES
        (${tenantId}, ${customer.id}, ${opts.experienceId ?? EXP.curta}, 1, ${opts.totalCents ?? 10000},
         ${opts.startAtUtc}::timestamptz, 60, 15, 'full'::payment_mode,
         'v1', now(), ${opts.status}::reservation_status)
      RETURNING id::text
    `)
  ).rows;

  return reservation.id;
}

const at = (date: string, time: string) => localToUtc(date, time).toISOString();

beforeAll(async () => {
  await assertCatalogSeeded();
  await insertFixtureTenant(OTHER_TENANT_ID, 'q');
});

afterAll(async () => {
  await wipeMovement();
  await removeFixtureTenant(OTHER_TENANT_ID);
});

beforeEach(wipeMovement);

describe('Q — lista consultavel de agendamentos', () => {
  it('77. devolve as reservas do tenant, mais recente primeiro', async () => {
    const id09 = await seedReservation({ name: 'Ana', status: 'confirmed', startAtUtc: at(SAT, '09:00') });
    const id15 = await seedReservation({ name: 'Bruno', status: 'confirmed', startAtUtc: at(SAT, '15:00') });
    const id12 = await seedReservation({ name: 'Carla', status: 'pending_payment', startAtUtc: at(SUN, '12:00') });

    const { items, limited } = await searchReservations({});

    // SUN 12:00 e o mais recente; depois SAT 15:00; por fim SAT 09:00.
    expect(items.map((i) => i.id)).toEqual([id12, id15, id09]);
    expect(limited).toBe(false);

    // Cada item carrega o que a tela pinta.
    const first = items[0];
    expect(first.startAt).toBe(new Date(first.startAt).toISOString()); // ISO 8601, nao o cru do Postgres
    expect(first.customerName).toBe('Carla');
    expect(typeof first.customerPhone).toBe('string');
    expect(first.experienceName.length).toBeGreaterThan(0);
    expect(first.totalPriceCents).toBe(10000);
    expect(first.status).toBe('pending_payment');
  });

  it('78. busca por parte do nome encontra, ignorando maiuscula/minuscula', async () => {
    await seedReservation({ name: 'Maria Aparecida', status: 'confirmed', startAtUtc: at(SAT, '09:00') });
    await seedReservation({ name: 'Carlos Souza', status: 'confirmed', startAtUtc: at(SAT, '11:00') });

    const { items } = await searchReservations({ query: 'maria' });

    expect(items).toHaveLength(1);
    expect(items[0].customerName).toBe('Maria Aparecida');
  });

  it('79. busca por telefone encontra (inclusive com o numero formatado)', async () => {
    await seedReservation({
      name: 'Joana',
      status: 'confirmed',
      startAtUtc: at(SAT, '09:00'),
      phone: '11987654321',
    });
    await seedReservation({
      name: 'Pedro',
      status: 'confirmed',
      startAtUtc: at(SAT, '11:00'),
      phone: '11912345678',
    });

    // Pedaco cru dos digitos.
    const porDigitos = await searchReservations({ query: '98765' });
    expect(porDigitos.items).toHaveLength(1);
    expect(porDigitos.items[0].customerName).toBe('Joana');

    // Digitado como o dono ve no identificador de chamadas: a normalizacao por
    // digitos resgata o caso que o ILIKE cru perderia por causa da pontuacao.
    const formatado = await searchReservations({ query: '(11) 98765' });
    expect(formatado.items).toHaveLength(1);
    expect(formatado.items[0].customerName).toBe('Joana');
  });

  it('80. filtro por status filtra', async () => {
    await seedReservation({ name: 'Aguardando', status: 'pending_payment', startAtUtc: at(SAT, '09:00') });
    const confirmadaId = await seedReservation({ name: 'Confirmada', status: 'confirmed', startAtUtc: at(SAT, '11:00') });
    await seedReservation({ name: 'Cancelada', status: 'cancelled', startAtUtc: at(SAT, '13:00') });

    const { items } = await searchReservations({ status: 'confirmed' });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(confirmadaId);
    expect(items[0].status).toBe('confirmed');
  });

  it('81. reserva de OUTRO tenant nao aparece', async () => {
    const meuId = await seedReservation({ name: 'Do tenant 1', status: 'confirmed', startAtUtc: at(SAT, '09:00') });
    const alheioId = await seedReservation({
      name: 'Do tenant vizinho',
      status: 'confirmed',
      startAtUtc: at(SAT, '11:00'),
      tenantId: OTHER_TENANT_ID,
    });

    const { items } = await searchReservations({});
    const ids = items.map((i) => i.id);

    expect(ids).toContain(meuId);
    expect(ids).not.toContain(alheioId);
  });

  it('82. o resultado da LISTAGEM nao carrega CPF, documento nem contato de emergencia', async () => {
    // Reserva REAL (createReservation), que grava CPF, documento do condutor e
    // contato de emergencia — exatamente os dados que a listagem NAO pode expor.
    const { slots } = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    await createReservation(
      reservationInput({ experienceId: EXP.curta, startAt: slots[0]!.startAt, resourcesNeeded: 1 }),
    );

    const { items } = await searchReservations({});
    const serialized = JSON.stringify(items);

    // Procurando os VALORES reais gravados pelo fixture, nao chaves.
    const proibidos: [string, string][] = [
      ['CPF', VALID_CPF],
      ['documento do condutor', '12345678900'],
      ['nome do contato de emergencia', 'Contato Emergência'],
      ['telefone do contato de emergencia', '19988887777'],
    ];
    for (const [rotulo, valor] of proibidos) {
      expect(serialized, `${rotulo} vazou na listagem`).not.toContain(valor);
    }

    // ...e o teste so vale porque o que DEVE aparecer aparece: sem isto, um
    // resultado vazio passaria trivialmente. Nome e telefone do cliente sao
    // exibidos de proposito (ferramenta do dono para retornar a ligacao).
    expect(serialized).toContain('Cliente Teste');
    expect(serialized).toContain('19999998888');
  });

  it('83. filtro por periodo filtra pela data do passeio', async () => {
    const sabadoId = await seedReservation({ name: 'Sabado', status: 'confirmed', startAtUtc: at(SAT, '10:00') });
    await seedReservation({ name: 'Domingo', status: 'confirmed', startAtUtc: at(SUN, '10:00') });

    const { items } = await searchReservations({ from: SAT, to: SAT });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(sabadoId);
  });

  it('84. bate o teto: devolve 100 e sinaliza que ha mais', async () => {
    // Uma a mais que o teto, todas em horarios distintos para uma ordem estavel.
    for (let i = 0; i < RESERVATION_LIST_LIMIT + 1; i += 1) {
      const minutes = i; // 0..100 min depois da meia-noite: instantes unicos
      await seedReservation({
        name: `Cliente ${i}`,
        status: 'confirmed',
        startAtUtc: new Date(localToUtc(SAT, '00:00').getTime() + minutes * 60_000).toISOString(),
      });
    }

    const { items, limited } = await searchReservations({});

    expect(items).toHaveLength(RESERVATION_LIST_LIMIT);
    expect(limited).toBe(true);
  });
});

describe('Q — abertura do painel de detalhe por URL (?reserva=)', () => {
  it('85. sem o param, nada abre: a agenda renderiza como antes', async () => {
    // openReservationId null = estado inicial do painel identico ao anterior.
    // undefined e string vazia (campo sem valor) resolvem os dois para null.
    expect(await resolveOpenReservationId(undefined)).toBeNull();
    expect(await resolveOpenReservationId('')).toBeNull();
  });

  it('86. param invalido, inexistente ou de outro tenant NAO abre painel e nao quebra', async () => {
    // Malformado: nao pode lancar (o `::uuid` abortaria com 22P02); vira null.
    for (const bad of ['nao-e-uuid', '123', 'undefined', "'; DROP TABLE reservations; --"]) {
      expect(await resolveOpenReservationId(bad), `id ${JSON.stringify(bad)}`).toBeNull();
    }

    // Bem-formado, porem inexistente.
    expect(await resolveOpenReservationId('11111111-2222-4333-8444-555555555555')).toBeNull();

    // Existente, mas de OUTRO tenant: indistinguivel de inexistente.
    const alheioId = await seedReservation({
      name: 'Vizinho',
      status: 'confirmed',
      startAtUtc: at(SAT, '09:00'),
      tenantId: OTHER_TENANT_ID,
    });
    expect(await resolveOpenReservationId(alheioId)).toBeNull();

    // A tabela continua de pe depois do id com cara de injecao.
    const { rows } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM reservations`,
    );
    expect(rows[0].n).toBe(1); // so a reserva do tenant vizinho criada acima
  });

  it('87. id existente do proprio tenant abre o painel (devolve o mesmo id)', async () => {
    const id = await seedReservation({ name: 'Cliente', status: 'confirmed', startAtUtc: at(SAT, '09:00') });

    expect(await resolveOpenReservationId(id)).toBe(id);
  });
});
