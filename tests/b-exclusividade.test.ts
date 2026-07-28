// GRUPO B — exclusividade de experiencia por horario (CLAUDE.md secao 1 e caso
// de borda 19). O Quadri Club opera com o flag LIGADO, e o seed reflete isso.
//
// A assimetria e o ponto: experiencia DIFERENTE sobreposta bloqueia; a MESMA
// experiencia nao bloqueia, seguindo governada so pela disponibilidade de recurso.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { SlotUnavailableError, createReservation } from '@/lib/reservations';
import { getBooleanSetting } from '@/lib/tenant';

import {
  EXP_CURTA,
  EXP_LONGA,
  assertCatalogSeeded,
  nextSaturday,
  occupy,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('B — exclusividade de experiencia', () => {
  it('o seed liga single_experience_per_slot (pre-condicao deste grupo)', async () => {
    expect(await getBooleanSetting('single_experience_per_slot')).toBe(true);
  });

  it('4. reserva ativa da experiencia A bloqueia a experiencia B sobreposta', async () => {
    const { slots } = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 1,
    });
    const alvo = slots[0]!;

    // Experiencia LONGA ocupando o horario, no recurso 1. O recurso 2 fica livre,
    // entao o unico motivo possivel para recusar e a exclusividade.
    await occupy({
      date: SAT,
      startLocal: alvo.label,
      minutes: 105,
      resourceId: 1,
      experienceId: EXP_LONGA,
    });

    // O motor ja esconde o horario...
    const depois = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 1,
    });
    expect(depois.slots.some((s) => s.startAt === alvo.startAt)).toBe(false);

    // ...e a criacao recusa, mesmo com recurso sobrando.
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP_CURTA,
          startAt: alvo.startAt,
          resourcesNeeded: 1,
          phone: '11933330000',
        }),
      ),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('5. reserva ativa da MESMA experiencia nao bloqueia, se houver recurso livre', async () => {
    const { slots } = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 1,
    });
    const alvo = slots[0]!;

    // Mesma experiencia, recurso 1 ocupado, recurso 2 livre.
    await occupy({
      date: SAT,
      startLocal: alvo.label,
      minutes: 75,
      resourceId: 1,
      experienceId: EXP_CURTA,
    });

    const depois = await getAvailability({
      experienceId: EXP_CURTA,
      date: SAT,
      resourcesNeeded: 1,
    });
    expect(depois.slots.some((s) => s.startAt === alvo.startAt)).toBe(true);

    const criada = await createReservation(
      reservationInput({
        experienceId: EXP_CURTA,
        startAt: alvo.startAt,
        resourcesNeeded: 1,
        phone: '11944440000',
      }),
    );

    expect(criada.status).toBe('pending_payment');
    // Pegou o recurso que sobrou, nao o ocupado.
    expect(criada.allocatedResourceIds).toEqual([2]);
  });
});
