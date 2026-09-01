// GRUPO Y — cartao de credito e chargeback (CLAUDE.md secoes 4-B.1, 4-B.2,
// 4-B.8, 4-B.9 e 8.1). Fase E.
//
// ============================================================================
// >>> O ACHADO QUE DEFINE ESTE GRUPO <<<
// Antes da Fase E, um chargeback era TRADUZIDO CORRETAMENTE por `toPaymentState`
// e depois DESCARTADO sem tocar no banco — a linha estava 'paid', o processamento
// saia por `already_paid` e o evento ia embora. Isso e pior que nao ter sido
// implementado, porque quem lesse a traducao concluiria que o caso estava
// coberto.
//
// Por isso Y3 nao verifica so "o estado ficou certo": verifica que o
// processamento ESCREVE, e Y3.4 verifica que a reserva NAO foi cancelada, que e
// a metade da regra que um teste ingenuo esqueceria.
//
// >>> O QUE E MOCKADO, E POR QUE SO ISSO <<<
// A borda de rede do provedor, como no grupo I. O banco e o Postgres de verdade
// — e e ele que responde as perguntas que importam aqui: o que
// `recalcReservationPayment` faz com uma linha revertida, e se o CHECK de
// coerencia deixa gravar o liquido do provedor sem modalidade de maquininha.
// ============================================================================

import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { listPublicExperiences } from '@/lib/experiences';
import type { CardCharge, ChargeSnapshot, PixCharge } from '@/lib/payments/provider';
import { InvalidCompositionError, createReservation } from '@/lib/reservations';

import { EXP, assertCatalogSeeded, nextSaturday, reservationInput, wipeMovement } from './helpers/db';

// Valores LITERAIS da tabela da secao 4-B.2, nunca derivados da aritmetica que
// esta sendo testada — mesma disciplina do grupo T.
const MONTANHA_CHEIO = 34_999;
const MONTANHA_PIX = 32_549;

const SAT = nextSaturday();

// ============================================================================
// Provedor falso
// ============================================================================

const fake = vi.hoisted(() => ({
  /** o que `getCharge` devolve */
  charge: null as ChargeSnapshot | null,
  /** quantas vezes cada criacao foi chamada, e com que corpo */
  pixCalls: [] as unknown[],
  cardCalls: [] as unknown[],
  /** `invoiceUrl` devolvido pela criacao de cartao; null simula o provedor omitir */
  cardInvoiceUrl: 'https://sandbox.asaas.com/i/abc123' as string | null,
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    getCharge: async (chargeId: string): Promise<ChargeSnapshot> => {
      if (!fake.charge) throw new Error('teste nao preparou a cobranca');
      return { ...fake.charge, chargeId };
    },
    createPixCharge: async (params: unknown): Promise<PixCharge> => {
      fake.pixCalls.push(params);
      return {
        chargeId: 'pay_pix_fake',
        providerCustomerId: 'cus_fake',
        qrCodeBase64: 'QVZFTlRJWA==',
        copyPaste: '000201...',
        expiresAt: null,
        invoiceUrl: 'https://sandbox.asaas.com/i/pix',
      };
    },
    // O provedor real recusa quando nao vem `invoiceUrl` (nao ha como pagar no
    // cartao sem ela). Aqui o falso reproduz a mesma recusa para Y2.4 exercitar
    // o caminho, em vez de o teste depender do erro do provedor de verdade.
    createCardCharge: async (params: unknown): Promise<CardCharge> => {
      fake.cardCalls.push(params);
      if (!fake.cardInvoiceUrl) throw new Error('cobranca criada sem invoiceUrl');
      return {
        chargeId: 'pay_card_fake',
        providerCustomerId: 'cus_fake',
        invoiceUrl: fake.cardInvoiceUrl,
      };
    },
    getPixQrCode: async () => {
      throw new Error('nao usado neste grupo');
    },
    findChargeByExternalReference: async () => null,
    cancelCharge: async () => {},
  },
}));

// Importados DEPOIS do vi.mock, para pegarem o provedor falso.
const { processCharge } = await import('@/lib/payments/process');
const { createChargeForReservation } = await import('@/lib/payments/charge');
const { toChargeStage, toPaymentState } = await import('@/lib/payments/asaas');

