// GRUPO Z — cancelar a reserva cancela a cobranca pendente no provedor
// (CLAUDE.md secoes 5.1, 7.2, 8-C e 15.12).
//
// ============================================================================
// >>> O QUE ESTE GRUPO PROTEGE E O CLIENTE CANCELADO QUE AINDA CONSEGUE PAGAR.
// Ate aqui, cancelar liberava a vaga e NAO tocava no Asaas. O QR ja estava no
// WhatsApp do cliente; ele pagava, o dinheiro entrava na conta do tenant para um
// passeio que nao ia acontecer, e o estorno era MANUAL, com taxa que nao volta.
//
// A propriedade central NAO e "chamar cancelCharge". Sao QUATRO, e cada caso
// abaixo trava uma:
//
//   1. toda cobranca PENDENTE morre — nao so a do saldo (Z1, Z2)
//   2. cobranca PAGA nunca e tocada — a politica e nao devolver (Z3)
//   3. o provedor NAO PODE VETAR o cancelamento local (Z4)
//   4. reserva sem cobranca viva nao fala com o provedor a toa (Z5)
// ============================================================================
//
// >>> O QUE E MOCKADO <<< `asaasProvider`, so a borda de rede — mesma linha de
// corte dos grupos I, K, V, W e Y. O banco e real, e e ele que guarda o
// `state='cancelled'` que este grupo verifica.
//
// >>> ESTE GRUPO E O PRIMEIRO A OBSERVAR `reservation_payments.state =
// 'cancelled'` EXISTINDO. <<< O valor estava no enum desde a rev 6 e nenhum
// caminho de codigo o produzia.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { PaymentProviderNetworkError } from '@/lib/payments/provider';
import {
  InvalidReservationTransitionError,
  ReservationNotFoundError,
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

const fake = vi.hoisted(() => ({
  /** cobrancas que o provedor foi mandado cancelar, na ordem. */
  cancelled: [] as string[],
  /** quando setado, TODA chamada a cancelCharge falha. */
  cancelThrows: null as Error | null,
  /**
   * Quando ligado, a PRIMEIRA chamada falha e as seguintes passam.
   *
   * >>> POR QUE "A PRIMEIRA" E NAO "A DO ID X". <<< A versao anterior deste
   * fake escolhia a vitima por id, e com isso Z4.2 so provava alguma coisa se a
   * ordem do RETURNING colocasse aquele id primeiro — passava por acidente de
   * ordem, exatamente a classe de problema da regra de 01/09. Falhando sempre a
   * primeira, o caso vale para qualquer ordem que o Postgres devolva.
   */
  failFirstCall: false,
  calls: 0,
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    cancelCharge: async (chargeId: string): Promise<void> => {
      fake.calls += 1;
      if (fake.cancelThrows) throw fake.cancelThrows;
      if (fake.failFirstCall && fake.calls === 1) {
        throw new PaymentProviderNetworkError(`falha simulada em ${chargeId}`);
      }
      fake.cancelled.push(chargeId);
    },
    createPixCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    getPixQrCode: async () => {
      throw new Error('nao usado neste grupo');
    },
    getCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    findChargeByExternalReference: async () => null,
  },
}));

const { cancelReservationAndCharges } = await import('@/lib/payments/cancel-charges');

const SAT = nextSaturday();

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

/**
 * Liga o sinal numa experiencia e RESTAURA O QUE ENCONTROU.
 *
 * Copia deliberada do helper dos grupos U/V/W/Y, pela regra de 01/09: toda
 * precondicao de catalogo se declara no proprio arquivo. Um helper compartilhado
 * economizaria estas linhas e reintroduziria a dependencia entre arquivos que
 * fez `U3.2` passar por acidente de ordem de execucao.
 */
