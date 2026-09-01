// GRUPO T — preco por metodo de pagamento (CLAUDE.md secao 4-B.1, 4-B.2, 4-B.5).
//
// ============================================================================
// >>> O CRITERIO DESTA FASE E CONTRAINTUITIVO: O PRECO NAO PODE MUDAR <<<
// Antes da Fase A o catalogo guardava 32549 e o cliente pagava 32549. Depois, o
// catalogo guarda 34999 e o cliente CONTINUA pagando 32549 — agora derivado.
// Mesmos numeros, origem diferente. Qualquer centavo de diferenca e bug.
//
// Por isso os valores aqui sao LITERAIS, e nao derivados de helper: se a
// aritmetica e o esperado saissem da mesma funcao, o teste passaria com a
// funcao errada. Os literais vem da tabela da secao 4-B.2.
// ============================================================================

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyDiscount } from '@/lib/basis-points';
import { db } from '@/lib/db/client';
import { getAvailability } from '@/lib/availability';
import { listPublicExperiences } from '@/lib/experiences';
import { createReservation } from '@/lib/reservations';
import { SEED_PIX_DISCOUNT_BASIS_POINTS, seedTenant } from '@/lib/seed';
import { quadricicloTemplate } from '@/lib/templates/quadriciclo';

import {
  EXP,
  TEMPLATE_EXP,
  assertCatalogSeeded,
  nextSaturday,
  precoEsperado,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

const MONTANHA_CHEIO = 34_999;
const MONTANHA_PIX = 32_549;
const FAZENDA_CHEIO = 24_999;
const FAZENDA_PIX = 23_249;

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

async function reservaGravada(reservationId: string) {
  const { rows } = await db.execute<{
    total_price_cents: number;
    full_price_cents: number | null;
    discount_basis_points: number | null;
  }>(sql`
    SELECT total_price_cents, full_price_cents, discount_basis_points
    FROM reservations WHERE id = ${reservationId}
  `);
  return rows[0];
}

/** Troca o desconto do tenant e devolve o valor anterior, para restaurar. */
async function setDesconto(basisPoints: number | null): Promise<void> {
  if (basisPoints === null) {
    await db.execute(sql`DELETE FROM payment_method_discounts WHERE method = 'pix'`);
    return;
  }
  await db.execute(sql`
    INSERT INTO payment_method_discounts (tenant_id, method, discount_basis_points)
    VALUES (1, 'pix', ${basisPoints})
    ON CONFLICT (tenant_id, method)
    DO UPDATE SET discount_basis_points = ${basisPoints}
  `);
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

afterAll(async () => {
  await wipeMovement();
  // Restaura o desconto semeado: o grupo T o altera para exercitar 5% e a
  // ausencia, e assertCatalogSeeded (que todo arquivo chama) falha se ele ficar
  // divergente. O seed e insert-only, entao NAO corrige — apagar e semear.
  await setDesconto(null);
  await seedTenant();
});

// ============================================================================
// O catalogo guarda o cheio
// ============================================================================

describe('T1 o template passou a guardar o valor CHEIO', () => {
  it('T1.1 os dois precos do template sao os cheios confirmados pelo cliente', () => {
    // Ancora no TEMPLATE, que e onde o negocio decide. Se alguem "corrigir" os
    // valores de volta para os de Pix, este teste cai antes de a venda cobrar
    // 7% a menos do que o dono espera receber.
    const porNome = new Map(quadricicloTemplate.experiences.map((e) => [e.name, e.priceCents]));
    expect(porNome.get('Trilha da Montanha')).toBe(MONTANHA_CHEIO);
    expect(porNome.get('Trilha da Fazenda')).toBe(FAZENDA_CHEIO);
  });

  it('T1.2 o desconto semeado do Quadri Club e 7%', () => {
    expect(SEED_PIX_DISCOUNT_BASIS_POINTS).toBe(700);
  });

  it('T1.3 34999 com 7% da EXATAMENTE 32549, e 24999 da EXATAMENTE 23249', () => {
    // Os dois valores que o cliente ja pagava antes da Fase A. A fase inteira
    // existe para que estes numeros NAO mudem.
    expect(applyDiscount(MONTANHA_CHEIO, 700)).toEqual({
      discountCents: 2_450,
      payableCents: MONTANHA_PIX,
    });
    expect(applyDiscount(FAZENDA_CHEIO, 700)).toEqual({
      discountCents: 1_750,
      payableCents: FAZENDA_PIX,
    });
  });
});

// ============================================================================
// A venda
// ============================================================================

describe('T2 a reserva cobra o preco com desconto', () => {
  it('T2.1 reserva de 1 recurso grava o total JA COM DESCONTO', async () => {
    const curta = TEMPLATE_EXP.curta.priceCents === FAZENDA_CHEIO;
    expect(curta, 'a curta do template deve ser a Fazenda').toBe(true);

    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta, 1),
        resourcesNeeded: 1,
        phone: '11955550001',
      }),
    );

    // O numero literal da secao 4-B.2, nao um derivado.
    expect(criada.totalCents).toBe(FAZENDA_PIX);
    expect(criada.dueNowCents).toBe(FAZENDA_PIX);

    const linha = await reservaGravada(criada.reservationId);
    expect(linha.total_price_cents).toBe(FAZENDA_PIX);
  });

  it('T2.2 a experiencia longa cobra o preco-Pix da Montanha', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550002',
      }),
    );

    expect(criada.totalCents).toBe(MONTANHA_PIX);
  });

  it('T2.3 dois recursos: o desconto incide sobre o TOTAL, nao sobre o unitario', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 2),
        resourcesNeeded: 2,
        phone: '11955550003',
      }),
    );

    // 34999 x 2 = 69998; 69998 x 700 / 10000 = 4899,86 -> 4900; 69998 - 4900.
    expect(criada.totalCents).toBe(65_098);

    const linha = await reservaGravada(criada.reservationId);
    expect(linha.full_price_cents).toBe(69_998);
  });

  it('T2.4 desconto sobre o total e sobre o unitario DIVERGEM, e o servidor usa o total', async () => {
    // Com os precos do Quadri Club os dois caminhos coincidem, o que esconderia
    // o erro. Este preco os separa: 33333 x 2 = 66666, desconto 4667 -> 61999,
    // enquanto o unitario descontado (31000) x 2 daria 62000.
    const [exp] = (
      await db.execute<{ id: number }>(sql`
        INSERT INTO experiences
          (tenant_id, name, duration_minutes, buffer_minutes, price_cents, payment_mode, min_passenger_age)
        VALUES (1, 'Fixture Divergencia T', 60, 15, 33333, 'full', 0)
        RETURNING id
      `)
    ).rows;

    try {
      const criada = await createReservation(
        reservationInput({
          experienceId: exp.id,
          startAt: await primeiroSlot(exp.id, 2),
          resourcesNeeded: 2,
          phone: '11955550004',
        }),
      );

      expect(criada.totalCents).toBe(61_999);
      expect(criada.totalCents).not.toBe(applyDiscount(33_333, 700).payableCents * 2);
    } finally {
      await wipeMovement();
      await db.execute(sql`DELETE FROM experiences WHERE id = ${exp.id}`);
    }
  });
});

