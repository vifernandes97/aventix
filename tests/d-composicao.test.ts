// GRUPO D — composicao e validacao na criacao (CLAUDE.md secao 1 e 4.6).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { InvalidCompositionError, createReservation } from '@/lib/reservations';
import { getBooleanSetting } from '@/lib/tenant';

import {
  EXP_CURTA,
  EXP_LONGA,
  assertCatalogSeeded,
  movementCounts,
  nextSaturday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

async function primeiroSlot(experienceId: number, resourcesNeeded: number): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('D — composicao e validacao', () => {
  it('12. menos operadores que recursos e rejeitado', async () => {
    const startAt = await primeiroSlot(EXP_CURTA, 2);
    const antes = await movementCounts();

    // 2 recursos, 1 operador: cada recurso alugado precisa de ao menos um
    // habilitado a operar (secao 1).
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP_CURTA,
          startAt,
          resourcesNeeded: 2,
          operators: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);

    expect(await movementCounts()).toEqual(antes);
  });

  it('13. participantes acima da soma das capacidades alocadas e rejeitado', async () => {
    const startAt = await primeiroSlot(EXP_CURTA, 2);
    const antes = await movementCounts();

    // 2 recursos de capacity 2 = 4 lugares. 2 operadores + 3 garupas = 5.
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP_CURTA,
          startAt,
          resourcesNeeded: 2,
          operators: 2,
          passengers: 3,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);

    expect(await movementCounts()).toEqual(antes);

    // Controle: exatamente 4 participantes passa. Sem isto, o teste acima
    // poderia estar rejeitando pelo motivo errado.
    const ok = await createReservation(
      reservationInput({
        experienceId: EXP_CURTA,
        startAt,
        resourcesNeeded: 2,
        operators: 2,
        passengers: 2,
        phone: '11955550000',
      }),
    );
    expect(ok.status).toBe('pending_payment');
  });

  it('14. operador sem documento e rejeitado quando o tenant exige', async () => {
    expect(
      await getBooleanSetting('operator_document_required'),
      'pre-condicao: o seed exige documento',
    ).toBe(true);

    const startAt = await primeiroSlot(EXP_CURTA, 1);
    const antes = await movementCounts();

    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP_CURTA,
          startAt,
          resourcesNeeded: 1,
          withDocuments: false,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);

    expect(await movementCounts()).toEqual(antes);
  });

  it('15. o preco vem do servidor: price_cents x resourcesNeeded', async () => {
    // Experiencia 1 = 12000c, experiencia 2 = 18000c (seed).
    const um = await createReservation(
      reservationInput({
        experienceId: EXP_CURTA,
        startAt: await primeiroSlot(EXP_CURTA, 1),
        resourcesNeeded: 1,
        phone: '11966660000',
      }),
    );
    expect(um.totalCents).toBe(12000);
    expect(um.dueNowCents).toBe(12000); // modo 'full': paga tudo agora
    expect(um.balanceCents).toBe(0);

    await wipeMovement();

    const dois = await createReservation(
      reservationInput({
        experienceId: EXP_CURTA,
        startAt: await primeiroSlot(EXP_CURTA, 2),
        resourcesNeeded: 2,
        phone: '11977770000',
      }),
    );
    expect(dois.totalCents).toBe(24000);

    await wipeMovement();

    const longa = await createReservation(
      reservationInput({
        experienceId: EXP_LONGA,
        startAt: await primeiroSlot(EXP_LONGA, 1),
        resourcesNeeded: 1,
        phone: '11988880000',
      }),
    );
    expect(longa.totalCents).toBe(18000);
  });

  it('15b. valor de preco vindo do cliente e ignorado', async () => {
    const startAt = await primeiroSlot(EXP_CURTA, 1);

    // CreateReservationInput nem tem campo de preco — o cast e para simular um
    // corpo malicioso chegando com campos a mais.
    const comLixo = {
      ...reservationInput({
        experienceId: EXP_CURTA,
        startAt,
        resourcesNeeded: 1,
        phone: '11999990000',
      }),
      totalPriceCents: 1,
      priceCents: 1,
      dueNowCents: 1,
    } as Parameters<typeof createReservation>[0];

    const criada = await createReservation(comLixo);

    expect(criada.totalCents).toBe(12000);
    expect(criada.dueNowCents).toBe(12000);
  });
});
