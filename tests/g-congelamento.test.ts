// GRUPO G — snapshot da venda: duracao e buffer congelam na reserva.
//
// O QUE ESTE GRUPO PROTEGE (CLAUDE.md secao 4.6, "como foi vendido"):
// reservations.duration_minutes e buffer_minutes sao gravados na venda e NUNCA
// acompanham edicao posterior da experiencia. Antes da migration 0001, o
// calendario e o painel liam os dois do JOIN com experiences — ou seja, do valor
// ATUAL —, entao alterar a duracao de uma trilha redesenhava retroativamente o
// tamanho dos blocos de reservas ja vendidas.
//
// A vaga em si (reservation_resources.period) sempre foi congelada, entao o
// defeito nunca produziu overbooking. Produzia tela mentindo, nas duas direcoes:
// aumentar a duracao mostrava o dia mais cheio do que estava (dono recusa
// cliente num horario livre); diminuir desenhava um vao que a grade oferecia e
// o POST /api/reservations recusava com 409.
//
// O CRUD de experiencias e o que torna isso alcancavel pelo dono — ate ele,
// mudar duracao so era possivel por psql.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { getCalendarReservations } from '@/lib/calendar';
import { db } from '@/lib/db/client';
import { getReservationDetail } from '@/lib/reservation-detail';
import { createReservation } from '@/lib/reservations';

import {
  EXP,
  assertCatalogSeeded,
  nextSaturday,
  nextSunday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAB = nextSaturday();
const DOM = nextSunday();

/** Duracao absurda de propósito: se algum caminho ler da experiencia, salta aos olhos. */
const DURACAO_NOVA = 240;

/** Valores originais da experiencia, lidos no beforeAll e restaurados no afterAll. */
let original: { duration: number; buffer: number };

async function lerExperiencia(id: number) {
  const { rows } = await db.execute<{ duration_minutes: number; buffer_minutes: number }>(sql`
    SELECT duration_minutes, buffer_minutes FROM experiences WHERE id = ${id}
  `);
  return { duration: rows[0]!.duration_minutes, buffer: rows[0]!.buffer_minutes };
}

async function setDuracao(id: number, minutos: number) {
  await db.execute(sql`UPDATE experiences SET duration_minutes = ${minutos} WHERE id = ${id}`);
}

async function primeiroSlot(experienceId: number, date: string): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date, resourcesNeeded: 1 });
  if (slots.length === 0) throw new Error(`sem slot livre em ${date} para a experiencia ${experienceId}`);
  return slots[0]!.startAt;
}

/** O bloco como o calendario o desenha. */
async function bloco(reservationId: string, date: string) {
  const reservas = await getCalendarReservations({ from: date, to: date });
  const r = reservas.find((x) => x.id === reservationId);
  if (!r) throw new Error(`reserva ${reservationId} nao apareceu no calendario de ${date}`);
  return r;
}

describe('G — duracao e buffer congelam na venda', () => {
  beforeAll(async () => {
    await assertCatalogSeeded();
    original = await lerExperiencia(EXP.longa);
  });

  beforeEach(async () => {
    await wipeMovement();
    // Cada caso parte da experiencia intacta: o teste anterior pode te-la
    // alterado, e a suite nunca deixa catalogo sujo para o vizinho.
    await setDuracao(EXP.longa, original.duration);
  });

  afterAll(async () => {
    await setDuracao(EXP.longa, original.duration);
    await wipeMovement();
  });

  it('G1 — editar a duracao da experiencia NAO muda o bloco de uma reserva ja feita', async () => {
    const startAt = await primeiroSlot(EXP.longa, SAB);
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.longa, startAt, resourcesNeeded: 1 }),
    );

    const antes = await bloco(reservationId, SAB);

    // Sanidade do ponto de partida: sem isto, um bug que gravasse zero nos dois
    // campos passaria no teste inteiro, porque "nao mudou" continuaria verdade.
    expect(antes.durationMinutes).toBe(original.duration);
    expect(antes.bufferMinutes).toBe(original.buffer);

    await setDuracao(EXP.longa, DURACAO_NOVA);

    const depois = await bloco(reservationId, SAB);

    // O bloco inteiro: os dois campos crus e as duas pontas derivadas deles.
    // endAt = start + duracao (SEM buffer, secao 4.6); bufferEndAt inclui.
    expect(depois.durationMinutes).toBe(antes.durationMinutes);
    expect(depois.bufferMinutes).toBe(antes.bufferMinutes);
    expect(depois.endAt).toBe(antes.endAt);
    expect(depois.bufferEndAt).toBe(antes.bufferEndAt);
  });

  it('G2 — o painel de detalhe tambem le o snapshot, nao a experiencia atual', async () => {
    const startAt = await primeiroSlot(EXP.longa, SAB);
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.longa, startAt, resourcesNeeded: 1 }),
    );

    const antes = (await getReservationDetail(reservationId))!;
    expect(antes.durationMinutes).toBe(original.duration);

    await setDuracao(EXP.longa, DURACAO_NOVA);

    const depois = (await getReservationDetail(reservationId))!;
    expect(depois.durationMinutes).toBe(antes.durationMinutes);
    expect(depois.bufferMinutes).toBe(antes.bufferMinutes);
    expect(depois.endAt).toBe(antes.endAt);
  });

  it('G3 — reserva NOVA usa a duracao vigente (o congelamento nao virou campo morto)', async () => {
    // Sem este caso, uma implementacao que simplesmente IGNORASSE a coluna e
    // devolvesse sempre a duracao do template passaria em G1 e G2. Aqui a
    // reserva e criada DEPOIS da alteracao e tem que enxergar o valor novo.
    await setDuracao(EXP.longa, DURACAO_NOVA);

    // Domingo, e nao sabado: com 240 min a grade muda de forma, e disputar o
    // mesmo dia com os casos anteriores so acrescentaria ruido de alocacao.
    const startAt = await primeiroSlot(EXP.longa, DOM);
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.longa, startAt, resourcesNeeded: 1 }),
    );

    const nova = await bloco(reservationId, DOM);
    expect(nova.durationMinutes).toBe(DURACAO_NOVA);

    const endMs = new Date(nova.endAt).getTime() - new Date(nova.startAt).getTime();
    expect(endMs).toBe(DURACAO_NOVA * 60_000);
  });

  it('G4 — o snapshot fecha com o period, que e a vaga realmente ocupada', async () => {
    // Os dois numeros tem origens diferentes (colunas da reserva x tstzrange da
    // alocacao) e sao gravados no mesmo INSERT. Se um dia divergirem, a grade
    // desenha um tamanho e a disponibilidade vende outro.
    const startAt = await primeiroSlot(EXP.longa, SAB);
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.longa, startAt, resourcesNeeded: 1 }),
    );

    const { rows } = await db.execute<{ snapshot: number; period: number }>(sql`
      SELECT r.duration_minutes + r.buffer_minutes                              AS snapshot,
             (EXTRACT(EPOCH FROM (upper(rr.period) - r.start_at)) / 60)::int    AS period
        FROM reservations r
        JOIN reservation_resources rr ON rr.reservation_id = r.id
       WHERE r.id = ${reservationId}
    `);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.snapshot).toBe(row.period);
  });
});
