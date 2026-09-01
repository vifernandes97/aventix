// GRUPO K — QR sob demanda: GET /api/reservations/{id}/payment (secoes 7.1 e 7.2).
//
// Arquivo SEPARADO do grupo J por causa do `vi.mock`: J exercita a rota de
// status, que nao fala com o provedor, e mockar o modulo la dentro esconderia
// justamente a propriedade que aquele grupo afirma.
//
// >>> O QUE E MOCKADO, E SO ISSO <<<
// `asaasProvider`, a BORDA DE REDE — mesma linha de corte de tests/i-webhook.
// O banco e real, a rota e a de producao, e as decisoes que este arquivo testa
// (404 x 409 x 502, no-store, o que sai no corpo) sao todas nossas, nao do
// provedor. Bater no sandbox do Asaas a cada `npm test` traria falha
// intermitente por rede e cobranca de verdade na conta do tenant.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { PaymentProviderNetworkError, type PixQrCode } from '@/lib/payments/provider';
import { createReservation, setReservationStatus } from '@/lib/reservations';

import {
  EXP,
  VALID_CPF,
  assertCatalogSeeded,
  insertFixtureTenant,
  nextSaturday,
  removeFixtureTenant,
  reservationInput,
  wipeMovement,
} from './helpers/db';

/** QR devolvido pelo provedor falso, ou erro a lancar. */
const fakeQr = vi.hoisted(() => ({
  value: null as PixQrCode | null,
  throws: null as Error | null,
  /** ids pedidos ao provedor, na ordem — prova que a rota nao o chama a toa. */
  calls: [] as string[],
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    getPixQrCode: async (chargeId: string): Promise<PixQrCode> => {
      fakeQr.calls.push(chargeId);
      if (fakeQr.throws) throw fakeQr.throws;
      if (!fakeQr.value) throw new Error('teste nao preparou o QR');
      return fakeQr.value;
    },
    createPixCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    getCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    cancelCharge: async () => {},
  },
}));

// Importado DEPOIS do vi.mock, para a rota pegar o provedor falso.
const { GET: getPayment } = await import('@/app/api/reservations/[id]/payment/route');

const SAT = nextSaturday();
const OTHER_TENANT_ID = 78;
const CHARGE_ID = 'pay_000000000001';

const QR_OK: PixQrCode = {
  qrCodeBase64: 'iVBORw0KGgoAAAANSUhEUg==',
  copyPaste: '00020126580014BR.GOV.BCB.PIX0136teste-copia-e-cola5204000053039865802BR',
  expiresAt: '2026-08-24T02:59:59.000Z',
};

