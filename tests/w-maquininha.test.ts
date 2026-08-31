// GRUPO W — registro manual do saldo na maquininha (CLAUDE.md secao 17, Fase D;
// regras em 4-B.6 e 4-B.7).
//
// ============================================================================
// >>> O QUE ESTE GRUPO PROTEGE E O PASSADO. <<<
// A propriedade central da Fase D nao e calcular o liquido certo: e o liquido
// certo NAO MUDAR quando a taxa mudar. Em setembro registra R$ 150 a 5% e
// mostra R$ 142,50; em novembro a operadora reajusta para 6%, o dono atualiza a
// tela, e sem congelamento a reserva de SETEMBRO passa a mostrar R$ 141,00 — o
// passado mudando sozinho, e a conferencia com o extrato quebrando sem nada
// acusar erro. O caso W4.1 e o que trava isso.
//
// A segunda propriedade e o CAMINHO DUPLO: o cliente pagou por Pix as 8h e o
// guia marca "recebi na maquininha" as 9h. Sem recusa, o sistema soma o mesmo
// dinheiro duas vezes.
// ============================================================================
//
// >>> O QUE E MOCKADO <<< `asaasProvider`, so a borda de rede — mesma linha de
// corte dos grupos I, K e V. O banco e real, e e ele que guarda os valores
// congelados que este grupo verifica.

import { sql } from 'drizzle-orm';
import { sealData } from 'iron-session';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { PaymentProviderNetworkError } from '@/lib/payments/provider';
import { getReservationDetail } from '@/lib/reservation-detail';
import { createReservation, recalcReservationPayment, setReservationStatus } from '@/lib/reservations';

import {
  EXP,
  assertCatalogSeeded,
  insertFixtureTenant,
  nextSaturday,
  removeFixtureTenant,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const fake = vi.hoisted(() => ({
  /** cobrancas que o provedor foi mandado cancelar. */
  cancelled: [] as string[],
  cancelThrows: null as Error | null,
}));

vi.mock('@/lib/payments/asaas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/asaas')>()),
  asaasProvider: {
    cancelCharge: async (chargeId: string): Promise<void> => {
      if (fake.cancelThrows) throw fake.cancelThrows;
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

const {
  ReceiptRefusedError,
  ReceiptReservationNotFoundError,
  countReceiptsAwaitingNet,
  previewReceipt,
  receiveBalanceInCash,
} = await import('@/lib/payments/receive-in-cash');
const { POST: postReceive } = await import(
  '@/app/api/admin/reservations/[id]/balance/receive-in-cash/route'
);

// ============================================================================
// >>> POR QUE ESTE ARQUIVO MEXE EM ADMIN_PASSWORD_HASH <<<
//
// Este e o PRIMEIRO teste do projeto a exercitar uma sessao selada de verdade
// (o grupo F so testa `isProtectedPath`, que e funcao pura). E ao faze-lo
// esbarra na armadilha do cifrao (secao 3 e secao 19), pelo lado que a
// documentacao ainda nao cobria:
//
//   o `.env` guarda o hash como `\$2b\$12\$...` porque o carregador do NEXT
//   expande `$`. Os testes carregam o `.env` com `dotenv` PURO, que nao
//   expande — entao o valor chega com as contrabarras LITERAIS, com 63
//   caracteres em vez de 60. `getAuthConfig()` recusa, `readSessionCookie`
//   devolve `null`, e toda rota que dependa da sessao responde 401 sem que
//   nada esteja errado com a sessao.
//
// A correcao abaixo desfaz o escape SO no processo de teste. Nao afrouxa nada
// do que este grupo verifica: o que esta sob teste e de onde o RASTRO vem, e
// para isso a sessao precisa poder ser lida de verdade. `getAuthConfig()` e
// memoizado e preguicoso, entao isto precisa acontecer antes da primeira
// chamada — e acontece, porque nada le auth no import.
if (process.env.ADMIN_PASSWORD_HASH?.includes('\\$')) {
  process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH.replace(/\\\$/g, '$');
}

const SAT = nextSaturday();
const OTHER_TENANT_ID = 81;
const GUIA = 'admin@quadriclub.com.br';

/** Saldo da Trilha da Montanha com sinal de 50%: 32549 - 16275. */
const SALDO = 16274;

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

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

/** Reserva `confirmed` + `partial`: sinal pago, saldo em aberto. */
async function reservaComSaldo(phone: string): Promise<string> {
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
    return criada.reservationId;
  });
}

