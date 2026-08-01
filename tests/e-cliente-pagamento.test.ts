// GRUPO E — cliente e pagamento (CLAUDE.md secoes 4.5, 4.6 e 5.2).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import {
  createReservation,
  findOrCreateCustomer,
  recalcReservationPayment,
} from '@/lib/reservations';

import {
  DEPOSIT_FIXED_FIXTURE,
  DEPOSIT_PCT_FIXTURE,
  EXP,
  EXP_DEPOSIT_FIXED,
  EXP_DEPOSIT_PCT,
  assertCatalogSeeded,
  ensureDepositExperiences,
  nextSaturday,
  removeDepositExperiences,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

// O teste faz a PROPRIA conta a partir dos parametros do fixture. Nao e
// circular: o fixture da o insumo (preco e percentual), a aritmetica esperada e
// feita aqui, e o resultado se compara com o que createReservation calculou por
// outro caminho. Comparar com o retorno do app seria a versao circular; cravar
// 34900/17450 seria a versao que envelhece calada quando o fixture mudar.
// Regra da secao 4.6: deposit = round(total x deposit_percent / 100).
const TOTAL_PCT = DEPOSIT_PCT_FIXTURE.priceCents;
const SINAL_PCT = Math.round((TOTAL_PCT * DEPOSIT_PCT_FIXTURE.depositPercent) / 100);
const SALDO_PCT = TOTAL_PCT - SINAL_PCT;

// Aqui deposit_fixed_cents e MAIOR que o preco, entao o teto da secao 4.6 faz o
// sinal virar o total e nenhuma linha de saldo existir.
const TOTAL_FIXED = DEPOSIT_FIXED_FIXTURE.priceCents;

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

async function pagamentos(reservationId: string) {
  const { rows } = await db.execute<{ kind: string; amount_cents: number; due_date: string }>(sql`
    SELECT kind::text, amount_cents::int, due_date::text
    FROM reservation_payments WHERE reservation_id = ${reservationId} ORDER BY kind
  `);
  return rows;
}

async function setPaymentState(reservationId: string, kind: string, state: string) {
  await db.execute(sql`
    UPDATE reservation_payments
    SET state = ${state}::payment_state,
        paid_at = CASE WHEN ${state} = 'paid' THEN now() ELSE NULL END
    WHERE reservation_id = ${reservationId} AND kind = ${kind}::payment_kind
  `);
}

beforeAll(async () => {
  await assertCatalogSeeded();
  await ensureDepositExperiences();
});

// Remove SO as experiencias que este arquivo criou; o catalogo do seed fica.
afterAll(removeDepositExperiences);

beforeEach(wipeMovement);

describe('E — cliente', () => {
  it('16. find-or-create e idempotente por telefone normalizado', async () => {
    const primeiro = await findOrCreateCustomer({
      name: 'Joao da Silva',
      phone: '(19) 99999-8888',
      cpf: '12345678900',
    });
    expect(primeiro.created).toBe(true);

    // Mesmo numero, tres grafias diferentes.
    for (const grafia of ['19999998888', '+55 19 99999-8888', '19 99999-8888']) {
      const repetido = await findOrCreateCustomer({ name: 'Joao da Silva', phone: grafia });
      expect(repetido.created, `grafia ${grafia}`).toBe(false);
      expect(repetido.customer.id, `grafia ${grafia}`).toBe(primeiro.customer.id);
    }

    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM customers`);
    expect(rows[0].n, 'nenhum cliente duplicado').toBe(1);

    // Dado ja gravado nao e apagado por uma reserva que nao o informou.
    const semCpf = await findOrCreateCustomer({ name: 'Joao da Silva', phone: '19999998888' });
    expect(semCpf.customer.cpf).toBe('12345678900');
  });
});

describe('E — pagamento', () => {
  it('17a. modo deposit cria sinal + saldo somando o total exato', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP_DEPOSIT_PCT,
        startAt: await primeiroSlot(EXP_DEPOSIT_PCT),
        resourcesNeeded: 1,
      }),
    );

    expect(criada.paymentMode).toBe('deposit');
    expect(criada.totalCents).toBe(TOTAL_PCT);
    expect(criada.dueNowCents).toBe(SINAL_PCT);
    expect(criada.balanceCents).toBe(SALDO_PCT);

    const linhas = await pagamentos(criada.reservationId);
    expect(linhas.map((l) => l.kind)).toEqual(['balance', 'deposit']);

    const soma = linhas.reduce((acc, l) => acc + Number(l.amount_cents), 0);
    expect(soma, 'sinal + saldo = total, sem centavo perdido').toBe(criada.totalCents);

    // Saldo vence no dia do passeio; sinal, hoje (secao 5.2).
    const saldo = linhas.find((l) => l.kind === 'balance')!;
    expect(saldo.due_date).toBe(SAT);
  });

  it('17b. deposit_fixed maior que o total vira uma cobranca so, sem saldo', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP_DEPOSIT_FIXED,
        startAt: await primeiroSlot(EXP_DEPOSIT_FIXED),
        resourcesNeeded: 1,
        phone: '11912340000',
      }),
    );

    // Sem o teto, o saldo seria negativo e o CHECK (amount_cents > 0) derrubaria
    // a venda por erro de configuracao da experiencia.
    expect(criada.totalCents).toBe(TOTAL_FIXED);
    expect(criada.dueNowCents).toBe(TOTAL_FIXED);
    expect(criada.balanceCents).toBe(0);

    const linhas = await pagamentos(criada.reservationId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].kind).toBe('deposit');
    expect(Number(linhas[0].amount_cents)).toBe(TOTAL_FIXED);
  });

  it('18. recalcReservationPayment soma so o que esta pago e classifica certo', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP_DEPOSIT_PCT,
        startAt: await primeiroSlot(EXP_DEPOSIT_PCT),
        resourcesNeeded: 1,
        phone: '11943210000',
      }),
    );
    const id = criada.reservationId;

    // Nada pago ainda.
    let r = await recalcReservationPayment(id);
    expect(r.amountPaidCents).toBe(0);
    expect(r.paymentState).toBe('pending');
    expect(r.balanceCents).toBe(TOTAL_PCT);

    // Sinal pago -> parcial.
    await setPaymentState(id, 'deposit', 'paid');
    r = await recalcReservationPayment(id);
    expect(r.amountPaidCents).toBe(SINAL_PCT);
    expect(r.paymentState).toBe('partial');
    expect(r.balanceCents).toBe(SALDO_PCT);

    // Saldo pago -> quitado. previousPaymentState = 'partial' e o que autoriza o
    // e-mail de "saldo quitado" a sair uma vez so (secao 9).
    await setPaymentState(id, 'balance', 'paid');
    r = await recalcReservationPayment(id);
    expect(r.amountPaidCents).toBe(TOTAL_PCT);
    expect(r.paymentState).toBe('settled');
    expect(r.previousPaymentState).toBe('partial');
    expect(r.balanceCents).toBe(0);

    // Idempotencia: sem mudanca nos pagamentos, o resultado nao se move, e
    // previous passa a igualar o atual (nada a notificar).
    const denovo = await recalcReservationPayment(id);
    expect(denovo.amountPaidCents).toBe(TOTAL_PCT);
    expect(denovo.paymentState).toBe('settled');
    expect(denovo.previousPaymentState).toBe('settled');

    // 'cancelled' sai da soma.
    await setPaymentState(id, 'balance', 'cancelled');
    r = await recalcReservationPayment(id);
    expect(r.amountPaidCents).toBe(SINAL_PCT);
    expect(r.paymentState).toBe('partial');

    // 'refunded' tambem sai.
    await setPaymentState(id, 'deposit', 'refunded');
    r = await recalcReservationPayment(id);
    expect(r.amountPaidCents).toBe(0);
    expect(r.paymentState).toBe('pending');

    // As linhas continuam la; elas so nao somam.
    expect(await pagamentos(id)).toHaveLength(2);
  });

  it('18b. recalc NAO altera o status da reserva', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta),
        resourcesNeeded: 1,
        phone: '11987650000',
      }),
    );

    await setPaymentState(criada.reservationId, 'full', 'paid');
    await recalcReservationPayment(criada.reservationId);

    // Confirmar reserva e responsabilidade exclusiva de setReservationStatus
    // (secao 4.6). O recalculo mexe so no agregado financeiro.
    const { rows } = await db.execute<{ status: string }>(
      sql`SELECT status::text FROM reservations WHERE id = ${criada.reservationId}`,
    );
    expect(rows[0].status).toBe('pending_payment');
  });
});
