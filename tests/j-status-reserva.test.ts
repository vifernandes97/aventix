// GRUPO J — estado publico da reserva (CLAUDE.md secoes 7.1 e 14).
//
// Cobre GET /api/reservations/{id}/status, que e a rota do polling da tela
// /reserva/[id]. Os testes chamam o HANDLER DA ROTA, nao so a funcao de lib:
// tres das garantias exigidas sao da BORDA HTTP e desapareceriam num teste de
// lib — o 404 em vez de 500 no uuid malformado, o `Cache-Control: no-store` e a
// forma exata do payload que chega ao navegador.
//
// >>> O TESTE DE PRIVACIDADE E O MAIS IMPORTANTE DO ARQUIVO <<<
// A rota e PUBLICA e o uuid da URL e a unica credencial — ele circula por
// WhatsApp, print e historico de navegador. O teste procura os valores REAIS
// gravados na reserva (CPF, telefone, nome, documento, contato de emergencia)
// dentro do JSON serializado, em vez de conferir uma lista de chaves esperadas:
// chave nova com dado pessoal passaria batida numa checagem de lista, e nao
// passa nesta.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { createReservation, recalcReservationPayment, setReservationStatus } from '@/lib/reservations';

import { GET as getStatus } from '@/app/api/reservations/[id]/status/route';

import {
  EXP,
  VALID_CPF,
  assertCatalogSeeded,
  nextSaturday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

/** Tenant inventado por este arquivo para exercitar o isolamento. */
const OTHER_TENANT_ID = 77;

/** Chama o handler como o Next chama: params e uma Promise. */
async function callStatus(id: string) {
  const response = await getStatus(new Request(`http://localhost/api/reservations/${id}/status`), {
    params: Promise.resolve({ id }),
  });
  const text = await response.text();
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    text,
    body: JSON.parse(text) as Record<string, unknown>,
  };
}

async function novaReserva(): Promise<string> {
  const { slots } = await getAvailability({
    experienceId: EXP.curta,
    date: SAT,
    resourcesNeeded: 1,
  });
  const { reservationId } = await createReservation(
    reservationInput({ experienceId: EXP.curta, startAt: slots[0]!.startAt, resourcesNeeded: 1 }),
  );
  return reservationId;
}