async function saldoRow(reservationId: string) {
  const { rows } = await db.execute<{
    state: string;
    amount_cents: number;
    received_in_cash: boolean;
    card_machine_modality: string | null;
    rate_basis_points_applied: number | null;
    net_cents: number | null;
    registered_by: string | null;
    registered_at: string | null;
  }>(sql`
    SELECT state::text, amount_cents, received_in_cash,
           card_machine_modality::text, rate_basis_points_applied, net_cents,
           registered_by, registered_at
    FROM reservation_payments WHERE reservation_id = ${reservationId} AND kind = 'balance'
  `);
  return rows[0];
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

/** Cadastra taxa de uma modalidade. Devolve como desfazer. */
async function comTaxa(modality: string, basisPoints: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO card_machine_rates (tenant_id, modality, rate_basis_points)
    VALUES (1, ${modality}::card_machine_modality, ${basisPoints})
    ON CONFLICT (tenant_id, modality) DO UPDATE SET rate_basis_points = ${basisPoints}
  `);
}

async function limparTaxas(): Promise<void> {
  await db.execute(sql`DELETE FROM card_machine_rates WHERE tenant_id = 1`);
}

/**
 * Cookie de sessao REAL, selado com o mesmo segredo da aplicacao.
 *
 * Nao e conveniencia de teste: o RASTRO sai da sessao, e um teste que injetasse
 * o e-mail por outro caminho provaria que a gravacao funciona sem provar que ela
 * pega o declarante do lugar certo. W1.4 depende disto para significar algo.
 */
async function sessionCookie(email = GUIA): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET ausente no .env de teste');
  return sealData({ email }, { password: secret, ttl: 8 * 60 * 60 });
}

async function callPost(id: string, body: unknown, options?: { semSessao?: boolean }) {
  const sealed = options?.semSessao ? null : await sessionCookie();
  const response = await postReceive(
    new NextRequest(
      `http://localhost/api/admin/reservations/${id}/balance/receive-in-cash`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        ...(sealed ? { headers: { cookie: `aventix_admin_session=${sealed}` } } : {}),
      },
    ),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(assertCatalogSeeded);
beforeEach(async () => {
  await wipeMovement();
  await limparTaxas();
  fake.cancelled = [];
  fake.cancelThrows = null;
});
afterAll(async () => {
  await wipeMovement();
  await limparTaxas();
});

// ============================================================================
describe('W1 o registro grava os quatro valores congelados', () => {
  it('W1.1 R$ 162,74 em credito a vista (5%) grava bruto, modalidade, percentual e liquido', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660001');

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    // 16274 a 5% -> taxa 814 (arredonda), liquido 15460.
    expect(resultado.grossCents).toBe(16274);
    expect(resultado.rateBasisPoints).toBe(500);
    expect(resultado.netCents).toBe(15460);

    const linha = await saldoRow(id);
    expect(linha!.amount_cents).toBe(16274);
    expect(linha!.card_machine_modality).toBe('credit');
    expect(linha!.rate_basis_points_applied).toBe(500);
    expect(linha!.net_cents).toBe(15460);
    expect(linha!.received_in_cash).toBe(true);
    expect(linha!.state).toBe('paid');

    // A propriedade da 4-B.5, valendo tambem aqui: taxa + liquido = bruto.
    expect(16274 - 15460).toBe(814);
  });

  it('W1.2 as tres modalidades dao liquidos DIFERENTES para o mesmo bruto', async () => {
    await comTaxa('debit', 200);
    await comTaxa('credit', 500);
    await comTaxa('credit_installment', 780);

    const debito = await previewReceipt(SALDO, 'debit');
    const credito = await previewReceipt(SALDO, 'credit');
    const parcelado = await previewReceipt(SALDO, 'credit_installment');

    expect(debito.netCents).toBe(15949);
    expect(credito.netCents).toBe(15460);
    expect(parcelado.netCents).toBe(15005);

    // >>> A razao de a taxa ser TABELA e nao campo unico (secao 4-B.6). <<<
    // Um campo so produziria numero errado com aparencia de certo.
    expect(new Set([debito.netCents, credito.netCents, parcelado.netCents]).size).toBe(3);
  });

  it('W1.3 o RASTRO e gravado: quem declarou e quando', async () => {
    await comTaxa('debit', 200);
    const id = await reservaComSaldo('11966660002');

    await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'debit',
      registeredBy: GUIA,
    });

    const linha = await saldoRow(id);
    // E a UNICA operacao do sistema em que alguem declara ter recebido dinheiro
    // sem prova externa. Sem rastro, uma divergencia nao se reconstitui.
    expect(linha!.registered_by).toBe(GUIA);
    expect(linha!.registered_at).not.toBeNull();
  });

  it('W1.4 a rota tira o registrante da SESSAO, nunca do corpo', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660003');

    const { status, body } = await callPost(id, {
      valorBrutoCentavos: SALDO,
      modalidade: 'credit',
      // tentativa de forjar o rastro
      registeredBy: 'outra-pessoa@exemplo.test',
    });

    expect(status).toBe(200);
    expect(body.registeredBy).toBe(GUIA);
    expect((await saldoRow(id))!.registered_by).toBe(GUIA);
  });
});

