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
// 3. Cancelar NAO mexe no dinheiro. Ver as duas notas no corpo.

import { NextResponse } from 'next/server';

import { isReservationId } from '@/lib/reservation-detail';
import {
  InvalidReservationTransitionError,
  ReservationNotFoundError,
  setReservationStatus,
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
    const result = await setReservationStatus(id, 'cancelled');

    // ------------------------------------------------------------------
    // FASE 4 — E-MAIL DE CANCELAMENTO ENTRA AQUI (secao 9).
    // Assincrono, e falha de e-mail NUNCA derruba o cancelamento: a vaga ja
    // esta liberada no banco quando esta linha e alcancada.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // DINHEIRO — o que esta rota deliberadamente NAO faz (secoes 8-C e 15.12):
    //
    //   - NAO estorna. Estorno de Pix e operacao MANUAL do dono no painel do
    //     Asaas, porque as taxas nao voltam e um estorno integral logo apos o
    //     recebimento pode ser recusado com 400 por saldo insuficiente na conta
    //     do tenant. Estorno automatico e pos go-live.
    //   - NAO remove a cobranca de saldo no Asaas nem marca pagamentos como
    //     'cancelled'. Isso e Fase 2: hoje nenhuma cobranca chega a existir la,
    //     e as linhas de reservation_payments nascem 'pending' e assim ficam.
    //
    // Quando a Fase 2 entrar, este e o ponto de costura: remover a cobranca de
    // 'balance' pendente, marcar os pagamentos 'cancelled' e sinalizar "estorno
    // pendente" se havia sinal pago.
    // ------------------------------------------------------------------

    return NextResponse.json(
      {
        reservationId: result.reservationId,
        status: result.status,
        previousStatus: result.previousStatus,
        /** Linhas de reservation_resources que sairam do estado ativo = vagas liberadas. */
        resourcesReleased: result.resourceRowsUpdated,
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