/** Marca a cobranca DEVIDA como paga e confirma, como o webhook faria. */
async function pagarEConfirmar(reservationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE reservation_payments
    SET state = 'paid'::payment_state, paid_at = now()
    WHERE reservation_id = ${reservationId} AND kind IN ('full', 'deposit')
  `);
  await recalcReservationPayment(reservationId);
  await setReservationStatus(reservationId, 'confirmed');
}

beforeAll(async () => {
  await assertCatalogSeeded();
  await db.execute(sql`
    INSERT INTO tenants (id, name) VALUES (${OTHER_TENANT_ID}, 'Tenant Vizinho')
    ON CONFLICT (id) DO NOTHING
  `);
});

// O tenant extra nao e catalogo semeado: sai junto com o movimento no fim.
afterAll(async () => {
  await wipeMovement();
  await db.execute(sql`DELETE FROM tenants WHERE id = ${OTHER_TENANT_ID}`);
});

beforeEach(wipeMovement);

describe('J — status publico da reserva', () => {
  it('45. reserva recem-criada responde pending_payment com hold e relogio do servidor', async () => {
    const reservationId = await novaReserva();

    const { status, body } = await callStatus(reservationId);

    expect(status).toBe(200);
    expect(body.status).toBe('pending_payment');
    expect(body.paymentState).toBe('pending');
    expect(body.amountPaidCents).toBe(0);

    // `serverNow` e o que a tela usa no lugar do relogio do celular. Precisa vir
    // sempre, e em ISO 8601 — o texto cru do Postgres (secao 3) daria NaN em
    // motor que nao seja o V8, e o sintoma so apareceria no aparelho do cliente.
    expect(typeof body.serverNow).toBe('string');
    expect(new Date(body.serverNow as string).toISOString()).toBe(body.serverNow);
    expect(new Date(body.startAt as string).toISOString()).toBe(body.startAt);

    // Hold de 15 min a partir de agora: o teste so exige que esteja no FUTURO
    // em relacao ao relogio do banco, sem cravar o valor.
    expect(typeof body.holdExpiresAt).toBe('string');
    expect(new Date(body.holdExpiresAt as string).getTime()).toBeGreaterThan(
      new Date(body.serverNow as string).getTime(),
    );

    // Dados do passeio que a tela mostra nos cinco estados.
    expect(typeof body.experienceName).toBe('string');
    expect(body.durationMinutes).toBeGreaterThan(0);
  });

  it('46. depois de o pagamento devido ser pago, responde confirmed e settled', async () => {
    const reservationId = await novaReserva();
    await pagarEConfirmar(reservationId);

    const { status, body } = await callStatus(reservationId);

    expect(status).toBe(200);
    expect(body.status).toBe('confirmed');
    expect(body.paymentState).toBe('paid');
    expect(body.amountPaidCents).toBeGreaterThan(0);
    // Modo `full`: pagou tudo, nao sobra saldo para o dia.
    expect(body.balanceCents).toBe(0);
  });

  it('47. id inexistente responde 404', async () => {
    const { status, body } = await callStatus('11111111-2222-4333-8444-555555555555');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('48. uuid malformado responde 404, nunca 500', async () => {
    // Sem a guarda de formato, `WHERE id = 'nao-e-uuid'::uuid` ABORTA no
    // Postgres com 22P02 e a rota viraria 500 — e um id digitado errado nao e
    // erro de servidor.
    for (const id of ['nao-e-uuid', '123', 'undefined', "'; DROP TABLE reservations; --"]) {
      const { status } = await callStatus(id);
      expect(status, `id ${JSON.stringify(id)} deveria dar 404`).toBe(404);
    }

    // A tabela continua de pe depois do id com aparencia de injecao.
    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM reservations`);
    expect(rows[0].n).toBe(0);
  });

  it('49. reserva de OUTRO tenant responde 404, nao 403', async () => {
    const reservationId = await novaReserva();

    // 403 aqui confirmaria a existencia do id para quem esta sondando; o
    // indistinguivel e a decisao (secao 7.2).
    await db.execute(sql`
      UPDATE reservations SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${reservationId}::uuid
    `);

    const { status } = await callStatus(reservationId);
    expect(status).toBe(404);
  });

  it('50. o payload NAO carrega nenhum dado pessoal', async () => {
    const reservationId = await novaReserva();
    const { text, body } = await callStatus(reservationId);

    // Os valores exatos que a reserva gravou, vindos do mesmo fixture que a
    // criou. Procurados no JSON CRU: assim um campo novo que vaze qualquer um
    // deles quebra este teste, sem ninguem precisar lembrar de atualizar lista.
    const proibidos: [string, string][] = [
      ['CPF', VALID_CPF],
      ['telefone do cliente', '19999998888'],
      ['nome do cliente', 'Cliente Teste'],
      ['nome do condutor', 'Condutor 1'],
      ['documento do condutor', '12345678900'],
      ['nome do contato de emergencia', 'Contato Emergência'],
      ['telefone do contato de emergencia', '19988887777'],
    ];

    for (const [rotulo, valor] of proibidos) {
      expect(text, `${rotulo} vazou no payload publico`).not.toContain(valor);
    }

    // Nenhuma CHAVE de dado pessoal, mesmo vazia ou nula: a presenca da chave ja
    // sinaliza que alguem passou a busca-la, e o valor viria na proxima edicao.
    for (const chave of ['cpf', 'phone', 'email', 'customer', 'participants', 'emergencyContact', 'documentNumber']) {
      expect(Object.keys(body), `chave ${chave} nao pertence a esta rota`).not.toContain(chave);
    }
  });

  it('51. toda resposta traz Cache-Control: no-store', async () => {
    const reservationId = await novaReserva();

    // Inclusive o 404: resposta cacheada aqui condena o polling a repetir para
    // sempre o estado velho, que e exatamente o defeito que a tela conserta.
    for (const id of [reservationId, '11111111-2222-4333-8444-555555555555', 'nao-e-uuid']) {
      const { cacheControl } = await callStatus(id);
      expect(cacheControl, `id ${id}`).toContain('no-store');
    }
  });
});