// ============================================================================
describe('W2 o estado da reserva depois do registro', () => {
  it('W2.1 recebendo o saldo inteiro, payment_state vai para settled', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660010');

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    expect(resultado.paymentState).toBe('settled');
    const reserva = await estadoReserva(id);
    expect(reserva!.payment_state).toBe('settled');
    expect(reserva!.amount_paid_cents).toBe(32549);
    // A VAGA nao se mexe: quitar dinheiro nao e transicao de status.
    expect(reserva!.status).toBe('confirmed');
  });

  it('W2.2 recebendo MENOS que o saldo, a reserva fica partial e o saldo continua visivel', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660011');

    // Decisao de 31/08: amount_cents passa a valer o BRUTO RECEBIDO. Sem isso a
    // reserva iria para `settled` AFIRMANDO ter recebido o que nao recebeu.
    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: 10000,
      modality: 'credit',
      registeredBy: GUIA,
    });

    expect(resultado.paymentState).toBe('partial');
    expect(resultado.balanceCents).toBe(32549 - 16275 - 10000);
    expect((await saldoRow(id))!.amount_cents).toBe(10000);
  });
});

// ============================================================================
describe('W3 as duas armadilhas', () => {
  it('W3.1 CAMINHO DUPLO: saldo ja pago por Pix -> o registro manual e RECUSADO', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660020');

    // O webhook registrou o Pix do saldo as 8h.
    await db.execute(sql`
      UPDATE reservation_payments SET state = 'paid', paid_at = now()
      WHERE reservation_id = ${id} AND kind = 'balance'
    `);
    await recalcReservationPayment(id);

    // As 9h o guia marca "recebi na maquininha".
    const { status, body } = await callPost(id, {
      valorBrutoCentavos: SALDO,
      modalidade: 'credit',
    });

    expect(status).toBe(409);
    expect(body.code).toBe('saldo_ja_liquidado');

    // >>> E o dinheiro NAO foi somado duas vezes. <<<
    expect((await estadoReserva(id))!.amount_paid_cents).toBe(32549);
    expect((await saldoRow(id))!.received_in_cash).toBe(false);
  });

  it('W3.2 cobranca Pix pendente do saldo e CANCELADA no provedor', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660021');
    // A Fase C gerou o QR e o cliente nao pagou por ali.
    await db.execute(sql`
      UPDATE reservation_payments SET asaas_payment_id = 'pay_saldo_vivo'
      WHERE reservation_id = ${id} AND kind = 'balance'
    `);

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    // Sem isto o cliente paga de novo em casa achando que ainda deve, e o
    // webhook, achando a linha ja paga, responderia 200 sem registrar nada.
    expect(fake.cancelled).toEqual(['pay_saldo_vivo']);
    expect(resultado.providerCharge).toBe('cancelada');
  });

  it('W3.3 sem cobranca gerada, nada e cancelado', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660022');

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    expect(fake.cancelled).toEqual([]);
    expect(resultado.providerCharge).toBe('nao_havia');
  });

  it('W3.4 falha ao cancelar NAO desfaz o registro, e o resultado avisa', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660023');
    await db.execute(sql`
      UPDATE reservation_payments SET asaas_payment_id = 'pay_saldo_vivo'
      WHERE reservation_id = ${id} AND kind = 'balance'
    `);
    fake.cancelThrows = new PaymentProviderNetworkError('[asaas] timeout');

    const erros = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resultado = await receiveBalanceInCash({
        reservationId: id,
        grossCents: SALDO,
        modality: 'credit',
        registeredBy: GUIA,
      });

      // ORDEM DELIBERADA: escreve primeiro, cancela depois. O dinheiro fica
      // CORRETAMENTE registrado e sobra uma cobranca a cancelar a mao — que e
      // melhor que o inverso (cliente sem como pagar um saldo que o sistema
      // ainda considera em aberto).
      expect(resultado.providerCharge).toBe('falhou');
      expect((await saldoRow(id))!.state).toBe('paid');
      expect((await estadoReserva(id))!.payment_state).toBe('settled');
    } finally {
      erros.mockRestore();
    }
  });
});

