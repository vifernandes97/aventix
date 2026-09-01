// GRUPO V — cobranca do saldo sob demanda (CLAUDE.md secao 17, Fase C).
//
// ============================================================================
// >>> A PROPRIEDADE QUE ESTE GRUPO EXISTE PARA PROVAR E UMA SO: <<<
// >>> APERTAR O BOTAO DUAS VEZES NAO PODE GERAR DUAS COBRANCAS.  <<<
//
// Nao e uma preocupacao teorica de concorrencia. O dono aperta "Cobrar saldo"
// no celular, em campo, com o cliente na frente; o botao demora um segundo; ele
// aperta de novo. Duas cobrancas significam cliente podendo pagar duas vezes, e
// estorno de Pix e MANUAL (secao 8-C) com taxa que nao volta.
//
// Por isso os testes de V1 nao verificam "respondeu 200": eles contam quantas
// vezes o PROVEDOR foi mandado criar. E o unico numero que importa.
// ============================================================================
//
// >>> O QUE E MOCKADO, E SO ISSO <<<
// `asaasProvider`, a BORDA DE REDE — mesma linha de corte dos grupos I e K. O
// banco e real (a trava de serializacao e um advisory lock de verdade, num
// Postgres de verdade), a rota e a de producao, e todas as decisoes testadas
// aqui sao nossas.

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import {
  PaymentProviderApiError,
  PaymentProviderNetworkError,
  type ChargeSnapshot,
  type PixCharge,
  type PixQrCode,
} from '@/lib/payments/provider';
import { createReservation, recalcReservationPayment, setReservationStatus } from '@/lib/reservations';

import {
  EXP,
  assertCatalogSeeded,
  insertFixtureTenant,
  makeBarrier,
  nextSaturday,
  removeFixtureTenant,
  reservationInput,
  wipeMovement,
} from './helpers/db';

// -- provedor falso ----------------------------------------------------------

const fake = vi.hoisted(() => ({
  /** externalReference de cada createPixCharge — o contador que importa. */
  createCalls: [] as string[],
  /** externalReference de cada consulta pela referencia (camada 3). */
  findCalls: [] as string[],
  qrCalls: [] as string[],
  /** resposta da camada 3: cobranca ja existente no provedor, ou null. */
  findResult: null as ChargeSnapshot | null,
  findThrows: null as Error | null,
  createThrows: null as Error | null,
  /** gancho para segurar A dentro da trava enquanto B tenta entrar (V1.2). */
  onCreateEnter: null as null | (() => Promise<void>),
  /** o mesmo, no caminho de RELEITURA do QR (V1.2b). */
  onQrEnter: null as null | (() => Promise<void>),
  qrThrows: null as Error | null,
  nextChargeId: 'pay_balance_0001',
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    createPixCharge: async (params: { externalReference: string; dueDate: string }): Promise<PixCharge> => {
      if (fake.onCreateEnter) await fake.onCreateEnter();
      fake.createCalls.push(params.externalReference);
      lastDueDate.value = params.dueDate;
      if (fake.createThrows) throw fake.createThrows;
      return {
        chargeId: fake.nextChargeId,
        providerCustomerId: 'cus_000001',
        qrCodeBase64: 'iVBORw0KGgoAAAANSUhEUg==',
        copyPaste: '00020126580014BR.GOV.BCB.PIX-saldo',
        expiresAt: '2026-09-01T02:59:59.000Z',
        invoiceUrl: 'https://sandbox.asaas.com/i/balance0001',
      };
    },
    findChargeByExternalReference: async (ref: string): Promise<ChargeSnapshot | null> => {
      fake.findCalls.push(ref);
      if (fake.findThrows) throw fake.findThrows;
      return fake.findResult;
    },
    getPixQrCode: async (chargeId: string): Promise<PixQrCode> => {
      if (fake.onQrEnter) await fake.onQrEnter();
      fake.qrCalls.push(chargeId);
      if (fake.qrThrows) throw fake.qrThrows;
      return {
        qrCodeBase64: 'iVBORw0KGgoAAAANSUhEUg==',
        copyPaste: '00020126580014BR.GOV.BCB.PIX-saldo-relido',
        expiresAt: '2026-09-01T02:59:59.000Z',
      };
    },
    getCharge: async () => {
      throw new Error('nao usado neste grupo');
    },
    cancelCharge: async () => {},
  },
}));

