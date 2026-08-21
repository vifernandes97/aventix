// GRUPO I — webhook e reconciliacao (CLAUDE.md secoes 8.1, 8.2, 8.3 e 8-B).
//
// >>> O QUE E MOCKADO AQUI, E POR QUE SO ISSO <<<
// Apenas `asaasProvider.getCharge` — a BORDA DE REDE. O banco continua sendo o
// Postgres de verdade, com transacao, FOR UPDATE e exclusion constraint reais,
// como manda a decisao de 2026-07-28 (mockar banco provaria que o mock
// funciona). E justamente o comportamento do BANCO que estes casos exercitam: o
// Pix tardio depende da exclusion constraint disparar de verdade.
//
// A alternativa — bater no sandbox do Asaas — nao daria teste: o estado de uma
// cobranca la nao e controlavel a partir daqui, e "pago" depende de alguem
// clicar no simulador. O ponta a ponta contra o sandbox foi feito a mao.

import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import type { ChargeSnapshot } from '@/lib/payments/provider';
import { createReservation, setReservationStatus } from '@/lib/reservations';

import { EXP, assertCatalogSeeded, nextSaturday, reservationInput, wipeMovement } from './helpers/db';

// Estado controlavel devolvido pelo provedor falso.
const fakeCharge = vi.hoisted(() => ({
  current: null as ChargeSnapshot | null,
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    getCharge: async (chargeId: string): Promise<ChargeSnapshot> => {
      if (!fakeCharge.current) throw new Error('teste nao preparou a cobranca');
      return { ...fakeCharge.current, chargeId };
    },
    createPixCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    getPixQrCode: async () => {
      throw new Error('nao usado neste grupo');
    },
    cancelCharge: async () => {},
  },
}));

// Importado DEPOIS do vi.mock, para pegar o provedor falso.
const { processCharge } = await import('@/lib/payments/process');
const { verifyWebhookToken } = await import('@/lib/payments/asaas');
const { reconcilePayments } = await import('@/lib/jobs/reconcile-payments');

const SAT = nextSaturday();

/** Cobranca paga no provedor. */
function paga(amountCents: number, externalReference: string): ChargeSnapshot {
  return {
    chargeId: 'pay_fake',
    state: 'paid',
    amountCents,
    externalReference,
    paidAt: new Date().toISOString(),
  };
}

/** Cria reserva e devolve o que o webhook precisaria: id da cobranca local. */
async function reservaComCobranca(params: {
  startAt: string;
  resourcesNeeded: number;
  phone: string;
  chargeId: string;
}) {
  const criada = await createReservation(
    reservationInput({
      experienceId: EXP.curta,
      startAt: params.startAt,
      resourcesNeeded: params.resourcesNeeded,
      phone: params.phone,
    }),
  );

  // A criacao da cobranca no provedor mora na ROTA, nao em createReservation
  // (para a suite nao depender de rede). Aqui simulamos o id ja gravado.
  await db.execute(sql`
    UPDATE reservation_payments SET asaas_payment_id = ${params.chargeId}
    WHERE reservation_id = ${criada.reservationId}
  `);

  const [row] = (
    await db.execute<{ external_reference: string; amount_cents: number }>(sql`
      SELECT external_reference, amount_cents FROM reservation_payments
      WHERE reservation_id = ${criada.reservationId}
    `)
  ).rows;

  return { ...criada, externalReference: row.external_reference, amountCents: row.amount_cents };
}

async function estado(reservationId: string) {
  const [row] = (
    await db.execute<{
      status: string;
      payment_state: string;
      amount_paid_cents: number;
      pay_state: string;
      paid_at: string | null;
    }>(sql`
      SELECT r.status, r.payment_state, r.amount_paid_cents,
             rp.state AS pay_state, rp.paid_at
      FROM reservations r JOIN reservation_payments rp ON rp.reservation_id = r.id
      WHERE r.id = ${reservationId}
    `)
  ).rows;
  return row;
}

async function primeiroSlot(resourcesNeeded: number): Promise<string> {
  const { slots } = await getAvailability({
    experienceId: EXP.curta,
    date: SAT,
    resourcesNeeded,
  });
  return slots[0]!.startAt;
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);
afterEach(() => {
  fakeCharge.current = null;
});