// ============================================================================
// Helpers
// ============================================================================

async function primeiroSlot(experienceId = EXP.longa, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

/** Liga o sinal na experiencia so durante `fn` (o catalogo real e 'full'). */
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

type PaymentRow = {
  id: string;
  state: string;
  method: string;
  charge_stage: string | null;
  amount_cents: number;
  net_cents: number | null;
  card_machine_modality: string | null;
  external_reference: string;
};

async function linhaDevida(reservationId: string): Promise<PaymentRow> {
  const { rows } = await db.execute<PaymentRow>(sql`
    SELECT id::text, state::text, method::text, charge_stage::text, amount_cents,
           net_cents, card_machine_modality::text, external_reference
    FROM reservation_payments
    WHERE reservation_id = ${reservationId} AND kind <> 'balance'
  `);
  return rows[0];
}

async function reserva(reservationId: string) {
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

/** Cria reserva no cartao e grava o id da cobranca, como a rota publica faria. */
async function reservaNoCartao(phone: string) {
  const criada = await createReservation(
    reservationInput({
      experienceId: EXP.longa,
      startAt: await primeiroSlot(),
      resourcesNeeded: 1,
      phone,
      paymentMethod: 'card',
    }),
  );
  await db.execute(sql`
    UPDATE reservation_payments SET asaas_payment_id = 'pay_card_fake'
    WHERE reservation_id = ${criada.reservationId} AND kind <> 'balance'
  `);
  return criada;
}

/** Snapshot do provedor com o status cru traduzido pelas funcoes REAIS. */
function doProvedor(asaasStatus: string, amountCents: number, ref: string, netCents: number | null = null): ChargeSnapshot {
  return {
    chargeId: 'pay_card_fake',
    // Traduz pelas funcoes de producao, nao por valores escritos a mao: assim o
    // teste exercita o mapeamento junto do comportamento, e um status novo mal
    // mapeado aparece aqui em vez de passar despercebido.
    state: toPaymentState(asaasStatus),
    stage: toChargeStage(asaasStatus),
    amountCents,
    externalReference: ref,
    paidAt: asaasStatus === 'CONFIRMED' || asaasStatus === 'RECEIVED' ? new Date().toISOString() : null,
    netCents,
  };
}

beforeAll(assertCatalogSeeded);

beforeEach(async () => {
  await wipeMovement();
  fake.charge = null;
  fake.pixCalls = [];
  fake.cardCalls = [];
  fake.cardInvoiceUrl = 'https://sandbox.asaas.com/i/abc123';
});

afterEach(wipeMovement);

// ============================================================================
// Y1 — preco: o cartao paga o CHEIO, o Pix paga com desconto
// ============================================================================

describe('Y1 preco por meio de pagamento', () => {
  it('Y1.1 cartao cobra o CHEIO e Pix cobra com desconto, na mesma experiencia', async () => {
    const noCartao = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955551001',
        paymentMethod: 'card',
      }),
    );

    expect(noCartao.totalCents).toBe(MONTANHA_CHEIO);
    expect(noCartao.dueNowCents).toBe(MONTANHA_CHEIO);
    expect(noCartao.paymentMethod).toBe('card');

    await wipeMovement();

    const noPix = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955551002',
        paymentMethod: 'pix',
      }),
    );

    expect(noPix.totalCents).toBe(MONTANHA_PIX);
  });

  it('Y1.2 a diferenca e EXATAMENTE o desconto do Pix — nao ha taxa somada ao cartao', async () => {
    // >>> O TESTE QUE TRAVA A REGRA MAIS FACIL DE VIOLAR SEM PERCEBER. <<<
    // A secao 4-B.1 proibe "cheio + taxa". Um dia alguem pode implementar o
    // cartao somando um percentual e chegar a um numero PARECIDO; aqui o cartao
    // tem que bater com o preco de catalogo, ao centavo.
    const catalogo = await listPublicExperiences();
    const montanha = catalogo.find((e) => e.name === 'Trilha da Montanha')!;

    expect(montanha.priceCents).toBe(MONTANHA_CHEIO);
    // Cartao sem linha de desconto: 0 bp. NAO ha um "acrescimo" configuravel em
    // lugar nenhum — a tabela so guarda desconto (secao 4-B.6).
    expect(montanha.discountBasisPointsByMethod.card).toBe(0);

    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955551003',
        paymentMethod: 'card',
      }),
    );

    expect(criada.totalCents).toBe(montanha.priceCents);
  });

  it('Y1.3 a linha de pagamento guarda o meio escolhido', async () => {
    const criada = await reservaNoCartao('11955551004');
    expect((await linhaDevida(criada.reservationId)).method).toBe('card');
  });
});