/** dueDate que chegou ao provedor na ultima criacao (V3). */
const lastDueDate = { value: '' };

// Importados DEPOIS do vi.mock, para pegarem o provedor falso.
const {
  BalanceChargeInProgressError,
  BalanceNotChargeableError,
  BalanceQrUnavailableError,
  BalanceReservationNotFoundError,
  chargeReservationBalance,
} = await import('@/lib/payments/balance-charge');
const { POST: postCharge } = await import(
  '@/app/api/admin/reservations/[id]/balance/charge/route'
);
const { GET: getBalance } = await import('@/app/api/admin/reservations/[id]/balance/route');
const { reconcilePayments } = await import('@/lib/jobs/reconcile-payments');

const SAT = nextSaturday();
const OTHER_TENANT_ID = 79;

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

/** Liga o sinal na experiencia so durante `fn`. Mesmo helper do grupo U. */
async function comSinal<T>(experienceId: number, fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`
    UPDATE experiences SET payment_mode = 'deposit', deposit_percent = 50, deposit_fixed_cents = NULL
    WHERE id = ${experienceId}
  `);
  try {
    return await fn();
  } finally {
    await db.execute(sql`
      UPDATE experiences SET payment_mode = 'full', deposit_percent = NULL, deposit_fixed_cents = NULL
      WHERE id = ${experienceId}
    `);
  }
}

/**
 * Reserva no estado em que o saldo E cobravel: sinal PAGO, reserva `confirmed`
 * com `payment_state='partial'` — a combinacao da secao 4-B.3.
 */
async function reservaComSaldo(phone: string): Promise<{ id: string; balanceCents: number }> {
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

    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid', paid_at = now()
      WHERE reservation_id = ${criada.reservationId} AND kind = 'deposit'
    `);
    await recalcReservationPayment(criada.reservationId);
    await setReservationStatus(criada.reservationId, 'confirmed');

    return { id: criada.reservationId, balanceCents: criada.balanceCents };
  });
}

async function balanceRow(reservationId: string) {
  const { rows } = await db.execute<{
    asaas_payment_id: string | null;
    due_date: string;
    state: string;
  }>(sql`
    SELECT asaas_payment_id, due_date::text AS due_date, state::text AS state
    FROM reservation_payments WHERE reservation_id = ${reservationId} AND kind = 'balance'
  `);
  return rows[0];
}

async function callPost(id: string) {
  const response = await postCharge(
    new Request(`http://localhost/api/admin/reservations/${id}/balance/charge`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
}