async function callPayment(id: string) {
  const response = await getPayment(new Request(`http://localhost/api/reservations/${id}/payment`), {
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

/**
 * Grava o id da cobranca no provedor. createReservation NAO faz isso: a cobranca
 * nasce fora da transacao (secao 5.2 passo 5), na rota de criacao.
 */
async function comCobranca(reservationId: string): Promise<string> {
  await db.execute(sql`
    UPDATE reservation_payments SET asaas_payment_id = ${CHARGE_ID}
    WHERE reservation_id = ${reservationId}::uuid AND kind IN ('full', 'deposit')
  `);
  return reservationId;
}

beforeAll(async () => {
  await assertCatalogSeeded();
  await insertFixtureTenant(OTHER_TENANT_ID, 'k');
});

afterAll(async () => {
  await wipeMovement();
  await removeFixtureTenant(OTHER_TENANT_ID);
});

beforeEach(async () => {
  await wipeMovement();
  fakeQr.value = QR_OK;
  fakeQr.throws = null;
  fakeQr.calls = [];
});

describe('K — QR sob demanda', () => {
  it('53. reserva pendente com cobranca devolve o QR ATUAL do provedor', async () => {
    const reservationId = await comCobranca(await novaReserva());

    const { status, body } = await callPayment(reservationId);

    expect(status).toBe(200);
    expect(body.qrCodeBase64).toBe(QR_OK.qrCodeBase64);
    expect(body.copyPaste).toBe(QR_OK.copyPaste);
    expect(body.expiresAt).toBe(QR_OK.expiresAt);
    // O valor sai do BANCO (a cobranca devida), nao do provedor: o preco e
    // decidido no servidor na criacao e congelado (secao 4.6).
    expect(body.dueNowCents).toBeGreaterThan(0);

    // Buscou no provedor, na hora, com o id certo. Nada de cache nem de coluna.
    expect(fakeQr.calls).toEqual([CHARGE_ID]);
  });

  it('54. reserva que nao esta mais aguardando pagamento responde 409', async () => {
    // A regra vale para os TRES estados nao-pendentes: gerar QR para reserva
    // confirmada, expirada ou cancelada nao faz sentido nenhum.
    for (const estado of ['confirmed', 'expired', 'cancelled'] as const) {
      await wipeMovement();
      fakeQr.calls = [];

      const reservationId = await comCobranca(await novaReserva());
      await setReservationStatus(reservationId, estado);

      const { status, body } = await callPayment(reservationId);

      expect(status, `estado ${estado}`).toBe(409);
      expect(body.error).toBeDefined();
      // E, principalmente, NAO foi ao provedor: 409 e decidido no banco.
      expect(fakeQr.calls, `estado ${estado} nao pode chamar o provedor`).toEqual([]);
    }
  });

  it('55. cobranca devida ja paga responde 409, sem chamar o provedor', async () => {
    const reservationId = await comCobranca(await novaReserva());
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid'::payment_state, paid_at = now()
      WHERE reservation_id = ${reservationId}::uuid AND kind IN ('full', 'deposit')
    `);

    const { status } = await callPayment(reservationId);

    expect(status).toBe(409);
    expect(fakeQr.calls).toEqual([]);
  });

  it('56. reserva pendente SEM cobranca no provedor responde 409 com codigo proprio', async () => {
    // Acontece de verdade: a criacao da cobranca falha depois da transacao
    // (secao 5.2 passo 5, borda 9) e a reserva fica pendente sem QR possivel. A
    // tela precisa DISTINGUIR isso de "deu erro, tente de novo" para mandar o
    // cliente falar com o tenant em vez de insistir.
    const reservationId = await novaReserva(); // sem comCobranca()

    const { status, body } = await callPayment(reservationId);

    expect(status).toBe(409);
    expect(body.code).toBe('sem_cobranca');
    expect(fakeQr.calls).toEqual([]);
  });

  it('57. falha do provedor vira 502, sem vazar detalhe da credencial', async () => {
    const reservationId = await comCobranca(await novaReserva());
    // A mensagem carrega o tipo de coisa que os erros do provedor citam
    // (comprimento e prefixo da chave). Nada disso pode atravessar a rota.
    fakeQr.throws = new PaymentProviderNetworkError(
      'timeout ao falar com o provedor (chave $aact_ com 164 caracteres)',
    );

    const { status, text } = await callPayment(reservationId);

    expect(status).toBe(502);
    expect(text).not.toContain('$aact_');
    expect(text).not.toContain('164');
    expect(text).not.toContain('timeout');
  });

  it('58. inexistente, uuid malformado e outro tenant respondem 404', async () => {
    expect((await callPayment('11111111-2222-4333-8444-555555555555')).status).toBe(404);
    expect((await callPayment('nao-e-uuid')).status).toBe(404);

    const reservationId = await comCobranca(await novaReserva());
    await db.execute(sql`
      UPDATE reservations SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${reservationId}::uuid
    `);
    expect((await callPayment(reservationId)).status).toBe(404);

    expect(fakeQr.calls).toEqual([]);
  });

  it('59. o payload nao carrega dado pessoal nem o id da cobranca no provedor', async () => {
    const reservationId = await comCobranca(await novaReserva());

    const { text, body } = await callPayment(reservationId);

    for (const [rotulo, valor] of [
      ['CPF', VALID_CPF],
      ['telefone do cliente', '19999998888'],
      ['nome do cliente', 'Cliente Teste'],
      ['documento do condutor', '12345678900'],
      ['telefone do contato de emergencia', '19988887777'],
      // O id da cobranca e referencia utilizavel contra a conta do tenant no
      // provedor. Quem tem o link da reserva nao precisa dele, entao nao sai.
      ['id da cobranca no provedor', CHARGE_ID],
    ] as [string, string][]) {
      expect(text, `${rotulo} vazou no payload publico`).not.toContain(valor);
    }

    // Lista EXAUSTIVA de proposito: campo novo aqui quebra o teste, e e essa a
    // funcao dele. `method` entrou na Fase E — a resposta virou uniao (Pix
    // devolve QR, cartao devolve a fatura) e a tela precisa do discriminante.
    // Nao e dado pessoal e nao e referencia contra a conta do tenant.
    expect(Object.keys(body).sort()).toEqual(
      ['copyPaste', 'dueNowCents', 'expiresAt', 'method', 'qrCodeBase64'].sort(),
    );
  });

  it('60. toda resposta traz Cache-Control: no-store — QR cacheado e QR vencido', async () => {
    const comQr = await comCobranca(await novaReserva());
    const semCobranca = await novaReserva();

    for (const id of [comQr, semCobranca, '11111111-2222-4333-8444-555555555555', 'nao-e-uuid']) {
      const { cacheControl } = await callPayment(id);
      expect(cacheControl, `id ${id}`).toContain('no-store');
    }
  });
});
