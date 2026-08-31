// POST /api/admin/reservations/{id}/balance/receive-in-cash — registra o saldo
// recebido na maquininha (CLAUDE.md secao 7.2, Fase D).
//
// O dinheiro NAO passa pelo provedor: nao ha webhook nem confirmacao de
// terceiro. Esta rota e a unica porta por onde entra um recebimento DECLARADO,
// e por isso ela e a unica que exige o RASTRO — quem declarou.
//
// >>> A REGRA DE CONGELAMENTO (4-B.7) MORA NA LIB, NAO AQUI. <<<
// Esta rota valida o corpo, resolve QUEM esta declarando, chama
// `receiveBalanceInCash` e traduz erro tipado em HTTP. Nao calcula liquido, nao
// le taxa, nao decide sobre caminho duplo. Duas copias de uma regra de dinheiro
// divergem, e a que diverge cobra errado.
//
// >>> O `registeredBy` VEM DA SESSAO, NUNCA DO CORPO. <<< Rastro que o cliente
// da requisicao pode escolher nao e rastro: quem quisesse registrar em nome de
// outro so precisaria digitar outro e-mail.

import { type NextRequest, NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/auth';
import { CARD_MACHINE_MODALITIES, type CardMachineModalityName } from '@/lib/financial-config';
import {
  ReceiptRefusedError,
  ReceiptReservationNotFoundError,
  receiveBalanceInCash,
} from '@/lib/payments/receive-in-cash';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

type Body = { valorBrutoCentavos?: unknown; modalidade?: unknown };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // O proxy.ts ja barrou quem nao tem sessao. Isto nao e uma segunda barreira
  // de autenticacao: e a origem do RASTRO, e sem ela o registro nao pode
  // acontecer, porque um recebimento declarado sem declarante e exatamente o
  // que a Fase D existe para nao permitir.
  //
  // `getUserFromRequest` e nao `getCurrentUser`: as duas convergem para
  // `readSessionCookie`, entao a regra de validade da sessao continua num lugar
  // so, mas esta le do NextRequest em vez do contexto de requisicao do App
  // Router. A diferenca e testabilidade — `cookies()` do next/headers lanca
  // fora de um escopo de requisicao, e o RASTRO precisa ser exercitado por
  // teste, nao so por confianca.
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'sessao ausente' }, { status: 401, headers: NO_STORE });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    // 400 fica so para JSON malformado; corpo semanticamente invalido e 422.
    return NextResponse.json({ error: 'corpo invalido' }, { status: 400, headers: NO_STORE });
  }

  const grossCents = body.valorBrutoCentavos;
  if (typeof grossCents !== 'number' || !Number.isInteger(grossCents) || grossCents <= 0) {
    return NextResponse.json(
      {
        error: 'valor invalido',
        code: 'valor_invalido',
        detail: 'valorBrutoCentavos precisa ser inteiro de centavos maior que zero',
      },
      { status: 422, headers: NO_STORE },
    );
  }

  const modality = body.modalidade;
  if (
    typeof modality !== 'string' ||
    !CARD_MACHINE_MODALITIES.includes(modality as CardMachineModalityName)
  ) {
    return NextResponse.json(
      {
        error: 'modalidade invalida',
        code: 'modalidade_invalida',
        detail: `modalidade precisa ser uma de: ${CARD_MACHINE_MODALITIES.join(', ')}`,
      },
      { status: 422, headers: NO_STORE },
    );
  }

  try {
    const result = await receiveBalanceInCash({
      reservationId: id,
      grossCents,
      modality: modality as CardMachineModalityName,
      registeredBy: user.email,
    });

    return NextResponse.json(
      {
        grossCents: result.grossCents,
        modality: result.modality,
        // `null` atravessa a borda como `null`, jamais como 0 — a tela e
        // obrigada a dizer "nao calculado" em palavras (secao 4-B.6).
        rateBasisPoints: result.rateBasisPoints,
        netCents: result.netCents,
        paymentState: result.paymentState,
        balanceCents: result.balanceCents,
        // A tela GRITA quando isto vem 'falhou': a cobranca segue pagavel e o
        // cliente pode pagar de novo em casa.
        providerCharge: result.providerCharge,
        registeredBy: user.email,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Inexistente, outro tenant, id malformado, e reserva vendida em `full`
    // (nunca teve linha de saldo). Todos 404, mesma regra das rotas irmas.
    if (error instanceof ReceiptReservationNotFoundError) {
      return NextResponse.json(
        { error: 'reserva sem saldo a registrar' },
        { status: 404, headers: NO_STORE },
      );
    }

    // 409 — o estado impede. `saldo_ja_liquidado` e o caminho duplo, e e o mais
    // importante deles: o cliente pagou por Pix mais cedo e marcar de novo
    // somaria o mesmo dinheiro duas vezes.
    if (error instanceof ReceiptRefusedError) {
      const status = error.reason === 'valor_invalido' ? 422 : 409;
      return NextResponse.json(
        { error: 'registro recusado', code: error.reason, detail: error.message },
        { status, headers: NO_STORE },
      );
    }

    console.error('[POST .../balance/receive-in-cash] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500, headers: NO_STORE });
  }
}
