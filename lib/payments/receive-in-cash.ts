// Aventix — registro manual do saldo recebido na maquininha (CLAUDE.md secao
// 17, Fase D; regras nas secoes 4-B.6 e 4-B.7).
//
// ============================================================================
// >>> O DINHEIRO NUNCA PASSA PELO PROVEDOR. O SISTEMA SO REGISTRA. <<<
// O cliente pagou o sinal por Pix e, no dia, passa os 50% restantes na
// maquininha do guia. Nao ha webhook, nao ha confirmacao de terceiro, nao ha
// nada a consultar: esta e a UNICA operacao do sistema em que alguem DECLARA
// ter recebido dinheiro. Duas consequencias, e as duas viram codigo aqui:
//
//   1. O LIQUIDO PRECISA SER CALCULADO, e congelado (4-B.7). Para o que passa
//      pelo Asaas o liquido e LIDO de la; so a maquininha exige conta.
//   2. O RASTRO e obrigatorio. Sem quem/quando, uma divergencia de dinheiro
//      entre o dev e o cliente nao tem como ser reconstituida — e essa e a
//      conversa que azeda uma relacao comercial.
// ============================================================================
//
// >>> CONGELAR, NUNCA RECALCULAR (4-B.7) <<<
// Grava bruto, modalidade, percentual aplicado e liquido NA LINHA. Depois disso
// o sistema so LE. A configuracao vale para o PROXIMO registro, jamais para os
// anteriores. Sem isso: em setembro registra R$ 150 a 5% e mostra R$ 142,50; em
// novembro a operadora reajusta para 6%, o dono atualiza a tela, e a reserva de
// SETEMBRO passa a mostrar R$ 141,00. O passado muda sozinho e a conferencia
// com o extrato quebra, sem nada acusar erro.
//
// >>> TAXA AUSENTE GRAVA NULL, E ISSO REVERTE A DECISAO DE 28/08 <<<
// Aquela decisao mandava RECUSAR o registro sem taxa configurada. Foi revertida
// em 31/08 (docs/DECISOES.md) por tres razoes, sendo a primeira decisiva:
// recusar NAO impede o dinheiro de ter sido recebido, impede so o sistema de
// saber — e isso viola a regra mais antiga e mais forte da secao 1, "nunca
// deixe o saldo fora do sistema". O que NAO mudou: `null` e "nao sei" e 0 e
// "nao teve taxa"; gravar 0 aqui seria a mentira que faz o liquido parecer
// igual ao bruto.

import { and, eq, sql } from 'drizzle-orm';

import { applyRate } from '../basis-points';
import { db } from '../db/client';
import {
  type CardMachineModalityName,
  getCardMachineRate,
} from '../financial-config';
import { recalcReservationPayment, type ReservationPaymentState } from '../reservations';
import { reservationPayments, reservations } from '../db/schema';
import { getTenantId } from '../tenant';
import { asaasProvider } from './asaas';

/** Formato de uuid. Ver o mesmo comentario em lib/reservation-detail.ts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// -- erros tipados -----------------------------------------------------------

/** Reserva inexistente, outro tenant, id malformado, ou reserva sem saldo. */
export class ReceiptReservationNotFoundError extends Error {
  constructor(reservationId: string) {
    super(`reserva ${reservationId} nao tem saldo a registrar`);
    this.name = 'ReceiptReservationNotFoundError';
  }
}

export type ReceiptRefusalReason =
  /** reserva cancelada ou expirada */
  | 'reserva_inativa'
  /**
   * >>> O CAMINHO DUPLO. <<< O saldo ja esta liquidado — tipicamente porque o
   * cliente pagou por Pix mais cedo e o webhook ja registrou. Marcar de novo
   * somaria dinheiro que entrou UMA vez.
   */
  | 'saldo_ja_liquidado'
  /** a linha de saldo nao esta em aberto (cancelada/estornada) */
  | 'saldo_indisponivel'
  /** bruto <= 0, ou fora de faixa */
  | 'valor_invalido';

export class ReceiptRefusedError extends Error {
  readonly reason: ReceiptRefusalReason;

  constructor(reason: ReceiptRefusalReason, detail: string) {
    super(detail);
    this.name = 'ReceiptRefusedError';
    this.reason = reason;
  }
}

// -- previa ------------------------------------------------------------------

/**
 * Os tres numeros que o guia PRECISA ver antes de confirmar: bruto, taxa,
 * liquido.
 *
 * `rateBasisPoints`/`netCents` vem `null` quando a modalidade nao tem taxa
 * configurada. A tela e OBRIGADA a dizer isso em palavras — nunca deixar o
 * campo em branco, que se le como zero.
 */
export type ReceiptPreview = {
  grossCents: number;
  modality: CardMachineModalityName;
  rateBasisPoints: number | null;
  feeCents: number | null;
  netCents: number | null;
};