async function comSinal<T>(experienceId: number, fn: () => Promise<T>): Promise<T> {
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

/**
 * Simula o que `createChargeForReservation` faz apos a transacao: grava o id da
 * cobranca do provedor na linha. A suite nao chama o provedor de verdade
 * (`createReservation` nao cria cobranca, por desenho — ver charge.ts).
 */
async function comCobranca(reservationId: string, kind: string, chargeId: string): Promise<void> {
  await db.execute(sql`
    UPDATE reservation_payments SET asaas_payment_id = ${chargeId}
    WHERE reservation_id = ${reservationId} AND kind = ${kind}::payment_kind
  `);
}

async function linhas(reservationId: string) {
  const { rows } = await db.execute<{
    kind: string;
    state: string;
    asaas_payment_id: string | null;
    charge_stage: string | null;
  }>(sql`
    SELECT kind::text, state::text, asaas_payment_id, charge_stage::text
    FROM reservation_payments WHERE reservation_id = ${reservationId} ORDER BY kind
  `);
  return rows;
}

async function estadoReserva(reservationId: string) {
  const { rows } = await db.execute<{
    status: string;
    payment_state: string;
    amount_paid_cents: number;
  }>(sql`
    SELECT status::text, payment_state::text, amount_paid_cents
    FROM reservations WHERE id = ${reservationId}
  `);
  return rows[0];
}

/** Linhas de alocacao ainda ocupando a vaga (as que a exclusion constraint ve). */
async function vagasOcupadas(reservationId: string): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM reservation_resources
    WHERE reservation_id = ${reservationId}
      AND status IN ('pending_payment','confirmed')
  `);
  return rows[0]!.total;
}

/** Reserva `pending_payment` com a cobranca do valor DEVIDO viva no provedor. */
async function reservaAguardandoPagamento(
  phone: string,
  chargeId: string,
): Promise<string> {
  const criada = await createReservation(
    reservationInput({
      experienceId: EXP.longa,
      startAt: await primeiroSlot(EXP.longa, 1),
      resourcesNeeded: 1,
      phone,
    }),
  );
  await comCobranca(criada.reservationId, 'full', chargeId);
  return criada.reservationId;
}

/**
 * Reserva `confirmed` + `partial`: sinal PAGO, saldo em aberto e JA COBRADO
 * (o dono apertou "Cobrar saldo" da Fase C).
 */
async function reservaComSaldoCobrado(
  phone: string,
  chargeIdSinal: string,
  chargeIdSaldo: string,
): Promise<string> {
  return comSinal(EXP.longa, async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone,
        paymentMethodMode: 'deposit',
      }),
    );
    await comCobranca(criada.reservationId, 'deposit', chargeIdSinal);
    await comCobranca(criada.reservationId, 'balance', chargeIdSaldo);
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid', paid_at = now()
      WHERE reservation_id = ${criada.reservationId} AND kind = 'deposit'
    `);
    await recalcReservationPayment(criada.reservationId);
    await setReservationStatus(criada.reservationId, 'confirmed');
    return criada.reservationId;
  });
}

beforeAll(assertCatalogSeeded);
beforeEach(async () => {
  await wipeMovement();
  fake.cancelled = [];
  fake.cancelThrows = null;
  fake.failFirstCall = false;
  fake.calls = 0;
});
afterAll(wipeMovement);

// ============================================================================
describe('Z1 reserva aguardando pagamento: a cobranca do devido e cancelada', () => {
  it('Z1.1 pending_payment cancelada cancela a cobranca no provedor e marca a linha', async () => {
    const id = await reservaAguardandoPagamento('11955550001', 'pay_z11');

    const result = await cancelReservationAndCharges(id);

    // O provedor foi chamado com o id CERTO. Nao basta "foi chamado uma vez":
    // uma implementacao que mandasse o id errado passaria nessa asercao fraca.
    expect(fake.cancelled).toEqual(['pay_z11']);
    expect(result.providerCancelled).toBe(1);
    expect(result.providerFailed).toBe(0);

    // A linha local descreve a NOSSA decisao (docs/DECISOES.md, 02/09).
    expect(await linhas(id)).toEqual([
      expect.objectContaining({ kind: 'full', state: 'cancelled', asaas_payment_id: 'pay_z11' }),
    ]);
    expect(result.paymentsCancelled).toBe(1);

    // E a vaga, que e o ponto de partida de tudo.
    expect((await estadoReserva(id)).status).toBe('cancelled');
    expect(await vagasOcupadas(id)).toBe(0);
  });

  it('Z1.2 a reserva com SINAL ainda nao pago cancela a cobranca do sinal, e o saldo nunca teve cobranca', async () => {
    // >>> NAO E SO O SALDO. <<< Aqui o que esta vivo e a cobranca do SINAL; a
    // do saldo sequer existe, porque nasce sob demanda (Fase C).
    const id = await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11955550002',
          paymentMethodMode: 'deposit',
        }),
      );
      await comCobranca(criada.reservationId, 'deposit', 'pay_z12');
      return criada.reservationId;
    });

    const result = await cancelReservationAndCharges(id);

    expect(fake.cancelled).toEqual(['pay_z12']);
    expect(result.providerCancelled).toBe(1);

    // As DUAS linhas sao marcadas: a do saldo tambem morre, mesmo sem cobranca
    // no provedor — ela nunca mais sera cobrada, e deixa-la 'pending' a manteria
    // no indice idx_rp_open como se fosse trabalho a fazer.
    const rows = await linhas(id);
    expect(rows.map((r) => [r.kind, r.state])).toEqual([
      ['balance', 'cancelled'],
      ['deposit', 'cancelled'],
    ]);
    expect(result.paymentsCancelled).toBe(2);
  });
});