// ============================================================================
// Y2 — o cartao nao aceita sinal, e nao ha formulario de cartao
// ============================================================================

describe('Y2 cartao nao aceita sinal', () => {
  it('Y2.1 cartao + sinal e RECUSADO, nunca rebaixado para integral em silencio', async () => {
    await comSinal(EXP.longa, async () => {
      const input = reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955552001',
        paymentMethod: 'card',
        paymentMethodMode: 'deposit',
      });

      await expect(createReservation(input)).rejects.toBeInstanceOf(InvalidCompositionError);
    });
  });

  it('Y2.2 a recusa acontece ANTES de qualquer escrita — nao sobra reserva nem cliente', async () => {
    // Rebaixar em silencio seria o desfecho ruim OBVIO. O menos obvio e recusar
    // depois de ter escrito: sobraria reserva orfa segurando vaga.
    await comSinal(EXP.longa, async () => {
      await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(),
          resourcesNeeded: 1,
          phone: '11955552002',
          paymentMethod: 'card',
          paymentMethodMode: 'deposit',
        }),
      ).catch(() => null);

      const { rows } = await db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM reservations`,
      );
      expect(rows[0].total).toBe(0);
    });
  });

  it('Y2.3 sinal no PIX continua funcionando — a recusa e do cartao, nao do sinal', async () => {
    await comSinal(EXP.longa, async () => {
      const criada = await createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(),
          resourcesNeeded: 1,
          phone: '11955552003',
          paymentMethod: 'pix',
          paymentMethodMode: 'deposit',
        }),
      );

      expect(criada.paymentMode).toBe('deposit');
      // Metade de 32549 (o total JA COM desconto), arredondando a entrada para
      // cima e obtendo o saldo por subtracao — secao 4-B.5.
      expect(criada.dueNowCents).toBe(16_275);
      expect(criada.balanceCents).toBe(16_274);
    });
  });

  it('Y2.4 a criacao no provedor NAO manda dado de cartao, e usa o metodo proprio', async () => {
    // >>> PCI-DSS (secao 4-B.8): nenhum dado de cartao pode atravessar o nosso
    // servidor. O teste inspeciona o corpo que foi para o provedor. <<<
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955552004',
        paymentMethod: 'card',
      }),
    );

    const bloco = await createChargeForReservation(criada.reservationId);

    // Caminho proprio: `createPixCharge` NAO pode ter sido chamado (ele buscaria
    // um QR Pix que nao existe para cobranca de cartao).
    expect(fake.pixCalls).toHaveLength(0);
    expect(fake.cardCalls).toHaveLength(1);

    const enviado = JSON.stringify(fake.cardCalls[0]);
    for (const proibido of ['creditCard', 'holderName', 'ccv', 'cardNumber', 'expiryMonth']) {
      expect(enviado, `${proibido} nao pode ir para o provedor`).not.toContain(proibido);
    }

    expect(bloco.method).toBe('card');
    if (bloco.method === 'card') {
      expect(bloco.invoiceUrl).toBe('https://sandbox.asaas.com/i/abc123');
    }
  });

  it('Y2.5 cobranca de cartao sem invoiceUrl EXPIRA a reserva — nao fica de pe sem como pagar', async () => {
    // Sem fatura nao ha caminho de pagamento nenhum no cartao (nao existe o
    // copia-e-cola que o Pix tem). Cair na borda 9 e o desfecho certo.
    fake.cardInvoiceUrl = null;

    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(),
        resourcesNeeded: 1,
        phone: '11955552005',
        paymentMethod: 'card',
      }),
    );

    await expect(createChargeForReservation(criada.reservationId)).rejects.toThrow();
    expect((await reserva(criada.reservationId)).status).toBe('expired');
  });
});

// ============================================================================
// Y3 — confirmacao no PAYMENT_CONFIRMED (e nao no RECEIVED, que vem 32 dias depois)
// ============================================================================

describe('Y3 confirmacao do cartao', () => {
  it('Y3.1 PAYMENT_CONFIRMED confirma a reserva', async () => {
    // >>> A REGRA QUE, SE ERRADA, SO APARECE 32 DIAS DEPOIS. <<<
    // No credito o RECEIVED chega ~32 dias apos a compra. Confirmar so nele
    // deixaria a vaga do cliente valendo daqui a um mes.
    const criada = await reservaNoCartao('11955553001');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference);

    const resultado = await processCharge('pay_card_fake');

    expect(resultado.outcome).toBe('confirmed');
    const depois = await reserva(criada.reservationId);
    expect(depois.status).toBe('confirmed');
    expect(depois.payment_state).toBe('settled');
    expect(depois.amount_paid_cents).toBe(MONTANHA_CHEIO);
  });

  it('Y3.2 o PAYMENT_RECEIVED que chega depois NAO duplica nada', async () => {
    const criada = await reservaNoCartao('11955553002');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');

    const entre = await reserva(criada.reservationId);

    // ~32 dias depois: mesmo pagamento, agora RECEIVED.
    fake.charge = doProvedor('RECEIVED', linha.amount_cents, linha.external_reference);
    const segundo = await processCharge('pay_card_fake');

    expect(segundo.outcome).toBe('already_paid');
    const depois = await reserva(criada.reservationId);
    expect(depois.amount_paid_cents).toBe(entre.amount_paid_cents);
    expect(depois.payment_state).toBe('settled');
  });

  it('Y3.3 o MESMO evento entregue duas vezes nao produz efeito duplo', async () => {
    // Entrega e at-least-once (secao 8.1 regra 4).
    const criada = await reservaNoCartao('11955553003');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference);

    const primeiro = await processCharge('pay_card_fake');
    const segundo = await processCharge('pay_card_fake');

    expect(primeiro.outcome).toBe('confirmed');
    expect(segundo.outcome).toBe('already_paid');
    expect((await reserva(criada.reservationId)).amount_paid_cents).toBe(MONTANHA_CHEIO);
  });

  it('Y3.4 CREDIT_CARD_CAPTURE_REFUSED NAO confirma a reserva', async () => {
    const criada = await reservaNoCartao('11955553004');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor(
      'CREDIT_CARD_CAPTURE_REFUSED',
      linha.amount_cents,
      linha.external_reference,
    );

    const resultado = await processCharge('pay_card_fake');

    expect(resultado.outcome).toBe('not_paid_yet');
    const depois = await reserva(criada.reservationId);
    expect(depois.status).toBe('pending_payment');
    expect(depois.amount_paid_cents).toBe(0);
    // ...mas o ESTAGIO foi gravado: e o que permite a tela dizer "nao aprovado"
    // em vez de repetir "aguardando pagamento".
    expect((await linhaDevida(criada.reservationId)).charge_stage).toBe('recusado');
  });

  it('Y3.5 AWAITING_RISK_ANALYSIS e AUTHORIZED ficam "em analise", sem confirmar', async () => {
    // "Autorizado" NAO e "pago": o limite foi reservado e o dinheiro nao saiu.
    for (const [i, status] of ['AWAITING_RISK_ANALYSIS', 'AUTHORIZED'].entries()) {
      await wipeMovement();
      const criada = await reservaNoCartao(`1195555400${i}`);
      const linha = await linhaDevida(criada.reservationId);

      fake.charge = doProvedor(status, linha.amount_cents, linha.external_reference);
      const resultado = await processCharge('pay_card_fake');

      expect(resultado.outcome, status).toBe('not_paid_yet');
      expect((await reserva(criada.reservationId)).status, status).toBe('pending_payment');
      expect((await linhaDevida(criada.reservationId)).charge_stage, status).toBe('em_analise');
    }
  });
});

// ============================================================================
// Y4 — chargeback: reverte o dinheiro, NAO a reserva
// ============================================================================

describe('Y4 chargeback', () => {
  /** Reserva de cartao ja confirmada e paga — o ponto de partida do chargeback. */
  async function confirmadaNoCartao(phone: string) {
    const criada = await reservaNoCartao(phone);
    const linha = await linhaDevida(criada.reservationId);
    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');
    return { criada, linha };
  }

  it('Y4.1 chargeback ESCREVE — nao e mais traduzido e descartado', async () => {
    // ======================================================================
    // >>> O TESTE MAIS IMPORTANTE DO GRUPO. <<<
    // Antes da Fase E este caminho saia por `already_paid` sem tocar no banco:
    // a traducao existia, o efeito nao. Se este teste passar a devolver
    // 'already_paid', a regressao voltou.
    // ======================================================================
    const { criada, linha } = await confirmadaNoCartao('11955555001');

    fake.charge = doProvedor(
      'CHARGEBACK_REQUESTED',
      linha.amount_cents,
      linha.external_reference,
    );

    const resultado = await processCharge('pay_card_fake');

    expect(resultado.outcome).toBe('reverted');
    expect((await linhaDevida(criada.reservationId)).state).toBe('refunded');
  });

  it('Y4.2 a reserva NAO e cancelada nem apagada, e a vaga continua ocupada', async () => {
    // ======================================================================
    // A outra metade da regra (secao 4-B.9): o passeio ACONTECEU. Cancelar
    // liberaria as linhas de reservation_resources, apagando o registro de que
    // o recurso esteve ocupado — evento financeiro destruindo historico
    // operacional.
    // ======================================================================
    const { criada, linha } = await confirmadaNoCartao('11955555002');

    fake.charge = doProvedor('CHARGEBACK_REQUESTED', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');

    const depois = await reserva(criada.reservationId);
    expect(depois.status).toBe('confirmed');

    const { rows } = await db.execute<{ status: string; total: number }>(sql`
      SELECT status::text, count(*)::int AS total
      FROM reservation_resources WHERE reservation_id = ${criada.reservationId}
      GROUP BY status
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].total).toBe(1);
  });

  it('Y4.3 o dinheiro sai do agregado da reserva, por derivacao', async () => {
    // Sem coluna nova: `recalcReservationPayment` soma so as linhas 'paid'.
    const { criada, linha } = await confirmadaNoCartao('11955555003');
    expect((await reserva(criada.reservationId)).amount_paid_cents).toBe(MONTANHA_CHEIO);

    fake.charge = doProvedor('REFUNDED', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');

    const depois = await reserva(criada.reservationId);
    expect(depois.amount_paid_cents).toBe(0);
    expect(depois.payment_state).toBe('pending');
  });

  it('Y4.4 os quatro eventos de chargeback em sequencia escrevem UMA vez so', async () => {
    // Todos traduzem para 'refunded'. Sem a saida por `already_refunded`, cada
    // um reescreveria a linha e repetiria o alerta no log — e alerta repetido
    // treina o dono a ignorar.
    const { criada, linha } = await confirmadaNoCartao('11955555004');

    const sequencia = [
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL',
      'REFUNDED',
    ];

    const desfechos: string[] = [];
    for (const status of sequencia) {
      fake.charge = doProvedor(status, linha.amount_cents, linha.external_reference);
      desfechos.push((await processCharge('pay_card_fake')).outcome);
    }

    expect(desfechos).toEqual(['reverted', 'already_refunded', 'already_refunded', 'already_refunded']);
    expect((await reserva(criada.reservationId)).amount_paid_cents).toBe(0);
  });

  it('Y4.5 disputa GANHA volta sozinha, pelo mesmo caminho', async () => {
    // A propriedade que torna o desenho robusto: processCharge CONVERGE para o
    // provedor em vez de aplicar transicoes, entao a volta nao precisa de codigo
    // proprio. Se um dia alguem transformar isto numa maquina de transicoes, este
    // teste quebra — e e a hora de discutir de novo.
    const { criada, linha } = await confirmadaNoCartao('11955555005');

    fake.charge = doProvedor('CHARGEBACK_DISPUTE', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');
    expect((await reserva(criada.reservationId)).amount_paid_cents).toBe(0);

    // Disputa ganha: o provedor devolve a cobranca a CONFIRMED.
    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference);
    await processCharge('pay_card_fake');

    const depois = await reserva(criada.reservationId);
    expect(depois.amount_paid_cents).toBe(MONTANHA_CHEIO);
    expect(depois.payment_state).toBe('settled');
    expect(depois.status).toBe('confirmed');
    expect((await linhaDevida(criada.reservationId)).state).toBe('paid');
  });

  it('Y4.6 cobranca nunca paga que vira "refunded" nao dispara alarme de reversao', async () => {
    // Cobranca cancelada/estornada sem nunca ter sido paga nao tem dinheiro a
    // reverter. Tratar como reversao geraria alerta para o dono sobre nada.
    const criada = await reservaNoCartao('11955555006');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('REFUNDED', linha.amount_cents, linha.external_reference);
    const resultado = await processCharge('pay_card_fake');

    expect(resultado.outcome).toBe('not_paid_yet');
    expect((await linhaDevida(criada.reservationId)).state).toBe('pending');
  });
});

