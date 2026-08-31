// Aventix — reconciliacao de pagamentos (CLAUDE.md secao 8-B).
//
// ============================================================================
// >>> REDE DE SEGURANCA OBRIGATORIA, NAO OTIMIZACAO <<<
// A fila de webhook do Asaas INTERROMPE depois de 15 falhas consecutivas. Uma
// vez interrompida, ela para de entregar: os eventos ficam retidos e sao
// descartados apos 14 dias. Enquanto isso o Pix continua caindo na conta do
// tenant e o sistema nao fica sabendo de nada — reserva paga expirando por hold
// vencido, cliente com o comprovante na mao e a vaga vendida para outro.
//
// Este job e o que impede esse cenario de durar mais de 10 minutos. Ele nao
// depende do webhook, nem de a fila estar viva, nem de o Asaas conseguir nos
// alcancar: e o Aventix que vai perguntar.
// ============================================================================
//
// Roda a MESMA funcao do webhook (`processCharge`), como a secao 8-B item 2
// exige. Ver o cabecalho de lib/payments/process.ts para o porque.
//
// Vizinho de expire-holds.ts e pelo mesmo motivo: a logica mora em lib/ para ser
// testavel isolada e chamavel a mao; instrumentation.ts so agenda.

import { and, eq, lt, ne, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { reservationPayments, reservations } from '../db/schema';
import { type ProcessChargeOutcome, processCharge } from '../payments/process';

/**
 * Carencia antes de reconsultar uma cobranca (secao 8-B item 1: "criada ha mais
 * de 5 min"). Serve para nao competir com o webhook no caminho feliz — ele
 * costuma chegar em segundos, e reconsultar antes disso so gastaria chamada.
 */
const MIN_AGE_MINUTES = 5;

export type ReconcilePaymentsResult = {
  /** cobrancas pendentes que entraram na varredura */
  checked: number;
  /** quantas mudaram de estado (o que o webhook deixou passar) */
  reconciled: number;
  /** ids de reserva que precisam de estorno manual (secao 8-C) */
  refundPending: string[];
  outcomes: Record<string, number>;
};

/**
 * Varre pagamentos pendentes e converge cada um contra o provedor.
 *
 * Idempotente: cobranca ja paga sai por `already_paid` sem escrever. Uma falha
 * numa cobranca NAO interrompe as demais — o dinheiro das outras nao pode ficar
 * refem de um erro pontual.
 */
export async function reconcilePayments(): Promise<ReconcilePaymentsResult> {
  // Cobrancas em aberto de reservas que ainda importam.
  //
  // `cancelled` fica de fora (secao 8-B item 1): a cobranca de saldo de uma
  // reserva cancelada foi removida no provedor, e insistir nela geraria consulta
  // inutil a cada 10 minutos, para sempre. Reserva `expired` CONTINUA na
  // varredura de proposito: e exatamente ali que mora o Pix tardio (secao 8.3).
  //
  // Casa com idx_rp_open (state, due_date) WHERE state = 'pending'.
  const pending = await db
    .select({
      chargeId: reservationPayments.asaasPaymentId,
      paymentId: reservationPayments.id,
      reservationId: reservationPayments.reservationId,
      // Necessario para distinguir as DUAS causas de "sem id no provedor" no
      // laco abaixo. Ate a Fase B so existia uma, e por isso nao era lido aqui.
      kind: reservationPayments.kind,
    })
    .from(reservationPayments)
    .innerJoin(reservations, eq(reservations.id, reservationPayments.reservationId))
    .where(
      and(
        eq(reservationPayments.state, 'pending'),
        ne(reservations.status, 'cancelled'),
        // Relogio do BANCO, igual ao expire-holds.
        lt(reservationPayments.createdAt, sql`now() - make_interval(mins => ${MIN_AGE_MINUTES})`),
      ),
    );

  const outcomes: Record<string, number> = {};
  const refundPending: string[] = [];
  let reconciled = 0;
  let checked = 0;

  for (const row of pending) {
    // ------------------------------------------------------------------
    // >>> SEM ID NO PROVEDOR TEM DUAS CAUSAS, E SO UMA E ANOMALIA <<<
    //
    // Ate a Fase B havia uma causa so, e por isso este bloco avisava sempre.
    // A Fase B criou a segunda, e ela e ROTINA:
    //
    //   kind='balance'         -> o dono ainda nao cobrou o saldo. A linha
    //                             nasce junto da reserva (secao 5.2 passo 3),
    //                             mas a cobranca so existe quando ele aperta
    //                             "Cobrar saldo". ESTADO ESPERADO.
    //   kind='deposit'|'full'  -> a cobranca do pagamento DEVIDO falhou depois
    //                             da transacao (caso de borda 9). A reserva
    //                             nasceu sem QR e o cliente nao tem como pagar.
    //                             ANOMALIA.
    //
    // O silencio do `balance` e PERMANENTE, nao um remendo ate a Fase C: mesmo
    // depois dela, `balance` sem id continua sendo "ainda nao cobrei", que e o
    // estado normal de toda reserva com sinal ate a vespera. O que volta a ser
    // assunto deste job e `balance` COM id, e esse cai no fluxo normal abaixo.
    //
    // >>> NUNCA silencie por "sem id" em vez de por `kind`. <<< Esse aviso e o
    // UNICO sinal que existe das reservas da borda 9 (ha 3 em producao hoje);
    // alargar o filtro as apagaria junto com o ruido.
    //
    // Por que isto e regra e nao ajuste cosmetico: sem o filtro, cada reserva
    // com sinal gera uma linha a cada 10 minutos, para sempre. Medido em
    // 28/08: 7 linhas por ciclo com 4 reservas de teste. Ruido constante faz
    // parar de ler o log, e e olhando log que este projeto pegou falha surda
    // tres vezes. Um aviso que dispara sempre nao e aviso, e fundo.
    // ------------------------------------------------------------------
    if (!row.chargeId) {
      if (row.kind !== 'balance') {
        console.warn(
          `[reconcile-payments] pagamento ${row.paymentId} (reserva ${row.reservationId}) ` +
            `kind=${row.kind} sem id no provedor; a criacao da cobranca falhou ` +
            '(caso de borda 9) e o cliente nao tem como pagar',
        );
      }
      continue;
    }

    checked += 1;

    try {
      const result = await processCharge(row.chargeId);
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;

      // DIVERGENCIA (secao 8-B item 3): o pagamento estava `pending` para nos e
      // o provedor ja o dava como pago. E a medida de quanto o webhook deixou
      // passar — se este numero deixar de ser zero com frequencia, a fila esta
      // com problema e o indicador de saude do admin tem que gritar.
      if (isDivergence(result.outcome)) {
        reconciled += 1;
        console.warn(
          '[reconcile-payments] DIVERGENCIA corrigida: ' +
            JSON.stringify({
              reservationId: row.reservationId,
              chargeId: row.chargeId,
              outcome: result.outcome,
              nota: 'o provedor ja registrava pagamento que o webhook nao entregou',
            }),
        );
      }

      if (result.refundPending) refundPending.push(row.reservationId);
    } catch (error) {
      // Provedor fora, banco fora, bug. Loga e SEGUE: as outras cobrancas nao
      // podem ficar paradas por causa desta, e o proximo tick tenta de novo.
      console.error(
        `[reconcile-payments] falha ao reconciliar a cobranca da reserva ${row.reservationId}:`,
        error,
      );
    }
  }

  return { checked, reconciled, refundPending, outcomes };
}

/** Estados que so podem ter surgido de um pagamento que o webhook nao entregou. */
function isDivergence(outcome: ProcessChargeOutcome): boolean {
  return outcome === 'confirmed' || outcome === 'recorded' || outcome === 'refund_pending';
}
