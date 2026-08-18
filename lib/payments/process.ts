// Aventix — processamento de UM pagamento (CLAUDE.md secoes 8.2, 8.3 e 8-B).
//
// ============================================================================
// >>> FUNCAO UNICA, USADA PELO WEBHOOK **E** PELA RECONCILIACAO <<<
// A secao 8-B, item 2, e explicita: o job aplica "exatamente a mesma funcao de
// processamento do webhook — mesmo codigo, mesma idempotencia".
//
// O motivo nao e economia de linhas. Duas implementacoes divergem com o tempo, e
// a divergencia se manifesta como "o webhook confirma e a reconciliacao nao" —
// bug que so aparece quando a fila do webhook cai, que e exatamente o momento em
// que a reconciliacao e a unica coisa segurando o fluxo do dinheiro. O bug
// estaria escondido no unico cenario em que ele importa.
// ============================================================================
//
// >>> NUNCA DECIDA PELO PAYLOAD <<<
// Esta funcao recebe um ID de cobranca, nunca um estado. O primeiro passo e
// RECONSULTAR o provedor (secao 8.2 passo 3): o payload diz o que alguem AFIRMA
// que aconteceu; a API diz o que E. Como o corpo do webhook e HTTP de entrada,
// forjar um POST "pago" seria trivial — a reconsulta e o que fecha essa porta.
//
// >>> IDEMPOTENCIA <<<
// Entrega e at-least-once: o mesmo evento chega de novo, e o job de 10 min pode
// pegar o mesmo pagamento que o webhook ja processou. Pagamento com
// `state='paid'` sai por `already_paid` sem escrever nada.

import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { reservationPayments, reservations } from '../db/schema';
import { isExclusionViolation, recalcReservationPayment, setReservationStatus } from '../reservations';
import { asaasProvider } from './asaas';
import { PaymentProviderApiError } from './provider';

/** O que aconteceu com a cobranca. Serve para log e para o retorno do job. */
export type ProcessChargeOutcome =
  /** nenhuma `reservation_payments` casa com o id nem com a referencia externa */
  | 'orphan'
  /** ja estava `paid` — nada a fazer (idempotencia) */
  | 'already_paid'
  /** o provedor ainda nao registra pagamento (pending/overdue) */
  | 'not_paid_yet'
  /** pagamento devido caiu e a reserva foi confirmada */
  | 'confirmed'
  /** pagamento registrado, sem mudanca de status (saldo, ou reserva ja confirmada) */
  | 'recorded'
  /** PIX TARDIO com a vaga ja tomada: dinheiro entrou, reserva segue expirada */
  | 'refund_pending';

export type ProcessChargeResult = {
  outcome: ProcessChargeOutcome;
  chargeId: string;
  paymentId?: string;
  reservationId?: string;
  /** true quando o dono precisa estornar na mao (secao 8-C) */
  refundPending?: boolean;
};

/**
 * Processa uma cobranca do provedor, convergindo o estado local para o dele.
 *
 * NAO LANCA por regra de negocio — devolve `outcome`. Quem chama e o webhook,
 * que nao pode responder 5xx (secao 8.1 regra 7: 15 falhas seguidas
 * INTERROMPEM a fila e os eventos sao descartados depois de 14 dias). Erro de
 * infraestrutura (provedor fora, banco fora) SOBE, porque ai repetir adianta.
 */