// ============================================================================
describe('W4 congelamento — o que esta fase existe para proteger', () => {
  it('W4.1 >>> mudar a taxa NAO altera um registro anterior <<<', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660030');

    await receiveBalanceInCash({
      reservationId: id,
      grossCents: 15000,
      modality: 'credit',
      registeredBy: GUIA,
    });

    const antes = await saldoRow(id);
    expect(antes!.rate_basis_points_applied).toBe(500);
    expect(antes!.net_cents).toBe(14250); // R$ 150 a 5% -> R$ 142,50

    // Novembro: a operadora reajusta e o dono atualiza a tela.
    await comTaxa('credit', 600);

    const depois = await saldoRow(id);
    // Sem congelamento, a reserva de setembro passaria a mostrar R$ 141,00.
    expect(depois!.rate_basis_points_applied).toBe(500);
    expect(depois!.net_cents).toBe(14250);
    expect(depois!.net_cents).not.toBe(14100);
  });

  it('W4.3 o CAMINHO DE LEITURA devolve o congelado, nao um recalculo', async () => {
    // W4.1 prova que as colunas nao mudam, o que e quase tautologico. O risco
    // real e um LEITOR que recalcule na hora de exibir — e e por
    // getReservationDetail que o painel monta a linha do pagamento. Este caso
    // exercita esse caminho.
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660032');
    await receiveBalanceInCash({
      reservationId: id,
      grossCents: 15000,
      modality: 'credit',
      registeredBy: GUIA,
    });

    await comTaxa('credit', 600);

    const detalhe = await getReservationDetail(id);
    const saldo = detalhe!.payment.rows.find((r) => r.kind === 'balance')!;

    expect(saldo.rateBasisPointsApplied).toBe(500);
    expect(saldo.netCents).toBe(14250);
    // Com recalculo na leitura, seria 14100 — a reserva de setembro mudando
    // sozinha em novembro.
    expect(saldo.netCents).not.toBe(14100);
    expect(saldo.cardMachineModality).toBe('credit');
    expect(saldo.registeredBy).toBe(GUIA);
  });

  it('W4.2 o percentual congelado e o VIGENTE NO REGISTRO, nao o primeiro cadastrado', async () => {
    await comTaxa('debit', 200);
    await comTaxa('debit', 350); // o dono corrigiu antes de qualquer registro
    const id = await reservaComSaldo('11966660031');

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: 10000,
      modality: 'debit',
      registeredBy: GUIA,
    });

    expect(resultado.rateBasisPoints).toBe(350);
    expect(resultado.netCents).toBe(9650);
  });
});

// ============================================================================
describe('W5 taxa ausente (decisao de 31/08, que reverte a de 28/08)', () => {
  it('W5.1 sem taxa configurada o registro PASSA, com liquido NULL e nunca 0', async () => {
    // Nenhuma taxa cadastrada — o estado real do Quadri Club hoje.
    const id = await reservaComSaldo('11966660040');

    const resultado = await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    // Recusar nao impediria o dinheiro de ter sido recebido, impediria so o
    // sistema de saber — violando "nunca deixe o saldo fora do sistema".
    expect(resultado.netCents).toBeNull();
    expect(resultado.rateBasisPoints).toBeNull();

    const linha = await saldoRow(id);
    expect(linha!.state).toBe('paid');
    expect(linha!.amount_cents).toBe(16274);
    expect(linha!.card_machine_modality).toBe('credit');

    // >>> NULL E "NAO SEI"; 0 SERIA "NAO TEVE TAXA". <<< A segunda e a mentira
    // que faz o liquido parecer igual ao bruto.
    expect(linha!.net_cents).toBeNull();
    expect(linha!.net_cents).not.toBe(0);
    expect(linha!.rate_basis_points_applied).toBeNull();
  });

  it('W5.2 o registro sem liquido e CONTADO como pendencia', async () => {
    expect(await countReceiptsAwaitingNet()).toBe(0);

    const id = await reservaComSaldo('11966660041');
    await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    // E o que impede a reversao de 31/08 de virar buraco silencioso.
    expect(await countReceiptsAwaitingNet()).toBe(1);
  });

  it('W5.3 cadastrar a taxa depois NAO preenche o registro anterior', async () => {
    const id = await reservaComSaldo('11966660042');
    await receiveBalanceInCash({
      reservationId: id,
      grossCents: SALDO,
      modality: 'credit',
      registeredBy: GUIA,
    });

    await comTaxa('credit', 500);

    // Preencher automaticamente seria recalcular o passado com uma taxa que
    // talvez nao fosse a vigente — fabricar um fato. O preenchimento e
    // operacao deliberada, com o percentual do extrato.
    expect((await saldoRow(id))!.net_cents).toBeNull();
    expect(await countReceiptsAwaitingNet()).toBe(1);
  });

  it('W5.4 pagamento antigo (sem modalidade) NAO conta como pendencia', async () => {
    const id = await reservaComSaldo('11966660043');
    // Linha de saldo comum: net_cents nulo porque nunca passou por maquininha.
    expect((await saldoRow(id))!.net_cents).toBeNull();

    // Sem o recorte por modalidade, isto contaria e a contagem misturaria
    // historia com trabalho a fazer.
    expect(await countReceiptsAwaitingNet()).toBe(0);
  });
});