/**
 * Calcula a previa no SERVIDOR. A tela espelha o mesmo calculo chamando
 * `applyRate` diretamente (modulo puro, sem `server-only`, nascido para ser
 * chamado dos dois lados — mesma escolha que a Fase A fez com `applyDiscount`),
 * mas quem decide e este lado.
 */
export async function previewReceipt(
  grossCents: number,
  modality: CardMachineModalityName,
): Promise<ReceiptPreview> {
  const rateBasisPoints = await getCardMachineRate(modality);

  if (rateBasisPoints === null) {
    // NAO cai para 0. Ver o cabecalho.
    return { grossCents, modality, rateBasisPoints: null, feeCents: null, netCents: null };
  }

  const { feeCents, netCents } = applyRate(grossCents, rateBasisPoints);
  return { grossCents, modality, rateBasisPoints, feeCents, netCents };
}

// -- registro ----------------------------------------------------------------

export type ReceiptResult = {
  paymentId: string;
  grossCents: number;
  modality: CardMachineModalityName;
  rateBasisPoints: number | null;
  netCents: number | null;
  paymentState: ReservationPaymentState;
  balanceCents: number;
  /**
   * A cobranca Pix do saldo foi cancelada no provedor?
   *
   * `'nao_havia'` — nunca foi gerada (o caminho comum).
   * `'cancelada'` — existia e foi removida.
   * `'falhou'`    — existia, o cancelamento NAO passou, e o cliente CONSEGUE
   *                 pagar de novo. A tela e obrigada a gritar isso.
   */
  providerCharge: 'nao_havia' | 'cancelada' | 'falhou';
};

/**
 * Registra o saldo recebido por fora e liquida a linha.
 *
 * @throws {ReceiptReservationNotFoundError} reserva inexistente/outro tenant/sem saldo
 * @throws {ReceiptRefusedError} ha saldo, mas registrar agora estaria errado
 */