describe('I — autenticacao do webhook (secao 8.1 regra 8)', () => {
  it('25. token correto passa; errado, vazio e ausente sao recusados', () => {
    const original = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = 'token-secreto-do-webhook';

    try {
      expect(verifyWebhookToken('token-secreto-do-webhook')).toBe(true);
      expect(verifyWebhookToken('token-errado')).toBe(false);
      expect(verifyWebhookToken('')).toBe(false);
      expect(verifyWebhookToken(null)).toBe(false);
      // Prefixo correto nao basta — a comparacao e do valor inteiro.
      expect(verifyWebhookToken('token-secreto-do-webhook-a-mais')).toBe(false);

      // Sem token no ambiente, RECUSA tudo. Aceitar seria pior: sem o segredo
      // nao ha como distinguir o Asaas de qualquer um.
      delete process.env.ASAAS_WEBHOOK_TOKEN;
      expect(verifyWebhookToken('qualquer-coisa')).toBe(false);
    } finally {
      if (original === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
      else process.env.ASAAS_WEBHOOK_TOKEN = original;
    }
  });
});

describe('I — processamento do pagamento (secao 8.2)', () => {
  it('26. cobranca orfa nao e erro: ignora em silencio', async () => {
    // Pix pessoal do dono na mesma conta gera evento. Se isto lancasse, o
    // acumulo de falhas interromperia a fila e derrubaria a confirmacao das
    // reservas de TODO MUNDO (secao 8.1 regras 6 e 7).
    fakeCharge.current = paga(10000, 'nada-a-ver-com-o-aventix');

    const result = await processCharge('pay_de_terceiro');

    expect(result.outcome).toBe('orphan');
    expect(result.reservationId).toBeUndefined();
  });

  it('27. pagamento devido confirma a reserva e liquida o estado financeiro', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000001',
      chargeId: 'pay_ok',
    });

    fakeCharge.current = paga(reserva.amountCents, reserva.externalReference);
    const result = await processCharge('pay_ok');

    expect(result.outcome).toBe('confirmed');

    const depois = await estado(reserva.reservationId);
    expect(depois.status).toBe('confirmed');
    expect(depois.pay_state).toBe('paid');
    expect(depois.paid_at).not.toBeNull();
    // Derivados por recalcReservationPayment (invariante 4.6).
    expect(depois.amount_paid_cents).toBe(reserva.amountCents);
    expect(depois.payment_state).toBe('settled');
  });

  it('28. o MESMO evento duas vezes nao muda nada na segunda (idempotencia)', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000002',
      chargeId: 'pay_dup',
    });

    fakeCharge.current = paga(reserva.amountCents, reserva.externalReference);

    const primeira = await processCharge('pay_dup');
    expect(primeira.outcome).toBe('confirmed');
    const apos1 = await estado(reserva.reservationId);

    const segunda = await processCharge('pay_dup');
    expect(segunda.outcome).toBe('already_paid');
    const apos2 = await estado(reserva.reservationId);

    // Igualdade do REGISTRO INTEIRO, nao so do status: `paid_at` reescrito seria
    // uma mudanca silenciosa, e e o carimbo que vale como recibo.
    expect(apos2).toEqual(apos1);
  });

  it('29. cobranca ainda nao paga (PAYMENT_OVERDUE) nao mexe em nada', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000003',
      chargeId: 'pay_overdue',
    });

    fakeCharge.current = {
      chargeId: 'pay_overdue',
      state: 'pending', // OVERDUE traduz para pending: vencido e devido
      amountCents: reserva.amountCents,
      externalReference: reserva.externalReference,
      paidAt: null,
    };

    const result = await processCharge('pay_overdue');

    expect(result.outcome).toBe('not_paid_yet');
    const depois = await estado(reserva.reservationId);
    expect(depois.status).toBe('pending_payment');
    expect(depois.pay_state).toBe('pending');
  });

  it('30. a cobranca e localizada por external_reference quando o id nao foi gravado', async () => {
    // Caminho que salva a reconciliacao quando a gravacao do id do provedor
    // falhou DEPOIS de a cobranca ter sido criada la (secao 4.6: o
    // external_reference e deterministico exatamente para isso).
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000004',
      chargeId: 'pay_sem_id',
    });

    await db.execute(sql`
      UPDATE reservation_payments SET asaas_payment_id = NULL
      WHERE reservation_id = ${reserva.reservationId}
    `);

    fakeCharge.current = paga(reserva.amountCents, reserva.externalReference);
    const result = await processCharge('pay_recuperado');

    expect(result.outcome).toBe('confirmed');

    // E o id passa a ficar gravado, para a proxima reconciliar pelo caminho rapido.
    const [row] = (
      await db.execute<{ asaas_payment_id: string }>(sql`
        SELECT asaas_payment_id FROM reservation_payments
        WHERE reservation_id = ${reserva.reservationId}
      `)
    ).rows;
    expect(row.asaas_payment_id).toBe('pay_recuperado');
  });
});