// ============================================================================
describe('Z2 reserva confirmed + partial: a cobranca do SALDO e cancelada', () => {
  it('Z2.1 o saldo cobrado morre no provedor e o sinal PAGO nao e tocado', async () => {
    const id = await reservaComSaldoCobrado('11955550003', 'pay_z21_sinal', 'pay_z21_saldo');
    expect((await estadoReserva(id)).payment_state).toBe('partial');

    const result = await cancelReservationAndCharges(id);

    // >>> A ASERCAO DECISIVA DESTE CASO E O QUE **NAO** FOI CHAMADO. <<<
    // O sinal esta pago e a politica do tenant e NAO DEVOLVER (secao 4-C).
    expect(fake.cancelled).toEqual(['pay_z21_saldo']);
    expect(fake.cancelled).not.toContain('pay_z21_sinal');
    expect(result.providerCancelled).toBe(1);
    expect(result.paymentsCancelled).toBe(1);

    const rows = await linhas(id);
    expect(rows.find((r) => r.kind === 'balance')!.state).toBe('cancelled');
    expect(rows.find((r) => r.kind === 'deposit')!.state).toBe('paid');

    // O dinheiro do sinal CONTINUA registrado. Cancelar a reserva nao apaga que
    // ele entrou — o estorno, se houver, e manual no painel (secao 8-C).
    const estado = await estadoReserva(id);
    expect(estado.status).toBe('cancelled');
    expect(estado.amount_paid_cents).toBeGreaterThan(0);
    expect(await vagasOcupadas(id)).toBe(0);
  });
});

// ============================================================================
describe('Z3 cobranca JA PAGA nunca e cancelada', () => {
  it('Z3.1 reserva integralmente paga e cancelada sem NENHUMA chamada ao provedor', async () => {
    const id = await reservaAguardandoPagamento('11955550004', 'pay_z31');
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid', paid_at = now()
      WHERE reservation_id = ${id} AND kind = 'full'
    `);
    await recalcReservationPayment(id);
    await setReservationStatus(id, 'confirmed');

    const result = await cancelReservationAndCharges(id);

    // Nao e "o Asaas recusou": e o sistema NAO PEDINDO. A distincao importa,
    // porque um cancelamento tentado e recusado deixaria log de erro e faria
    // alguem investigar um comportamento correto.
    expect(fake.cancelled).toEqual([]);
    expect(result.providerCancelled).toBe(0);
    expect(result.providerFailed).toBe(0);
    expect(result.paymentsCancelled).toBe(0);

    // A linha paga fica INTACTA — inclusive o id da cobranca e o paid_at.
    expect(await linhas(id)).toEqual([
      expect.objectContaining({ kind: 'full', state: 'paid', asaas_payment_id: 'pay_z31' }),
    ]);
    expect((await estadoReserva(id)).amount_paid_cents).toBeGreaterThan(0);
  });

  it('Z3.2 linha ESTORNADA (chargeback, Fase E) tambem nao e cancelada', async () => {
    const id = await reservaAguardandoPagamento('11955550005', 'pay_z32');
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'refunded'
      WHERE reservation_id = ${id} AND kind = 'full'
    `);

    await cancelReservationAndCharges(id);

    expect(fake.cancelled).toEqual([]);
    expect((await linhas(id))[0]!.state).toBe('refunded');
  });
});