export async function receiveBalanceInCash(params: {
  reservationId: string;
  grossCents: number;
  modality: CardMachineModalityName;
  /** e-mail da sessao do admin — o RASTRO (ver cabecalho). Obrigatorio. */
  registeredBy: string;
}): Promise<ReceiptResult> {
  const { reservationId, grossCents, modality, registeredBy } = params;

  if (!UUID.test(reservationId)) throw new ReceiptReservationNotFoundError(reservationId);

  // `amount_cents > 0` e CHECK do banco; recusar antes da transacao da uma
  // mensagem util em vez de um 500 vindo da constraint.
  if (!Number.isInteger(grossCents) || grossCents <= 0) {
    throw new ReceiptRefusedError('valor_invalido', 'o valor recebido precisa ser maior que zero');
  }

  const tenantId = getTenantId();

  const [row] = await db
    .select({
      paymentId: reservationPayments.id,
      chargeId: reservationPayments.asaasPaymentId,
      state: reservationPayments.state,
      reservationStatus: reservations.status,
    })
    .from(reservationPayments)
    .innerJoin(reservations, eq(reservations.id, reservationPayments.reservationId))
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        eq(reservationPayments.kind, 'balance'),
        eq(reservations.tenantId, tenantId),
      ),
    );

  // Sem linha de saldo: inexistente, outro tenant, ou reserva vendida em
  // `full`. Indistinguiveis de proposito, mesma regra do detalhe.
  if (!row) throw new ReceiptReservationNotFoundError(reservationId);

  if (row.reservationStatus === 'cancelled' || row.reservationStatus === 'expired') {
    throw new ReceiptRefusedError(
      'reserva_inativa',
      `a reserva esta ${row.reservationStatus === 'cancelled' ? 'cancelada' : 'expirada'}`,
    );
  }

  // >>> ARMADILHA 1: O CAMINHO DUPLO. <<<
  // O cliente pagou o saldo por Pix as 8h e o webhook registrou; as 9h o guia
  // marca "recebi na maquininha". Sem esta checagem o sistema somaria duas
  // vezes o mesmo dinheiro, e a reserva passaria a dizer que recebeu o dobro.
  // A recusa e por ESTADO DA LINHA, nao por `payment_state` da reserva: a
  // linha e o fato, o agregado e derivado dela.
  if (row.state === 'paid') {
    throw new ReceiptRefusedError(
      'saldo_ja_liquidado',
      'o saldo desta reserva ja consta como pago; registrar de novo somaria o mesmo dinheiro duas vezes',
    );
  }

  if (row.state !== 'pending') {
    throw new ReceiptRefusedError(
      'saldo_indisponivel',
      `a linha de saldo esta ${row.state} e nao pode receber registro`,
    );
  }

  // Percentual VIGENTE AGORA, lido uma vez e congelado abaixo. Ler de novo na
  // exibicao e o que a 4-B.7 proibe.
  const rateBasisPoints = await getCardMachineRate(modality);
  const applied =
    rateBasisPoints === null ? null : applyRate(grossCents, rateBasisPoints);

  // -- escrita ---------------------------------------------------------------
  //
  // `amount_cents` passa a valer o BRUTO RECEBIDO (decisao de 31/08). A linha,
  // uma vez paga, significa "dinheiro que entrou", e e isso que
  // recalcReservationPayment soma. Deixar o valor devido faria uma reserva em
  // que o guia recebeu R$ 100 de um saldo de R$ 162,74 ir para `settled`,
  // AFIRMANDO ter recebido o que nao recebeu. Recebendo menos, a reserva fica
  // `partial` e o saldo continua visivel na agenda, que e a leitura honesta.
  const recalc = await db.transaction(async (tx) => {
    await tx
      .update(reservationPayments)
      .set({
        state: 'paid',
        receivedInCash: true,
        // Relogio do BANCO, nao do Node: o sistema usa `now()` de proposito
        // (secao 3), e e o mesmo relogio que o webhook grava em paid_at.
        paidAt: sql`now()`,
        amountCents: grossCents,
        cardMachineModality: modality,
        rateBasisPointsApplied: rateBasisPoints,
        netCents: applied?.netCents ?? null,
        registeredBy,
        registeredAt: sql`now()`,
      })
      .where(eq(reservationPayments.id, row.paymentId));

    // MESMA transacao (secao 4.6): o agregado da reserva nunca fica um instante
    // discordando das linhas.
    return recalcReservationPayment(reservationId, tx);
  });

  // -- ARMADILHA 2: a cobranca Pix do saldo ainda viva -----------------------
  //
  // Se a Fase C gerou o QR e o cliente nao pagou por ali, aquela cobranca
  // continua PAGAVEL. Sem cancelar, o cliente paga de novo em casa achando que
  // ainda deve — e o webhook, encontrando a linha ja `paid`, responderia 200
  // sem registrar nada (idempotencia), entao o dinheiro entraria na conta do
  // tenant SEM aparecer no sistema. Estorno seria manual.
  //
  // >>> DEPOIS DA ESCRITA, NUNCA ANTES, E A ORDEM E DELIBERADA. <<<
  // Cancelar primeiro e falhar na escrita deixaria o cliente sem como pagar
  // online um saldo que o sistema ainda considera em aberto. Escrever primeiro
  // e falhar no cancelamento deixa o dinheiro CORRETAMENTE registrado e uma
  // cobranca a cancelar a mao. Entre as duas, a que preserva o registro do
  // dinheiro vence — e a regra da secao 1.
  let providerCharge: ReceiptResult['providerCharge'] = 'nao_havia';

  if (row.chargeId) {
    try {
      await asaasProvider.cancelCharge(row.chargeId);
      providerCharge = 'cancelada';
    } catch (error) {
      // NAO relanca: o dinheiro ja esta registrado e derrubar a operacao aqui
      // faria o dono repetir um registro que ja aconteceu. Volta no resultado
      // para a tela avisar em voz alta.
      providerCharge = 'falhou';
      console.error(
        `[receive-in-cash] reserva ${reservationId}: o saldo foi registrado, mas a cobranca ` +
          `${row.chargeId} NAO foi cancelada no provedor. O cliente ainda consegue paga-la. ` +
          'Cancele no painel do Asaas.',
        error,
      );
    }
  }

  return {
    paymentId: row.paymentId,
    grossCents,
    modality,
    rateBasisPoints,
    netCents: applied?.netCents ?? null,
    paymentState: recalc.paymentState,
    balanceCents: recalc.balanceCents,
    providerCharge,
  };
}

// -- pendencia de liquido -----------------------------------------------------

/**
 * Quantos registros de maquininha ficaram SEM liquido, por falta de taxa
 * configurada.
 *
 * >>> ISTO E O QUE IMPEDE A REVERSAO DE 31/08 DE VIRAR BURACO SILENCIOSO. <<<
 * Permitir registrar sem taxa so e defensavel se alguem for lembrado de voltar.
 * Sem esta contagem em /admin/financeiro, teriamos trocado uma falha visivel
 * (o registro recusado na hora) por uma invisivel (o liquido que nunca chega) —
 * o padrao que ja mordeu este projeto tres vezes.
 *
 * O preenchimento posterior e operacao DELIBERADA, com o percentual historico
 * do extrato. Nunca recalculo automatico, que a 4-B.7 proibe.
 */
export async function countReceiptsAwaitingNet(): Promise<number> {
  // `card_machine_modality IS NOT NULL` isola os registros da Fase D: um
  // pagamento antigo tambem tem net_cents nulo, e nao e pendencia nenhuma.
  // Sem esse recorte a contagem misturaria historia com trabalho a fazer.
  const { rows } = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM reservation_payments rp
    JOIN reservations r ON r.id = rp.reservation_id
    WHERE r.tenant_id = ${getTenantId()}
      AND rp.card_machine_modality IS NOT NULL
      AND rp.net_cents IS NULL
  `);

  return rows[0]?.total ?? 0;
}