async function callGet(id: string) {
  const response = await getBalance(
    new Request(`http://localhost/api/admin/reservations/${id}/balance`),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(assertCatalogSeeded);
beforeEach(async () => {
  await wipeMovement();
  fake.createCalls = [];
  fake.findCalls = [];
  fake.qrCalls = [];
  fake.findResult = null;
  fake.findThrows = null;
  fake.createThrows = null;
  fake.onCreateEnter = null;
  fake.onQrEnter = null;
  fake.qrThrows = null;
  fake.nextChargeId = 'pay_balance_0001';
  lastDueDate.value = '';
});
afterEach(async () => {
  await wipeMovement();
});
afterAll(async () => {
  await wipeMovement();
});

// ============================================================================
describe('V1 idempotencia — a propriedade que define a fase', () => {
  it('V1.1 duas chamadas EM SEQUENCIA criam UMA cobranca; a segunda reaproveita', async () => {
    const reserva = await reservaComSaldo('11955550001');

    const primeira = await chargeReservationBalance(reserva.id);
    const segunda = await chargeReservationBalance(reserva.id);

    // O UNICO numero que importa.
    expect(fake.createCalls).toHaveLength(1);

    expect(primeira.origin).toBe('created');
    expect(segunda.origin).toBe('reused');
    // Mesma cobranca, e o valor e o saldo real da reserva.
    expect(segunda.amountCents).toBe(reserva.balanceCents);
    expect((await balanceRow(reserva.id))!.asaas_payment_id).toBe('pay_balance_0001');

    // A segunda nem chegou a perguntar ao provedor se existia: o caminho rapido
    // local (camada 1) resolveu antes.
    expect(fake.findCalls).toHaveLength(1);
  });

  it('V1.2 O DUPLO TOQUE: duas chamadas SIMULTANEAS criam UMA cobranca', async () => {
    const reserva = await reservaComSaldo('11955550002');

    // Segura a chamada A DENTRO da trava, para B tentar entrar enquanto ela
    // esta la. Sem isso as duas se sucederiam e o teste viraria o V1.1.
    let aEstaDentro!: () => void;
    const aChegou = new Promise<void>((resolve) => {
      aEstaDentro = resolve;
    });
    const soltarA = makeBarrier(2);

    fake.onCreateEnter = async () => {
      aEstaDentro();
      await soltarA();
    };

    const chamadaA = chargeReservationBalance(reserva.id);
    await aChegou; // A esta dentro da transacao, segurando o advisory lock.

    // B chega agora. Nao pode criar nada.
    const erroB = await chargeReservationBalance(reserva.id).catch((e: unknown) => e);

    await soltarA(); // libera A
    const resultadoA = await chamadaA;

    // >>> A AFIRMACAO CENTRAL DO GRUPO <<<
    expect(fake.createCalls).toHaveLength(1);

    expect(resultadoA.origin).toBe('created');
    expect(erroB).toBeInstanceOf(BalanceChargeInProgressError);
    // E o banco ficou com UMA cobranca, a de A.
    expect((await balanceRow(reserva.id))!.asaas_payment_id).toBe('pay_balance_0001');
  });

  it('V1.2b duplo toque com a cobranca JA CRIADA tambem e serializado', async () => {
    // MEDIDO em 31/08 contra o sandbox: sem trava neste caminho, os dois toques
    // disparam duas leituras concorrentes do mesmo QR e o Asaas responde 400
    // numa delas — que a rota traduzia em "o provedor recusou a cobranca".
    // Nada era duplicado; a mensagem e que era falsa, e chegava ao dono em
    // campo. A invariante agora e: UMA operacao de saldo em voo por reserva.
    const reserva = await reservaComSaldo('11955550006');
    await chargeReservationBalance(reserva.id);
    expect(fake.createCalls).toHaveLength(1);

    let aEstaDentro!: () => void;
    const aChegou = new Promise<void>((resolve) => {
      aEstaDentro = resolve;
    });
    const soltarA = makeBarrier(2);

    // Segura a releitura do QR de A dentro da trava.
    fake.onQrEnter = async () => {
      fake.onQrEnter = null; // so a primeira segura
      aEstaDentro();
      await soltarA();
    };

    const chamadaA = chargeReservationBalance(reserva.id);
    await aChegou;

    const erroB = await chargeReservationBalance(reserva.id).catch((e: unknown) => e);

    await soltarA();
    await chamadaA;

    // B foi recusado pela trava em vez de bater no provedor junto com A.
    expect(erroB).toBeInstanceOf(BalanceChargeInProgressError);
    // E continua valendo o que importa: nada foi criado.
    expect(fake.createCalls).toHaveLength(1);
  });

  it('V1.2c falha ao reler o QR NAO vira "o provedor recusou"', async () => {
    const reserva = await reservaComSaldo('11955550007');
    await chargeReservationBalance(reserva.id);

    fake.qrThrows = new PaymentProviderApiError(400, 'Um erro desconhecido foi encontrado.');

    const erro = await chargeReservationBalance(reserva.id).catch((e: unknown) => e);

    // >>> A DISTINCAO. <<< A cobranca existe; dizer "recusou" mandaria o dono
    // refazer uma cobranca que ja esta de pe.
    expect(erro).toBeInstanceOf(BalanceQrUnavailableError);
    expect(erro).not.toBeInstanceOf(PaymentProviderApiError);

    const { status, body } = await callPost(reserva.id);
    expect(status).toBe(502);
    expect(body.code).toBe('qr_indisponivel');
    expect(body.detail).toContain('nada foi duplicado');
  });

  it('V1.3 cobranca existe no provedor mas o id nao foi gravado: ADOTA, nao cria outra', async () => {
    // Reproduz o buraco que trava local nenhuma alcanca: o processo morreu
    // entre o Asaas criar e nos gravarmos o id. A linha esta com id nulo e a
    // cobranca existe la.
    const reserva = await reservaComSaldo('11955550003');
    fake.findResult = {
      chargeId: 'pay_orfa_9999',
      state: 'pending',
      stage: 'aguardando',
      amountCents: reserva.balanceCents,
      externalReference: `${reserva.id}:balance`,
      paidAt: null,
      netCents: null,
    };

    const resultado = await chargeReservationBalance(reserva.id);

    expect(resultado.origin).toBe('adopted');
    // Nada foi criado — este e o ponto.
    expect(fake.createCalls).toHaveLength(0);
    // E o id orfao passou a ser o nosso.
    expect((await balanceRow(reserva.id))!.asaas_payment_id).toBe('pay_orfa_9999');
  });

  it('V1.4 FAIL-CLOSED: se nao da para perguntar ao provedor, NAO cria', async () => {
    const reserva = await reservaComSaldo('11955550004');
    fake.findThrows = new PaymentProviderNetworkError('[asaas] timeout');

    await expect(chargeReservationBalance(reserva.id)).rejects.toBeInstanceOf(
      PaymentProviderNetworkError,
    );

    // A falha da consulta NAO pode virar "entao cria": e justamente o risco que
    // a camada 3 existe para eliminar.
    expect(fake.createCalls).toHaveLength(0);
    expect((await balanceRow(reserva.id))!.asaas_payment_id).toBeNull();
  });

  it('V1.5 falha na criacao NAO deixa id gravado, e a proxima tentativa funciona', async () => {
    const reserva = await reservaComSaldo('11955550005');
    fake.createThrows = new PaymentProviderApiError(400, 'valor abaixo do minimo');

    await expect(chargeReservationBalance(reserva.id)).rejects.toBeInstanceOf(
      PaymentProviderApiError,
    );
    expect((await balanceRow(reserva.id))!.asaas_payment_id).toBeNull();

    // Consertada a causa, a proxima tentativa cria normalmente — a reserva NAO
    // ficou num estado morto. (Diferente da borda 9, onde a reserva expira: ali
    // o que falta e o pagamento DEVIDO; aqui a vaga ja esta garantida.)
    fake.createThrows = null;
    const ok = await chargeReservationBalance(reserva.id);
    expect(ok.origin).toBe('created');
  });
});

// ============================================================================
describe('V2 quando o saldo NAO e cobravel', () => {
  it('V2.1 reserva ainda aguardando o sinal: recusa com sinal_pendente', async () => {
    // Sinal NAO pago: a reserva segue pending_payment. Cobrar o saldo aqui poria
    // dois QR na mao do cliente, e o que ele pagasse primeiro nao confirmaria.
    const criada = await comSinal(EXP.longa, async () =>
      createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11955550010',
          paymentMethodMode: 'deposit',
        }),
      ),
    );

    const erro = await chargeReservationBalance(criada.reservationId).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BalanceNotChargeableError);
    expect((erro as InstanceType<typeof BalanceNotChargeableError>).reason).toBe('sinal_pendente');
    expect(fake.createCalls).toHaveLength(0);
  });

  it('V2.2 reserva cancelada: recusa com reserva_inativa', async () => {
    const reserva = await reservaComSaldo('11955550011');
    await setReservationStatus(reserva.id, 'cancelled');

    const { status, body } = await callPost(reserva.id);
    expect(status).toBe(409);
    expect(body.code).toBe('reserva_inativa');
    expect(fake.createCalls).toHaveLength(0);
  });

  it('V2.3 saldo ja quitado: recusa com saldo_quitado', async () => {
    const reserva = await reservaComSaldo('11955550012');
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid', paid_at = now(), received_in_cash = true
      WHERE reservation_id = ${reserva.id} AND kind = 'balance'
    `);
    await recalcReservationPayment(reserva.id);

    const { status, body } = await callPost(reserva.id);
    expect(status).toBe(409);
    expect(body.code).toBe('saldo_quitado');
    expect(fake.createCalls).toHaveLength(0);
  });

  it('V2.4 reserva no modo full nao tem linha de saldo: 404', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11955550013',
      }),
    );

    const { status } = await callPost(criada.reservationId);
    expect(status).toBe(404);
    expect(fake.createCalls).toHaveLength(0);
  });

  it('V2.5 id malformado, inexistente e de OUTRO TENANT: os tres 404', async () => {
    await insertFixtureTenant(OTHER_TENANT_ID, 'saldo');
    try {
      const reserva = await reservaComSaldo('11955550014');
      await db.execute(sql`
        UPDATE reservations SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${reserva.id}
      `);

      expect((await callPost('nao-e-uuid')).status).toBe(404);
      expect((await callPost('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      // Existe, tem saldo, e de outro tenant: 404 igual. Um 403 confirmaria o id.
      expect((await callPost(reserva.id)).status).toBe(404);

      expect(fake.createCalls).toHaveLength(0);
    } finally {
      await wipeMovement();
      await removeFixtureTenant(OTHER_TENANT_ID);
    }
  });

  it('V2.6 erro tipado de reserva inexistente sobe da lib, nao um erro solto', async () => {
    await expect(
      chargeReservationBalance('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(BalanceReservationNotFoundError);
  });
});

// ============================================================================
describe('V3 vencimento mandado ao provedor', () => {
  it('V3.1 saldo atrasado vai ao provedor com hoje, e a linha NAO e reescrita', async () => {
    const reserva = await reservaComSaldo('11955550020');

    // Passeio no passado: o dono esta cobrando um saldo atrasado.
    await db.execute(sql`
      UPDATE reservation_payments SET due_date = current_date - 10
      WHERE reservation_id = ${reserva.id} AND kind = 'balance'
    `);

    await chargeReservationBalance(reserva.id);

    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    // O Asaas recusa vencimento no passado — por isso vai `hoje`.
    expect(lastDueDate.value).toBe(hoje);

    // Mas a LINHA continua dizendo quando a divida nasceu. Reescrever o
    // due_date apagaria o fato de que o saldo venceu no dia do passeio.
    const linha = await balanceRow(reserva.id);
    expect(linha!.due_date).not.toBe(hoje);
  });

  it('V3.2 saldo futuro mantem a data do passeio', async () => {
    const reserva = await reservaComSaldo('11955550021');
    const antes = (await balanceRow(reserva.id))!.due_date;

    await chargeReservationBalance(reserva.id);

    expect(lastDueDate.value).toBe(antes);
  });
});

// ============================================================================
describe('V4 a rota', () => {
  it('V4.1 POST responde 200 com QR, no-store, e SEM o id da cobranca', async () => {
    const reserva = await reservaComSaldo('11955550030');

    const { status, body, cacheControl } = await callPost(reserva.id);

    expect(status).toBe(200);
    expect(cacheControl).toBe('no-store');
    expect(body.payment.qrCodeBase64).toBeTruthy();
    expect(body.payment.copyPaste).toBeTruthy();
    expect(body.amountCents).toBe(reserva.balanceCents);

    // O chargeId do provedor nao atravessa a borda HTTP.
    expect(JSON.stringify(body)).not.toContain('pay_balance_0001');
  });

  it('V4.2 GET NAO cria cobranca — e a razao de a rota ter sido partida em duas', async () => {
    const reserva = await reservaComSaldo('11955550031');

    const { status, body } = await callGet(reserva.id);

    expect(status).toBe(200);
    expect(body.hasCharge).toBe(false);
    expect(body.chargeable).toBe(true);
    expect(body.amountCents).toBe(reserva.balanceCents);
    expect(body.payment).toBeNull();

    // >>> Ler nao cria. <<<
    expect(fake.createCalls).toHaveLength(0);
    expect(fake.findCalls).toHaveLength(0);
  });

  it('V4.3 depois de cobrar, o GET devolve o QR atual relido do provedor', async () => {
    const reserva = await reservaComSaldo('11955550032');
    await callPost(reserva.id);

    const { body } = await callGet(reserva.id);

    expect(body.hasCharge).toBe(true);
    expect(body.payment.copyPaste).toContain('relido');
    // Buscado na hora, nunca persistido (secao 7.2).
    expect(fake.qrCalls).toContain('pay_balance_0001');
  });

  it('V4.4 provedor indisponivel responde 502 dizendo que NAO criou', async () => {
    const reserva = await reservaComSaldo('11955550033');
    fake.findThrows = new PaymentProviderNetworkError('[asaas] timeout');

    const { status, body } = await callPost(reserva.id);

    expect(status).toBe(502);
    expect(body.code).toBe('provedor_indisponivel');
    expect(body.detail).toContain('NAO foi criada');
    expect(fake.createCalls).toHaveLength(0);
  });

  it('V4.5 recusa do provedor responde 422 COM o detalhe, para o dono agir', async () => {
    const reserva = await reservaComSaldo('11955550034');
    fake.createThrows = new PaymentProviderApiError(400, 'valor abaixo do minimo permitido');

    const { status, body } = await callPost(reserva.id);

    expect(status).toBe(422);
    expect(body.code).toBe('provedor_recusou');
    // O dono precisa da mensagem: sem ela ele nao sabe o que consertar.
    expect(body.detail).toContain('minimo');
  });
});

// ============================================================================
describe('V5 o reconciliador para de gritar sobre o saldo', () => {
  it('V5.1 balance SEM cobranca nao gera aviso — e estado esperado, nao anomalia', async () => {
    const reserva = await reservaComSaldo('11955550040');
    // O job so olha cobrancas criadas ha mais de 5 min.
    await db.execute(sql`
      UPDATE reservation_payments SET created_at = now() - interval '30 minutes'
      WHERE reservation_id = ${reserva.id}
    `);

    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcilePayments();
      const sobreEsteSaldo = avisos.mock.calls
        .map((c) => String(c[0]))
        .filter((linha) => linha.includes(reserva.id));
      // Antes da Fase C isto era 1 linha a cada 10 minutos, para sempre.
      expect(sobreEsteSaldo).toHaveLength(0);
    } finally {
      avisos.mockRestore();
    }
  });

  it('V5.2 deposit SEM cobranca CONTINUA avisando — e a borda 9, e e o unico sinal dela', async () => {
    const criada = await comSinal(EXP.longa, async () =>
      createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa, 1),
          resourcesNeeded: 1,
          phone: '11955550041',
          paymentMethodMode: 'deposit',
        }),
      ),
    );
    await db.execute(sql`
      UPDATE reservation_payments SET created_at = now() - interval '30 minutes'
      WHERE reservation_id = ${criada.reservationId}
    `);

    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcilePayments();
      const linhas = avisos.mock.calls
        .map((c) => String(c[0]))
        .filter((linha) => linha.includes(criada.reservationId));

      // Exatamente um: o do `deposit`. O do `balance` da mesma reserva calou.
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toContain('kind=deposit');
    } finally {
      avisos.mockRestore();
    }
  });
});
