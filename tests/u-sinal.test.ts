// GRUPO U — sinal de 50% via Pix (CLAUDE.md secoes 4-B.2, 4-B.3 e 4-B.5).
//
// ============================================================================
// >>> O RISCO DESTA FASE NAO E O CALCULO. E A PALAVRA "CONFIRMADA". <<<
// Reserva com sinal pago fica `confirmed` + `payment_state='partial'`. Se as
// telas mostrarem so "confirmada", o guia leva a pessoa no passeio e ninguem
// cobra o que falta. Por isso o grupo tem tanto teste de ESTADO quanto de conta.
// ============================================================================

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { expireHolds } from '@/lib/jobs/expire-holds';
import {
  InvalidCompositionError,
  canTransition,
  createReservation,
  recalcReservationPayment,
  setReservationStatus,
} from '@/lib/reservations';

import {
  EXP,
  assertCatalogSeeded,
  nextSaturday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

/** Empurra o hold para o passado. Sem mockar relogio (proibido — ver helpers). */
async function vencerHold(reservationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE reservations SET hold_expires_at = now() - interval '1 hour'
    WHERE id = ${reservationId}
  `);
}

async function estado(reservationId: string) {
  const { rows } = await db.execute<{
    status: string;
    payment_state: string;
    amount_paid_cents: number;
    total_price_cents: number;
  }>(sql`
    SELECT status::text, payment_state::text, amount_paid_cents, total_price_cents
    FROM reservations WHERE id = ${reservationId}
  `);
  return rows[0];
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);
afterAll(wipeMovement);

// ============================================================================
// As barreiras do cron
// ============================================================================
//
// >>> ESTES TESTES NAO CONSERTAM NADA. ELES TRAVAM. <<<
// As duas barreiras que impedem o cron de expirar uma reserva ja paga sao uma
// linha cada, e remover qualquer uma NAO PARECE PERIGOSO para quem escreve:
// alargar o filtro de um SELECT ou acrescentar uma transicao a um mapa passam
// em revisao sem levantar suspeita. Com estes testes, viram build vermelho.
//
// O dano que eles previnem e o pior possivel desta fase: liberar a vaga de quem
// ja pagou metade, com o dinheiro na conta do tenant.

describe('U1 o cron de hold nao toca em reserva confirmada', () => {
  it('U1.1 confirmada com hold VENCIDO sobrevive ao cron', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta, 1),
        resourcesNeeded: 1,
        phone: '11944440001',
      }),
    );

    await setReservationStatus(criada.reservationId, 'confirmed');
    // O hold continua gravado depois da confirmacao — nao e limpo. E justamente
    // por isso que o filtro por status e a unica coisa que protege a reserva.
    await vencerHold(criada.reservationId);

    const resultado = await expireHolds();

    expect(resultado.reservationIds).not.toContain(criada.reservationId);
    expect((await estado(criada.reservationId)).status).toBe('confirmed');
  });

  it('U1.2 a maquina de estados recusa confirmed -> expired', () => {
    // Segunda barreira, independente do filtro do SELECT. Se alguem alargar
    // aquele filtro, esta ainda segura — e o contrario tambem vale.
    expect(canTransition('confirmed', 'expired')).toBe(false);
    expect(canTransition('pending_payment', 'expired')).toBe(true);
  });

  it('U1.3 e o cron CONTINUA expirando o que deve: pending_payment vencida', async () => {
    // O par do U1.1. Sem ele, "o cron nao expirou nada" passaria por sucesso
    // mesmo se alguem quebrasse a expiracao inteira.
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta, 1),
        resourcesNeeded: 1,
        phone: '11944440002',
      }),
    );

    await vencerHold(criada.reservationId);

    const resultado = await expireHolds();

    expect(resultado.reservationIds).toContain(criada.reservationId);
    expect((await estado(criada.reservationId)).status).toBe('expired');
  });
});

// ============================================================================
// O calculo
// ============================================================================

const MONTANHA_CHEIO = 34_999;
const MONTANHA_PIX = 32_549;
const MONTANHA_ENTRADA = 16_275;
const MONTANHA_SALDO = 16_274;

const FAZENDA_PIX = 23_249;
const FAZENDA_ENTRADA = 11_625;
const FAZENDA_SALDO = 11_624;

/**
 * Garante que a experiencia NAO oferece sinal, restaurando depois.
 *
 * >>> DECLARA A PRECONDICAO EM VEZ DE ASSUMI-LA. <<<
 * U3.2 dependia do catalogo estar em 'full' e passava por ACIDENTE DE ORDEM: o
 * `comSinal` de um caso anterior gravava 'full' literal no `finally` e deixava a
 * experiencia assim para o caso seguinte. Quando o `comSinal` passou a restaurar
 * o valor que leu (01/09) e o template passou a declarar 'deposit', o acidente
 * sumiu e o teste caiu — corretamente, porque ele nunca tinha estabelecido o
 * estado que afirmava testar.
 */
async function semSinal<T>(experienceId: number, fn: () => Promise<T>): Promise<T> {
  const [antes] = (
    await db.execute<{
      payment_mode: 'full' | 'deposit';
      deposit_percent: number | null;
      deposit_fixed_cents: number | null;
    }>(sql`
      SELECT payment_mode::text, deposit_percent, deposit_fixed_cents
      FROM experiences WHERE id = ${experienceId}
    `)
  ).rows;

  await db.execute(sql`
    UPDATE experiences SET payment_mode = 'full', deposit_percent = NULL, deposit_fixed_cents = NULL
    WHERE id = ${experienceId}
  `);
  try {
    return await fn();
  } finally {
    await db.execute(sql`
      UPDATE experiences
      SET payment_mode = ${antes.payment_mode},
          deposit_percent = ${antes.deposit_percent},
          deposit_fixed_cents = ${antes.deposit_fixed_cents}
      WHERE id = ${experienceId}
    `);
  }
}

/** Liga/desliga o sinal numa experiencia do catalogo, restaurando depois. */
async function comSinal<T>(experienceId: number, fn: () => Promise<T>): Promise<T> {
  // >>> RESTAURA O QUE ENCONTROU, NUNCA 'full' FIXO. <<<
  // Ate 01/09 o `finally` gravava 'full' literal. Aquilo casava com o template
  // por coincidencia, e parou de casar quando o template passou a declarar
  // 'deposit' — a divergencia so nao aparecia porque o seed do grupo T
  // reconciliava o catalogo de volta. Com experiences insert-only essa muleta
  // nao existe mais, e um helper que "restaura" para um valor inventado deixa o
  // catalogo sujo para o proximo arquivo da suite.
  const [antes] = (
    await db.execute<{
      payment_mode: 'full' | 'deposit';
      deposit_percent: number | null;
      deposit_fixed_cents: number | null;
    }>(sql`
      SELECT payment_mode::text, deposit_percent, deposit_fixed_cents
      FROM experiences WHERE id = ${experienceId}
    `)
  ).rows;

  await db.execute(sql`
    UPDATE experiences SET payment_mode = 'deposit', deposit_percent = 50, deposit_fixed_cents = NULL
    WHERE id = ${experienceId}
  `);
  try {
    return await fn();
  } finally {
    await db.execute(sql`
      UPDATE experiences
      SET payment_mode = ${antes.payment_mode},
          deposit_percent = ${antes.deposit_percent},
          deposit_fixed_cents = ${antes.deposit_fixed_cents}
      WHERE id = ${experienceId}
    `);
  }
}

async function pagamentos(reservationId: string) {
  const { rows } = await db.execute<{ kind: string; amount_cents: number }>(sql`
    SELECT kind::text, amount_cents FROM reservation_payments
    WHERE reservation_id = ${reservationId} ORDER BY kind
  `);
  return rows;
}

describe('U2 a divisao do sinal', () => {
  it('U2.1 Montanha: entrada 16275 + saldo 16274 = 32549 exatos', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440010',
          paymentMethodMode: 'deposit',
        }),
      );

      expect(criada.totalCents).toBe(MONTANHA_PIX);
      expect(criada.dueNowCents).toBe(MONTANHA_ENTRADA);
      expect(criada.balanceCents).toBe(MONTANHA_SALDO);
      // A propriedade da secao 4-B.5, afirmada explicitamente.
      expect(criada.dueNowCents + criada.balanceCents).toBe(criada.totalCents);
    });
  });

  it('U2.2 Fazenda: os valores correspondentes', async () => {
    await comSinal(EXP.curta, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.curta,
          startAt: await primeiroSlot(EXP.curta, 1),
          resourcesNeeded: 1,
          phone: '11944440011',
          paymentMethodMode: 'deposit',
        }),
      );

      expect(criada.totalCents).toBe(FAZENDA_PIX);
      expect(criada.dueNowCents).toBe(FAZENDA_ENTRADA);
      expect(criada.balanceCents).toBe(FAZENDA_SALDO);
      expect(criada.dueNowCents + criada.balanceCents).toBe(criada.totalCents);
    });
  });

  it('U2.3 >>> o desconto incide ANTES da divisao <<<', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440012',
          paymentMethodMode: 'deposit',
        }),
      );

      // 50% de 32549 (ja com desconto) = 16275.
      expect(criada.dueNowCents).toBe(MONTANHA_ENTRADA);

      // NAO 50% de 34999 (o cheio) = 17500. Se fosse assim, o cliente do sinal
      // pagaria 35000 no total — MAIS que os 32549 de quem paga integral,
      // punindo exatamente quem aceitou pagar antes (secao 4-B.2).
      expect(criada.dueNowCents).not.toBe(Math.round(MONTANHA_CHEIO / 2));
      expect(criada.dueNowCents + criada.balanceCents).toBeLessThan(MONTANHA_CHEIO);
    });
  });

  it('U2.4 entrada + saldo fecha mesmo quando a metade nao e inteira', async () => {
    // Preco impar de propósito: 33333 com 7% da 31000, cuja metade e 15500
    // exata; entao usamos um valor cujo total descontado seja IMPAR.
    const [exp] = (
      await db.execute<{ id: number }>(sql`
        INSERT INTO experiences
          (tenant_id, name, duration_minutes, buffer_minutes, price_cents,
           payment_mode, deposit_percent, min_passenger_age)
        VALUES (1, 'Fixture Metade Quebrada U', 60, 15, 10001, 'deposit', 50, 0)
        RETURNING id
      `)
    ).rows;

    try {
      const criada = await createReservation(
        reservationInput({
          experienceId: exp.id,
          startAt: await primeiroSlot(exp.id, 1),
          resourcesNeeded: 1,
          phone: '11944440013',
          paymentMethodMode: 'deposit',
        }),
      );

      // 10001 - round(700,07) = 10001 - 700 = 9301, que e IMPAR.
      expect(criada.totalCents).toBe(9_301);
      // 9301 / 2 = 4650,5 -> entrada arredonda para CIMA (secao 4-B.5).
      expect(criada.dueNowCents).toBe(4_651);
      expect(criada.balanceCents).toBe(4_650);
      // O centavo impar tem dono por construcao, e a soma fecha.
      expect(criada.dueNowCents + criada.balanceCents).toBe(criada.totalCents);
    } finally {
      await wipeMovement();
      await db.execute(sql`DELETE FROM experiences WHERE id = ${exp.id}`);
    }
  });

  it('U2.5 cria DUAS linhas de pagamento: deposit e balance', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440014',
          paymentMethodMode: 'deposit',
        }),
      );

      const linhas = await pagamentos(criada.reservationId);
      expect(linhas.map((l) => l.kind)).toEqual(['balance', 'deposit']);
      expect(linhas.reduce((acc, l) => acc + Number(l.amount_cents), 0)).toBe(MONTANHA_PIX);
    });
  });
});

// ============================================================================
// Oferecido x cobrado, e o congelamento
// ============================================================================

describe('U3 a experiencia OFERECE, o cliente ESCOLHE', () => {
  it('U3.1 experiencia com sinal, cliente escolhendo integral: cobra tudo', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440020',
          paymentMethodMode: 'full',
        }),
      );

      // O modo EFETIVO e o do CLIENTE, nao o da experiencia (secao 4-B.4).
      expect(criada.paymentMode).toBe('full');
      expect(criada.dueNowCents).toBe(MONTANHA_PIX);
      expect(criada.balanceCents).toBe(0);
      expect((await pagamentos(criada.reservationId)).map((l) => l.kind)).toEqual(['full']);
    });
  });

  it('U3.2 experiencia SEM sinal, cliente pedindo sinal: RECUSA, nunca rebaixa', async () => {
    // Rebaixar em silencio para integral cobraria o DOBRO do que a tela mostrou.
    //
    // O `semSinal` e obrigatorio: o catalogo real oferece sinal nas duas trilhas
    // (o template declara 'deposit' desde 01/09), entao a experiencia SEM sinal
    // que este caso precisa nao existe por padrao e tem de ser estabelecida.
    await semSinal(EXP.longa, async () => {
      await expect(
        createReservation(
          reservationInput({
            experienceId: EXP.longa,
            startAt: await primeiroSlot(EXP.longa, 1),
            resourcesNeeded: 1,
            phone: '11944440021',
            paymentMethodMode: 'deposit',
          }),
        ),
      ).rejects.toBeInstanceOf(InvalidCompositionError);
    });
  });

  it('U3.3 reserva em modo integral segue intacta — nada disto a afeta', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11944440022',
      }),
    );

    expect(criada.paymentMode).toBe('full');
    expect(criada.dueNowCents).toBe(MONTANHA_PIX);
    expect(criada.balanceCents).toBe(0);
    expect((await estado(criada.reservationId)).payment_state).toBe('pending');
  });

  it('U3.4 no modo sinal, full_price_cents e discount_basis_points continuam gravados', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440023',
          paymentMethodMode: 'deposit',
        }),
      );

      const { rows } = await db.execute<{
        full_price_cents: number | null;
        discount_basis_points: number | null;
      }>(sql`
        SELECT full_price_cents, discount_basis_points FROM reservations
        WHERE id = ${criada.reservationId}
      `);

      // O congelamento da Fase A nao pode ter se perdido ao ligar o sinal: e
      // ele que explica de onde saiu o total que foi dividido ao meio.
      expect(rows[0].full_price_cents).toBe(MONTANHA_CHEIO);
      expect(rows[0].discount_basis_points).toBe(700);
    });
  });
});

// ============================================================================
// O estado: confirmed + partial
// ============================================================================

describe('U4 sinal pago deixa a reserva confirmed + partial', () => {
  it('U4.1 pagar a linha de deposit confirma a reserva com saldo em aberto', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440030',
          paymentMethodMode: 'deposit',
        }),
      );

      // Simula o que o webhook faz (secao 8.2, passo 6): marca a cobranca paga,
      // recalcula o agregado e confirma. As duas funcoes, na ordem — nunca um
      // UPDATE direto (regra inviolavel da secao 4.6).
      await db.execute(sql`
        UPDATE reservation_payments SET state = 'paid', paid_at = now()
        WHERE reservation_id = ${criada.reservationId} AND kind = 'deposit'
      `);
      await recalcReservationPayment(criada.reservationId);
      await setReservationStatus(criada.reservationId, 'confirmed');

      const depois = await estado(criada.reservationId);
      expect(depois.status).toBe('confirmed');
      expect(depois.payment_state).toBe('partial');
      expect(depois.amount_paid_cents).toBe(MONTANHA_ENTRADA);
      // A vaga esta garantida E ainda falta dinheiro. E a combinacao que a
      // maquina de estados da secao 5 nao previa.
      expect(depois.total_price_cents - depois.amount_paid_cents).toBe(MONTANHA_SALDO);
    });
  });

  it('U4.2 >>> confirmed+partial com hold VENCIDO sobrevive ao cron <<<', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11944440031',
          paymentMethodMode: 'deposit',
        }),
      );

      await db.execute(sql`
        UPDATE reservation_payments SET state = 'paid', paid_at = now()
        WHERE reservation_id = ${criada.reservationId} AND kind = 'deposit'
      `);
      await recalcReservationPayment(criada.reservationId);
      await setReservationStatus(criada.reservationId, 'confirmed');

      await vencerHold(criada.reservationId);

      // O CASO QUE DOI: o cliente pagou metade, o hold venceu, e o cron roda.
      // Se ele expirasse a reserva, a vaga de quem ja pagou seria liberada — com
      // o dinheiro na conta do tenant.
      const resultado = await expireHolds();

      expect(resultado.reservationIds).not.toContain(criada.reservationId);
      const depois = await estado(criada.reservationId);
      expect(depois.status).toBe('confirmed');
      expect(depois.payment_state).toBe('partial');
    });
  });
});