// ============================================================================
describe('Z4 o provedor NAO PODE VETAR o cancelamento local', () => {
  it('Z4.1 provedor fora do ar: a reserva e cancelada e a VAGA E LIBERADA assim mesmo', async () => {
    const id = await reservaAguardandoPagamento('11955550006', 'pay_z41');
    fake.cancelThrows = new PaymentProviderNetworkError('timeout simulado');

    // NAO lanca. Esta e a regra inviolavel da tarefa: cancelamento e operacao
    // local e soberana.
    const result = await cancelReservationAndCharges(id);

    expect((await estadoReserva(id)).status).toBe('cancelled');
    expect(await vagasOcupadas(id)).toBe(0);

    // E o dono PRECISA saber, porque a cobranca continua pagavel e nao ha
    // retentativa automatica (o reconciliador exclui reservas canceladas).
    expect(result.providerFailed).toBe(1);
    expect(result.providerCancelled).toBe(0);

    // A linha e marcada MESMO ASSIM (decisao de 02/09): ela descreve a nossa
    // decisao, nao o estado do provedor. Marcar so as confirmadas deixaria o
    // banco heterogeneo por acidente de rede.
    expect((await linhas(id))[0]!.state).toBe('cancelled');
  });

  it('Z4.2 duas cobrancas e a PRIMEIRA falha: a segunda e tentada assim mesmo', async () => {
    // Abortar na primeira falha deixaria a segunda pagavel sem nem ter sido
    // tentada. Uma cobranca cancelada e estritamente melhor que zero.
    const id = await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11955550007',
          paymentMethodMode: 'deposit',
        }),
      );
      await comCobranca(criada.reservationId, 'deposit', 'pay_z42_sinal');
      await comCobranca(criada.reservationId, 'balance', 'pay_z42_saldo');
      return criada.reservationId;
    });

    fake.failFirstCall = true;

    const result = await cancelReservationAndCharges(id);

    // >>> AS ASERCOES SAO INDEPENDENTES DA ORDEM DO `RETURNING`, DE PROPOSITO.
    // O que importa nao e QUAL das duas foi cancelada: e que a segunda tenha
    // sido TENTADA depois de a primeira falhar. Fixar o id aqui faria o caso
    // provar ou nao provar conforme a ordem que o Postgres devolvesse.
    expect(fake.calls).toBe(2);
    expect(fake.cancelled).toHaveLength(1);
    expect(['pay_z42_sinal', 'pay_z42_saldo']).toContain(fake.cancelled[0]);
    expect(result.providerCancelled).toBe(1);
    expect(result.providerFailed).toBe(1);
    expect(result.paymentsCancelled).toBe(2);
  });
});

// ============================================================================
describe('Z5 nao fala com o provedor a toa', () => {
  it('Z5.1 reserva sem cobranca criada (borda 9 / saldo nunca cobrado) nao chama o provedor', async () => {
    // Linha 'pending' SEM asaas_payment_id: nao ha o que cancelar la.
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550008',
      }),
    );

    const result = await cancelReservationAndCharges(criada.reservationId);

    expect(fake.cancelled).toEqual([]);
    expect(result.providerCancelled).toBe(0);
    expect(result.providerFailed).toBe(0);

    // Mas a linha local morre do mesmo jeito.
    expect(result.paymentsCancelled).toBe(1);
    expect((await linhas(criada.reservationId))[0]!.state).toBe('cancelled');
  });

  it('Z5.2 `charge_stage` NAO e escrito por este caminho', async () => {
    // Ele e vocabulario de EXIBICAO, escrito por processCharge a partir de uma
    // LEITURA do provedor (secao 4-B.9). Grava-lo aqui inventaria um estagio que
    // nao lemos — e, no caso da falha do Z4.1, afirmaria 'cancelado' sobre uma
    // cobranca que continua pagavel.
    const id = await reservaAguardandoPagamento('11955550009', 'pay_z52');
    await db.execute(sql`
      UPDATE reservation_payments SET charge_stage = 'aguardando'
      WHERE reservation_id = ${id} AND kind = 'full'
    `);

    await cancelReservationAndCharges(id);

    expect((await linhas(id))[0]!.charge_stage).toBe('aguardando');
  });
});

// ============================================================================
describe('Z6 a maquina de estados continua sendo a de setReservationStatus', () => {
  it('Z6.1 reserva ja cancelada recusa a segunda vez e NAO chama o provedor', async () => {
    const id = await reservaAguardandoPagamento('11955550010', 'pay_z61');
    await cancelReservationAndCharges(id);
    fake.cancelled = [];

    await expect(cancelReservationAndCharges(id)).rejects.toBeInstanceOf(
      InvalidReservationTransitionError,
    );

    // A transacao inteira abortou: nada foi remarcado e o provedor nao foi
    // chamado de novo com um id que ja cancelamos.
    expect(fake.cancelled).toEqual([]);
  });

  it('Z6.2 reserva inexistente lanca ReservationNotFoundError, sem tocar no provedor', async () => {
    await expect(
      cancelReservationAndCharges('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);

    expect(fake.cancelled).toEqual([]);
  });
});