// ============================================================================
describe('W6 recusas e bordas da rota', () => {
  it('W6.1 reserva cancelada: 409 reserva_inativa', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660050');
    await setReservationStatus(id, 'cancelled');

    const { status, body } = await callPost(id, { valorBrutoCentavos: SALDO, modalidade: 'credit' });
    expect(status).toBe(409);
    expect(body.code).toBe('reserva_inativa');
  });

  it('W6.2 reserva no modo full nao tem saldo: 404', async () => {
    const criada = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt: await primeiroSlot(EXP.longa, 1),
        resourcesNeeded: 1,
        phone: '11966660051',
      }),
    );

    const { status } = await callPost(criada.reservationId, {
      valorBrutoCentavos: 1000,
      modalidade: 'credit',
    });
    expect(status).toBe(404);
  });

  it('W6.3 id malformado, inexistente e de OUTRO TENANT: os tres 404', async () => {
    await insertFixtureTenant(OTHER_TENANT_ID, 'maquininha');
    try {
      const id = await reservaComSaldo('11966660052');
      await db.execute(sql`UPDATE reservations SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${id}`);

      const corpo = { valorBrutoCentavos: 1000, modalidade: 'credit' };
      expect((await callPost('nao-e-uuid', corpo)).status).toBe(404);
      expect((await callPost('00000000-0000-4000-8000-000000000000', corpo)).status).toBe(404);
      expect((await callPost(id, corpo)).status).toBe(404);
    } finally {
      await wipeMovement();
      await removeFixtureTenant(OTHER_TENANT_ID);
    }
  });

  it('W6.4 valor e modalidade invalidos: 422, e nada e gravado', async () => {
    const id = await reservaComSaldo('11966660053');

    expect((await callPost(id, { valorBrutoCentavos: 0, modalidade: 'credit' })).status).toBe(422);
    expect((await callPost(id, { valorBrutoCentavos: -100, modalidade: 'credit' })).status).toBe(422);
    // Centavos sao INTEIROS: 162.74 aqui seria reais disfarcados de centavos.
    expect((await callPost(id, { valorBrutoCentavos: 162.74, modalidade: 'credit' })).status).toBe(422);
    expect((await callPost(id, { valorBrutoCentavos: 1000, modalidade: 'pix' })).status).toBe(422);

    expect((await saldoRow(id))!.state).toBe('pending');
  });

  it('W6.7 SEM SESSAO nao registra: recebimento declarado exige declarante', async () => {
    await comTaxa('credit', 500);
    const id = await reservaComSaldo('11966660055');

    const { status } = await callPost(
      id,
      { valorBrutoCentavos: SALDO, modalidade: 'credit' },
      { semSessao: true },
    );

    expect(status).toBe(401);
    expect((await saldoRow(id))!.state).toBe('pending');
  });

  it('W6.5 erro tipado de reserva inexistente sobe da lib', async () => {
    await expect(
      receiveBalanceInCash({
        reservationId: '00000000-0000-4000-8000-000000000000',
        grossCents: 1000,
        modality: 'credit',
        registeredBy: GUIA,
      }),
    ).rejects.toBeInstanceOf(ReceiptReservationNotFoundError);
  });

  it('W6.6 valor invalido sobe como ReceiptRefusedError, nao como erro do banco', async () => {
    const id = await reservaComSaldo('11966660054');
    const erro = await receiveBalanceInCash({
      reservationId: id,
      grossCents: 0,
      modality: 'credit',
      registeredBy: GUIA,
    }).catch((e: unknown) => e);

    // O CHECK amount_cents > 0 viraria 500; a recusa antes da transacao da uma
    // mensagem util.
    expect(erro).toBeInstanceOf(ReceiptRefusedError);
    expect((erro as InstanceType<typeof ReceiptRefusedError>).reason).toBe('valor_invalido');
  });
});