// ============================================================================
// O congelamento
// ============================================================================

describe('T3 o desconto aplicado fica congelado na reserva', () => {
  it('T3.1 grava full_price_cents e discount_basis_points, e a conta fecha sozinha', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550005',
      }),
    );

    const linha = await reservaGravada(criada.reservationId);
    expect(linha.full_price_cents).toBe(MONTANHA_CHEIO);
    expect(linha.discount_basis_points).toBe(700);

    // A propriedade que justifica as duas colunas: a linha se explica sozinha,
    // sem consultar o catalogo nem a configuracao ATUAL.
    const { payableCents } = applyDiscount(linha.full_price_cents!, linha.discount_basis_points!);
    expect(payableCents).toBe(linha.total_price_cents);
  });

  it('T3.2 mudar o desconto DEPOIS nao reescreve a reserva antiga', async () => {
    const antiga = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550006',
      }),
    );

    // O dono renegocia e baixa o desconto para 5%, dois meses depois.
    await setDesconto(500);

    const linha = await reservaGravada(antiga.reservationId);
    // O passado NAO muda: e a exigencia da secao 4-B.7 aplicada ao preco.
    expect(linha.total_price_cents).toBe(MONTANHA_PIX);
    expect(linha.discount_basis_points).toBe(700);

    // E uma venda NOVA ja sai com o percentual novo: 34999 x 500 / 10000 =
    // 1749,95 -> 1750; 34999 - 1750 = 33249.
    await wipeMovement();
    const nova = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550007',
      }),
    );
    expect(nova.totalCents).toBe(33_249);
    expect((await reservaGravada(nova.reservationId)).discount_basis_points).toBe(500);

    await setDesconto(SEED_PIX_DISCOUNT_BASIS_POINTS);
  });
});

