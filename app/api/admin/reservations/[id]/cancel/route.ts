// POST /api/admin/reservations/{id}/cancel — cancela e LIBERA as vagas
// (CLAUDE.md secoes 5.1, 4.6 e 7.2).
//
// PRIMEIRA ROTA DE ESCRITA DO ADMIN. Tres regras que nao se negociam:
//
// 1. >>> A escrita passa por setReservationStatus, nunca por UPDATE direto. <<<
//    Regra inviolavel da secao 4.6. Aquela funcao trava a linha com FOR UPDATE e
//    sincroniza `reservation_resources.status` na MESMA transacao — e o status
//    das linhas de recurso que a exclusion constraint enxerga. E exatamente isso
//    que LIBERA a vaga: sair de pending_payment/confirmed tira a linha do WHERE
//    da constraint. Um UPDATE em `reservations` sozinho deixaria o horario
//    travado para sempre, sem erro nenhum aparecendo.
//
// 2. A maquina de estados (secao 5.1) ja mora em setReservationStatus. Esta rota
//    NAO reimplementa "so pode cancelar de pending_payment ou confirmed": ela
//    chama e traduz InvalidReservationTransitionError em 409. Duas copias da
//    mesma regra divergem com o tempo.
//
// 3. Cancelar NAO ESTORNA — mas CANCELA a cobranca pendente. Ver a nota no corpo.

import { NextResponse } from 'next/server';

import { cancelReservationAndCharges } from '@/lib/payments/cancel-charges';
import { isReservationId } from '@/lib/reservation-detail';
import {
  InvalidReservationTransitionError,
  ReservationNotFoundError,
} from '@/lib/reservations';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // Mesma razao da rota irma de leitura: `WHERE id = 'abc'` numa coluna uuid
  // aborta com 22P02 e viraria 500. Malformado responde 404, igual a
  // inexistente e a reserva de outro tenant.
  if (!isReservationId(id)) {
    return NextResponse.json({ error: 'reserva nao encontrada' }, { status: 404 });
  }

  try {
    const result = await cancelReservationAndCharges(id);

    // ------------------------------------------------------------------
    // FASE 4 — E-MAIL DE CANCELAMENTO ENTRA AQUI (secao 9).
    // Assincrono, e falha de e-mail NUNCA derruba o cancelamento: a vaga ja
    // esta liberada no banco quando esta linha e alcancada.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // DINHEIRO — o que foi COSTURADO e o que continua deliberadamente de fora.
    //
    // O comentario que vivia aqui dizia que remover a cobranca era "Fase 2,
    // hoje nenhuma cobranca chega a existir la". Aquilo era verdade quando foi
    // escrito e envelheceu LITERALMENTE, em duas etapas: a cobranca do valor
    // devido nasce logo apos a criacao da reserva (`charge.ts`), e a do saldo
    // passou a nascer sob demanda em 28/08 (Fase C). Enquanto o comentario
    // permaneceu, o dono cancelava, a vaga era liberada, e o cliente continuava
    // conseguindo pagar uma reserva que nao existia mais.
    //
    //   - CANCELA no Asaas toda cobranca PENDENTE da reserva e marca as linhas
    //     como 'cancelled' (`lib/payments/cancel-charges.ts`). Nao e so o
    //     saldo: dependendo do estado, o que esta vivo e a cobranca do valor
    //     integral, a do sinal, a do saldo, ou nenhuma.
    //   - NAO estorna, e isso NAO mudou. Estorno de Pix e operacao MANUAL do
    //     dono no painel do Asaas (secao 8-C), porque as taxas nao voltam e um
    //     estorno integral logo apos o recebimento pode ser recusado com 400 por
    //     saldo insuficiente na conta do tenant. A politica do tenant e nao
    //     devolver o sinal (secao 4-C). Cobranca ja PAGA nao e sequer tocada.
    // ------------------------------------------------------------------

    return NextResponse.json(
      {
        reservationId: result.reservationId,
        status: result.status,
        previousStatus: result.previousStatus,
        /** Linhas de reservation_resources que sairam do estado ativo = vagas liberadas. */
        resourcesReleased: result.resourceRowsUpdated,
        /** Linhas de reservation_payments que sairam de 'pending'. */
        paymentsCancelled: result.paymentsCancelled,
        providerCancelled: result.providerCancelled,
        /**
         * >>> A TELA E OBRIGADA A AVISAR EM VOZ ALTA QUANDO ISTO FOR > 0. <<<
         * A reserva esta cancelada e a vaga liberada — mas estas cobrancas
         * continuam PAGAVEIS, e o dono e o unico que pode consertar, no painel
         * do Asaas. Nao ha retentativa automatica, de proposito: o
         * reconciliador exclui reservas canceladas por decisao explicita da
         * secao 8-B, e este numero na tela e o que substitui a fila.
         */
        providerFailed: result.providerFailed,
      },
      { status: 200 },
    );
  } catch (error) {
    // Inexistente ou de outro tenant — setReservationStatus ja filtra por
    // tenant. Mesma resposta dos dois casos, pelo mesmo motivo da rota de leitura.
    if (error instanceof ReservationNotFoundError) {
      return NextResponse.json({ error: 'reserva nao encontrada' }, { status: 404 });
    }

    // 409 — ja cancelada, ou expirada. Nao e falha do servidor nem corpo
    // invalido: e o estado atual do recurso que impede a operacao. `detail`
    // carrega a mensagem tipada, que ja nomeia o status de origem e as
    // transicoes validas a partir dele.
    if (error instanceof InvalidReservationTransitionError) {
      return NextResponse.json(
        {
          error: 'transicao invalida',
          detail: error.message,
          currentStatus: error.from,
        },
        { status: 409 },
      );
    }

    console.error('[POST /api/admin/reservations/{id}/cancel] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
