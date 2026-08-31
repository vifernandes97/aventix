// GET /api/admin/reservations/{id}/balance — estado do saldo, e o QR ATUAL
// quando a cobranca ja existe (CLAUDE.md secoes 7.2 e 11.1, Fase C).
//
// >>> ESTE GET NAO CRIA NADA, E ISSO E O DESENHO, NAO UMA OMISSAO <<<
// A secao 7.2 descreve uma rota so, que devolve o saldo "e, sob demanda, o QR
// Code Pix atual". A Fase C a partiu em duas — este GET, que le, e o
// POST .../balance/charge, que cria — porque criar cobranca num GET poe uma
// operacao de DINHEIRO atras do verbo que todo mundo (o prefetch do Next, um
// retry de rede, o dono dando refresh) considera seguro repetir. "Sob demanda"
// e honrado pelo POST: a demanda e o dono apertar o botao, nao a tela abrir.
//
// O painel chama este GET ao abrir uma reserva com saldo, e o POST so no clique.
//
// >>> O `chargeId` NAO SAI NO CORPO <<< — mesma regra da rota publica de
// pagamento. Ele e insumo para pedir o QR; exposto, vira referencia utilizavel
// contra a conta do tenant no provedor. A tela recebe `hasCharge`.

import { NextResponse } from 'next/server';

import { asaasProvider } from '@/lib/payments/asaas';
import { getBalanceState } from '@/lib/payments/balance-charge';

export const dynamic = 'force-dynamic';

/** QR expira: resposta cacheada entrega um codigo que o banco recusa (secao 7.2). */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const balance = await getBalanceState(id);

    // Sem linha de saldo. Tres causas indistinguiveis daqui — reserva
    // inexistente, reserva de outro tenant, reserva vendida no modo `full` — e
    // as tres sao "nao ha saldo neste endereco". O painel ja sabe qual e o
    // caso, porque carregou o detalhe da reserva antes de chamar isto.
    if (!balance) {
      return NextResponse.json(
        { error: 'reserva sem saldo', code: 'sem_saldo' },
        { status: 404, headers: NO_STORE },
      );
    }

    // QR so quando ja existe cobranca E ela segue em aberto. Sem cobranca a
    // resposta continua valida: e o estado normal de toda reserva com sinal ate
    // o dono cobrar.
    let payment = null;
    if (balance.chargeId && balance.state === 'pending') {
      try {
        payment = await asaasProvider.getPixQrCode(balance.chargeId);
      } catch (error) {
        // Provedor fora NAO pode esconder do dono quanto o cliente deve: esse
        // numero sai do banco e e o que ele cobra na maquininha. Loga, devolve
        // o resto, e a tela mostra o valor sem o QR.
        console.error('[GET /api/admin/reservations/{id}/balance] QR indisponivel:', error);
      }
    }

    return NextResponse.json(
      {
        amountCents: balance.amountCents,
        state: balance.state,
        hasCharge: balance.chargeId !== null,
        invoiceUrl: balance.invoiceUrl,
        chargeable: balance.chargeable === true,
        ...(balance.chargeable === true
          ? {}
          : { code: balance.chargeable.reason, detail: balance.chargeable.detail }),
        payment,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error('[GET /api/admin/reservations/{id}/balance] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500, headers: NO_STORE });
  }
}