// ============================================================================
// Desconto ausente
// ============================================================================

describe('T4 sem desconto configurado, o cliente paga o cheio', () => {
  it('T4.1 a venda nao quebra e cobra o valor cheio', async () => {
    await setDesconto(null);

    try {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11955550008',
        }),
      );

      // Default fail-safe da secao 4-B.6: entre errar cobrando o cheio e errar
      // dando desconto que ninguem autorizou, o sistema erra para o cheio.
      expect(criada.totalCents).toBe(MONTANHA_CHEIO);

      const linha = await reservaGravada(criada.reservationId);
      expect(linha.discount_basis_points).toBe(0);
      expect(linha.full_price_cents).toBe(MONTANHA_CHEIO);
    } finally {
      await setDesconto(SEED_PIX_DISCOUNT_BASIS_POINTS);
    }
  });
});

// ============================================================================
// O catalogo publico
// ============================================================================

describe('T5 o catalogo publico entrega o cheio e o percentual', () => {
  it('T5.1 priceCents continua sendo o CHEIO, com o desconto de cada metodo ao lado', async () => {
    const catalogo = await listPublicExperiences();
    const montanha = catalogo.find((e) => e.name === 'Trilha da Montanha')!;

    // O campo NAO mudou de significado: segue igual a coluna price_cents.
    expect(montanha.priceCents).toBe(MONTANHA_CHEIO);
    // Fase E: virou mapa por metodo. O cartao nao tem linha configurada, logo
    // 0 bp — ele paga o cheio porque nao tem desconto, nunca por acrescimo.
    expect(montanha.discountBasisPointsByMethod.pix).toBe(700);
    expect(montanha.discountBasisPointsByMethod.card).toBe(0);
  });

  it('T5.2 a conta do wizard bate com a do servidor, inclusive em 2 recursos', async () => {
    const catalogo = await listPublicExperiences();
    const montanha = catalogo.find((e) => e.name === 'Trilha da Montanha')!;

    // Reproduz o que app/(public)/_components/shared.ts faz. O ponto do teste
    // e que existe UMA conta: a tela e o servidor chamam a mesma funcao sobre os
    // mesmos insumos, em vez de duas contas que precisam concordar.
    const doWizard = (n: number) =>
      applyDiscount(montanha.priceCents * n, montanha.discountBasisPointsByMethod.pix).payableCents;

    for (const n of [1, 2]) {
      await wipeMovement();
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, n),
          resourcesNeeded: n,
          phone: `1195555001${n}`,
        }),
      );
      expect(doWizard(n), `divergencia com ${n} recurso(s)`).toBe(criada.totalCents);
    }
  });

  it('T5.3 precoEsperado dos helpers concorda com os literais desta fase', () => {
    // Amarra o helper usado pelos grupos D e E aos valores literais daqui: se
    // alguem mudar o helper, os outros grupos nao passam a mentir em silencio.
    expect(precoEsperado(MONTANHA_CHEIO)).toBe(MONTANHA_PIX);
    expect(precoEsperado(FAZENDA_CHEIO)).toBe(FAZENDA_PIX);
    expect(precoEsperado(MONTANHA_CHEIO, 2)).toBe(65_098);
  });
});
