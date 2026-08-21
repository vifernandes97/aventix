// GET /api/reservations/{id}/status — estado da reserva para a tela do cliente
// (CLAUDE.md secoes 7.1 e 14).
//
// Camada FINA sobre lib/reservation-status.ts, mesmo padrao das outras rotas de
// leitura do projeto (/api/admin/calendar sobre lib/calendar.ts).
//
// >>> ROTA PUBLICA. A CREDENCIAL E O UUID DA URL. <<<
// Nao ha sessao: `proxy.ts` so protege /admin e /api/admin. Quem tem o link ve
// a resposta, e o link circula por WhatsApp, historico e print de tela. Por
// isso o payload NAO contem nome, telefone, e-mail, CPF, participante, documento
// nem contato de emergencia — link vazado nao pode virar vazamento de dado
// pessoal. A garantia mora na query estreita de lib/reservation-status.ts (que
// nao BUSCA esses campos, em vez de busca-los e filtrar) e no teste
// tests/j-status-reserva.test.ts, que afirma a ausencia contra o payload real.
//
// >>> ALVO DE POLLING: NAO CHAMA O ASAAS <<<
// A tela consulta esta rota a cada 4-8 segundos enquanto o Pix nao cai. Bater no
// provedor de pagamento nesse ritmo, a partir de uma rota que qualquer um
// alcanca, seria abuso de servico de terceiro. O banco e a fonte da verdade do
// estado da reserva (secao 2); o webhook o mantem em dia e o job de
// reconciliacao de 10 minutos e a rede de seguranca (secao 8-B). Quem precisa
// falar com o provedor e a rota irma ../payment, que roda UMA vez por carga.

import { NextResponse } from 'next/server';

import { getPublicReservationStatus } from '@/lib/reservation-status';

// O estado muda por webhook e por cron, fora do ciclo desta requisicao.
export const dynamic = 'force-dynamic';

/**
 * >>> NAO REMOVA, E NAO CONFIE SO NO `dynamic` ACIMA. <<<
 *
 * `force-dynamic` manda o Next RE-EXECUTAR esta funcao; nao impede que a
 * resposta seja guardada DEPOIS dela — por um CDN, pelo proxy do VPS ou pelo
 * cache HTTP do proprio navegador. E este e o unico endpoint do sistema em que
 * uma resposta guardada nao parece um bug: o polling continuaria recebendo
 * 200 com "pending_payment" indefinidamente, com a reserva confirmada no banco,
 * e a tela ficaria dizendo "falta pagar" para quem ja pagou — exatamente o
 * defeito que esta tela existe para consertar, de volta disfarcado de codigo
 * correto.
 *
 * Vai tambem no 404 e no 500: um erro transitorio cacheado condenaria a tela a
 * repeti-lo ate o cache vencer.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const reservation = await getPublicReservationStatus(id);

    // Inexistente, id malformado e reserva de OUTRO TENANT respondem a mesma
    // coisa, pelo mesmo motivo da rota do admin: 403 no ultimo caso confirmaria
    // a existencia do id para quem esta sondando.
    if (!reservation) {
      return NextResponse.json({ error: 'reserva nao encontrada' }, { status: 404, headers: NO_STORE });
    }

    return NextResponse.json(reservation, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error('[GET /api/reservations/{id}/status] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500, headers: NO_STORE });
  }
}
