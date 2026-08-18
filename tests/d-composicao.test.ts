// GRUPO D — composicao e validacao na criacao (CLAUDE.md secao 1 e 4.6).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { InvalidCompositionError, createReservation } from '@/lib/reservations';
import { getBooleanSetting } from '@/lib/tenant';
import { todayLocalDate } from '@/lib/time';

import {
  EXP,
  TEMPLATE_EXP,
  assertCatalogSeeded,
  movementCounts,
  nextSaturday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

/**
 * Data de nascimento de quem completa `years` anos HOJE, no fuso do tenant.
 *
 * ANCORADA EM `todayLocalDate()`, NAO em `new Date().toISOString()`. A regra de
 * maioridade do servidor corta pela data de calendario de SAO PAULO, e depois
 * das 21h locais o UTC ja virou o dia seguinte — uma data derivada do UTC
 * produziria "um dia a mais" e o caso de borda dos 18 anos exatos falharia so
 * no fim da noite. Foi exatamente assim que este teste quebrou ao ser rodado
 * 22h; o bug estava aqui, nao no servidor.
 */
function birthdateForAge(years: number): string {
  const [year, month, day] = todayLocalDate().split('-');
  return `${Number(year) - years}-${month}-${day}`;
}

async function primeiroSlot(experienceId: number, resourcesNeeded: number): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('D — composicao e validacao', () => {
  it('12. menos operadores que recursos e rejeitado', async () => {
    const startAt = await primeiroSlot(EXP.curta, 2);
    const antes = await movementCounts();

    // 2 recursos, 1 operador: cada recurso alugado precisa de ao menos um
    // habilitado a operar (secao 1).
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.curta,
          startAt,
          resourcesNeeded: 2,
          operators: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);

    expect(await movementCounts()).toEqual(antes);
  });

  it('13. participantes acima da soma das capacidades alocadas e rejeitado', async () => {
    const startAt = await primeiroSlot(EXP.curta, 2);
    const antes = await movementCounts();

    // 2 recursos de capacity 2 = 4 lugares. 2 operadores + 3 garupas = 5.
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.curta,
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
        experienceId: EXP.curta,
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

    const startAt = await primeiroSlot(EXP.curta, 1);
    const antes = await movementCounts();

    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.curta,
          startAt,
          resourcesNeeded: 1,
          withDocuments: false,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);

    expect(await movementCounts()).toEqual(antes);
  });

  it('15. o preco vem do servidor: price_cents x resourcesNeeded', async () => {
    // ANCORA NO TEMPLATE, nao em numero solto nem no banco.
    //
    // Numero solto e o que estava aqui antes (12000 / 18000, os precos
    // provisorios): virou mentira silenciosa quando ce3e4c6 gravou os precos
    // reais, e ninguem percebeu porque a suite ja estava vermelha por outro
    // motivo. Ler do BANCO seria pior: o teste compararia o que createReservation
    // calculou com a mesma linha que ele consultou, e passaria mesmo se a
    // multiplicacao por resourcesNeeded sumisse.
    //
    // O template e a terceira fonte, independente das outras duas: e o que o
    // negocio DECIDIU cobrar.
    const precoCurta = TEMPLATE_EXP.curta.priceCents;
    const precoLonga = TEMPLATE_EXP.longa.priceCents;

    const um = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta, 1),
        resourcesNeeded: 1,
        phone: '11966660000',
      }),
    );
    expect(um.totalCents).toBe(precoCurta);
    expect(um.dueNowCents).toBe(precoCurta); // modo 'full': paga tudo agora
    expect(um.balanceCents).toBe(0);

    await wipeMovement();

    const dois = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta, 2),
        resourcesNeeded: 2,
        phone: '11977770000',
      }),
    );
    expect(dois.totalCents).toBe(precoCurta * 2);

    await wipeMovement();

    const longa = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11988880000',
      }),
    );
    expect(longa.totalCents).toBe(precoLonga);

    // As duas experiencias precisam ter precos DIFERENTES, senao os tres
    // expects acima passariam mesmo se createReservation ignorasse a
    // experiencia e usasse sempre a mesma linha.
    expect(precoCurta).not.toBe(precoLonga);
  });

  it('16. operador menor de 18 anos e rejeitado; 18+ e sem data tambem se comportam corretamente', async () => {
    const startAt = await primeiroSlot(EXP.curta, 1);
    const antes = await movementCounts();

    // 17 anos completos hoje: menor.
    const birthdate17 = birthdateForAge(17);

    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.curta,
          startAt,
          resourcesNeeded: 1,
          operatorBirthdate: birthdate17,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);
    expect(await movementCounts()).toEqual(antes);

    // Sem data de nascimento: nao ha como verificar, entao rejeita tambem.
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.curta,
          startAt,
          resourcesNeeded: 1,
          operatorBirthdate: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCompositionError);
    expect(await movementCounts()).toEqual(antes);

    // Controle: exatamente 18 anos completos HOJE passa (borda da regra —
    // "na data do agendamento", nao "mais de 18").
    const birthdate18 = birthdateForAge(18);

    const ok = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt,
        resourcesNeeded: 1,
        operatorBirthdate: birthdate18,
        phone: '11933330000',
      }),
    );
    expect(ok.status).toBe('pending_payment');
  });

  it('15b. valor de preco vindo do cliente e ignorado', async () => {
    const startAt = await primeiroSlot(EXP.curta, 1);

    // CreateReservationInput nem tem campo de preco — o cast e para simular um
    // corpo malicioso chegando com campos a mais.
    const comLixo = {
      ...reservationInput({
        experienceId: EXP.curta,
        startAt,
        resourcesNeeded: 1,
        phone: '11999990000',
      }),
      totalPriceCents: 1,
      priceCents: 1,
      dueNowCents: 1,
    } as Parameters<typeof createReservation>[0];

    const criada = await createReservation(comLixo);

    // Mesma ancora do teste 15: o preco do template, nao os 1 centavo que o
    // corpo malicioso mandou nem um numero fixo que envelhece.
    expect(criada.totalCents).toBe(TEMPLATE_EXP.curta.priceCents);
    expect(criada.dueNowCents).toBe(TEMPLATE_EXP.curta.priceCents);
  });
});
