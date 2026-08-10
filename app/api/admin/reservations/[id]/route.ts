// GET /api/admin/reservations/{id} — detalhe de UMA reserva (CLAUDE.md secoes 7.2 e 11.1).
//
// Camada FINA sobre lib/reservation-detail.ts, mesmo padrao de
// /api/admin/calendar sobre lib/calendar.ts.
//
// AUTENTICACAO: nao ha checagem aqui de proposito. `/api/admin/*` esta no
// matcher do proxy.ts, que responde 401 em JSON antes desta funcao rodar.
// Repetir a verificacao aqui daria a impressao de que a rota se protege sozinha
// e convidaria alguem a tirar o caminho do matcher um dia.
//
// >>> PRIVACIDADE — as tres regras desta rota <<<
// 1. CPF, numero de documento e contato de emergencia (nome + telefone de
//    terceiro) saem no CORPO, nunca em URL. O que vai na URL e so o id da
//    reserva, que e opaco (uuid) e nao identifica ninguem.
// 2. NADA do payload entra em log. O `console.error` do catch recebe o objeto de
//    erro, e os UNICOS valores que esta rota liga a uma query sao o id e o
//    tenant — nenhum dado do cliente e parametro de statement, entao nem um erro
//    do driver teria como ecoar CPF, CNH ou contato de emergencia. Se um dia
//    alguem acrescentar log de requisicao aqui, os campos `customer.cpf`,
//    `participants[].documentNumber` e `emergencyContact.*` tem que ser
//    redigidos ANTES.
// 3. Nao existe `console.log` de depuracao neste arquivo. Nao acrescente.
//
// SOMENTE LEITURA. O cancelamento e a rota irma em ./cancel.

import { NextResponse } from 'next/server';

import { getReservationDetail } from '@/lib/reservation-detail';

// Detalhe de reserva muda a cada pagamento e cancelamento; cachear serviria
// estado velho para a tela que decide operacao.
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const reservation = await getReservationDetail(id);

    // Inexistente, id malformado e reserva de OUTRO TENANT respondem a mesma
    // coisa. 403 no ultimo caso confirmaria a existencia do id para quem esta
    // sondando; 400 no id malformado nao ajuda ninguem e distingue "formato
    // errado" de "nao existe", que aqui e distincao sem uso.
    if (!reservation) {
      return NextResponse.json({ error: 'reserva nao encontrada' }, { status: 404 });
    }

    return NextResponse.json({ reservation }, { status: 200 });
  } catch (error) {
    // Detalhe no log do servidor, nunca na resposta. Ver a nota de privacidade
    // do cabecalho: nenhum dado sensivel atravessa este caminho.
    console.error('[GET /api/admin/reservations/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
