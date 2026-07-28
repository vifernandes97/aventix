// GRUPO A — corridas reais (CLAUDE.md casos de borda 1, 2 e 3).
//
// Concorrencia de verdade: transacoes que commitam, nao mocks. E o unico grupo
// que precisa rodar varias vezes, porque corrida nao e deterministica.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { SlotUnavailableError, createReservation } from '@/lib/reservations';

import {
  EXP_CURTA,
  assertCatalogSeeded,
  makeBarrier,
  movementCounts,
  nextSaturday,
  occupy,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();
/** experiencia 1: 60 min de duracao + 15 de buffer */
const TOTAL_MINUTES = 75;

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('A — corridas', () => {
  it('1. dois createReservation simultaneos pelo mesmo horario: exatamente um vence (10 rodadas)', async () => {
    const placar = {
      sucessos: 0,
      conflitos: 0,
      ambos: 0,
      viaConstraint: 0,
      viaRecheck: 0,
      outros: [] as string[],
    };

    for (let rodada = 0; rodada < 10; rodada += 1) {
      await wipeMovement();

      const { slots } = await getAvailability({
        experienceId: EXP_CURTA,
        date: SAT,
        resourcesNeeded: 2,
      });
      const startAt = slots[0]!.startAt;

      // Barreira: as duas chamadas largam juntas, e nao apenas "quase juntas"
      // como um Promise.all sozinho garantiria.
      const largar = makeBarrier(2);
      const disputar = async (phone: string) => {
        await largar();
        return createReservation(
          reservationInput({ experienceId: EXP_CURTA, startAt, resourcesNeeded: 2, phone }),
        );
      };

      const resultado = await Promise.allSettled([
        disputar('11911110000'),
        disputar('11922220000'),
      ]);

      const venceram = resultado.filter((r) => r.status === 'fulfilled');
      const perderam = resultado.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      if (venceram.length === 2) placar.ambos += 1;
      placar.sucessos += venceram.length;
      placar.conflitos += perderam.length;

      for (const p of perderam) {
        if (!(p.reason instanceof SlotUnavailableError)) {
          placar.outros.push(`${(p.reason as Error).name}: ${(p.reason as Error).message}`);
          continue;
        }
        // Duas defesas independentes derrubam o perdedor, e qual delas atua
        // depende do timing. Contar as duas documenta por onde a corrida passou
        // nesta configuracao; nao se assere a distribuicao, que nao e estavel.
        if (p.reason.reason.includes('outro cliente reservou')) placar.viaConstraint += 1;
        else placar.viaRecheck += 1;
      }

      // Estado apos cada rodada: uma reserva, duas alocacoes, nenhuma orfa.
      const counts = await movementCounts();
      expect(counts.reservations, `rodada ${rodada}: reservas`).toBe(1);
      expect(counts.reservation_resources, `rodada ${rodada}: alocacoes`).toBe(2);
      expect(counts.reservation_payments, `rodada ${rodada}: cobrancas`).toBe(1);
    }

    // DOUBLE-BOOKING seria as duas vencerem. Zero tolerancia.
    expect(placar.ambos, 'rodadas em que AMBAS venceram (double-booking)').toBe(0);
    expect(placar.sucessos, 'sucessos em 10 rodadas').toBe(10);
    expect(placar.conflitos, 'conflitos em 10 rodadas').toBe(10);
    expect(placar.outros, 'perdedores com erro fora do esperado').toEqual([]);

    // Nao e assercao, e registro: mostra por qual defesa a corrida foi barrada.
    console.info(
      `[corrida] perdedores via exclusion constraint: ${placar.viaConstraint}, ` +
        `via recheck de disponibilidade: ${placar.viaRecheck}`,
    );
  });

  it('2. pedir 2 recursos com 1 ja ocupado: rollback total, nenhuma linha criada', async () => {
    const { slots } = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 2,
    });
    const startAt = slots[0]!.startAt;
    const startLocal = slots[0]!.label;

    await occupy({ date: SAT, startLocal, minutes: TOTAL_MINUTES, resourceId: 1 });

    const antes = await movementCounts();

    await expect(
      createReservation(
        reservationInput({ experienceId: EXP_CURTA, startAt, resourcesNeeded: 2 }),
      ),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // Caso de borda 2: ou aloca tudo, ou nada. Nunca reserva parcial.
    expect(await movementCounts()).toEqual(antes);
  });

  it('3. grade desatualizada: o slot some entre o getAvailability e o createReservation', async () => {
    const { slots } = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 1,
    });
    const startAt = slots[0]!.startAt;
    const startLocal = slots[0]!.label;

    // O cliente "demorou": nesse meio tempo os dois recursos foram tomados.
    await occupy({ date: SAT, startLocal, minutes: TOTAL_MINUTES, resourceId: 1 });
    await occupy({ date: SAT, startLocal, minutes: TOTAL_MINUTES, resourceId: 2 });

    const antes = await movementCounts();

    await expect(
      createReservation(
        reservationInput({ experienceId: EXP_CURTA, startAt, resourcesNeeded: 1 }),
      ),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    expect(await movementCounts()).toEqual(antes);
  });
});