describe('I — Pix tardio (secao 8.3)', () => {
  it('31. hold expirado com a vaga ainda livre: RECONFIRMA', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000005',
      chargeId: 'pay_tardio_ok',
    });

    // O cron expirou o hold antes de o Pix cair.
    await setReservationStatus(reserva.reservationId, 'expired');
    expect((await estado(reserva.reservationId)).status).toBe('expired');

    fakeCharge.current = paga(reserva.amountCents, reserva.externalReference);
    const result = await processCharge('pay_tardio_ok');

    expect(result.outcome).toBe('confirmed');
    const depois = await estado(reserva.reservationId);
    expect(depois.status).toBe('confirmed');
    expect(depois.payment_state).toBe('settled');
  });

  it('32. hold expirado com a vaga TOMADA: mantem expired, registra o pagamento e sinaliza estorno', async () => {
    // O caso que dói: o dinheiro entrou e a vaga nao existe mais.
    const startAt = await primeiroSlot(2);
    const perdedora = await reservaComCobranca({
      startAt,
      resourcesNeeded: 2, // ocupa TODOS os recursos
      phone: '11900000006',
      chargeId: 'pay_tardio_colisao',
    });

    await setReservationStatus(perdedora.reservationId, 'expired');

    // Outro cliente compra o mesmo horario, com os mesmos recursos.
    const vencedora = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt,
        resourcesNeeded: 2,
        phone: '11900000007',
      }),
    );
    expect(vencedora.status).toBe('pending_payment');

    fakeCharge.current = paga(perdedora.amountCents, perdedora.externalReference);
    const result = await processCharge('pay_tardio_colisao');

    expect(result.outcome).toBe('refund_pending');
    expect(result.refundPending).toBe(true);

    const depois = await estado(perdedora.reservationId);
    // A reserva NAO ressuscita...
    expect(depois.status).toBe('expired');
    // ...mas o dinheiro FICA REGISTRADO. Este e o ponto do savepoint: sem ele a
    // violacao da constraint teria desfeito tambem o `paid`, e o sistema
    // esqueceria que recebeu.
    expect(depois.pay_state).toBe('paid');
    expect(depois.paid_at).not.toBeNull();

    // E a vencedora seguiu intacta — a tentativa de reconfirmar nao a tocou.
    expect((await estado(vencedora.reservationId)).status).toBe('pending_payment');

    // O SINAL para o dono e derivavel, sem coluna nova: expirada + paga.
    const [pendencia] = (
      await db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total
        FROM reservations r JOIN reservation_payments rp ON rp.reservation_id = r.id
        WHERE r.status = 'expired' AND rp.state = 'paid'
      `)
    ).rows;
    expect(pendencia.total).toBe(1);
  });
});

describe('I — reconciliacao (secao 8-B)', () => {
  it('33. o job confirma sozinho o que o webhook nao entregou', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000008',
      chargeId: 'pay_reconciliado',
    });

    // A carencia de 5 min existe para o job nao competir com o webhook no
    // caminho feliz. Envelhecemos a linha em vez de esperar — mesma tecnica que
    // a suite ja usa para lead time (manipular dado, nunca o relogio do Node).
    await db.execute(sql`
      UPDATE reservation_payments SET created_at = now() - interval '10 minutes'
      WHERE reservation_id = ${reserva.reservationId}
    `);

    fakeCharge.current = paga(reserva.amountCents, reserva.externalReference);

    const resultado = await reconcilePayments();

    expect(resultado.checked).toBe(1);
    expect(resultado.reconciled).toBe(1); // divergencia: pago la, pendente aqui
    expect((await estado(reserva.reservationId)).status).toBe('confirmed');
  });

  it('34. cobranca recente nao entra na varredura (carencia de 5 min)', async () => {
    const startAt = await primeiroSlot(1);
    await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000009',
      chargeId: 'pay_recente',
    });

    // created_at = agora: o webhook ainda tem chance de chegar.
    const resultado = await reconcilePayments();
    expect(resultado.checked).toBe(0);
  });

  it('35. reserva cancelada fica fora da varredura', async () => {
    const startAt = await primeiroSlot(1);
    const reserva = await reservaComCobranca({
      startAt,
      resourcesNeeded: 1,
      phone: '11900000010',
      chargeId: 'pay_cancelado',
    });

    await setReservationStatus(reserva.reservationId, 'cancelled');
    await db.execute(sql`
      UPDATE reservation_payments SET created_at = now() - interval '10 minutes'
      WHERE reservation_id = ${reserva.reservationId}
    `);

    // Insistir numa cobranca removida no provedor geraria consulta inutil a
    // cada 10 minutos, para sempre.
    const resultado = await reconcilePayments();
    expect(resultado.checked).toBe(0);
  });
});