export async function processCharge(chargeId: string): Promise<ProcessChargeResult> {
  // -- 1. RECONSULTA o provedor (nunca o payload) ----------------------------
  let charge;
  try {
    charge = await asaasProvider.getCharge(chargeId);
  } catch (error) {
    // 404: a cobranca nao existe NEM no provedor. Isso e regra 6, nao falha de
    // infraestrutura — chega assim quando alguem forja um POST ou quando um id
    // vem de outra conta. Repetir nunca vai achar, entao tratar como erro
    // encheria o log de stack trace e faria a reconciliacao insistir a toa.
    // Orfa DE VERDADE (Pix pessoal do dono) existe no provedor e sai pelo
    // caminho de baixo, sem linha local — os dois convergem para 'orphan'.
    if (error instanceof PaymentProviderApiError && error.status === 404) {
      console.info(`[payments] cobranca ${chargeId} nao existe no provedor; ignorando`);
      return { outcome: 'orphan', chargeId };
    }
    throw error;
  }

  // -- 2. localiza a cobranca local -----------------------------------------
  // Por `asaas_payment_id` e, se nao achar, por `external_reference`. O fallback
  // nao e paranoia: `external_reference` e "{reservationId}:{kind}", unico e
  // deterministico (secao 4.6), gravado ANTES de a cobranca existir no provedor.
  // Se a gravacao do id do provedor falhou depois de a cobranca ser criada, este
  // e o caminho que reconcilia a linha em vez de trata-la como orfa.
  const [payment] = await db
    .select({
      id: reservationPayments.id,
      reservationId: reservationPayments.reservationId,
      kind: reservationPayments.kind,
      state: reservationPayments.state,
      asaasPaymentId: reservationPayments.asaasPaymentId,
    })
    .from(reservationPayments)
    .where(
      charge.externalReference
        ? sql`${reservationPayments.asaasPaymentId} = ${chargeId}
              OR ${reservationPayments.externalReference} = ${charge.externalReference}`
        : eq(reservationPayments.asaasPaymentId, chargeId),
    );

  // -- 3. COBRANCA ORFA E NORMAL (secao 8.1 regra 6) -------------------------
  // Toda entrada de dinheiro na conta do tenant gera evento, inclusive Pix
  // pessoal do dono. Isto NAO e erro: loga e segue. Lancar aqui contaria como
  // falha na fila do webhook e, repetido, a interromperia — o Pix pessoal do
  // dono derrubaria a confirmacao das reservas de todo mundo.
  if (!payment) {
    console.info(
      `[payments] cobranca ${chargeId} nao pertence ao Aventix (nenhuma reserva casa ` +
        'por id nem por referencia externa); ignorando',
    );
    return { outcome: 'orphan', chargeId };
  }

  // -- 4. idempotencia (secao 8.2 passo 5) -----------------------------------
  if (payment.state === 'paid') {
    return {
      outcome: 'already_paid',
      chargeId,
      paymentId: payment.id,
      reservationId: payment.reservationId,
    };
  }

  // -- 5. o provedor ainda nao viu o dinheiro --------------------------------
  // PAYMENT_OVERDUE cai aqui: vencido e devido, nao e estado terminal e nao
  // muda nada localmente. O hold ja tera expirado pelo cron.
  if (charge.state !== 'paid') {
    return {
      outcome: 'not_paid_yet',
      chargeId,
      paymentId: payment.id,
      reservationId: payment.reservationId,
    };
  }

  // -- 6. registra o pagamento e reflete no status (secao 8.2 passo 6) -------
  return db.transaction(async (tx) => {
    // Marca paga. O WHERE repete `state <> 'paid'`: se outra transacao (o job e
    // o webhook processando o mesmo pagamento) tiver marcado entre a leitura
    // acima e esta escrita, esta atualizacao nao encontra a linha e sai por
    // `already_paid`, sem escrever duas vezes.
    const marked = await tx
      .update(reservationPayments)
      .set({
        state: 'paid',
        // Data do provedor quando ele informa; senao o relogio do BANCO.
        paidAt: charge.paidAt ? new Date(charge.paidAt).toISOString() : sql`now()`,
        // Preenche o id do provedor quando a linha foi achada por referencia
        // externa — dali em diante ela reconcilia pelo caminho rapido.
        ...(payment.asaasPaymentId ? {} : { asaasPaymentId: chargeId }),
      })
      .where(
        and(eq(reservationPayments.id, payment.id), sql`${reservationPayments.state} <> 'paid'`),
      )
      .returning({ id: reservationPayments.id });

    if (marked.length === 0) {
      return {
        outcome: 'already_paid' as const,
        chargeId,
        paymentId: payment.id,
        reservationId: payment.reservationId,
      };
    }

    // Deriva amount_paid_cents e payment_state da reserva (invariante 4.6).
    await recalcReservationPayment(payment.reservationId, tx);

    // O SALDO NUNCA MEXE NO STATUS DA RESERVA (secao 5.1): a reserva ja foi
    // confirmada pelo sinal, e o saldo do dia nao pode reabrir essa decisao.
    if (payment.kind === 'balance') {
      return {
        outcome: 'recorded' as const,
        chargeId,
        paymentId: payment.id,
        reservationId: payment.reservationId,
      };
    }

    // Trava a reserva antes de decidir. setReservationStatus faz o proprio
    // FOR UPDATE, mas a DECISAO abaixo depende do status e precisa ler o valor
    // ja estavel — sem isto, o cron de expiracao poderia mudar o status entre a
    // leitura e a escrita.
    const [reservation] = await tx
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, payment.reservationId))
      .for('update');

    if (reservation?.status === 'pending_payment') {
      // Caminho normal. Nao pode estourar a exclusion constraint: as linhas ja
      // estao em 'pending_payment', que ja e um dos status do WHERE — mudar
      // para 'confirmed' as mantem la, sem criar sobreposicao nova.
      await setReservationStatus(payment.reservationId, 'confirmed', tx);
      return {
        outcome: 'confirmed' as const,
        chargeId,
        paymentId: payment.id,
        reservationId: payment.reservationId,
      };
    }

    if (reservation?.status === 'expired') {
      // ================================================================
      // PIX TARDIO (secao 8.3). O hold venceu, a vaga foi liberada e o
      // dinheiro chegou depois.
      //
      // Nao consultamos disponibilidade para decidir: TENTAMOS reconfirmar e
      // deixamos a exclusion constraint responder. Ela e a unica fonte que nao
      // tem janela de corrida — um "checa e depois grava" poderia ver livre e
      // perder a vaga entre as duas operacoes.
      //
      // SAVEPOINT (transacao aninhada do Drizzle) porque a violacao ABORTA a
      // transacao inteira no Postgres. Sem ele, a vaga tomada desfaria tambem o
      // `state='paid'` gravado acima — o sistema esqueceria que o dinheiro
      // entrou, que e o pior desfecho possivel deste fluxo.
      // ================================================================
      try {
        await tx.transaction(async (sp) => {
          await setReservationStatus(payment.reservationId, 'confirmed', sp);
        });

        console.info(
          `[payments] PIX TARDIO reconfirmou a reserva ${payment.reservationId}: ` +
            'o hold tinha expirado e a vaga ainda estava livre',
        );
        return {
          outcome: 'confirmed' as const,
          chargeId,
          paymentId: payment.id,
          reservationId: payment.reservationId,
        };
      } catch (error) {
        if (!isExclusionViolation(error)) throw error;

        // ==============================================================
        // >>> DINHEIRO ENTROU E A VAGA NAO EXISTE MAIS <<<
        // O dono PRECISA ver isto para devolver. O estorno e manual no
        // painel do Asaas (secao 8-C: as taxas nao voltam, e estornar 100%
        // logo apos o recebimento pode dar 400 por saldo insuficiente) —
        // nao ha tentativa de estornar por API aqui, de proposito.
        //
        // NAO ha coluna de "estorno pendente", e nao precisa haver: o estado
        // JA e derivavel, e a consulta e exata —
        //   reservations.status = 'expired' AND reservation_payments.state = 'paid'
        // Uma coluna nova guardaria, com risco de divergir, o que estas duas
        // ja dizem juntas. O indicador de saude do admin (secao 8-B, tarefa
        // separada) le exatamente este predicado.
        // ==============================================================
        console.error(
          '[payments] ESTORNO PENDENTE — pagamento recebido sem vaga: ' +
            JSON.stringify({
              evento: 'refund_pending',
              reservationId: payment.reservationId,
              paymentId: payment.id,
              chargeId,
              motivo: 'pix tardio: o horario foi tomado por outra reserva antes do pagamento',
              acao: 'estornar manualmente no painel do Asaas (secao 8-C)',
            }),
        );

        return {
          outcome: 'refund_pending' as const,
          chargeId,
          paymentId: payment.id,
          reservationId: payment.reservationId,
          refundPending: true,
        };
      }
    }

    // 'confirmed' (outro pagamento ja confirmou) ou 'cancelled' (o dono
    // cancelou antes de o Pix cair). Nos dois casos o pagamento fica
    // registrado e o status nao se mexe; cancelada com dinheiro dentro tambem
    // e caso de estorno manual (secao 8-C).
    const refundPending = reservation?.status === 'cancelled';
    if (refundPending) {
      console.error(
        '[payments] ESTORNO PENDENTE — pagamento recebido em reserva cancelada: ' +
          JSON.stringify({
            evento: 'refund_pending',
            reservationId: payment.reservationId,
            paymentId: payment.id,
            chargeId,
            motivo: 'a reserva foi cancelada antes de o pagamento cair',
            acao: 'estornar manualmente no painel do Asaas (secao 8-C)',
          }),
      );
    }

    return {
      outcome: 'recorded' as const,
      chargeId,
      paymentId: payment.id,
      reservationId: payment.reservationId,
      ...(refundPending ? { refundPending: true } : {}),
    };
  });
}