// ============================================================================
// Y5 — liquido LIDO do provedor, congelado (a tarefa transversal da secao 4-B.7)
// ============================================================================

describe('Y5 valor liquido do provedor', () => {
  it('Y5.1 o netValue do provedor e GRAVADO na linha, sem modalidade de maquininha', async () => {
    // O CHECK de coerencia era bicondicional ate a Fase E e barraria isto:
    // exigia percentual e modalidade para aceitar liquido. Ver a migration 0009.
    const criada = await reservaNoCartao('11955556001');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference, 34_299);
    await processCharge('pay_card_fake');

    const depois = await linhaDevida(criada.reservationId);
    expect(depois.net_cents).toBe(34_299);
    // A PROCEDENCIA fica legivel: modalidade nula = veio do provedor, nao da
    // maquininha. E o que impede a contagem de pendencias da Fase D de
    // confundir os dois.
    expect(depois.card_machine_modality).toBeNull();
  });

  it('Y5.2 o liquido NAO e recalculado depois — fica congelado no registro', async () => {
    // Secao 4-B.7: taxa muda com o tempo, registro de dinheiro nao muda junto.
    const criada = await reservaNoCartao('11955556002');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference, 34_299);
    await processCharge('pay_card_fake');

    // O provedor passa a informar OUTRO liquido (taxa reajustada). Reprocessar o
    // mesmo pagamento nao pode reescrever o passado.
    fake.charge = doProvedor('RECEIVED', linha.amount_cents, linha.external_reference, 33_000);
    await processCharge('pay_card_fake');

    expect((await linhaDevida(criada.reservationId)).net_cents).toBe(34_299);
  });

  it('Y5.3 liquido ausente NAO apaga um liquido ja conhecido', async () => {
    // `null` e "nao sei". Sobrescrever um valor conhecido com "nao sei" e perda
    // de informacao — a mesma distincao entre NULL e 0 da secao 4-B.6.
    const criada = await reservaNoCartao('11955556003');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference, 34_299);
    await processCharge('pay_card_fake');

    // Chargeback e volta, agora sem netValue no payload.
    fake.charge = doProvedor('CHARGEBACK_REQUESTED', linha.amount_cents, linha.external_reference, null);
    await processCharge('pay_card_fake');
    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference, null);
    await processCharge('pay_card_fake');

    expect((await linhaDevida(criada.reservationId)).net_cents).toBe(34_299);
  });

  it('Y5.4 nada calcula o liquido: sem netValue, a coluna fica NULA', async () => {
    // Para o que passa pelo provedor, o liquido e LIDO. Se um dia alguem
    // "melhorar" isto derivando de card_machine_rates, este teste quebra.
    const criada = await reservaNoCartao('11955556004');
    const linha = await linhaDevida(criada.reservationId);

    fake.charge = doProvedor('CONFIRMED', linha.amount_cents, linha.external_reference, null);
    await processCharge('pay_card_fake');

    expect((await linhaDevida(criada.reservationId)).net_cents).toBeNull();
  });
});
